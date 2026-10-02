import type { Session } from './types';

export function isSessionValid(session: Session, now = Date.now()) {
  const expiration = new Date(session.expiresAt).getTime();
  return Number.isFinite(expiration) && expiration > now && Boolean(session.accessToken && session.user.id);
}
