import { MockAuthAdapter } from '@/src/infra/auth/mock-auth-adapter';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));

describe('múltiplos perfis na mesma conta', () => {
  it('adiciona Cliente sem remover Prestador e alterna o contexto', async () => {
    const auth = new MockAuthAdapter();
    await auth.signIn({ email: 'provider@example.com', password: 'senha123', selectedRole: 'provider' });
    await auth.addRole('client');
    const session = await auth.switchRole({ role: 'client' });
    expect(session.user.roles).toEqual(['provider', 'client']);
    expect(session.user.activeRole).toBe('client');
    expect(session.user.role).toBe('client');
  });

  it('bloqueia troca para perfil que ainda não foi criado', async () => {
    const auth = new MockAuthAdapter();
    await auth.signIn({ email: 'provider@example.com', password: 'senha123', selectedRole: 'provider' });
    await expect(auth.switchRole({ role: 'client' })).rejects.toMatchObject({ code: 'ROLE_NOT_AVAILABLE' });
  });
});
