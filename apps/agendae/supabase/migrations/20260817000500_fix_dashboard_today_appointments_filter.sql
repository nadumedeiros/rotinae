-- ============================================================================
-- Migration: Corrigir filtro de agendamentos de hoje no dashboard
-- ============================================================================
-- Garante que todos os agendamentos do dia atual (v_start até v_end) sejam
-- retornados na lista do painel, e não apenas os que começam nos próximos 30min.

create or replace function public.get_provider_dashboard_snapshot(p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_user_display_name text;
  v_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_month_start date;
  v_month_end date;
  v_summary jsonb;
  v_appointments jsonb;
begin
  -- 1. Busca o tenant do prestador
  select * into v_tenant
  from public.tenants
  where owner_user_id = auth.uid() and status = 'active'
  limit 1;

  -- 2. Se não existir, auto-provisiona o perfil e o tenant
  if not found then
    select coalesce(p.display_name, u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1), 'Prestador')
    into v_user_display_name
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    where u.id = auth.uid();

    insert into public.profiles (user_id, role, display_name, phone)
    values (auth.uid(), 'provider', coalesce(v_user_display_name, 'Prestador'), null)
    on conflict (user_id) do update
    set role = 'provider'
    where public.profiles.role is distinct from 'provider';

    insert into public.profile_roles (user_id, role)
    values (auth.uid(), 'provider')
    on conflict (user_id, role) do nothing;

    insert into public.tenants (owner_user_id, display_name, timezone, status)
    values (auth.uid(), coalesce(v_user_display_name, 'Meu Espaço'), 'America/Sao_Paulo', 'active')
    returning * into v_tenant;

    insert into public.provider_settings (
      provider_user_id,
      timezone,
      slot_interval_minutes,
      min_advance_hours,
      business_hours_start,
      business_hours_end,
      booking_window_days
    ) values (
      auth.uid(),
      'America/Sao_Paulo',
      30,
      0,
      '08:00',
      '18:00',
      60
    ) on conflict (provider_user_id) do nothing;
  end if;

  -- 3. Datas e fusos
  v_date := coalesce(p_date, (now() at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))::date);
  v_start := v_date::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo');
  v_end := (v_date + 1)::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo');
  v_month_start := date_trunc('month', v_date::timestamp)::date;
  v_month_end := (v_month_start + interval '1 month')::date;

  -- 4. KPIs do resumo consolidados
  select jsonb_build_object(
    -- Clientes Ativos: clientes cadastrados com status active
    'activeClients', coalesce((
      select count(*)
      from public.clients c
      where c.tenant_id = v_tenant.id and c.status = 'active'
    ), 0),

    -- Novos Clientes no Mês
    'newClientsThisMonth', coalesce((
      select count(*)
      from public.clients c
      where c.tenant_id = v_tenant.id
        and c.status = 'active'
        and c.created_at >= (v_month_start::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))
        and c.created_at < (v_month_end::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))
    ), 0),

    -- Agendamentos de Hoje (total não cancelado no dia)
    'appointmentsToday', coalesce((
      select count(*)
      from public.appointments
      where tenant_id = v_tenant.id
        and starts_at >= v_start
        and starts_at < v_end
        and state <> 'cancelled'
    ), 0),

    -- Atendimentos Concluídos Hoje
    'completedToday', coalesce((
      select count(*)
      from public.appointments
      where tenant_id = v_tenant.id
        and starts_at >= v_start
        and starts_at < v_end
        and state <> 'cancelled'
        and (state = 'completed' or ends_at <= now())
    ), 0),

    -- Aguardando Confirmação Hoje
    'pendingConfirmationToday', coalesce((
      select count(*)
      from public.appointments
      where tenant_id = v_tenant.id
        and starts_at >= v_start
        and starts_at < v_end
        and state = 'scheduled'
        and confirmation_status = 'pending'
    ), 0),

    -- Faturamento / Saldo Recebido no Mês
    'serviceBalanceCents', coalesce((
      select sum(value_cents)
      from public.manual_payments
      where tenant_id = v_tenant.id
        and (status = 'paid' or status = 'received')
        and (
          (paid_at >= (v_month_start::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo')) and paid_at < (v_month_end::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo')))
          or (received_at >= (v_month_start::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo')) and received_at < (v_month_end::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo')))
          or (created_at >= (v_month_start::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo')) and created_at < (v_month_end::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo')))
        )
    ), 0),

    'balanceReferenceMonth', to_char(v_month_start, 'YYYY-MM')
  ) into v_summary;

  -- 5. Agendamentos de hoje (todos os compromissos do dia ordenados por horário)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'startsAt', a.starts_at,
    'clientId', a.client_id,
    'clientName', coalesce(c.name, 'Sem cliente'),
    'serviceName', coalesce(a.service_name_snapshot, 'Atendimento'),
    'serviceValueCents', coalesce(a.value_cents_snapshot, 0),
    'status', case
      when a.state = 'completed' or (a.ends_at <= now() and a.state <> 'cancelled') then 'completed'
      when a.state = 'cancelled' then 'cancelled'
      when a.confirmation_status = 'pending' then 'pending_confirmation'
      when a.confirmation_status = 'no_show' then 'no_show'
      else 'confirmed'
    end
  ) order by a.starts_at asc), '[]'::jsonb)
  into v_appointments
  from public.appointments a
  left join public.clients c on c.id = a.client_id
  where a.tenant_id = v_tenant.id
    and a.starts_at >= v_start
    and a.starts_at < v_end
    and a.state <> 'cancelled';

  return jsonb_build_object(
    'providerDisplayName', coalesce(v_tenant.display_name, 'Prestador'),
    'timeZone', coalesce(v_tenant.timezone, 'America/Sao_Paulo'),
    'summary', v_summary,
    'todayAppointments', v_appointments,
    'notifications', '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_provider_dashboard_snapshot(date) from public, anon;
grant execute on function public.get_provider_dashboard_snapshot(date) to authenticated;
