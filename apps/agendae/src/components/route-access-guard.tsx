import { router, usePathname } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';

import { PageLoadingOverlay } from '@/src/components/ui/page-loading-overlay';
import { supabaseAuthService } from '@/src/infra/auth/supabase-auth-adapter';

const PUBLIC_ROUTES = new Set([
  '/',
  '/login',
  '/select-profile',
  '/create-account',
  '/confirm-email',
  '/auth/callback',
  '/forgot-password',
  '/change-password',
  '/feedback',
]);

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.has(pathname);
}

export function RouteAccessGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const publicRoute = isPublicRoute(pathname);
  const [checking, setChecking] = useState(!publicRoute);

  useEffect(() => {
    let active = true;
    if (publicRoute) {
      setChecking(false);
      return () => { active = false; };
    }

    setChecking(true);
    void supabaseAuthService.getSession().then((session) => {
      if (!active) return;
      if (!session) {
        router.replace('/login');
        return;
      } else if (pathname === '/admin-users' && !session.user.isAdmin) {
        router.replace(session.user.activeRole === 'provider' ? '/dashboard' : '/client-home');
        return;
      }
      setChecking(false);
    }).catch(() => {
      if (!active) return;
      router.replace('/login');
    });
    return () => { active = false; };
  }, [pathname, publicRoute]);

  // The root navigator must remain mounted before router.replace can run.
  // Data access is enforced by the backend; this guard controls navigation.
  return <>{children}{checking && <PageLoadingOverlay coverHeader />}</>;
}
