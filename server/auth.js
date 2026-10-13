// Optional login, off by default. It is on when AUTH_ENABLED=true, off when
// AUTH_ENABLED=false, and otherwise follows the editor's toggle (the
// auth_enabled setting). When it's off, nothing here gets in the way:
// requireAuth() lets every request through and /api/auth/session reports
// { auth_enabled: false }.
//
// - Passwords: scrypt from node:crypto, stored as scrypt$N$r$p$salt$hash.
// - Sessions: a random token in an HttpOnly, SameSite=Lax cookie; the
//   database stores only its SHA-256, so a leaked database can't be replayed
//   as cookies. Sessions last SESSION_TTL_HOURS and renew when half used.
// - CSRF: SameSite=Lax keeps the cookie off cross-site POSTs, and
//   state-changing requests whose Origin isn't this host are refused.
// - Brute force: 10 failed logins per IP per 15 minutes, then 429.
import crypto from 'crypto';
import { promisify } from 'util';
import express from 'express';
import { Op } from 'sequelize';
import { config } from './config.js';
import { User, Session, getSetting, putSetting } from './db.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'mfe_session';
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

// ── On or off ──
let ui_setting = false;

/** Whether sign-in is required right now. */
export const isAuthEnabled = () => config.auth_enabled_env ?? ui_setting;

/** True when AUTH_ENABLED decides, so the editor's toggle is locked. */
export const isAuthLocked = () => config.auth_enabled_env !== null;

/** Reads the toggle from the database (at startup). */
export async function loadAuthSetting() {
  ui_setting = Boolean(await getSetting('auth_enabled', false));
}

async function setAuthSetting(value) {
  await putSetting('auth_enabled', Boolean(value));
  ui_setting = Boolean(value);
}

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ── Passwords ──
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, { ...SCRYPT, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Compared against when the username doesn't exist, so a wrong username takes
// as long as a wrong password.
let dummy_hash = null;
const dummyHash = async () => (dummy_hash ??= await hashPassword(crypto.randomBytes(16).toString('hex')));

// Usernames are stored lowercase, so "Ada" and "ada" are the same account on
// every database (MySQL compares case-insensitively, SQLite/PostgreSQL don't).
export const normalizeUsername = (username) => String(username ?? '').trim().toLowerCase();

export function checkUsername(username) {
  const name = normalizeUsername(username);
  if (!/^[\w.@-]{1,64}$/.test(name)) {
    throw new AuthError('Usernames are 1–64 characters: letters, numbers and . _ @ -');
  }
  return name;
}

export function checkPassword(password) {
  const text = String(password ?? '');
  if (text.length < 8) throw new AuthError('Passwords need at least 8 characters.');
  if (text.length > 256) throw new AuthError('Passwords can be at most 256 characters.');
  return text;
}

export async function createUser(username, password) {
  const name = checkUsername(username);
  checkPassword(password);
  if (await User.findOne({ where: { username: name } })) throw new AuthError(`The user "${name}" already exists.`, 409);
  return User.create({ username: name, password_hash: await hashPassword(password) });
}

export async function setPassword(user, password) {
  checkPassword(password);
  await user.update({ password_hash: await hashPassword(password) });
}

// ── Sessions ──
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const ttlMs = () => config.session_ttl_hours * 3600 * 1000;

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      try { cookies[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim()); } catch { /* skip */ }
    }
  }
  return cookies;
}

function setCookie(req, res, token, max_age_ms) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: max_age_ms,
  });
}

async function startSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  await Session.create({ id: sha256(token), user_id: user.id, expires_at: new Date(Date.now() + ttlMs()) });
  await user.update({ last_login_at: new Date() });
  setCookie(req, res, token, ttlMs());
}

// The signed-in user for a request, or null. Renews sessions past half-life.
async function sessionUser(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const session = await Session.findByPk(sha256(token), { include: User });
  if (!session || !session.User) return null;
  const left = session.expires_at.getTime() - Date.now();
  if (left <= 0) {
    await session.destroy();
    return null;
  }
  if (left < ttlMs() / 2) {
    await session.update({ expires_at: new Date(Date.now() + ttlMs()) });
    setCookie(req, res, token, ttlMs());
  }
  req.session_id = session.id;
  return session.User;
}

