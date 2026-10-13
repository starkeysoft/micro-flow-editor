// Who is signed in, and whether sign-in is on. Shared by the router guard,
// the login page and the settings dialog.
import { reactive } from 'vue';

export const session = reactive({
  loaded: false,
  auth_enabled: false,
  auth_locked: false,
  needs_setup: false,
  has_users: false,
  user: null,
});

export async function loadSession() {
  const res = await fetch('/api/auth/session');
  const data = await res.json();
  Object.assign(session, data, { loaded: true });
  return session;
}

// Set by main.js: where a 401 from the API sends you.
let onSignedOut = () => {};
export const setSignedOutHandler = (fn) => { onSignedOut = fn; };

export function signedOut() {
  session.user = null;
  onSignedOut();
}
