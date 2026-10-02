import type { AuthPort } from '@/src/domain/auth/auth-port';
import { AuthError, type Session, type SignInInput, type SwitchRoleInput, type UserRole } from '@/src/domain/auth/types';
import { isSessionValid } from '@/src/domain/auth/session-validation';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const SESSION_KEY = 'agendae.demo.session';

async function readStoredSession(): Promise<Session | null> {
  try {
    const raw = Platform.OS === 'web'
      ? (typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage.getItem(SESSION_KEY))
      : await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    session.user.roles ??= [session.user.role];
    session.user.activeRole ??= session.user.role;
    if (!isSessionValid(session)) {
      await storeSession(null);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

async function storeSession(session: Session | null) {
  if (Platform.OS === 'web') {
    if (typeof globalThis.localStorage === 'undefined') return;
    if (session) globalThis.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else globalThis.localStorage.removeItem(SESSION_KEY);
    return;
  }
  if (session) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  else await SecureStore.deleteItemAsync(SESSION_KEY);
}

export class MockAuthAdapter implements AuthPort {
  private session: Session | null = null;

  async signIn({ email, password, selectedRole = 'provider' }: SignInInput) {
    await wait(650);
    if (!email.includes('@') || password.length < 6) {
      throw new AuthError('INVALID_CREDENTIALS', 'Confira seu e-mail e sua senha e tente novamente.');
    }

    this.session = {
      accessToken: 'local-demo-token',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      user: { id: 'local-user', email, role: selectedRole, roles: [selectedRole], activeRole: selectedRole, displayName: email.toLowerCase() === 'admin@agendae.com' ? 'Administrador' : selectedRole === 'provider' ? 'Profissional' : 'Cliente', isAdmin: email.toLowerCase() === 'admin@agendae.com' },
    };
    await storeSession(this.session);
    return this.session;
  }

  async signOut() { this.session = null; await storeSession(null); }
  async getSession() { this.session ??= await readStoredSession(); return this.session; }
  async addRole(role: UserRole) {
    const session = await this.requireSession();
    if (!session.user.roles.includes(role)) session.user.roles = [...session.user.roles, role];
    await storeSession(session);
    return session;
  }
  async switchRole({ role }: SwitchRoleInput) {
    const session = await this.requireSession();
    if (!session.user.roles.includes(role)) throw new AuthError('ROLE_NOT_AVAILABLE', 'Adicione este perfil antes de alternar.');
    session.user.activeRole = role;
    session.user.role = role;
    await storeSession(session);
    return session;
  }
  private async requireSession() {
    const session = await this.getSession();
    if (!session) throw new AuthError('SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente.');
    return session;
  }
}

export const authService: AuthPort = new MockAuthAdapter();