const publicUser = (user) => (user ? {
  id: user.id,
  username: user.username,
  created_at: user.createdAt,
  last_login_at: user.last_login_at,
} : null);

// ── Brute-force limit ──
const failures = new Map(); // ip → [timestamps]

function recentFailures(ip) {
  const now = Date.now();
  const list = (failures.get(ip) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
  if (list.length) failures.set(ip, list);
  else failures.delete(ip);
  return list;
}

function noteFailure(ip) {
  recentFailures(ip);
  failures.set(ip, [...(failures.get(ip) ?? []), Date.now()]);
}

// ── Middleware ──
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Refuses state-changing requests sent from another site.
function sameOrigin(req) {
  if (SAFE_METHODS.has(req.method)) return true;
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (curl, scripts)
  try {
    // req.host follows X-Forwarded-Host when TRUST_PROXY is set, so a reverse
    // proxy that rewrites Host still matches the browser's Origin.
    return new URL(origin).host === (req.host ?? req.headers.host);
  } catch {
    return false;
  }
}

/** Express middleware: requires a signed-in user when AUTH_ENABLED is on. */
export async function requireAuth(req, res, next) {
  if (!isAuthEnabled()) return next();
  try {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'cross-site request refused' });
    const user = await sessionUser(req, res);
    if (!user) return res.status(401).json({ error: 'sign in first', auth_required: true });
    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

// ── Startup helpers ──
/** Creates ADMIN_USERNAME / ADMIN_PASSWORD when set and missing. */
export async function bootstrapAdmin() {
  if (!config.admin_username && !config.admin_password) return;
  if (!config.admin_username || !config.admin_password) {
    console.warn('ADMIN_USERNAME and ADMIN_PASSWORD must both be set to create the first account; ignoring them.');
    return;
  }
  try {
    const name = checkUsername(config.admin_username);
    if (await User.findOne({ where: { username: name } })) return;
    await createUser(name, config.admin_password);
    console.log(`Created the user "${name}" from ADMIN_USERNAME.`);
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    console.warn(`Could not create the account from ADMIN_USERNAME/ADMIN_PASSWORD: ${error.message}`);
  }
}

/** Deletes expired sessions now and every hour. Returns a stop function. */
export function startSessionCleanup() {
  const sweep = () => Session.destroy({ where: { expires_at: { [Op.lt]: new Date() } } }).catch(() => {});
  sweep();
  const timer = setInterval(sweep, 3600 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

// ── Routes: /api/auth/* ──
export const router = express.Router();

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.message });
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};

const requireEnabled = () => {
  if (!isAuthEnabled()) throw new AuthError('Sign-in is turned off on this server.', 404);
};

const requireUnlocked = () => {
  if (isAuthLocked()) {
    throw new AuthError(`Sign-in is set by the AUTH_ENABLED environment variable (${config.auth_enabled_env}), so it can't be changed here.`, 409);
  }
};

async function signedIn(req, res) {
  requireEnabled();
  if (!sameOrigin(req)) throw new AuthError('cross-site request refused', 403);
  const user = await sessionUser(req, res);
  if (!user) throw new AuthError('sign in first', 401);
  return user;
}

router.get('/auth/session', handle(async (req, res) => {
  const locked = isAuthLocked();
  if (!isAuthEnabled()) {
    return res.json({ auth_enabled: false, auth_locked: locked, needs_setup: false, has_users: (await User.count()) > 0, user: null });
  }
  const user = await sessionUser(req, res);
  const has_users = user ? true : (await User.count()) > 0;
  return res.json({ auth_enabled: true, auth_locked: locked, needs_setup: !has_users, has_users, user: publicUser(user) });
}));

