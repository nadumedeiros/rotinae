-- ============================================================================
-- Auto-provisionamento de Tenant no Dashboard do Prestador
-- ============================================================================
-- Se o prestador acessar o dashboard e ainda não tiver um tenant criado,
-- a função cria automaticamente o tenant, as configurações padrão e o serviço
-- padrão 'Atendimento', evitando a mensagem "Você não tem acesso a este painel".

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
    -- Garante que o profile existe com role provider
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

    -- Cria o tenant
    insert into public.tenants (owner_user_id, display_name, timezone, status)
    values (auth.uid(), coalesce(v_user_display_name, 'Meu Espaço'), 'America/Sao_Paulo', 'active')
    returning * into v_tenant;

    -- Cria as configurações padrão de atendimento
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
      2,
      '08:00',
      '18:00',
      60
    ) on conflict (provider_user_id) do nothing;
  end if;

  -- 3. Datas e fusos
  v_date := coalesce(p_date, (now() at time zone v_tenant.timezone)::date);
  v_start := v_date::timestamp at time zone v_tenant.timezone;
  v_end := (v_date + 1)::timestamp at time zone v_tenant.timezone;
  v_month_start := date_trunc('month', v_date::timestamp)::date;
  v_month_end := (v_month_start + interval '1 month')::date;

  -- 4. KPIs do resumo
  select jsonb_build_object(
    'activeClients', (select count(*) from public.clients where tenant_id = v_tenant.id and status = 'active'),
    'newClientsThisMonth', (select count(*) from public.clients where tenant_id = v_tenant.id and created_at >= (v_month_start::timestamp at time zone v_tenant.timezone) and created_at < (v_month_end::timestamp at time zone v_tenant.timezone)),
    'appointmentsToday', (select count(*) from public.appointments where tenant_id = v_tenant.id and starts_at >= v_start and starts_at < v_end and state <> 'cancelled'),
    'completedToday', (select count(*) from public.appointments where tenant_id = v_tenant.id and starts_at >= v_start and starts_at < v_end and state = 'completed'),
    'pendingConfirmationToday', (select count(*) from public.appointments where tenant_id = v_tenant.id and starts_at >= v_start and starts_at < v_end and state = 'scheduled' and confirmation_status = 'pending'),
    'serviceBalanceCents', coalesce((select sum(value_cents) from public.manual_payments where tenant_id = v_tenant.id and kind = 'charge' and status in ('pending', 'overdue') and due_date >= v_month_start and due_date < v_month_end), 0),
    'balanceReferenceMonth', to_char(v_month_start, 'YYYY-MM')
  ) into v_summary;

  -- 5. Agendamentos de hoje
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'startsAt', a.starts_at,
    'clientId', a.client_id,
    'clientName', coalesce(c.name, 'Sem cliente'),
    'serviceName', a.service_name_snapshot,
    'status', case
      when a.state = 'completed' then 'completed'
      when a.state = 'cancelled' then 'cancelled'
      when a.confirmation_status = 'pending' then 'pending_confirmation'
      when a.confirmation_status = 'no_show' then 'no_show'
      else 'confirmed'
    end
  ) order by a.starts_at), '[]'::jsonb)
  into v_appointments
  from public.appointments a
  left join public.clients c on c.id = a.client_id
  where a.tenant_id = v_tenant.id
    and a.starts_at >= greatest(v_start, now())
    and a.starts_at < v_end
    and a.state <> 'cancelled';

  return jsonb_build_object(
    'providerDisplayName', v_tenant.display_name,
    'timeZone', v_tenant.timezone,
    'summary', v_summary,
    'todayAppointments', v_appointments
  );
end;
$$;

revoke all on function public.get_provider_dashboard_snapshot(date) from public, anon;
grant execute on function public.get_provider_dashboard_snapshot(date) to authenticated;
