// LoopMune Patient — sign-in.
//
// Demo-grade authentication: any well-formed email with a non-empty
// password signs in. The one rule that matters and must never regress:
// an empty password is always rejected.

import { httpError } from './errors.js';

export function login(email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) {
    throw httpError(400, 'invalid email format');
  }
  if (!password) {
    throw httpError(400, 'password required');
  }
  return { ok: true, user: email };
}
