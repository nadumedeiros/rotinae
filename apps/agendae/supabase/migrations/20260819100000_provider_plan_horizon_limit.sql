-- ============================================================================
-- Horizonte de agendamento por plano do prestador (RN-PLN-018 a 023,
-- RF-PLN-009 a 013, HU-PLN-004/005 — docs/REGRAS_DE_NEGOCIO_MVP.md,
-- docs/REQUISITOS_FUNCIONAIS_MVP.md, docs/HISTORIAS_DE_USUARIO_MVP.md).
-- ============================================================================
--
-- REGRA (decisão de produto já aprovada, não reaberta aqui):
-- 1) Prestador com Premium ativo (assinatura `active`/`cancel_at_period_end`
--    dentro do período já pago, ou trial vigente) agenda sem nenhum limite de
--    meses à frente.
-- 2) Prestador no Plano Gratuito (sem Premium ativo e fora do período já
--    pago) tem um limite de 1 MÊS à frente para novos agendamentos.
-- 3) A carência pós-cancelamento NÃO é uma janela nova de 30 dias: é
--    exatamente `current_period_ends_at`/`trial_ends_at` já existentes em
--    `provider_subscriptions` (20260810173000, 20260811161000,
--    mercado-pago-subscriptions/index.ts). Nenhum novo contador é criado.
-- 4) Quando o período pago termina e o prestador efetivamente vira Gratuito,
--    o sistema varre os agendamentos futuros e cancela SOMENTE os que
--    ultrapassam o novo limite de 1 mês — exceção pontual e explícita a
--    RN-PLN-015 (que preserva agendamentos no downgrade), restrita a este
--    eixo de "horizonte de meses". RN-PLN-003 (cota diária) e RN-PLN-011
--    (teto de clientes) continuam preservando tudo normalmente — nada aqui
--    toca nessas duas regras.
-- 5) Cada cancelamento automático é registrado com motivo padronizado
--    (`cancellation_reason`) e também numa tabela de auditoria dedicada
--    (`plan_horizon_auto_cancellations`), distinguível de cancelamento
--    manual e útil para eventual reversão.
-- 6) O cliente vinculado é notificado pelo MESMO mecanismo já existente de
--    RN-COM-013 (`notify_appointment_change`, 20260811153000): usamos
--    `cancelled_by = 'provider'`, que já dispara notificação ao cliente sem
--    nenhum código novo de notificação.
-- 7) A checagem de horizonte roda no SERVIDOR, dentro de
--    `_create_appointment_row`/`update_appointment` (SECURITY DEFINER);
--    client-side é só otimização de UX (função `get_provider_appointment_
--    horizon` abaixo existe só para isso).
-- 8) Cada ocorrência de uma série recorrente é avaliada individualmente
--    (mesmo princípio de RN-REC-003): a checagem está dentro de
--    `_create_appointment_row`, chamada uma vez por ocorrência.
-- 9) A rotina de varredura pós-downgrade é idempotente: (a) o UPDATE de
--    cancelamento só afeta linhas ainda `state = 'scheduled'`; (b) a tabela
--    `plan_horizon_auto_cancellations` tem `appointment_id` como PK
--    (`on conflict do nothing`); (c) o próprio prestador só é reprocessado
--    quando `current_period_ends_at`/`trial_ends_at` mudar de valor desde a
--    última varredura (`provider_subscriptions.plan_horizon_swept_period_
--    ends_at`).
--
-- Depende de: 20260818120000_appointment_title_optional_service.sql
-- (última redefinição de `_create_appointment_row`, já com a assinatura de
-- 12 parâmetros/p_title) e 20260816235000_provider_unrestricted_advance_notice.sql
-- (última redefinição de `update_appointment`; ambas são redefinidas aqui por
-- completo — nunca editamos migrations antigas),
-- 20260810173000_provider_subscriptions.sql,
-- 20260811161000_subscription_lifecycle.sql,
-- 20260811153000_notification_producers.sql (notify_appointment_change),
-- 20260806102100_appointments.sql (audit_appointment_state_change).
--
-- Contrato de erro NOVO para o frontend: `PLAN_LIMIT_REACHED` — já existe em
-- `AppointmentErrorCode`/`HUMAN_MESSAGES` (src/domain/agenda/types.ts,
-- src/infra/agenda/supabase-appointment-adapter.ts) mas AINDA NÃO está em
-- `KNOWN_PREFIX_CODES` daquele adapter; falta uma linha
-- `PLAN_LIMIT_REACHED: "PLAN_LIMIT_REACHED"` nesse mapa para o prefixo ser
-- reconhecido em vez de cair em UNKNOWN. Wiring de frontend (mapa de erro +
-- seletor de datas) fica fora do escopo desta migration.

-- ============================================================================
-- 1) Helper: o prestador tem horizonte de agendamento irrestrito?
-- ============================================================================
--
-- Espelha EXATAMENTE o cálculo de `hasPremiumAccess` já usado pela ação
-- "status" de supabase/functions/mercado-pago-subscriptions/index.ts, para
-- que o RPC nunca divirja do que a tela de assinatura já informa ao
-- prestador. Ausência de linha em `provider_subscriptions` (prestador nunca
-- chegou a iniciar checkout) resolve para `false` (sem horizonte irrestrito),
-- mesmo comportamento hoje observável naquela função quando `current` é nulo.
create or replace function public.provider_has_unrestricted_appointment_horizon(p_provider_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select
        s.status in ('trialing', 'active')
        or (
          s.status = 'cancel_at_period_end'
          and coalesce(s.current_period_ends_at, s.trial_ends_at) is not null
          and coalesce(s.current_period_ends_at, s.trial_ends_at) > now()
        )
      from public.provider_subscriptions s
      where s.provider_user_id = p_provider_user_id
    ),
    false
  );
$$;

revoke all on function public.provider_has_unrestricted_appointment_horizon(uuid) from public, anon, authenticated;

-- ============================================================================
-- 2) _create_appointment_row — redefinição completa com a checagem nova
-- ============================================================================

-- NOTA (correção pós-falha de push, 2026-08-19): a primeira versão desta
-- migration foi escrita a partir de uma cópia desatualizada de
-- `_create_appointment_row` (baseada em 20260816235000), anterior à
-- migration de 18/08 que adicionou `p_title`, tornou `p_service_id`
-- opcional (compromisso livre sem cliente/serviço) e trocou
-- confirmation_source para 'provider_manual'. Isso criava uma SEGUNDA
-- sobrecarga da função (assinatura diferente, 11 parâmetros em vez de 12),
-- em vez de substituir a existente — e derrubava a verificação estrutural
-- abaixo (`more than one row`) ao tentar aplicar em produção. O corpo
-- abaixo foi reconstruído a partir da definição REAL vigente em produção
-- (pg_get_functiondef, consultada antes de reaplicar), preservando 100% do
-- comportamento de título/compromisso livre, com a checagem de horizonte
-- inserida no mesmo ponto pretendido originalmente.
create or replace function public._create_appointment_row(
  p_caller uuid,
  p_client_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_timezone text,
  p_duration_minutes integer,
  p_client_message text,
  p_internal_notes text,
  p_recurrence_group_id uuid,
  p_recurrence_index integer,
  p_recurrence_count integer,
  p_title text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_client_user_id uuid;
  v_client_status client_status;
  v_client_total_limit integer;
  v_client_daily_limit integer;
  v_client_window_start date;
  v_client_window_end date;
  v_caller_role profile_role;
  v_requested_by appointment_actor;
  v_tenant_timezone text;
  v_tenant_attendance_days smallint[];
  v_tenant_minimum_advance_hours integer;
  v_service_name text;
  v_service_value_cents integer;
  v_ends_at timestamptz;
  v_minimum_instant timestamptz;
  v_local_date date;
  v_daily_count integer;
  v_total_count integer;
  v_confirmation_status appointment_confirmation_status;
  v_confirmation_source appointment_confirmation_source;
  v_confirmed_at timestamptz;
  v_row public.appointments;
  -- RN-PLN-018/019: horizonte de agendamento por plano do prestador.
  v_owner_user_id uuid;
  v_has_unrestricted_horizon boolean;
  v_starts_local_date date;
  v_max_allowed_date date;
begin
  if p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'INVALID_DATE_TIME: duration must be a positive integer of minutes' using errcode = '22023';
  end if;

  -- RN final (DECISÃO DE PRODUTO 2026-08-18), checada o mais cedo possível:
  --   client_id presente -> service_id obrigatório.
  --   client_id ausente  -> title obrigatório (service_id passa a ser livre).
  if p_client_id is not null and p_service_id is null then
    raise exception 'SERVICE_REQUIRED: a service is required for appointments with a client' using errcode = '22023';
  end if;

  if p_client_id is null and btrim(coalesce(p_title, '')) = '' then
    raise exception 'TITLE_REQUIRED: title is required for appointments without a client' using errcode = '22023';
  end if;

  select role into v_caller_role from public.profiles where user_id = p_caller;

  if p_client_id is not null then
    select c.tenant_id, c.client_user_id, c.status, c.total_booking_limit, c.daily_booking_limit,
           c.request_window_start, c.request_window_end
      into v_tenant_id, v_client_user_id, v_client_status, v_client_total_limit, v_client_daily_limit,
           v_client_window_start, v_client_window_end
    from public.clients c
    where c.id = p_client_id;

    if not found then
      raise exception 'CLIENT_NOT_FOUND: client does not exist' using errcode = '22023';
    end if;

    if v_client_status <> 'active' then
      raise exception 'CLIENT_NOT_FOUND: client is not active' using errcode = '22023';
    end if;

    if v_caller_role = 'provider' then
      if not exists (
        select 1 from public.tenants t
        where t.id = v_tenant_id and t.owner_user_id = p_caller
      ) then
        raise exception 'FORBIDDEN: caller does not own this tenant' using errcode = '42501';
      end if;
      v_requested_by := 'provider';
    elsif v_caller_role = 'client' then
      if v_client_user_id is distinct from p_caller then
        raise exception 'FORBIDDEN: caller does not own this client record' using errcode = '42501';
      end if;
      if not exists (
        select 1 from public.provider_client_links l
        where l.tenant_id = v_tenant_id
          and l.client_user_id = p_caller
          and l.status = 'active'
      ) then
        raise exception 'CLIENT_LINK_INACTIVE: client link is not active' using errcode = '22023';
      end if;
      v_requested_by := 'client';
    else
      raise exception 'FORBIDDEN: caller has no recognized role' using errcode = '42501';
    end if;
  else
    if v_caller_role = 'client' then
      raise exception 'FORBIDDEN: client callers must always provide their own client_id' using errcode = '42501';
    elsif v_caller_role <> 'provider' then
      raise exception 'FORBIDDEN: caller has no recognized role' using errcode = '42501';
    end if;

    if p_service_id is not null then
      select s.tenant_id into v_tenant_id from public.services s where s.id = p_service_id;
      if not found then
        raise exception 'SERVICE_NOT_FOUND: service does not exist or is not active for this provider' using errcode = '22023';
      end if;
    else
      -- Compromisso livre (sem cliente e sem serviço, ex.: "Reunião",
      -- "Bloqueio pessoal"): não há mais nenhuma tabela de onde derivar
      -- `tenant_id` — só pode vir do próprio tenant do prestador chamador.
      select t.id into v_tenant_id from public.tenants t where t.owner_user_id = p_caller;
      if not found then
        raise exception 'FORBIDDEN: caller does not own an active tenant' using errcode = '42501';
      end if;
    end if;

    if not exists (
      select 1 from public.tenants t
      where t.id = v_tenant_id and t.owner_user_id = p_caller
    ) then
      raise exception 'FORBIDDEN: caller does not own this tenant' using errcode = '42501';
    end if;

    v_requested_by := 'provider';
  end if;

  select timezone, attendance_days, coalesce(minimum_advance_hours, 0), owner_user_id
    into v_tenant_timezone, v_tenant_attendance_days, v_tenant_minimum_advance_hours, v_owner_user_id
  from public.tenants where id = v_tenant_id;
  if not found then
    raise exception 'FORBIDDEN: tenant not found' using errcode = '42501';
  end if;

  if p_timezone is distinct from v_tenant_timezone then
    raise exception 'INVALID_DATE_TIME: timezone must match the provider agenda timezone' using errcode = '22023';
  end if;

  -- Snapshot do serviço: só resolvido quando `p_service_id` foi informado.
  -- Sem cliente E sem serviço, nenhum valor/nome é inventado — os três
  -- campos ficam NULL (appointments_service_snapshot_consistency_check).
  if p_service_id is not null then
    select name, reference_value_cents into v_service_name, v_service_value_cents
    from public.services
    where id = p_service_id and tenant_id = v_tenant_id and status = 'active';

    if not found then
      raise exception 'SERVICE_NOT_FOUND: service does not exist or is not active for this provider' using errcode = '22023';
    end if;
  else
    v_service_name := null;
    v_service_value_cents := null;
  end if;

  v_ends_at := p_starts_at + (p_duration_minutes * interval '1 minute');

  -- ==========================================================================
  -- RN-PLN-018/019/020: horizonte de agendamento por plano do prestador.
  -- Aplica-se a QUALQUER ator (prestador ou cliente em autoatendimento) —
  -- diferente do bloco abaixo (client-only), este é um limite do PLANO do
  -- prestador, válido para toda a agenda do tenant. Reutiliza
  -- current_period_ends_at/trial_ends_at já existentes (RN-PLN-020); nenhum
  -- novo contador de carência é criado aqui.
  -- ==========================================================================
  v_has_unrestricted_horizon := public.provider_has_unrestricted_appointment_horizon(v_owner_user_id);
  if not v_has_unrestricted_horizon then
    v_starts_local_date := (p_starts_at at time zone v_tenant_timezone)::date;
    v_max_allowed_date := ((now() at time zone v_tenant_timezone)::date + interval '1 month')::date;
    if v_starts_local_date > v_max_allowed_date then
      raise exception 'PLAN_LIMIT_REACHED: appointment date exceeds the free plan booking horizon of 1 month'
        using errcode = '22023';
    end if;
  end if;

  -- Regras restritivas aplicadas SOMENTE ao CLIENTE no autoatendimento:
  if v_requested_by = 'client' then
    if exists (
      select 1 from public.availability_blocks b
      where b.tenant_id = v_tenant_id
        and p_starts_at < b.ends_at
        and v_ends_at > b.starts_at
    ) then
      raise exception 'AGENDA_BLOCKED: requested slot overlaps a provider availability block' using errcode = '22023';
    end if;

    if not (
      extract(dow from (p_starts_at at time zone v_tenant_timezone))::smallint
      = any(coalesce(v_tenant_attendance_days, array[0,1,2,3,4,5,6]::smallint[]))
    ) then
      raise exception 'ATTENDANCE_DAY_UNAVAILABLE: requested date falls outside the provider attendance days'
        using errcode = '22023';
    end if;

    v_minimum_instant := now() + (v_tenant_minimum_advance_hours * interval '1 hour');
    if p_starts_at < v_minimum_instant then
      raise exception 'ADVANCE_NOTICE_INVALID: minimum advance notice not met' using errcode = '22023';
    end if;

    v_local_date := (p_starts_at at time zone v_tenant_timezone)::date;

    if v_client_window_start is not null
       and (v_local_date < v_client_window_start or v_local_date > v_client_window_end)
    then
      raise exception 'OUTSIDE_ALLOWED_PERIOD: requested date is outside the allowed window' using errcode = '22023';
    end if;

    if v_client_daily_limit is not null then
      select count(*) into v_daily_count
      from public.appointments a
      where a.client_id = p_client_id
        and a.state <> 'cancelled'
        and (a.starts_at at time zone v_tenant_timezone)::date = v_local_date;

      if v_daily_count >= v_client_daily_limit then
        raise exception 'DAILY_LIMIT_REACHED: daily booking limit reached for this client' using errcode = '22023';
      end if;
    end if;

    if v_client_total_limit is not null then
      select count(*) into v_total_count
      from public.appointments a
      where a.client_id = p_client_id
        and a.state <> 'cancelled';

      if v_total_count >= v_client_total_limit then
        raise exception 'TOTAL_LIMIT_REACHED: total booking limit reached for this client' using errcode = '22023';
      end if;
    end if;
  end if;

  if v_requested_by = 'provider' then
    v_confirmation_status := 'confirmed';
    v_confirmation_source := 'provider_manual';
    v_confirmed_at := now();
  else
    v_confirmation_status := 'pending';
    v_confirmation_source := null;
    v_confirmed_at := null;
  end if;

  begin
    insert into public.appointments (
      tenant_id, client_id, service_id, service_name_snapshot, value_cents_snapshot,
      starts_at, timezone, duration_minutes, state, confirmation_status,
      confirmation_source, confirmed_at, client_message, internal_notes,
      recurrence_group_id, recurrence_index, recurrence_count, title
    )
    values (
      v_tenant_id, p_client_id, p_service_id, v_service_name, v_service_value_cents,
      p_starts_at, p_timezone, p_duration_minutes, 'scheduled', v_confirmation_status,
      v_confirmation_source, v_confirmed_at, p_client_message, p_internal_notes,
      p_recurrence_group_id, p_recurrence_index, p_recurrence_count, p_title
    )
    returning * into v_row;
  exception
    when exclusion_violation then
      raise exception 'SLOT_UNAVAILABLE: requested slot overlaps an existing appointment' using errcode = '23P01';
  end;

  return v_row;
end;
$$;

-- ============================================================================
-- 3) update_appointment — redefinição completa com a checagem nova
-- ============================================================================

create or replace function public.update_appointment(
  p_id uuid,
  p_starts_at timestamptz default null,
  p_timezone text default null,
  p_duration_minutes integer default null,
  p_client_message text default null,
  p_client_message_provided boolean default false,
  p_internal_notes text default null,
  p_internal_notes_provided boolean default false,
  p_state text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role profile_role;
  v_requested_by appointment_actor;
  v_client_id uuid;
  v_client_tenant_id uuid;
  v_client_user_id uuid;
  v_client_total_limit integer;
  v_client_daily_limit integer;
  v_client_window_start date;
  v_client_window_end date;
  v_tenant_timezone text;
  v_tenant_minimum_advance_hours integer;
  v_owner_user_id uuid;
  v_current_state appointment_state;
  v_current_starts_at timestamptz;
  v_current_duration integer;
  v_current_timezone text;
  v_new_starts_at timestamptz;
  v_new_timezone text;
  v_new_duration integer;
  v_ends_at timestamptz;
  v_minimum_instant timestamptz;
  v_local_date date;
  v_daily_count integer;
  v_time_changed boolean;
  v_row public.appointments;
  -- RN-PLN-018/019: horizonte de agendamento por plano do prestador.
  v_has_unrestricted_horizon boolean;
  v_starts_local_date date;
  v_max_allowed_date date;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  select a.client_id, a.state, a.starts_at, a.duration_minutes, a.timezone, a.tenant_id
    into v_client_id, v_current_state, v_current_starts_at, v_current_duration, v_current_timezone, v_client_tenant_id
  from public.appointments a
  where a.id = p_id
  for update of a;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND: appointment does not exist' using errcode = '22023';
  end if;

  if v_client_id is not null then
    select c.tenant_id, c.client_user_id, c.total_booking_limit, c.daily_booking_limit,
           c.request_window_start, c.request_window_end
      into v_client_tenant_id, v_client_user_id, v_client_total_limit, v_client_daily_limit,
           v_client_window_start, v_client_window_end
    from public.clients c
    where c.id = v_client_id;
  end if;

  select role into v_caller_role from public.profiles where user_id = v_caller;

  if v_caller_role = 'provider' then
    if not exists (
      select 1 from public.tenants t where t.id = v_client_tenant_id and t.owner_user_id = v_caller
    ) then
      raise exception 'FORBIDDEN: caller does not own this tenant' using errcode = '42501';
    end if;
    v_requested_by := 'provider';
  elsif v_caller_role = 'client' then
    if v_client_user_id is distinct from v_caller then
      raise exception 'FORBIDDEN: caller does not own this appointment' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.provider_client_links l
      where l.tenant_id = v_client_tenant_id and l.client_user_id = v_caller and l.status = 'active'
    ) then
      raise exception 'CLIENT_LINK_INACTIVE: client link is not active' using errcode = '22023';
    end if;
    v_requested_by := 'client';
  else
    raise exception 'FORBIDDEN: caller has no recognized role' using errcode = '42501';
  end if;

  if v_current_state in ('completed', 'cancelled', 'no_show') then
    raise exception 'INVALID_STATE_TRANSITION: terminal appointments cannot be updated' using errcode = '22023';
  end if;

  select timezone, coalesce(minimum_advance_hours, 0), owner_user_id
    into v_tenant_timezone, v_tenant_minimum_advance_hours, v_owner_user_id
  from public.tenants where id = v_client_tenant_id;

  v_new_starts_at := coalesce(p_starts_at, v_current_starts_at);
  v_new_timezone := coalesce(p_timezone, v_current_timezone);
  v_new_duration := coalesce(p_duration_minutes, v_current_duration);

  if p_timezone is not null and p_timezone is distinct from v_tenant_timezone then
    raise exception 'INVALID_DATE_TIME: timezone must match the provider agenda timezone' using errcode = '22023';
  end if;

  if p_duration_minutes is not null and p_duration_minutes <= 0 then
    raise exception 'INVALID_DATE_TIME: duration must be a positive integer of minutes' using errcode = '22023';
  end if;

  v_time_changed := (p_starts_at is not null and p_starts_at is distinct from v_current_starts_at)
                 or (p_duration_minutes is not null and p_duration_minutes is distinct from v_current_duration);

  -- ==========================================================================
  -- RN-PLN-018/019/020: horizonte de agendamento por plano do prestador.
  -- Assim como na criação, vale para QUALQUER ator que remarque (prestador ou
  -- cliente), pois é limite do plano do prestador dono do tenant, não uma
  -- regra exclusiva do autoatendimento do cliente. Só é avaliado quando o
  -- horário efetivamente muda (v_time_changed) — remarcações "sem mudança de
  -- data" (ex.: só troca de mensagem) nunca disparam esta checagem.
  -- ==========================================================================
  if v_time_changed then
    v_has_unrestricted_horizon := public.provider_has_unrestricted_appointment_horizon(v_owner_user_id);
    if not v_has_unrestricted_horizon then
      v_starts_local_date := (v_new_starts_at at time zone v_tenant_timezone)::date;
      v_max_allowed_date := ((now() at time zone v_tenant_timezone)::date + interval '1 month')::date;
      if v_starts_local_date > v_max_allowed_date then
        raise exception 'PLAN_LIMIT_REACHED: appointment date exceeds the free plan booking horizon of 1 month'
          using errcode = '22023';
      end if;
    end if;
  end if;

  if v_time_changed and v_requested_by = 'client' then
    v_ends_at := v_new_starts_at + (v_new_duration * interval '1 minute');

    if exists (
      select 1 from public.availability_blocks b
      where b.tenant_id = v_client_tenant_id
        and v_new_starts_at < b.ends_at
        and v_ends_at > b.starts_at
    ) then
      raise exception 'AGENDA_BLOCKED: requested slot overlaps a provider availability block' using errcode = '22023';
    end if;

    v_minimum_instant := now() + (v_tenant_minimum_advance_hours * interval '1 hour');
    if v_new_starts_at < v_minimum_instant then
      raise exception 'ADVANCE_NOTICE_INVALID: minimum advance notice not met' using errcode = '22023';
    end if;

    v_local_date := (v_new_starts_at at time zone v_tenant_timezone)::date;

    if v_client_window_start is not null
       and (v_local_date < v_client_window_start or v_local_date > v_client_window_end)
    then
      raise exception 'OUTSIDE_ALLOWED_PERIOD: requested date is outside the allowed window' using errcode = '22023';
    end if;

    if v_client_daily_limit is not null then
      select count(*) into v_daily_count
      from public.appointments a
      where a.client_id = v_client_id
        and a.id <> p_id
        and a.state <> 'cancelled'
        and (a.starts_at at time zone v_tenant_timezone)::date = v_local_date;

      if v_daily_count >= v_client_daily_limit then
        raise exception 'DAILY_LIMIT_REACHED: daily booking limit reached for this client' using errcode = '22023';
      end if;
    end if;
  end if;

  begin
    update public.appointments
    set starts_at = v_new_starts_at,
        timezone = v_new_timezone,
        duration_minutes = v_new_duration,
        client_message = case when p_client_message_provided then p_client_message else client_message end,
        internal_notes = case when p_internal_notes_provided then p_internal_notes else internal_notes end,
        state = case when p_state is not null then p_state::appointment_state else state end,
        updated_at = now()
    where id = p_id
    returning * into v_row;
  exception
    when exclusion_violation then
      raise exception 'SLOT_UNAVAILABLE: requested slot is already booked for this provider (%)', v_new_starts_at
        using errcode = '22023';
  end;

  return v_row;
end;
$$;

-- ============================================================================
-- 4) get_provider_appointment_horizon — leitura pública para otimização de UX
-- ============================================================================
--
-- RF-PLN-010: nunca é a barreira de segurança (essa é a checagem dentro das
-- duas funções acima); serve só para o seletor de datas do frontend poder
-- desabilitar/avisar antes de tentar submeter.
create or replace function public.get_provider_appointment_horizon(p_tenant_id uuid)
returns table (unrestricted boolean, max_allowed_date date)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role profile_role;
  v_owner_user_id uuid;
  v_tenant_timezone text;
  v_has_unrestricted boolean;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  select owner_user_id, timezone into v_owner_user_id, v_tenant_timezone
  from public.tenants where id = p_tenant_id;

  if not found then
    raise exception 'FORBIDDEN: tenant not found' using errcode = '42501';
  end if;

  select role into v_caller_role from public.profiles where user_id = v_caller;

  if v_caller_role = 'provider' then
    if v_owner_user_id is distinct from v_caller then
      raise exception 'FORBIDDEN: caller does not own this tenant' using errcode = '42501';
    end if;
  elsif v_caller_role = 'client' then
    if not exists (
      select 1 from public.provider_client_links l
      where l.tenant_id = p_tenant_id and l.client_user_id = v_caller and l.status = 'active'
    ) then
      raise exception 'CLIENT_LINK_INACTIVE: client link is not active' using errcode = '22023';
    end if;
  else
    raise exception 'FORBIDDEN: caller has no recognized role' using errcode = '42501';
  end if;

  v_has_unrestricted := public.provider_has_unrestricted_appointment_horizon(v_owner_user_id);

  return query
    select
      v_has_unrestricted,
      case when v_has_unrestricted then null
        else ((now() at time zone v_tenant_timezone)::date + interval '1 month')::date
      end;
