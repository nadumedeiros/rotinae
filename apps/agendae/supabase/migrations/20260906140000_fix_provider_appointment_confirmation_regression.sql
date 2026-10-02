-- ============================================================================
-- REGRESSÃO CRÍTICA CORRIGIDA: agendamento criado pelo prestador sempre
-- nascia "Confirmado", nunca "A confirmar" — desde 17/08/2026
-- ============================================================================
--
-- RELATO DO USUÁRIO (06/09/2026, duas vezes na mesma sessão): "quando
-- estamos salvando e colocamos a confirmar, salva como confirmado" —
-- reproduzível em QUALQUER agendamento criado pelo prestador, não só em
-- casos de borda (antecedência mínima).
--
-- INVESTIGAÇÃO ANTERIOR NESTA MESMA SESSÃO (DEC-167/BLG-104) tinha corrigido
-- só um caminho secundário e raro: o insert local de contorno em
-- `supabase-appointment-adapter.ts`, usado apenas quando a RPC
-- `create_appointment` rejeita por `ADVANCE_NOTICE_INVALID`/outros códigos
-- de restrição do cliente com o prestador como chamador. Essa correção
-- estava certa, mas era secundária — o CAMINHO PRIMÁRIO (a própria RPC,
-- usada em toda criação normal) continuava com o bug, por isso o usuário
-- reportou o mesmo sintoma de novo depois da primeira correção.
--
-- CAUSA RAIZ REAL: `_create_appointment_row` (função interna chamada por
-- `create_appointment` E `create_recurring_appointments`) tem, desde
-- `20260806102200_appointment_rpcs.sql`, a decisão de design documentada:
--   requestedBy = 'client'   -> nasce confirmed  (RN-AGD-014: cliente que
--                                agenda diretamente não precisa de aprovação)
--   requestedBy = 'provider' -> nasce pending    (precisa de confirmação
--                                manual posterior, via confirm_appointment_manually)
--
-- Em `20260817000100_fix_provider_confirmation_source.sql` (título indica
-- só um ajuste de enum; nenhum `alter type`/`add value` existe nesse
-- arquivo — o enum `appointment_confirmation_source` já tinha
-- 'provider_manual' desde a criação da tabela em 20260806102100), a
-- redefinição da função INVERTEU os dois ramos por engano:
--   requestedBy = 'provider' -> confirmed  (ERRADO)
--   requestedBy = 'client'   -> pending    (ERRADO)
-- Nenhum comentário/decisão de produto justifica a inversão no ponto onde
-- ela ocorre — é tratado como bug, não como mudança de design. Toda
-- redefinição seguinte de `_create_appointment_row` (20260818120000,
-- 20260819100000, 20260823150000 — a vigente) preservou a inversão sem
-- perceber, por nunca reabrir essa lógica especificamente.
--
-- IMPACTO: desde 17/08/2026, TODO agendamento criado pelo prestador
-- (individual ou recorrente) nasceu `confirmation_status = 'confirmed'`,
-- `confirmation_source = 'provider_manual'`, `confirmed_at = now()` —
-- mesmo quando "A confirmar" era escolhido no formulário — e TODO
-- agendamento criado pelo próprio cliente nasceu `pending`, quando deveria
-- nascer `confirmed` (RN-AGD-014). Nenhum backfill é feito nesta migration:
-- corrigir dados históricos de `confirmation_status`/`confirmation_source`
-- de agendamentos já existentes é uma decisão de produto separada (pode
-- alterar o que o cliente já viu como "confirmado"), não tomada
-- unilateralmente aqui — sinalizado como pendência abaixo.
--
-- CORREÇÃO: corpo de `_create_appointment_row` idêntico ao vigente em
-- `20260823150000_client_policy_renewal.sql` (preserva RN-PLN-018/019/020,
-- limite por ciclo de política do cliente, checagens de serviço/título
-- opcionais, etc. — nenhuma outra regra tocada), com APENAS os dois ramos
-- de confirmação revertidos para o design original documentado em
-- 20260806102200.
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
  v_client_policy_cycle_started_at timestamptz;
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
           c.request_window_start, c.request_window_end, c.policy_cycle_started_at
      into v_tenant_id, v_client_user_id, v_client_status, v_client_total_limit, v_client_daily_limit,
           v_client_window_start, v_client_window_end, v_client_policy_cycle_started_at
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
      -- RN da renovação de cliente: a contagem é POR CICLO (`created_at >=
      -- policy_cycle_started_at`), não desde sempre. Clientes nunca
      -- renovados têm `policy_cycle_started_at = created_at` (backfill de
      -- 20260823150000), então continuam contando TODOS os agendamentos
      -- deles desde sempre.
      select count(*) into v_total_count
      from public.appointments a
      where a.client_id = p_client_id
        and a.state <> 'cancelled'
        and a.created_at >= v_client_policy_cycle_started_at;

      if v_total_count >= v_client_total_limit then
        raise exception 'TOTAL_LIMIT_REACHED: total booking limit reached for this client' using errcode = '22023';
      end if;
    end if;
  end if;

  -- ==========================================================================
  -- CORREÇÃO DESTA MIGRATION (só este bloco muda em relação a
  -- 20260823150000): os dois ramos abaixo estavam invertidos desde
  -- 20260817000100 — ver nota no topo do arquivo.
  -- ==========================================================================
  if v_requested_by = 'client' then
    v_confirmation_status := 'confirmed';
    v_confirmation_source := 'client';
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

-- Sem `drop function` antes: assinatura idêntica à vigente (mesmos 12
-- parâmetros, mesmo `p_title default null`) — `create or replace` de fato
-- substitui, mesmo padrão de toda redefinição anterior desta função. Sem
-- `revoke`/`grant`, igual a toda redefinição anterior desta função interna:
-- nunca teve grant explícito para nenhum papel (prefixo `_`, nunca chamada
-- diretamente pelo adapter) — `create_appointment`/`create_recurring_appointments`
-- (mesmo owner de migração) têm EXECUTE implícito por posse.

-- ============================================================================
-- Verificação estrutural
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

  assert v_definition like '%if v_requested_by = ''client'' then%v_confirmation_status := ''confirmed''%',
    '_create_appointment_row deveria confirmar automaticamente só agendamentos solicitados pelo CLIENTE (RN-AGD-014)';
  assert v_definition like '%v_confirmation_source := ''client''%',
    '_create_appointment_row deveria gravar confirmation_source=client para agendamentos do cliente';
  -- Continua preservando as regras já existentes, intocadas por esta migration.
  assert v_definition like '%v_client_policy_cycle_started_at%',
    '_create_appointment_row deveria continuar consultando policy_cycle_started_at do cliente';
  assert v_definition like '%PLAN_LIMIT_REACHED%',
    '_create_appointment_row deveria continuar aplicando o horizonte de agendamento por plano';

  raise notice '_create_appointment_row: verificação estrutural da correção de confirmação passou.';
end $$;

notify pgrst, 'reload schema';