// Turns sign-in on from the editor. Needs credentials in the same request so
// nobody gets locked out: with no accounts yet they create the first one,
// otherwise they must match an existing account. Signs the caller in.
router.post('/auth/enable', handle(async (req, res) => {
  requireUnlocked();
  if (!sameOrigin(req)) throw new AuthError('cross-site request refused', 403);
  if (isAuthEnabled()) throw new AuthError('Sign-in is already on.', 409);
  if (recentFailures(req.ip).length >= MAX_FAILURES) {
    throw new AuthError('Too many failed sign-ins. Wait a few minutes and try again.', 429);
  }
  let user;
  if ((await User.count()) === 0) {
    user = await createUser(req.body?.username, req.body?.password);
  } else {
    const username = normalizeUsername(req.body?.username);
    user = username ? await User.findOne({ where: { username } }) : null;
    const ok = await verifyPassword(String(req.body?.password ?? ''), user?.password_hash ?? await dummyHash());
    if (!user || !ok) {
      noteFailure(req.ip);
      throw new AuthError('Sign in with an existing account to turn sign-in back on.', 401);
    }
  }
  failures.delete(req.ip);
  await setAuthSetting(true);
  await startSession(req, res, user);
  res.json({ user: publicUser(user) });
}));

// Turns sign-in off from the editor (signed-in users only). Accounts are kept.
router.post('/auth/disable', handle(async (req, res) => {
  requireUnlocked();
  await signedIn(req, res);
  await setAuthSetting(false);
  res.status(204).end();
}));

// Creates the first account. Only works while there are no users at all.
let setting_up = false;
router.post('/auth/setup', handle(async (req, res) => {
  requireEnabled();
  if (!sameOrigin(req)) throw new AuthError('cross-site request refused', 403);
  if (setting_up || (await User.count()) > 0) throw new AuthError('This server already has an account. Sign in instead.', 409);
  setting_up = true;
  try {
    const user = await createUser(req.body?.username, req.body?.password);
    await startSession(req, res, user);
    res.status(201).json({ user: publicUser(user) });
  } finally {
    setting_up = false;
  }
}));

router.post('/auth/login', handle(async (req, res) => {
  requireEnabled();
  if (!sameOrigin(req)) throw new AuthError('cross-site request refused', 403);
  const ip = req.ip;
  if (recentFailures(ip).length >= MAX_FAILURES) {
    throw new AuthError('Too many failed sign-ins. Wait a few minutes and try again.', 429);
  }
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password ?? '');
  const user = username ? await User.findOne({ where: { username } }) : null;
  const ok = await verifyPassword(password, user?.password_hash ?? await dummyHash());
  if (!user || !ok) {
    noteFailure(ip);
    throw new AuthError('Wrong username or password.', 401);
  }
  failures.delete(ip);
  await startSession(req, res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/auth/logout', handle(async (req, res) => {
  if (!sameOrigin(req)) throw new AuthError('cross-site request refused', 403);
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await Session.destroy({ where: { id: sha256(token) } });
  res.clearCookie(COOKIE, { path: '/' });
  res.status(204).end();
}));

// Changes your own password and signs out your other sessions.
router.post('/auth/password', handle(async (req, res) => {
  const user = await signedIn(req, res);
  if (!(await verifyPassword(String(req.body?.current_password ?? ''), user.password_hash))) {
    throw new AuthError('Your current password is wrong.', 403);
  }
  await setPassword(user, req.body?.new_password);
  await Session.destroy({ where: { user_id: user.id, id: { [Op.ne]: req.session_id } } });
  res.status(204).end();
}));

router.get('/auth/users', handle(async (req, res) => {
  await signedIn(req, res);
  const users = await User.findAll({ order: [['username', 'ASC']] });
  res.json(users.map(publicUser));
}));

router.post('/auth/users', handle(async (req, res) => {
  await signedIn(req, res);
  const user = await createUser(req.body?.username, req.body?.password);
  res.status(201).json(publicUser(user));
}));

router.delete('/auth/users/:id', handle(async (req, res) => {
  const me = await signedIn(req, res);
  if (req.params.id === me.id) throw new AuthError('You can\'t delete your own account.', 409);
  const user = await User.findByPk(req.params.id);
  if (!user) throw new AuthError('user not found', 404);
  await Session.destroy({ where: { user_id: user.id } });
  await user.destroy();
  res.status(204).end();
}));