end;
$$;

revoke all on function public.get_provider_appointment_horizon(uuid) from public, anon, authenticated;
grant execute on function public.get_provider_appointment_horizon(uuid) to authenticated;

-- ============================================================================
-- 5) Varredura pós-downgrade (RN-PLN-021/022/023, RF-PLN-011/012/013)
-- ============================================================================

-- Trilha dedicada de auditoria/reversão: distingue cancelamento automático de
-- manual sem depender de comparar texto livre de `cancellation_reason`, e
-- garante idempotência por linha via PK em `appointment_id`.
create table public.plan_horizon_auto_cancellations (
  appointment_id uuid primary key references public.appointments (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id),
  provider_user_id uuid not null references public.profiles (user_id),
  original_starts_at timestamptz not null,
  cancelled_at timestamptz not null default now(),
  -- period_ends_at (current_period_ends_at ou trial_ends_at) vigente no
  -- momento da varredura — permite auditar exatamente qual ciclo de
  -- downgrade motivou este cancelamento específico.
  triggered_by_period_ends_at timestamptz
);

create index plan_horizon_auto_cancellations_provider_idx
  on public.plan_horizon_auto_cancellations (provider_user_id);

alter table public.plan_horizon_auto_cancellations enable row level security;
-- Nenhuma policy para anon/authenticated de propósito — mesmo padrão de
-- audit_events (20260806100900): escrita e leitura administrativa só via
-- service_role ou função SECURITY DEFINER dedicada.

