-- Torna `appointments.client_id` opcional para o agendamento manual do
-- prestador sem cliente cadastrado/vinculado (BACKLOG.md, BLG-051, DEC-127).
--
-- Contexto: `app/agenda.tsx` (Ada) deixa de exigir a seleção de um cliente ao
-- criar um agendamento manual pelo prestador — cenário real ("horário
-- reservado", "bloqueio pessoal disfarçado de atendimento", cliente que
-- ainda não tem cadastro) que a regra anterior impedia sem necessidade,
-- porque a política de cliente (limites, janela de datas) nunca se aplicou a
-- agendamentos criados pelo prestador (`v_requested_by = 'provider'`) — só a
-- ausência de linha em `clients` era o problema.
--
-- Depende de: 20260806102100_appointments.sql (tabela, view, triggers),
-- 20260806102200_appointment_rpcs.sql (`_create_appointment_row`,
-- `update_appointment`, `cancel_appointment`, `confirm_appointment_manually`),
-- 20260811143000_dashboard_snapshot.sql (`get_provider_dashboard_snapshot`).
--
-- Escopo explicitamente FORA desta migration (outra sessão em andamento):
-- fluxo de vínculo cliente<->prestador por código (`clients.tsx`,
-- `rotate_provider_link_code`/`redeem_provider_link_code`) — nada aqui altera
-- essas RPCs.

-- ============================================================================
-- 1) Coluna: client_id passa a aceitar NULL
-- ============================================================================
--
-- A FK (`references public.clients (id) on delete restrict`) e o índice
-- `appointments_client_idx` são preservados sem alteração — uma FK nullable
-- só valida quando o valor não é nulo, comportamento padrão do Postgres.
-- `enforce_appointments_immutable_columns` (20260806102100) já usa
-- `is distinct from`, que trata `null = null` como "não mudou" e continua
-- bloqueando corretamente a REATRIBUIÇÃO de um `client_id` já definido (nulo
-- -> preenchido ou preenchido -> outro cliente permanecem proibidos).

alter table public.appointments alter column client_id drop not null;

comment on column public.appointments.client_id is
  'Cadastro em `clients` vinculado a este agendamento. NULL quando o '
  'prestador cria manualmente sem selecionar/ter um cliente cadastrado '
  '(DEC-127) — nesse caso o agendamento nasce sempre com '
  'confirmation_source = provider_manual e nunca é visível na '
  '`appointments_client_view` (que faz INNER JOIN com `clients`).';

