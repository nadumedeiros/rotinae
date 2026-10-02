import type { SignUpInput } from '@/src/domain/auth/types';

// Mocka o cliente Supabase real (que lançaria por falta de variáveis de
// ambiente fora deste teste) para exercitar só a lógica do adapter, sem
// depender de um projeto Supabase real. Ver "Testes pendentes" no handoff
// (docs/HANDOFF_CADASTRO_RECUPERACAO_CRIS.md) para o que só pode ser
// validado com Supabase local.
//
// Os `jest.fn()` são criados DENTRO do factory (em vez de referenciar
// `const`s externas) de propósito: `jest.mock()` é hoisted pelo babel acima
// de qualquer `import`, incluindo o import do próprio módulo sob teste — se
// o factory referenciasse uma variável externa, ela ainda estaria
// `undefined` no momento em que o factory roda. Depois do mock, importamos
// `supabase` (já mockado) para obter os handles dos mocks nas asserções.
jest.mock('@/src/infra/supabase/client', () => ({
  supabase: {
    auth: {
      signUp: jest.fn(),
      resend: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      updateUser: jest.fn(),
    },
  },
}));

import { supabase } from '@/src/infra/supabase/client';
import { SupabaseAuthRegistrationAdapter } from '../supabase-auth-registration-adapter';

const mockSignUp = supabase.auth.signUp as jest.Mock;
const mockResend = supabase.auth.resend as jest.Mock;
const mockResetPasswordForEmail = supabase.auth.resetPasswordForEmail as jest.Mock;
const mockUpdateUser = supabase.auth.updateUser as jest.Mock;

const validSignUpInput: SignUpInput = {
  name: 'Maria Souza',
  email: 'maria@exemplo.com',
  phone: '+5511999999999',
  password: 'senha-segura-123',
  role: 'client',
  legalAcceptance: {
    consentVersion: 'seed-1.0.0',
    acceptedAt: '2026-08-06T12:00:00.000Z',
    source: 'web',
  },
  marketingConsent: true,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SupabaseAuthRegistrationAdapter.signUp', () => {
  it('nunca devolve Session; sempre exige confirmação de e-mail', async () => {
    mockSignUp.mockResolvedValueOnce({ data: { user: { id: 'user-1' }, session: null }, error: null });
    const adapter = new SupabaseAuthRegistrationAdapter();

    const result = await adapter.signUp(validSignUpInput);

    expect(result).toEqual({ email: validSignUpInput.email, emailConfirmationRequired: true });
  });

  it('envia os metadados corretos para o trigger de cadastro consumir via raw_user_meta_data', async () => {
    mockSignUp.mockResolvedValueOnce({ data: { user: { id: 'user-1' }, session: null }, error: null });
    const adapter = new SupabaseAuthRegistrationAdapter();

    await adapter.signUp(validSignUpInput);

    expect(mockSignUp).toHaveBeenCalledWith({
      email: validSignUpInput.email,
      password: validSignUpInput.password,
      options: {
        data: {
          name: validSignUpInput.name,
          phone: validSignUpInput.phone,
          role: validSignUpInput.role,
          consentVersion: validSignUpInput.legalAcceptance.consentVersion,
          marketingConsent: validSignUpInput.marketingConsent,
          source: validSignUpInput.legalAcceptance.source,
        },
        emailRedirectTo: expect.stringContaining('confirm-email'),
      },
    });
  });

  it('nunca revela que o e-mail já está cadastrado (anti-enumeração)', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'User already registered', code: 'user_already_exists', status: 422 },
    });
    const adapter = new SupabaseAuthRegistrationAdapter();

    const result = await adapter.signUp(validSignUpInput);

    expect(result).toEqual({ email: validSignUpInput.email, emailConfirmationRequired: true });
  });

  it('propaga AUTH_WEAK_PASSWORD sem mascarar como sucesso', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Password should be at least 8 characters', code: 'weak_password', status: 422 },
    });
    const adapter = new SupabaseAuthRegistrationAdapter();

    await expect(adapter.signUp(validSignUpInput)).rejects.toMatchObject({ code: 'AUTH_WEAK_PASSWORD' });
  });

  it('propaga RATE_LIMITED quando o GoTrue limita tentativas de cadastro', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Email rate limit exceeded', code: 'over_email_send_rate_limit', status: 429 },
    });
    const adapter = new SupabaseAuthRegistrationAdapter();

    await expect(adapter.signUp(validSignUpInput)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('SupabaseAuthRegistrationAdapter.resendConfirmationEmail', () => {
  it('sempre resolve quando o GoTrue não reporta erro', async () => {
    mockResend.mockResolvedValueOnce({ data: {}, error: null });
    const adapter = new SupabaseAuthRegistrationAdapter();

    await expect(adapter.resendConfirmationEmail('qualquer@exemplo.com')).resolves.toBeUndefined();
    expect(mockResend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'qualquer@exemplo.com',
      options: expect.objectContaining({ emailRedirectTo: expect.stringContaining('confirm-email') }),
    });
  });

  it('nunca rejeita com um código que revele o estado da conta', async () => {
    mockResend.mockResolvedValueOnce({
      data: {},
      error: { message: 'User not found', code: 'user_not_found', status: 404 },
    });
    const adapter = new SupabaseAuthRegistrationAdapter();

    await expect(adapter.resendConfirmationEmail('inexistente@exemplo.com')).rejects.toMatchObject({
      code: 'UNKNOWN',
    });
  });

  it('propaga RATE_LIMITED (não revela existência de conta, só volume de tentativas)', async () => {
    mockResend.mockResolvedValueOnce({
      data: {},
      error: { message: 'Email rate limit exceeded', code: 'over_email_send_rate_limit', status: 429 },
    });
    const adapter = new SupabaseAuthRegistrationAdapter();

    await expect(adapter.resendConfirmationEmail('qualquer@exemplo.com')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });
});

describe('SupabaseAuthRegistrationAdapter.requestPasswordReset', () => {
  it('sempre resolve para e-mail existente ou inexistente', async () => {
    mockResetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });
    const adapter = new SupabaseAuthRegistrationAdapter();

    await expect(adapter.requestPasswordReset('qualquer@exemplo.com')).resolves.toBeUndefined();
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
      'qualquer@exemplo.com',
      expect.objectContaining({ redirectTo: expect.stringContaining('change-password') }),
    );
  });

  it('nunca rejeita com um código que revele o estado da conta', async () => {
    mockResetPasswordForEmail.mockResolvedValueOnce({
      data: {},
      error: { message: 'User not found', code: 'user_not_found', status: 404 },
    });
    const adapter = new SupabaseAuthRegistrationAdapter();

    await expect(adapter.requestPasswordReset('inexistente@exemplo.com')).rejects.toMatchObject({
      code: 'UNKNOWN',
    });
  });
});

describe('SupabaseAuthRegistrationAdapter.updatePassword', () => {
  it('efetiva a troca usando a sessão de recuperação ativa', async () => {
    mockUpdateUser.mockResolvedValueOnce({ data: { user: { id: 'user-1' } }, error: null });
    const adapter = new SupabaseAuthRegistrationAdapter();

    await expect(adapter.updatePassword({ newPassword: 'nova-senha-123' })).resolves.toBeUndefined();
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'nova-senha-123' });
  });

  it('lança SESSION_EXPIRED quando não há sessão de recuperação ativa', async () => {
    mockUpdateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Auth session missing!', name: 'AuthSessionMissingError', status: 400 },
    });
    const adapter = new SupabaseAuthRegistrationAdapter();

    await expect(adapter.updatePassword({ newPassword: 'nova-senha-123' })).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('lança AUTH_WEAK_PASSWORD quando o backend rejeita a nova senha', async () => {
    mockUpdateUser.mockResolvedValueOnce({
      data: { user: null },
      error: {
        message: 'password is known to be weak and easy to guess (pwned)',
        code: 'weak_password',
        status: 422,
      },
    });
    const adapter = new SupabaseAuthRegistrationAdapter();

    await expect(adapter.updatePassword({ newPassword: '12345678' })).rejects.toMatchObject({
      code: 'AUTH_WEAK_PASSWORD',
    });
  });
});
