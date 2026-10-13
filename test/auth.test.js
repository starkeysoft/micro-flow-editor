// Sign-in switched on and off from the editor (AUTH_ENABLED unset).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../lib/index.js';
import { client } from './auth-helpers.js';

delete process.env.AUTH_ENABLED;
let editor;
let base;

before(async () => {
  // TRUST_PROXY=false must mean "off", not an address.
  editor = await startServer({ port: 0, database_url: 'sqlite::memory:', trust_proxy: 'false' });
  base = `http://127.0.0.1:${editor.server.address().port}`;
});
after(() => editor.close());

test('off by default, toggled on and off from the editor', async () => {
  const ada = client(base);
  let r = await ada.get('/api/auth/session');
  assert.deepEqual(r.data, { auth_enabled: false, auth_locked: false, needs_setup: false, has_users: false, user: null });
  assert.equal((await ada.get('/api/flows')).status, 200, 'open while off');

  r = await ada.post('/api/auth/enable', { username: 'ada', password: 'short' });
  assert.equal(r.status, 400, 'password policy');
  r = await ada.post('/api/auth/enable', { username: 'ada', password: 'correct horse' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.username, 'ada');
  assert.match(r.set_cookie, /HttpOnly/i);
  assert.match(r.set_cookie, /SameSite=Lax/i);

  const stranger = client(base);
  assert.equal((await stranger.get('/api/flows')).status, 401, 'locked without a session');
  assert.equal((await stranger.get('/api/meta')).status, 401);
  assert.equal((await stranger.get('/webhook/nothing')).status, 404, 'webhooks stay public');
  assert.equal((await ada.get('/api/flows')).status, 200, 'session cookie works');

  r = await ada.post('/api/flows', { name: 'x' }, { origin: 'http://evil.example' });
  assert.equal(r.status, 403, 'cross-site writes refused');
  r = await ada.post('/api/flows', { name: 'x' }, { origin: base });
  assert.equal(r.status, 201, 'same-origin writes allowed');

  r = await ada.get('/api/auth/session');
  assert.equal(r.data.auth_enabled, true);
  assert.equal(r.data.user.username, 'ada');

  // Turning it off opens the API again; accounts are kept.
  assert.equal((await ada.post('/api/auth/disable')).status, 204);
  assert.equal((await stranger.get('/api/flows')).status, 200);
  r = await stranger.get('/api/auth/session');
  assert.equal(r.data.has_users, true);

  // Turning it back on needs an existing account.
  assert.equal((await stranger.post('/api/auth/enable', { username: 'ada', password: 'wrong password' })).status, 401);
  assert.equal((await stranger.get('/api/flows')).status, 200, 'still off after a failed enable');
  assert.equal((await ada.post('/api/auth/enable', { username: 'ada', password: 'correct horse' })).status, 200);
  assert.equal((await stranger.get('/api/flows')).status, 401);
});

test('users, passwords and sign-out', async () => {
  const ada = client(base);
  assert.equal((await ada.post('/api/auth/login', { username: 'ada', password: 'correct horse' })).status, 200);

  let r = await ada.post('/api/auth/users', { username: 'bob', password: 'bobs password' });
  assert.equal(r.status, 201);
  const bob_id = r.data.id;
  assert.equal((await ada.post('/api/auth/users', { username: 'bob', password: 'another one' })).status, 409);
  r = await ada.get('/api/auth/users');
  assert.deepEqual(r.data.map((u) => u.username), ['ada', 'bob']);
  assert.ok(!('password_hash' in r.data[0]), 'hashes never leave the server');

  const me = r.data.find((u) => u.username === 'ada');
  assert.equal((await ada.del(`/api/auth/users/${me.id}`)).status, 409, 'can\'t delete yourself');

  // Bob's sessions end when his account is deleted.
  const bob = client(base);
  assert.equal((await bob.post('/api/auth/login', { username: 'bob', password: 'bobs password' })).status, 200);
  assert.equal((await ada.del(`/api/auth/users/${bob_id}`)).status, 204);
  assert.equal((await bob.get('/api/flows')).status, 401);

  // Changing a password keeps this session and ends the others.
  const other = client(base);
  await other.post('/api/auth/login', { username: 'ada', password: 'correct horse' });
  assert.equal((await ada.post('/api/auth/password', { current_password: 'nope nope', new_password: 'battery staple' })).status, 403);
  assert.equal((await ada.post('/api/auth/password', { current_password: 'correct horse', new_password: 'battery staple' })).status, 204);
  assert.equal((await ada.get('/api/flows')).status, 200);
  assert.equal((await other.get('/api/flows')).status, 401);
  assert.equal((await other.post('/api/auth/login', { username: 'ada', password: 'battery staple' })).status, 200);

  assert.equal((await ada.post('/api/auth/logout', undefined, { origin: 'http://evil.example' })).status, 403, 'no cross-site sign-out');
  assert.equal((await ada.post('/api/auth/logout')).status, 204);
  assert.equal(ada.cookie, '', 'logout clears the cookie');
  assert.equal((await ada.get('/api/flows')).status, 401);
});

test('usernames are case-insensitive', async () => {
  const shouty = client(base);
  assert.equal((await shouty.post('/api/auth/login', { username: '  ADA ', password: 'battery staple' })).status, 200);
  assert.equal((await shouty.get('/api/auth/session')).data.user.username, 'ada');
  const r = await shouty.post('/api/auth/users', { username: 'Ada', password: 'some password' });
  assert.equal(r.status, 409, '"Ada" is the existing "ada"');
});

test('repeated wrong passwords are rate limited', async () => {
  const guess = client(base);
  for (let i = 0; i < 10; i++) {
    assert.equal((await guess.post('/api/auth/login', { username: 'ada', password: `guess ${i} wrong` })).status, 401);
  }
  assert.equal((await guess.post('/api/auth/login', { username: 'ada', password: 'battery staple' })).status, 429);
  assert.equal((await guess.post('/api/auth/login', { username: 'nobody', password: 'whatever pw' })).status, 429);
});