-- ============================================================================
-- 2) _create_appointment_row — ramo dedicado para p_client_id nulo
-- ============================================================================
--
-- DECISÃO DE DESIGN (DEC-127) — quem pode omitir o cliente
-- ----------------------------------------------------------------------------
-- Um chamador com `profiles.role = 'client'` SEMPRE tem um `client_id` (o
-- próprio cadastro, resolvido a partir de `client_user_id = auth.uid()`) —
-- omitir esse valor não corresponde a nenhum caso de uso real do cliente, e
-- aceitar isso silenciosamente abriria a possibilidade de um cliente criar um
-- agendamento "anônimo" que escapa da política de limites/janela dele mesmo
-- (essas regras são aplicadas apenas quando `v_requested_by = 'client'`, e
-- dependem de `p_client_id` para contar/consultar). Por isso um chamador
-- `client` que enviar `p_client_id is null` recebe `FORBIDDEN` explícito, sem
-- ambiguidade com "cliente não encontrado".
--
-- Quando `p_client_id is null` E o chamador é `provider`: o `tenant_id` (que
-- antes vinha sempre de `clients.tenant_id`) passa a ser resolvido a partir
-- de `services.tenant_id` — o serviço sempre pertence a exatamente um tenant,
-- e a posse desse tenant pelo chamador é validada em seguida, exatamente como
-- já acontecia no ramo com cliente. O restante do fluxo (fuso do tenant,
-- serviço ativo, exclusion constraint de conflito de horário) é código
-- compartilhado e não muda: bloqueio de agenda, antecedência mínima e
-- política de limites do cliente já eram (e continuam sendo) aplicados
-- apenas quando `v_requested_by = 'client'`, então nunca dependeram de
-- `p_client_id` estar preenchido no ramo do prestador.

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
  p_recurrence_count integer
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
begin
  if p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'INVALID_DATE_TIME: duration must be a positive integer of minutes' using errcode = '22023';
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

    -- Cadastro arquivado (RN implícita: um cliente inativo não recebe novos
    -- agendamentos). Reaproveita o mesmo código público — não há um código
    -- mais específico em AppointmentErrorCode para este caso.
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
    -- DEC-127: só um `provider` pode criar sem cliente. Um `client` sempre
    -- tem o próprio cadastro — omitir aqui nunca é um uso legítimo.
    if v_caller_role = 'client' then
      raise exception 'FORBIDDEN: client callers must always provide their own client_id' using errcode = '42501';
    elsif v_caller_role <> 'provider' then
      raise exception 'FORBIDDEN: caller has no recognized role' using errcode = '42501';
    end if;

    select s.tenant_id into v_tenant_id from public.services s where s.id = p_service_id;
    if not found then
      raise exception 'SERVICE_NOT_FOUND: service does not exist or is not active for this provider' using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.tenants t
      where t.id = v_tenant_id and t.owner_user_id = p_caller
    ) then
      raise exception 'FORBIDDEN: caller does not own this tenant' using errcode = '42501';
    end if;

    v_requested_by := 'provider';
  end if;

  select timezone into v_tenant_timezone from public.tenants where id = v_tenant_id;
  if not found then
    raise exception 'FORBIDDEN: tenant not found' using errcode = '42501';
  end if;

  -- RN-AGD-008: o fuso oficial é o do prestador. O valor informado precisa
  -- ser exatamente o mesmo — nunca um fuso arbitrário escolhido pelo
  -- cliente.
  if p_timezone is distinct from v_tenant_timezone then
    raise exception 'INVALID_DATE_TIME: timezone must match the provider agenda timezone' using errcode = '22023';
  end if;

  select name, reference_value_cents into v_service_name, v_service_value_cents
  from public.services
  where id = p_service_id and tenant_id = v_tenant_id and status = 'active';

  if not found then
    raise exception 'SERVICE_NOT_FOUND: service does not exist or is not active for this provider' using errcode = '22023';
  end if;

  v_ends_at := p_starts_at + (p_duration_minutes * interval '1 minute');

  -- Precedência do bloqueio (handoff): só se aplica a solicitações do
  -- CLIENTE. O prestador pode criar manualmente dentro do próprio bloqueio
  -- (a checagem de horário já ocupado continua valendo via exclusion
  -- constraint, ao final desta função).
  if v_requested_by = 'client' and exists (
    select 1 from public.availability_blocks b
    where b.tenant_id = v_tenant_id
      and p_starts_at < b.ends_at
      and v_ends_at > b.starts_at
  ) then
    raise exception 'AGENDA_BLOCKED: requested slot overlaps a provider availability block' using errcode = '22023';
  end if;

  -- RN-AGD-004/008/009: antecedência mínima de 1 dia útil, calculada no fuso
  -- do prestador. Aplicada independentemente de haver cliente — já valia
  -- assim para o prestador antes desta migration.
  v_minimum_instant := public.minimum_bookable_instant(now(), v_tenant_timezone);
  if p_starts_at < v_minimum_instant then
    raise exception 'ADVANCE_NOTICE_INVALID: minimum advance notice not met' using errcode = '22023';
  end if;

  -- RN-AGD-015 a 022: política de agendamento do cliente. Aplicada somente a
  -- solicitações do CLIENTE — quando o prestador cria manualmente (ex.:
  -- atendimento combinado por telefone, ou sem cliente algum), ele está
  -- gerindo a própria agenda, não "solicitando" no sentido da regra. Este
  -- bloco nunca executa quando `p_client_id is null`, porque nesse caso
  -- `v_requested_by` é sempre `'provider'` (ver ramo acima).
  if v_requested_by = 'client' then
    v_local_date := (p_starts_at at time zone v_tenant_timezone)::date;

    if v_client_window_start is not null
       and (v_local_date < v_client_window_start or v_local_date > v_client_window_end)
    then
      raise exception 'OUTSIDE_ALLOWED_PERIOD: requested date is outside the allowed window' using errcode = '22023';
    end if;

    if v_client_daily_limit is not null then
      -- RN-AGD-020: cancelados não contam; demais estados contam pela data
      -- civil do atendimento no fuso do prestador.
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
      starts_at, timezone, duration_minutes,
      confirmation_status, confirmation_source, confirmed_at,
      client_message, internal_notes,
      recurrence_group_id, recurrence_index, recurrence_count
    ) values (
      v_tenant_id, p_client_id, p_service_id, v_service_name, v_service_value_cents,
      p_starts_at, p_timezone, p_duration_minutes,
      v_confirmation_status, v_confirmation_source, v_confirmed_at,
      p_client_message, p_internal_notes,
      p_recurrence_group_id, p_recurrence_index, p_recurrence_count
    )
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'SLOT_UNAVAILABLE: requested slot conflicts with an existing appointment at %', p_starts_at
      using errcode = '22023';
  end;

  return v_row;
end;
$$;

revoke all on function public._create_appointment_row(
  uuid, uuid, uuid, timestamptz, text, integer, text, text, uuid, integer, integer
) from public, anon, authenticated;

-- ============================================================================
-- 3) update_appointment / cancel_appointment / confirm_appointment_manually
--    — usar appointments.tenant_id diretamente (corrige bug pré-existente)
-- ============================================================================
--
-- BUG CORRIGIDO (achado durante esta migration, não introduzido por ela): as
-- três funções abaixo derivavam `tenant_id` fazendo um SEGUNDO select em
-- `clients` a partir do `client_id` do agendamento
-- (`select c.tenant_id from clients c where c.id = v_client_id`), quando a
-- própria linha de `appointments` já tem `tenant_id` (coluna própria, nunca
-- nula, imutável). Isso já era desnecessário antes desta migration — e passa
-- a ser um bug ativo agora que `client_id` pode ser nulo: um `select ...
-- where c.id = null` nunca encontra linha, então `v_client_tenant_id` viraria
-- `null` e a checagem de posse do tenant pelo prestador
-- (`t.id = v_client_tenant_id and t.owner_user_id = v_caller`) falharia
-- incorretamente com `FORBIDDEN` para QUALQUER agendamento sem cliente,
-- inclusive para o próprio prestador dono do tenant. As três funções passam a
-- ler `tenant_id` da própria linha de `appointments` (já disponível no select
-- inicial `for update`), e só consultam `clients` quando `client_id` não é
-- nulo — exclusivamente para obter `client_user_id`/limites de política do
-- cliente, que não fazem sentido sem um cliente vinculado.

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
  v_client_id uuid;
  v_client_tenant_id uuid;
  v_client_user_id uuid;
  v_client_total_limit integer;
  v_client_daily_limit integer;
  v_client_window_start date;
  v_client_window_end date;
  v_current_state appointment_state;
  v_current_starts_at timestamptz;
  v_current_duration integer;
  v_tenant_timezone text;
  v_requested_by appointment_actor;
  v_new_starts_at timestamptz;
  v_new_timezone text;
  v_new_duration integer;
  v_ends_at timestamptz;
  v_minimum_instant timestamptz;
  v_local_date date;
  v_daily_count integer;
  v_time_changed boolean;
  v_row public.appointments;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  select a.client_id, a.tenant_id, a.state, a.starts_at, a.duration_minutes
    into v_client_id, v_client_tenant_id, v_current_state, v_current_starts_at, v_current_duration
  from public.appointments a
  where a.id = p_id
  for update of a;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND: appointment does not exist' using errcode = '22023';
  end if;

  -- Só consulta `clients` quando o agendamento tem cliente vinculado — sem
  -- cliente, `v_client_user_id`/limites permanecem NULL, e a checagem de
  -- posse abaixo (`v_client_user_id is distinct from v_caller`) continua
  -- correta: um chamador `client` nunca pode mexer num agendamento sem
  -- cliente (NULL é sempre distinto de qualquer uuid de sessão).
  if v_client_id is not null then
    select c.client_user_id, c.total_booking_limit, c.daily_booking_limit,
           c.request_window_start, c.request_window_end
      into v_client_user_id, v_client_total_limit, v_client_daily_limit,
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

  -- RN-OBS-010: só o prestador grava internal_notes.
  if p_internal_notes_provided and v_requested_by <> 'provider' then
    raise exception 'FORBIDDEN: only the provider can edit internal notes' using errcode = '42501';
  end if;

  -- Um registro em estado terminal é histórico: não volta a ser editado
  -- (generalização de RN-CAN-006).
  if v_current_state <> 'scheduled' then
    raise exception 'INVALID_STATE_TRANSITION: only scheduled appointments can be edited' using errcode = '22023';
  end if;

  -- RN-AGD-011: só o prestador marca completed/no_show.
  if p_state is not null then
    if v_requested_by <> 'provider' then
      raise exception 'FORBIDDEN: only the provider can mark completed or no_show' using errcode = '42501';
    end if;
    if p_state not in ('completed', 'no_show') then
      raise exception 'INVALID_STATE_TRANSITION: state must be completed or no_show' using errcode = '22023';
    end if;
  end if;

  select timezone into v_tenant_timezone from public.tenants where id = v_client_tenant_id;

  v_new_starts_at := coalesce(p_starts_at, v_current_starts_at);
  v_new_duration := coalesce(p_duration_minutes, v_current_duration);
  v_new_timezone := coalesce(p_timezone, v_tenant_timezone);

  v_time_changed := (p_starts_at is not null and p_starts_at is distinct from v_current_starts_at)
    or (p_duration_minutes is not null and p_duration_minutes is distinct from v_current_duration);

  if v_new_timezone is distinct from v_tenant_timezone then
    raise exception 'INVALID_DATE_TIME: timezone must match the provider agenda timezone' using errcode = '22023';
  end if;

  if v_new_duration is null or v_new_duration <= 0 then
    raise exception 'INVALID_DATE_TIME: duration must be a positive integer of minutes' using errcode = '22023';
  end if;

  -- RN-AGD-012: "se a remarcação falhar, o horário original será
  -- preservado" — naturalmente garantido por esta função ser uma única
  -- transação (qualquer `raise exception` abaixo reverte o UPDATE por
  -- inteiro, o `for update of a` acima nem chega a ser liberado com uma
  -- mudança visível).
  if v_time_changed then
    v_ends_at := v_new_starts_at + (v_new_duration * interval '1 minute');

    if v_requested_by = 'client' and exists (
      select 1 from public.availability_blocks b
      where b.tenant_id = v_client_tenant_id
        and v_new_starts_at < b.ends_at
        and v_ends_at > b.starts_at
    ) then
      raise exception 'AGENDA_BLOCKED: requested slot overlaps a provider availability block' using errcode = '22023';
    end if;

    v_minimum_instant := public.minimum_bookable_instant(now(), v_tenant_timezone);
    if v_new_starts_at < v_minimum_instant then
      raise exception 'ADVANCE_NOTICE_INVALID: minimum advance notice not met' using errcode = '22023';
    end if;

    if v_requested_by = 'client' then
      v_local_date := (v_new_starts_at at time zone v_tenant_timezone)::date;

      if v_client_window_start is not null
         and (v_local_date < v_client_window_start or v_local_date > v_client_window_end)
      then
        raise exception 'OUTSIDE_ALLOWED_PERIOD: requested date is outside the allowed window' using errcode = '22023';
      end if;

      -- Só o limite DIÁRIO é reavaliado na remarcação: o atendimento já
      -- consumia o limite TOTAL antes da mudança de horário e continua
      -- consumindo o mesmo (RN-AGD-020 conta ocorrências não canceladas,
      -- independentemente de qual data elas caem).
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
  end if;

  begin
    update public.appointments
    set starts_at = v_new_starts_at,
        timezone = v_new_timezone,
        duration_minutes = v_new_duration,
        client_message = case when p_client_message_provided then p_client_message else client_message end,
        internal_notes = case when p_internal_notes_provided then p_internal_notes else internal_notes end,
        state = coalesce(p_state::appointment_state, state)
    where id = p_id
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'SLOT_UNAVAILABLE: requested slot conflicts with an existing appointment at %', v_new_starts_at
      using errcode = '22023';
  end;

  return v_row;
