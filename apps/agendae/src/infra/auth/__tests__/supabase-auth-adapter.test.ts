// Mesmo padrão de apps/agendae/src/infra/clients/__tests__: mocka o cliente
// Supabase (que lançaria por falta de variáveis de ambiente fora deste
// teste) para exercitar `SupabaseAuthAdapter.signIn`/`getSession` e a
// derivação de `isAdmin` a partir de `profiles.is_admin` (DEC-076), sem
// depender de um projeto Supabase real.
jest.mock('@/src/infra/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      getSession: jest.fn(),
    },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { supabase } from '@/src/infra/supabase/client';
import { SupabaseAuthAdapter } from '../supabase-auth-adapter';

const mockSignInWithPassword = supabase.auth.signInWithPassword as jest.Mock;
const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

// Builder fluente mínimo: só os métodos usados por `loadProfile`
// (`select().eq().maybeSingle()`); ver createQueryBuilder equivalente em
// supabase-client-portfolio-adapter.test.ts.
function createProfileQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {};
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  return builder;
}

function createRolesQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {};
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

function baseProfileRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    user_id: 'user-1',
    role: 'provider',
    display_name: 'Fulano de Tal',
    status: 'active',
    is_admin: false,
    ...overrides,
  };
}

const fakeSession = {
  access_token: 'token-abc',
  expires_at: 1893456000,
  user: { id: 'user-1', email: 'fulano@exemplo.com' },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SupabaseAuthAdapter — isAdmin (DEC-076)', () => {
  describe('signIn', () => {
    it('usa a mesma resposta publica para credencial invalida e email nao confirmado', async () => {
      const adapter = new SupabaseAuthAdapter();
      for (const error of [
        { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 },
        { code: 'email_not_confirmed', message: 'Email not confirmed', status: 400 },
      ]) {
        mockSignInWithPassword.mockResolvedValueOnce({ data: { session: null }, error });
        await expect(adapter.signIn({ email: 'conta@exemplo.com', password: 'senha' })).rejects.toMatchObject({
          code: 'INVALID_CREDENTIALS',
          message: 'Confira seu e-mail e sua senha e tente novamente.',
        });
      }
    });

    it('devolve isAdmin: false para usuário comum (is_admin = false na tabela)', async () => {
      mockSignInWithPassword.mockResolvedValue({ data: { session: fakeSession }, error: null });
      mockFrom.mockReturnValue(createProfileQueryBuilder({ data: baseProfileRow(), error: null }));

      const adapter = new SupabaseAuthAdapter();
      const session = await adapter.signIn({ email: 'fulano@exemplo.com', password: 'senha-forte-123' });

      expect(session.user.isAdmin).toBe(false);
    });

    it('devolve isAdmin: true quando profiles.is_admin = true', async () => {
      mockSignInWithPassword.mockResolvedValue({ data: { session: fakeSession }, error: null });
      mockFrom.mockReturnValue(
        createProfileQueryBuilder({ data: baseProfileRow({ is_admin: true }), error: null }),
      );

      const adapter = new SupabaseAuthAdapter();
      const session = await adapter.signIn({ email: 'admin@exemplo.com', password: 'senha-forte-123' });

      expect(session.user.isAdmin).toBe(true);
    });

    it('carrega o perfil só por leitura: nenhuma chamada grava em is_admin', async () => {
      mockSignInWithPassword.mockResolvedValue({ data: { session: fakeSession }, error: null });
      const builder = createProfileQueryBuilder({ data: baseProfileRow({ is_admin: true }), error: null });
      builder.update = jest.fn(() => builder);
      builder.insert = jest.fn(() => builder);
      mockFrom.mockReturnValue(builder);

      const adapter = new SupabaseAuthAdapter();
      await adapter.signIn({ email: 'admin@exemplo.com', password: 'senha-forte-123' });

      expect(builder.select).toHaveBeenCalledWith(
        expect.stringContaining('is_admin'),
      );
      expect(builder.update).not.toHaveBeenCalled();
      expect(builder.insert).not.toHaveBeenCalled();
    });
  });

  describe('getSession', () => {
    it('devolve isAdmin: false para usuário comum', async () => {
      mockGetSession.mockResolvedValue({ data: { session: fakeSession }, error: null });
      mockFrom.mockReturnValue(createProfileQueryBuilder({ data: baseProfileRow(), error: null }));

      const adapter = new SupabaseAuthAdapter();
      const session = await adapter.getSession();

      expect(session?.user.isAdmin).toBe(false);
    });

    it('devolve isAdmin: true quando profiles.is_admin = true', async () => {
      mockGetSession.mockResolvedValue({ data: { session: fakeSession }, error: null });
      mockFrom.mockReturnValue(
        createProfileQueryBuilder({ data: baseProfileRow({ is_admin: true }), error: null }),
      );

      const adapter = new SupabaseAuthAdapter();
      const session = await adapter.getSession();

      expect(session?.user.isAdmin).toBe(true);
    });

    it('carrega o perfil só por leitura: nenhuma chamada grava em is_admin', async () => {
      mockGetSession.mockResolvedValue({ data: { session: fakeSession }, error: null });
      const builder = createProfileQueryBuilder({ data: baseProfileRow({ is_admin: true }), error: null });
      builder.update = jest.fn(() => builder);
      builder.insert = jest.fn(() => builder);
      mockFrom.mockReturnValue(builder);

      const adapter = new SupabaseAuthAdapter();
      await adapter.getSession();

      expect(builder.update).not.toHaveBeenCalled();
      expect(builder.insert).not.toHaveBeenCalled();
    });
  });
});

