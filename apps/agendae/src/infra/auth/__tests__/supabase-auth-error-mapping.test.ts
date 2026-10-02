// `supabase-auth-adapter.ts` importa `@/src/infra/supabase/client` no nível
// de módulo, e esse cliente real lança se as variáveis de ambiente do
// Supabase não estiverem definidas (comportamento intencional em produção).
// Mockamos o módulo do cliente antes do import para testar só as funções
// puras de mapeamento de erro, sem precisar de um Supabase real.
jest.mock('@/src/infra/supabase/client', () => ({ supabase: {} }));

import { mapNeutralSupabaseAuthError, mapSupabaseAuthError } from '../supabase-auth-adapter';

describe('mapSupabaseAuthError', () => {
  it.each([
    [{ message: 'Request rate limit reached', code: 'over_email_send_rate_limit' }, 'RATE_LIMITED'],
    [{ message: 'Too many requests', status: 429 }, 'RATE_LIMITED'],
    [{ message: 'Invalid login credentials', code: 'invalid_credentials' }, 'INVALID_CREDENTIALS'],
    [{ message: 'Email not confirmed', code: 'email_not_confirmed' }, 'AUTH_EMAIL_NOT_CONFIRMED'],
    [{ message: 'Email not confirmed' }, 'AUTH_EMAIL_NOT_CONFIRMED'],
    [{ message: 'Auth session missing!', name: 'AuthSessionMissingError' }, 'SESSION_EXPIRED'],
    [{ message: 'Token has expired or is invalid', code: 'otp_expired' }, 'AUTH_LINK_INVALID'],
    [{ message: 'Invalid flow state, no valid flow state found', code: 'flow_state_not_found' }, 'AUTH_LINK_INVALID'],
    [{ message: 'PKCE flow state has expired', code: 'flow_state_expired' }, 'AUTH_LINK_INVALID'],
    [{ message: 'code verifier should be non-empty', code: 'bad_code_verifier' }, 'AUTH_LINK_INVALID'],
    [{ message: 'Email link is invalid or has expired' }, 'AUTH_LINK_INVALID'],
    [{ message: 'Password should be at least 8 characters', code: 'weak_password' }, 'AUTH_WEAK_PASSWORD'],
    [{ message: 'Password is known to be weak and easy to guess, please choose a different one (pwned)' }, 'AUTH_WEAK_PASSWORD'],
    [{ message: 'Failed to fetch' }, 'NETWORK_ERROR'],
    [{ message: 'Network request failed', name: 'AuthRetryableFetchError' }, 'NETWORK_ERROR'],
    [{ message: 'Something odd happened before any HTTP response' }, 'NETWORK_ERROR'],
    [{ message: 'Something unexpected', status: 400, code: 'unexpected_failure' }, 'UNKNOWN'],
  ])('mapeia %j para %s', (error, expectedCode) => {
    expect(mapSupabaseAuthError(error).code).toBe(expectedCode);
  });
});

describe('mapNeutralSupabaseAuthError (anti-enumeração)', () => {
  it('preserva RATE_LIMITED', () => {
    expect(mapNeutralSupabaseAuthError({ message: 'rate limit', status: 429 }).code).toBe('RATE_LIMITED');
  });

  it('preserva NETWORK_ERROR', () => {
    expect(mapNeutralSupabaseAuthError({ message: 'Failed to fetch' }).code).toBe('NETWORK_ERROR');
  });

  it.each([
    { message: 'Email not confirmed', code: 'email_not_confirmed' },
    { message: 'Invalid login credentials', code: 'invalid_credentials' },
    { message: 'User already registered', code: 'user_already_exists' },
    { message: 'Auth session missing!', name: 'AuthSessionMissingError' },
  ])('nunca revela o estado da conta: %j vira UNKNOWN', (error) => {
    expect(mapNeutralSupabaseAuthError(error).code).toBe('UNKNOWN');
  });
});
