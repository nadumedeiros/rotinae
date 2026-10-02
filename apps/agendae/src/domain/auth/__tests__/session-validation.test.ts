import { isSessionValid } from '../session-validation';
import type { Session } from '../types';

const session = (expiresAt: string): Session => ({ accessToken: 'token', expiresAt, user: { id: 'user-1', email: 'user@example.com', role: 'provider', roles: ['provider'], activeRole: 'provider', displayName: 'Maria' } });

describe('isSessionValid', () => {
  const now = Date.parse('2026-08-04T12:00:00.000Z');
  it('aceita sessão ainda válida', () => expect(isSessionValid(session('2026-08-04T13:00:00.000Z'), now)).toBe(true));
  it('rejeita sessão expirada', () => expect(isSessionValid(session('2026-08-04T11:59:59.000Z'), now)).toBe(false));
  it('rejeita data inválida', () => expect(isSessionValid(session('inválida'), now)).toBe(false));
  it('rejeita sessão sem token', () => expect(isSessionValid({ ...session('2026-08-04T13:00:00.000Z'), accessToken: '' }, now)).toBe(false));
});
