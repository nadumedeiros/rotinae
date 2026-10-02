-- ============================================================================
-- Migration: Permissão de insert e update direto para o dono do tenant em appointments
-- ============================================================================

drop policy if exists "appointments_insert_owner" on public.appointments;
create policy "appointments_insert_owner"
  on public.appointments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.tenants t
      where t.id = appointments.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

drop policy if exists "appointments_update_owner" on public.appointments;
create policy "appointments_update_owner"
  on public.appointments for update
  to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = appointments.tenant_id
        and t.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tenants t
      where t.id = appointments.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );
