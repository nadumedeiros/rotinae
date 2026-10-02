-- Fecha a lacuna registrada em 20260813130000 (seção "ESCOPO DESTA ENTREGA"):
-- RN-AGD-027 (BACKLOG.md, DEC-139) — "o cliente não pode solicitar um
-- agendamento fora do dia de atendimento configurado pelo prestador" — ainda
-- não era validada dentro das RPCs de escrita de `appointments`.
--
-- Depende de: 20260813130000_provider_attendance_days.sql (coluna
-- `tenants.attendance_days`) e 20260812140000_appointments_optional_client.sql
-- (última migration a redefinir o CORPO de `_create_appointment_row` e
-- `update_appointment` — esta migration parte EXATAMENTE dessa versão, não da
-- mais antiga em 20260806102200, para não regredir a correção de
-- `client_id` opcional/bug de `tenant_id` já aplicada ali).
--
-- ============================================================================
-- DECISÃO DE DESIGN — escopo e ponto de checagem
-- ============================================================================
--
-- 1. Só se aplica a `v_requested_by = 'client'` — mesmo precedente já usado
--    nestas duas funções para `AGENDA_BLOCKED`/`OUTSIDE_ALLOWED_PERIOD`/
--    limites diário e total (RN-AGD-015 a 022): o prestador está GERINDO a
--    própria agenda quando cria/remarca manualmente, não "solicitando" no
--    sentido da regra, e pode agendar fora do dia de atendimento configurado
--    sem bloqueio nenhum.
--
-- 2. Dia da semana calculado na MESMA convenção de `tenants.attendance_days`
--    (`extract(dow from ...)`, 0=domingo…6=sábado — idêntica a
--    `Date.getDay()` em JS/TS, NÃO `isodow`, que é 1=segunda…7=domingo e é
--    usada em outro contexto por `minimum_bookable_instant`/
--    `next_business_day` para dias úteis), aplicado sobre o horário LOCAL do
--    prestador (`p_starts_at at time zone v_tenant_timezone` /
--    `v_new_starts_at at time zone v_tenant_timezone`) — mesmo padrão de
--    conversão já usado nesta função para `v_local_date` e para
--    `minimum_bookable_instant`, nenhuma lógica de fuso nova inventada aqui.
--
-- 3. Feriado nacional (`is_national_holiday`) é uma checagem INDEPENDENTE e
--    não relacionada a esta regra — não é tocada nem referenciada por este
--    bloco.
--
-- 4. Não retroativo (RN-AGD-028, mesma nota de 20260813130000): esta checagem
--    só corre no momento da criação/validação de UM agendamento novo dentro
--    de `_create_appointment_row`/`update_appointment` — nunca revalida
--    agendamentos/séries já existentes, nem dispara em nenhuma trigger de
--    UPDATE de `tenants.attendance_days`.
--
-- 5. Posição da checagem: imediatamente após `AGENDA_BLOCKED` e antes de
--    `ADVANCE_NOTICE_INVALID` — mesmo agrupamento lógico ("o slot é válido
--    para a agenda do prestador, antes de entrar no cronograma de
--    antecedência/política pessoal do cliente"). `create_recurring_
--    appointments` não precisa de nenhuma alteração própria: chama
--    `_create_appointment_row` em loop, então a checagem já se aplica a cada
--    ocorrência automaticamente.
--
-- 6. Novo código de erro público: `ATTENDANCE_DAY_UNAVAILABLE` — nome
--    consistente com o padrão já usado neste arquivo (`AGENDA_BLOCKED`,
--    `OUTSIDE_ALLOWED_PERIOD`, `ADVANCE_NOTICE_INVALID`: prefixo descreve a
--    causa, sem repetir "APPOINTMENT"). Adicionado a
--    `AppointmentErrorCode` (domain/agenda/types.ts) e ao mapeamento
--    Postgres -> domínio em supabase-appointment-adapter.ts, no mesmo padrão
--    dos demais códigos desta família.
--
-- 7. Migration SEPARADA de 20260813130000 (em vez de editar aquela, ainda não
--    commitada): 20260813130000 é sobre o contrato de LEITURA/ESCRITA de
--    `ProviderSettings`/`get_client_booking_context`; esta é sobre a RPC de
--    ESCRITA de `appointments` (arquivo/responsabilidade totalmente
--    diferente, 20260812140000/20260806102200). Nenhuma mudança de
--    assinatura em nenhuma das duas funções — `create or replace function`
--    é suficiente.

-- ============================================================================
-- _create_appointment_row — corpo idêntico a 20260812140000, com a checagem
-- de dia de atendimento inserida após AGENDA_BLOCKED
-- ============================================================================

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
  v_tenant_attendance_days smallint[];
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

  select timezone, attendance_days into v_tenant_timezone, v_tenant_attendance_days
  from public.tenants where id = v_tenant_id;
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

  -- RN-AGD-027 (BACKLOG.md, DEC-139): dia da semana fora dos dias de
  -- atendimento configurados pelo prestador — só se aplica a solicitações do
  -- CLIENTE (o prestador gerencia a própria agenda sem esta restrição). Dia
  -- calculado na convenção `Date.getDay()` (0=domingo…6=sábado, mesma de
  -- `tenants.attendance_days`), no horário LOCAL do prestador. `coalesce`
  -- defensivo: a coluna é NOT NULL com default de 7 dias (20260813130000),
  -- nunca deveria chegar NULL aqui.
  if v_requested_by = 'client'
     and not (
       extract(dow from (p_starts_at at time zone v_tenant_timezone))::smallint
       = any(coalesce(v_tenant_attendance_days, array[0,1,2,3,4,5,6]::smallint[]))
     )
  then
    raise exception 'ATTENDANCE_DAY_UNAVAILABLE: requested date falls outside the provider attendance days'
      using errcode = '22023';
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
-- update_appointment — corpo idêntico a 20260812140000, com a mesma checagem
-- inserida após AGENDA_BLOCKED, dentro do bloco `if v_time_changed`
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
  v_tenant_attendance_days smallint[];
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

  select timezone, attendance_days into v_tenant_timezone, v_tenant_attendance_days
  from public.tenants where id = v_client_tenant_id;

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

    -- RN-AGD-027 (BACKLOG.md, DEC-139): mesma checagem de dia de atendimento
    -- de `_create_appointment_row`, aplicada à remarcação — só quando o
    -- HORÁRIO efetivamente muda (`v_time_changed`) e só para solicitações do
    -- CLIENTE. Reagendar para o mesmo horário/duração (sem mudança de tempo)
    -- não passa por este bloco; o prestador nunca é bloqueado.
    if v_requested_by = 'client'
       and not (
         extract(dow from (v_new_starts_at at time zone v_tenant_timezone))::smallint
         = any(coalesce(v_tenant_attendance_days, array[0,1,2,3,4,5,6]::smallint[]))
       )
    then
      raise exception 'ATTENDANCE_DAY_UNAVAILABLE: requested date falls outside the provider attendance days'
        using errcode = '22023';
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

-- ============================================================================
-- Testes executados na própria migration (mesmo padrão de
-- 20260806102200_appointment_rpcs.sql/20260812140000_appointments_optional_
-- client.sql) — verificações estruturais apenas; migration NÃO executada
-- contra um Postgres real neste ambiente (Docker inacessível ao sandbox,
-- mesma limitação já registrada em BLG-050/DEC-073). Cenários de
-- sessão/autorização (cliente em dia sem atendimento, cliente em dia com
-- atendimento, prestador sem bloqueio, remarcação) são cobertos pelos testes
-- de TypeScript do adapter com o cliente Supabase mockado.
-- ============================================================================

do $$
declare
  v_source text;
begin
  select prosrc into v_source
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = '_create_appointment_row';

  assert v_source like '%ATTENDANCE_DAY_UNAVAILABLE%',
    '_create_appointment_row deveria conter a checagem ATTENDANCE_DAY_UNAVAILABLE';

  select prosrc into v_source
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'update_appointment';

  assert v_source like '%ATTENDANCE_DAY_UNAVAILABLE%',
    'update_appointment deveria conter a checagem ATTENDANCE_DAY_UNAVAILABLE';

  raise notice 'appointment_attendance_day_check: verificações estruturais passaram (sem execução contra Postgres real).';
end $$;
