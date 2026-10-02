import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { RouteAccessGuard } from '../route-access-guard';
import { supabaseAuthService } from '@/src/infra/auth/supabase-auth-adapter';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() }, usePathname: () => '/dashboard' }));
jest.mock('@/src/infra/auth/supabase-auth-adapter', () => ({ supabaseAuthService: { getSession: jest.fn() } }));
jest.mock('@/src/components/ui/page-loading-overlay', () => ({ PageLoadingOverlay: () => null }));

it('keeps the navigator mounted while checking the session and redirecting a guest', async () => {
  let resolveSession!: (value: null) => void;
  jest.mocked(supabaseAuthService.getSession).mockReturnValue(new Promise(resolve => { resolveSession = resolve; }));
  const view = await render(<RouteAccessGuard><Text>Navigator mounted</Text></RouteAccessGuard>);
  expect(view.getByText('Navigator mounted')).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
  resolveSession(null);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
  expect(view.getByText('Navigator mounted')).toBeTruthy();
});
