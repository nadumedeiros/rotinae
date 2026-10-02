import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260924120000_harden_profiles_and_admin_rpcs.sql'),
  'utf8',
);

describe('admin database security contract', () => {
  it('blocks profile status changes outside service_role', () => {
    expect(source).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(source).toContain('before update of status on public.profiles');
  });

  it('requires an active admin and hides unchecked implementations', () => {
    expect(source).toContain("and status = 'active'");
    expect(source).toContain('and is_admin = true');
    expect(source).toContain('revoke all on function public.get_admin_users_unchecked()');
    expect(source).toContain('revoke all on function public.admin_set_provider_plan_unchecked(uuid, text)');
  });
});
