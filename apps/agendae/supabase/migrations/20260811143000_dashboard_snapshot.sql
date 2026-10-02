-- Snapshot agregado e autorizado da Home do prestador (BLG-066).
create or replace function public.get_provider_dashboard_snapshot(p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_month_start date;
  v_month_end date;
  v_summary jsonb;
  v_appointments jsonb;
begin
  select * into v_tenant
  from public.tenants
  where owner_user_id = auth.uid() and status = 'active'
  limit 1;

  if not found then
    raise exception 'FORBIDDEN: active provider tenant not found' using errcode = '42501';
  end if;

  v_date := coalesce(p_date, (now() at time zone v_tenant.timezone)::date);
  v_start := v_date::timestamp at time zone v_tenant.timezone;
  v_end := (v_date + 1)::timestamp at time zone v_tenant.timezone;
  v_month_start := date_trunc('month', v_date::timestamp)::date;
  v_month_end := (v_month_start + interval '1 month')::date;

  select jsonb_build_object(
    'activeClients', (select count(*) from public.clients where tenant_id = v_tenant.id and status = 'active'),
    'newClientsThisMonth', (select count(*) from public.clients where tenant_id = v_tenant.id and created_at >= (v_month_start::timestamp at time zone v_tenant.timezone) and created_at < (v_month_end::timestamp at time zone v_tenant.timezone)),
    'appointmentsToday', (select count(*) from public.appointments where tenant_id = v_tenant.id and starts_at >= v_start and starts_at < v_end and state <> 'cancelled'),
    'completedToday', (select count(*) from public.appointments where tenant_id = v_tenant.id and starts_at >= v_start and starts_at < v_end and state = 'completed'),
    'pendingConfirmationToday', (select count(*) from public.appointments where tenant_id = v_tenant.id and starts_at >= v_start and starts_at < v_end and state = 'scheduled' and confirmation_status = 'pending'),
    'serviceBalanceCents', coalesce((select sum(value_cents) from public.manual_payments where tenant_id = v_tenant.id and kind = 'charge' and status in ('pending', 'overdue') and due_date >= v_month_start and due_date < v_month_end), 0),
    'balanceReferenceMonth', to_char(v_month_start, 'YYYY-MM')
  ) into v_summary;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'startsAt', a.starts_at,
    'clientId', a.client_id,
    'clientName', c.name,
    'serviceName', a.service_name_snapshot,
    'serviceValueCents', a.value_cents_snapshot,
    'status', case
      when a.state = 'scheduled' and a.confirmation_status = 'pending' then 'pending_confirmation'
      when a.state = 'scheduled' then 'confirmed'
      else a.state::text
    end
  ) order by a.starts_at), '[]'::jsonb)
  into v_appointments
  from public.appointments a
  join public.clients c on c.id = a.client_id and c.tenant_id = a.tenant_id
  where a.tenant_id = v_tenant.id and a.starts_at >= v_start and a.starts_at < v_end and a.state <> 'cancelled';

  return jsonb_build_object(
    'generatedAt', now(),
    'timeZone', v_tenant.timezone,
    'providerDisplayName', v_tenant.display_name,
    'summary', v_summary,
    'todayAppointments', v_appointments,
    'notifications', '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_provider_dashboard_snapshot(date) from public, anon;
grant execute on function public.get_provider_dashboard_snapshot(date) to authenticated;