end;
$$;

revoke all on function public.update_appointment(
  uuid, timestamptz, text, integer, text, boolean, text, boolean, text
) from public, anon, authenticated;
grant execute on function public.update_appointment(
  uuid, timestamptz, text, integer, text, boolean, text, boolean, text
) to authenticated;

create or replace function public.cancel_appointment(p_id uuid, p_reason text default null)
returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role profile_role;
  v_client_id uuid;
  v_client_tenant_id uuid;
  v_client_user_id uuid;
  v_current_state appointment_state;
  v_starts_at timestamptz;
  v_actor appointment_actor;
  v_row public.appointments;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  select a.client_id, a.tenant_id, a.state, a.starts_at
    into v_client_id, v_client_tenant_id, v_current_state, v_starts_at
  from public.appointments a
  where a.id = p_id
  for update of a;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND: appointment does not exist' using errcode = '22023';
  end if;

  if v_client_id is not null then
    select c.client_user_id into v_client_user_id
    from public.clients c where c.id = v_client_id;
  end if;

  select role into v_caller_role from public.profiles where user_id = v_caller;

  if v_caller_role = 'provider' then
    if not exists (
      select 1 from public.tenants t where t.id = v_client_tenant_id and t.owner_user_id = v_caller
    ) then
      raise exception 'FORBIDDEN: caller does not own this tenant' using errcode = '42501';
    end if;
    v_actor := 'provider';
  elsif v_caller_role = 'client' then
    if v_client_user_id is distinct from v_caller then
      raise exception 'FORBIDDEN: caller does not own this appointment' using errcode = '42501';
    end if;
    v_actor := 'client';
  else
    raise exception 'FORBIDDEN: caller has no recognized role' using errcode = '42501';
  end if;

  -- Idempotência: recancelar não é erro nem reescreve motivo/ator/data já
  -- gravados (RN-CAN-004/005 preservam o registro cancelado como está).
  if v_current_state = 'cancelled' then
    select * into v_row from public.appointments where id = p_id;
    return v_row;
  end if;

  -- RN-CAN-006.
  if v_current_state in ('completed', 'no_show') then
    raise exception 'INVALID_STATE_TRANSITION: completed or no_show appointments cannot be cancelled'
      using errcode = '22023';
  end if;

  -- "O cliente poderá cancelar até imediatamente antes do horário inicial."
  -- (seção 8 de docs/REGRAS_DE_NEGOCIO_MVP.md) — depois do início, só o
  -- prestador decide o desfecho (completed/no_show).
  if v_actor = 'client' and v_starts_at <= now() then
    raise exception 'INVALID_STATE_TRANSITION: client cannot cancel after the appointment has started'
      using errcode = '22023';
  end if;

  update public.appointments
  set state = 'cancelled',
      cancellation_reason = p_reason,
      cancelled_by = v_actor,
      cancelled_at = now()
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.cancel_appointment(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_appointment(uuid, text) to authenticated;

create or replace function public.confirm_appointment_manually(p_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_client_id uuid;
  v_client_tenant_id uuid;
  v_current_confirmation appointment_confirmation_status;
  v_current_state appointment_state;
  v_row public.appointments;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  select a.client_id, a.tenant_id, a.confirmation_status, a.state
    into v_client_id, v_client_tenant_id, v_current_confirmation, v_current_state
  from public.appointments a
  where a.id = p_id
  for update of a;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND: appointment does not exist' using errcode = '22023';
  end if;

  -- `tenant_id` vem direto da própria linha — esta função nunca precisou de
  -- `client_user_id`/limites, então nem chega a consultar `clients`.
  if not exists (
    select 1 from public.tenants t where t.id = v_client_tenant_id and t.owner_user_id = v_caller
  ) then
    raise exception 'FORBIDDEN: only the provider can confirm manually' using errcode = '42501';
  end if;

  if v_current_state <> 'scheduled' then
    raise exception 'INVALID_STATE_TRANSITION: only scheduled appointments can be confirmed' using errcode = '22023';
  end if;

  -- Idempotência exigida pelo handoff (tabela de cenários: "ALREADY_CONFIRMED
  -- | tratar como idempotência e exibir o registro confirmado") — nunca
  -- lançamos um erro aqui, sempre devolvemos o registro já confirmado.
  if v_current_confirmation = 'confirmed' then
    select * into v_row from public.appointments where id = p_id;
    return v_row;
  end if;

  update public.appointments
  set confirmation_status = 'confirmed',
      confirmation_source = 'provider_manual',
      confirmed_at = now()
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.confirm_appointment_manually(uuid) from public, anon, authenticated;
grant execute on function public.confirm_appointment_manually(uuid) to authenticated;

-- ============================================================================
-- 4) get_provider_dashboard_snapshot — não perder agendamentos sem cliente
-- ============================================================================
--
-- ACHADO adicional desta revisão: a lista `todayAppointments` usava
-- `join public.clients c on c.id = a.client_id` (INNER JOIN). Com
-- `client_id` nulo, um INNER JOIN nunca casa, então TODO agendamento manual
-- sem cliente desapareceria silenciosamente da Home do prestador — o
-- resumo numérico (`summary.appointmentsToday` etc., que conta direto em
-- `appointments`) continuaria correto, mas a lista detalhada do dia ficaria
-- incoerente com o número mostrado. Corrigido para LEFT JOIN;
-- `clientName` usa `coalesce(c.name, 'Sem cliente')` para preservar o
-- contrato `DashboardAppointment.clientName: string` (não-nulo) sem exigir
-- nenhuma mudança em `app/dashboard.tsx`, que já exibe esse campo como texto
-- direto.

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
    'clientName', coalesce(c.name, 'Sem cliente'),
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
  left join public.clients c on c.id = a.client_id and c.tenant_id = a.tenant_id
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

-- ============================================================================
-- Testes executados na própria migration (mesmo padrão de
-- 20260806102200_appointment_rpcs.sql) — verificações estruturais apenas;
-- migration NÃO executada contra um Postgres real neste ambiente (Docker
-- inacessível ao sandbox, mesma limitação já registrada em BLG-050/DEC-073).
-- Cenários de sessão/autorização são cobertos pelos testes de TypeScript do
-- adapter com o cliente Supabase mockado.
-- ============================================================================

do $$
declare
  v_is_nullable text;
  v_fk_count integer;
begin
  select is_nullable into v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'appointments' and column_name = 'client_id';

  assert v_is_nullable = 'YES',
    'appointments.client_id deveria ser nullable após esta migration';

  -- A FK para `clients` deve continuar existindo mesmo com a coluna
  -- nullable (FK nullable só valida quando o valor não é nulo).
  select count(*) into v_fk_count
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'appointments'
    and con.contype = 'f'
    and con.confrelid = 'public.clients'::regclass;

  assert v_fk_count = 1,
    'appointments deveria continuar com exatamente 1 FK para clients (client_id) mesmo nullable';

  raise notice 'appointments_optional_client: verificações estruturais passaram (sem execução contra Postgres real).';
end $$;
