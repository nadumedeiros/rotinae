-- Contexto mínimo e seguro para a tela de agendamento do cliente.
-- Não expõe nomes de outros clientes; horários ocupados são apenas instantes.
create or replace function public.get_client_booking_context(p_month text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;
  if p_month !~ '^\d{4}-\d{2}$' then
    raise exception 'INVALID_DATE_TIME: month must use YYYY-MM' using errcode = '22023';
  end if;

  v_start := (p_month || '-01T00:00:00Z')::timestamptz;
  v_end := v_start + interval '1 month';

  select coalesce(jsonb_agg(provider_row order by provider_row->>'providerName'), '[]'::jsonb)
    into v_result
  from (
    select jsonb_build_object(
      'tenantId', t.id,
      'providerId', t.owner_user_id,
      'providerName', coalesce(nullif(trim(p.display_name), ''), 'Prestador'),
      'clientId', c.id,
      'primaryServiceId', c.primary_service_id,
      'timezone', coalesce(t.timezone, 'America/Sao_Paulo'),
      'workdayStart', coalesce(t.workday_start::text, '08:00:00'),
      'workdayEnd', coalesce(t.workday_end::text, '18:00:00'),
      'minimumAdvanceHours', coalesce(t.minimum_advance_hours, 0),
      'services', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'name', s.name, 'durationMinutes', s.duration_minutes,
          'referenceValueCents', s.reference_value_cents
        ) order by s.name)
        from public.services s where s.tenant_id = t.id and s.status = 'active'
      ), '[]'::jsonb),
      'blocks', coalesce((
        select jsonb_agg(jsonb_build_object('startsAt', b.starts_at, 'endsAt', b.ends_at))
        from public.availability_blocks b
        where b.tenant_id = t.id and b.starts_at < v_end and b.ends_at > v_start
      ), '[]'::jsonb),
      'occupiedStartsAt', coalesce((
        select jsonb_agg(a.starts_at order by a.starts_at)
        from public.appointments a
        where a.tenant_id = t.id and a.state = 'scheduled'
          and a.starts_at >= v_start and a.starts_at < v_end
      ), '[]'::jsonb)
    ) provider_row
    from public.provider_client_links l
    join public.tenants t on t.id = l.tenant_id
    join public.profiles p on p.user_id = t.owner_user_id and p.role = 'provider'
    join public.clients c on c.tenant_id = t.id and c.client_user_id = v_user and c.status = 'active'
    where l.client_user_id = v_user and l.status = 'active'
  ) linked;

  return v_result;
end;
$$;

revoke all on function public.get_client_booking_context(text) from public, anon;
grant execute on function public.get_client_booking_context(text) to authenticated;
