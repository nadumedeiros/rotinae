jest.mock('@/src/infra/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      setSession: jest.fn(),
    },
  },
}));

/* eslint-disable import/first -- jest.mock precisa ser elevado antes do módulo sob teste. */
import { supabase } from '@/src/infra/supabase/client';
import {
  authRedirectUrl,
  completeAuthSessionFromUrl,
  parseAuthCallbackUrl,
} from '../auth-url-session';

const getSession = supabase.auth.getSession as jest.Mock;
const exchangeCodeForSession = supabase.auth.exchangeCodeForSession as jest.Mock;
const setSession = supabase.auth.setSession as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: null }, error: null });
});

describe('authRedirectUrl', () => {
  it('usa o scheme estável do aplicativo no ambiente nativo de testes', () => {
    expect(authRedirectUrl('change-password')).toBe('rotinae:///change-password');
    expect(authRedirectUrl('auth/callback')).toBe('rotinae:///auth/callback');
  });
});

describe('parseAuthCallbackUrl', () => {
  it('lê um código PKCE e erros da query string', () => {
    expect(parseAuthCallbackUrl('rotinae:///auth/callback?code=pkce-code&type=recovery')).toMatchObject({
      code: 'pkce-code',
      type: 'recovery',
    });
  });

  it('lê tokens legados do fragmento', () => {
    expect(parseAuthCallbackUrl('rotinae:///change-password#access_token=access&refresh_token=refresh&type=recovery')).toMatchObject({
      accessToken: 'access',
      refreshToken: 'refresh',
      type: 'recovery',
    });
  });
});

describe('completeAuthSessionFromUrl', () => {
  it('troca código PKCE por sessão quando ainda não foi consumido', async () => {
    const session = { access_token: 'access' };
    exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });

    await expect(completeAuthSessionFromUrl('rotinae:///auth/callback?code=pkce-code', 'oauth')).resolves.toBe(session);
    expect(exchangeCodeForSession).toHaveBeenCalledWith('pkce-code');
  });

  it('troca o novo código mesmo quando já existe uma sessão A', async () => {
    const oldSession = { access_token: 'account-a' };
    const newSession = { access_token: 'account-b' };
    getSession.mockResolvedValue({ data: { session: oldSession }, error: null });
    exchangeCodeForSession.mockResolvedValue({ data: { session: newSession }, error: null });

    await expect(completeAuthSessionFromUrl('rotinae:///change-password?code=recovery-b', 'recovery')).resolves.toBe(newSession);
    expect(exchangeCodeForSession).toHaveBeenCalledWith('recovery-b');
    expect(getSession).not.toHaveBeenCalled();
  });

  it('troca o código Google B mesmo quando o app ainda possui a sessão Google A', async () => {
    const newSession = { access_token: 'google-b' };
    getSession.mockResolvedValue({ data: { session: { access_token: 'google-a' } }, error: null });
    exchangeCodeForSession.mockResolvedValue({ data: { session: newSession }, error: null });

    await expect(completeAuthSessionFromUrl('rotinae:///auth/callback?code=google-b-code', 'oauth')).resolves.toBe(newSession);
    expect(exchangeCodeForSession).toHaveBeenCalledWith('google-b-code');
    expect(getSession).not.toHaveBeenCalled();
  });

  it('rejeita flow state ausente mesmo quando ainda existe uma sessão A', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'account-a' } }, error: null });
    exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { code: 'flow_state_not_found', message: 'Flow state not found' },
    });

    await expect(completeAuthSessionFromUrl('rotinae:///change-password?code=recovery-b', 'recovery')).rejects.toMatchObject({
      code: 'flow_state_not_found',
    });
    expect(exchangeCodeForSession).toHaveBeenCalledWith('recovery-b');
    expect(getSession).not.toHaveBeenCalled();
  });

  it('não mascara erro genérico de troca com uma sessão antiga', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'account-a' } }, error: null });
    exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { code: 'unexpected_failure', message: 'Unexpected failure' },
    });

    await expect(completeAuthSessionFromUrl('rotinae:///auth/callback?code=account-b', 'oauth')).rejects.toMatchObject({
      code: 'unexpected_failure',
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('recusa access e refresh tokens recebidos por deep link', async () => {
    await expect(completeAuthSessionFromUrl('rotinae:///change-password#access_token=access&refresh_token=refresh&type=recovery', 'recovery')).rejects.toThrow('AUTH_CALLBACK_TOKENS_FORBIDDEN');
    expect(setSession).not.toHaveBeenCalled();
  });

  it('recusa callback de outro tipo em uma recuperação', async () => {
    await expect(completeAuthSessionFromUrl('rotinae:///change-password?code=code&type=signup', 'recovery')).rejects.toThrow('AUTH_CALLBACK_TYPE_MISMATCH');
  });

  it('recusa fragmento incompleto em vez de criar uma sessão parcial', async () => {
    await expect(completeAuthSessionFromUrl('rotinae:///change-password#access_token=access', 'recovery')).rejects.toThrow('AUTH_CALLBACK_TOKENS_FORBIDDEN');
    expect(setSession).not.toHaveBeenCalled();
  });

  it('recusa rota de callback diferente da finalidade esperada', async () => {
    await expect(completeAuthSessionFromUrl('rotinae:///auth/callback?code=code', 'recovery')).rejects.toThrow('AUTH_CALLBACK_PATH_MISMATCH');
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('recusa callback sem codigo PKCE', async () => {
    await expect(completeAuthSessionFromUrl('rotinae:///change-password', 'recovery')).rejects.toThrow('AUTH_CALLBACK_CODE_MISSING');
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
