/**
 * Records that this browser has logged in successfully at some point.
 *
 * ERPNext's session cookie (`sid`) is HttpOnly, so JavaScript cannot read it to
 * discover whether a session exists - the only way to know is to ask ERPNext.
 * Asking on every visit means an unauthenticated API call (and a 403 in the
 * console) before the user has done anything, which is what this marker avoids:
 * the app only probes ERPNext when it has reason to believe a session exists.
 *
 * This is a hint, never a security control. A missing marker only means "do not
 * bother asking first"; the server still authorises every single request.
 */
const SESSION_HINT_KEY = 'salesin.has-session';

export function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    // Storage can be unavailable (private browsing). Not probing is the safe default.
    return false;
  }
}

export function rememberSessionHint(): void {
  try {
    localStorage.setItem(SESSION_HINT_KEY, '1');
  } catch {
    // Non-fatal: the user simply signs in again after the next reload.
  }
}

export function forgetSessionHint(): void {
  try {
    localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Non-fatal.
  }
}