describe('SupabaseAuthAdapter — múltiplos perfis', () => {
  it('adiciona um perfil pela RPC autoritativa e devolve os dois papéis', async () => {
    mockGetSession.mockResolvedValue({ data: { session: fakeSession }, error: null });
    mockRpc.mockResolvedValue({ data: null, error: null });
    const profileBuilder = createProfileQueryBuilder({ data: baseProfileRow(), error: null });
    const rolesBuilder = createRolesQueryBuilder({ data: [{ role: 'provider' }, { role: 'client' }], error: null });
    mockFrom.mockReturnValueOnce(profileBuilder).mockReturnValueOnce(rolesBuilder);

    const session = await new SupabaseAuthAdapter().addRole('client');

    expect(mockRpc).toHaveBeenCalledWith('add_profile_role', { p_role: 'client' });
    expect(session.user.roles).toEqual(['provider', 'client']);
  });

  it('alterna o contexto apenas pela RPC e devolve o papel ativo atualizado', async () => {
    mockGetSession.mockResolvedValue({ data: { session: fakeSession }, error: null });
    mockRpc.mockResolvedValue({ data: null, error: null });
    const profileBuilder = createProfileQueryBuilder({ data: baseProfileRow({ role: 'client' }), error: null });
    const rolesBuilder = createRolesQueryBuilder({ data: [{ role: 'provider' }, { role: 'client' }], error: null });
    mockFrom.mockReturnValueOnce(profileBuilder).mockReturnValueOnce(rolesBuilder);

    const session = await new SupabaseAuthAdapter().switchRole({ role: 'client' });

    expect(mockRpc).toHaveBeenCalledWith('switch_profile_role', { p_role: 'client' });
    expect(session.user.activeRole).toBe('client');
    expect(session.user.role).toBe('client');
  });

  it('não simula sucesso quando o banco recusa um perfil inexistente', async () => {
    mockGetSession.mockResolvedValue({ data: { session: fakeSession }, error: null });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'ROLE_NOT_AVAILABLE', status: 400 } });

    await expect(new SupabaseAuthAdapter().switchRole({ role: 'client' })).rejects.toMatchObject({
      code: 'ROLE_NOT_AVAILABLE',
    });
  });
});
