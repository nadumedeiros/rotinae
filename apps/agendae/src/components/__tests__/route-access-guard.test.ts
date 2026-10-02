jest.mock('expo-router', () => ({ router: { replace: jest.fn() }, usePathname: jest.fn(() => '/') }));
jest.mock('@/src/infra/auth/supabase-auth-adapter', () => ({ supabaseAuthService: { getSession: jest.fn() } }));

import { isPublicRoute } from '../route-access-guard';

describe('route access classification', () => {
  it('keeps only authentication entry points public', () => {
    expect(isPublicRoute('/login')).toBe(true);
    expect(isPublicRoute('/change-password')).toBe(true);
    expect(isPublicRoute('/dashboard')).toBe(false);
    expect(isPublicRoute('/admin-users')).toBe(false);
  });
});