-- Idempotência do JOB (nível prestador): registra qual period_ends_at já foi
-- varrido, para que o mesmo ciclo de downgrade não seja reprocessado a cada
-- UPDATE subsequente de provider_subscriptions.
alter table public.provider_subscriptions
  add column if not exists plan_horizon_swept_period_ends_at timestamptz;

create or replace function public.provider_process_plan_horizon_downgrade(p_provider_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_current_period_ends_at timestamptz;
  v_trial_ends_at timestamptz;
  v_swept_period_ends_at timestamptz;
  v_period_ends_at timestamptz;
  v_has_unrestricted boolean;
  v_tenant record;
  v_max_allowed_date date;
  v_appointment record;
  v_cancelled_count integer := 0;
begin
  -- `for update` trava a linha do prestador pela duração da transação,
  -- serializando execuções concorrentes deste mesmo sweep (idempotência de
  -- concorrência, além da idempotência lógica abaixo).
  select status, current_period_ends_at, trial_ends_at, plan_horizon_swept_period_ends_at
    into v_status, v_current_period_ends_at, v_trial_ends_at, v_swept_period_ends_at
  from public.provider_subscriptions
  where provider_user_id = p_provider_user_id
  for update;

  if not found then
    -- Prestador sem nenhum registro de assinatura: nunca teve horizonte
    -- irrestrito concedido por este mecanismo, nada a varrer.
    return 0;
  end if;

  v_period_ends_at := coalesce(v_current_period_ends_at, v_trial_ends_at);

  v_has_unrestricted := v_status in ('trialing', 'active')
    or (
      v_status = 'cancel_at_period_end'
      and v_period_ends_at is not null
      and v_period_ends_at > now()
    );

  if v_has_unrestricted then
    -- Ainda dentro do período pago/trial vigente: nada a varrer agora (a
    -- carência é exatamente isto — RN-PLN-020).
    return 0;
  end if;

  if v_period_ends_at is not distinct from v_swept_period_ends_at then
    -- Mesmo ciclo de downgrade já processado (inclui o caso null = null: um
    -- prestador que nunca teve período pago/trial registrado nunca dispara
    -- a varredura, pois nunca teve horizonte irrestrito para reverter).
    return 0;
  end if;

  for v_tenant in
    select id, timezone from public.tenants where owner_user_id = p_provider_user_id
  loop
    v_max_allowed_date := ((now() at time zone v_tenant.timezone)::date + interval '1 month')::date;

    for v_appointment in
      select a.id, a.starts_at
      from public.appointments a
      where a.tenant_id = v_tenant.id
        and a.state = 'scheduled'
        and (a.starts_at at time zone v_tenant.timezone)::date > v_max_allowed_date
      order by a.starts_at
      for update of a
    loop
      -- RN-REC-003/RN-PLN-023: cada ocorrência (inclusive de série
      -- recorrente) é avaliada e cancelada individualmente; as demais
      -- ocorrências da mesma série não são afetadas por esta atualização.
      update public.appointments
      set state = 'cancelled',
          cancelled_by = 'provider',
          cancellation_reason =
            'Cancelamento automático: agendamento fora do novo limite de 1 mês do Plano Gratuito, aplicado após o fim do período Premium.',
          cancelled_at = now()
      where id = v_appointment.id
        and state = 'scheduled';

      if found then
        insert into public.plan_horizon_auto_cancellations (
          appointment_id, tenant_id, provider_user_id, original_starts_at, triggered_by_period_ends_at
        ) values (
          v_appointment.id, v_tenant.id, p_provider_user_id, v_appointment.starts_at, v_period_ends_at
        )
        on conflict (appointment_id) do nothing;

        v_cancelled_count := v_cancelled_count + 1;
      end if;
    end loop;
  end loop;

  update public.provider_subscriptions
  set plan_horizon_swept_period_ends_at = v_period_ends_at
  where provider_user_id = p_provider_user_id;

  return v_cancelled_count;
end;
$$;

revoke all on function public.provider_process_plan_horizon_downgrade(uuid) from public, anon, authenticated;
-- Grant explícito a service_role: permite reexecução manual e segura (a
-- função já é idempotente) a partir de uma futura Edge Function
-- administrativa, mesmo padrão operacional de
-- finalize-subscription-cancellations, sem depender de privilégio implícito.
grant execute on function public.provider_process_plan_horizon_downgrade(uuid) to service_role;

-- Disparo reativo: qualquer INSERT/UPDATE relevante em provider_subscriptions
-- (webhook do Mercado Pago, finalize-subscription-cancellations, ou
-- admin_set_provider_plan) reavalia o horizonte do prestador. A função é
-- idempotente por si só (ver comentários acima), então acionar em toda
-- mudança relevante é seguro e não duplica cancelamento/notificação.
--
-- Sem risco de recursão: a atualização final feita DENTRO da função só toca
-- `plan_horizon_swept_period_ends_at`, coluna que NÃO está na lista `of ...`
-- abaixo — portanto aquele UPDATE não reaciona esta mesma trigger.
create or replace function public.trigger_plan_horizon_downgrade_sweep()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.provider_process_plan_horizon_downgrade(new.provider_user_id);
  return new;
end;
$$;

revoke all on function public.trigger_plan_horizon_downgrade_sweep() from public, anon, authenticated;

drop trigger if exists provider_subscriptions_plan_horizon_downgrade on public.provider_subscriptions;
create trigger provider_subscriptions_plan_horizon_downgrade
  after insert or update of status, current_period_ends_at, trial_ends_at, cancel_at_period_end
  on public.provider_subscriptions
  for each row
  execute function public.trigger_plan_horizon_downgrade_sweep();

-- ============================================================================
-- Verificação estrutural (mesmo padrão de outras migrations desta série,
-- ex.: 20260814110000) — checagens de definição de função, sem depender de
-- sessão/JWT.
-- ============================================================================

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = '_create_appointment_row';

  assert v_definition like '%PLAN_LIMIT_REACHED%',
    '_create_appointment_row deveria lançar PLAN_LIMIT_REACHED';
  assert v_definition like '%provider_has_unrestricted_appointment_horizon%',
    '_create_appointment_row deveria consultar provider_has_unrestricted_appointment_horizon';

  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'update_appointment';

  assert v_definition like '%PLAN_LIMIT_REACHED%',
    'update_appointment deveria lançar PLAN_LIMIT_REACHED';
  assert v_definition like '%v_time_changed then%',
    'update_appointment deveria checar o horizonte de plano apenas quando o horário muda';

  raise notice 'provider_plan_horizon_limit: verificações estruturais passaram.';
end $$;

do $$
declare
  v_ref timestamptz := '2026-01-15T12:00:00Z';
  v_ref_date date := (v_ref)::date;
begin
  -- Regressão da aritmética "1 mês à frente" (RN-PLN-019): 15/01 + 1 mês =
  -- 15/02, mesmo princípio usado dentro das funções acima.
  assert ((v_ref_date + interval '1 month')::date) = date '2026-02-15',
    'o horizonte de 1 mês deveria somar exatamente um mês à data de referência';

  -- Rollover de fim de mês (31/01 + 1 mês = 28/02, ano não bissexto):
  -- Postgres normaliza automaticamente dias inexistentes no mês seguinte.
  assert ((date '2026-01-31' + interval '1 month')::date) = date '2026-02-28',
    'o rollover de fim de mês deveria normalizar para o último dia do mês seguinte';

  raise notice 'provider_plan_horizon_limit: teste de regressão da aritmética de 1 mês passou.';
end $$;
