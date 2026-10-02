-- Etapa 1 — funções SECURITY DEFINER que fecham o caminho de escrita de
-- `appointments` (docs/HANDOFF_AGENDA_CRIS.md; RN-AGD-001 a 024; RN-REC-001 a
-- 008; RN-CAN-001 a 007; BACKLOG.md, BLG-051, DEC-074).
--
-- Depende de 20260806102100_appointments.sql (tabela, exclusion constraint,
-- view) e de 20260806102000_availability_blocks.sql.
--
-- ============================================================================
-- DECISÃO DE DESIGN — `requestedBy` nunca é um parâmetro de entrada
-- ============================================================================
--
-- `CreateAppointmentCommand.requestedBy` existe no contrato do front, mas o
-- comentário do próprio types.ts já avisa: "o campo não deve substituir a
-- identidade da sessão". Em vez de aceitar esse valor como parâmetro e
-- validá-lo contra a sessão (superfície extra para inconsistência), as RPCs
-- abaixo NEM RECEBEM esse parâmetro: o papel do chamador (`provider`|
-- `client`) é sempre resolvido aqui dentro a partir de `profiles.role` do
-- `auth.uid()` atual. O adaptador (`SupabaseAppointmentAdapter`) não envia
-- `requestedBy` a nenhuma RPC — é um campo do domínio consumido inteiramente
-- no cliente HTTP local por enquanto (a UI decide o que mostrar), nunca
-- cruzando a fronteira de rede como fonte de verdade de autorização.
--
-- ============================================================================
-- DECISÃO DE DESIGN — função interna compartilhada entre criação simples e
-- recorrente
-- ============================================================================
--
-- `_create_appointment_row` concentra TODA a validação de domínio (vínculo,
-- serviço, bloqueio, antecedência, política do cliente) e o INSERT em si.
-- `create_appointment` chama esta função uma vez; `create_recurring_
-- appointments` chama em loop, dentro da MESMA transação implícita da
-- função — se qualquer chamada lançar exceção, TODAS as linhas já inseridas
-- nesta mesma invocação são revertidas (RN-REC-007: "se uma ocorrência for
-- inválida ou conflitante, nenhuma será criada"). A mensagem de erro
-- embute o horário da ocorrência que falhou (`%`, p_starts_at) — decisão
-- registrada: reporta a PRIMEIRA data conflitante encontrada, não agrega a
-- lista completa de conflitos nesta versão (YAGNI; revisar se o produto
-- exigir a lista completa no futuro).
--
-- Prefixo `_` por convenção deste arquivo: função interna, nunca chamada
-- diretamente pelo adapter. `revoke all` de anon/authenticated/public é
-- suficiente para bloquear chamada externa — funções SECURITY DEFINER
-- chamadas de DENTRO de outra função SECURITY DEFINER do MESMO owner
-- (o papel de migração) têm EXECUTE implícito por posse, mesmo padrão já
-- usado por `hash_provider_link_code`/`verify_provider_link_code`
-- (20260806101300).
--
-- ============================================================================
-- DECISÃO DE DESIGN — confirmação automática na criação
-- ============================================================================
--
-- RN-AGD-014: "o cliente criará diretamente o agendamento, sem aprovação
-- adicional". Interpretação adotada: quando `requestedBy = 'client'`, o
-- agendamento nasce `confirmation_status = 'confirmed'`,
-- `confirmation_source = 'client'`, `confirmed_at = now()` — não há etapa de
-- aprovação posterior. Quando `requestedBy = 'provider'` (ex.: prestador
-- lança um agendamento combinado por telefone), o registro nasce `pending`
-- e depende de uma chamada posterior a `confirm_appointment_manually` para
-- virar `confirmed`/`provider_manual`. Esta leitura não está escrita
-- literalmente no handoff, mas é a única que dá uso real às DUAS variantes
-- de `ConfirmationSource` (`client` vs `provider_manual`) definidas em
-- domain/agenda/types.ts — documentada aqui para rastreabilidade.
--
-- ============================================================================
-- DECISÃO DE DESIGN — apenas atendimentos "scheduled" podem ser editados
-- ============================================================================
--
-- `update_appointment` rejeita qualquer edição (inclusive marcar
-- completed/no_show) quando o estado atual já não é `scheduled`, com
-- `INVALID_STATE_TRANSITION`. Não está descrito letra-por-letra no handoff,
-- mas decorre diretamente de RN-CAN-006 ("Um atendimento Concluído ou
-- marcado como Não compareceu não poderá ser cancelado") generalizado para
-- edição: um registro em estado terminal (completed/no_show/cancelled) é
-- histórico, não deveria voltar a mudar de horário ou de mensagem.
--
-- ============================================================================
-- DECISÃO DE DESIGN — `clientId`/`serviceId` não são reatribuíveis via
-- `update_appointment`
-- ============================================================================
--
-- `UpdateAppointmentInput` é `Partial<CreateAppointmentInput>`, então o TIPO
-- permite, em tese, enviar um `clientId`/`serviceId` diferente numa
-- remarcação. Nenhuma RPC aqui aceita esses dois parâmetros: reatribuir o
-- cliente ou o serviço de um agendamento já existente é, na prática, um
-- agendamento NOVO (o histórico do antigo cliente/serviço deixaria de fazer
-- sentido), não uma remarcação (RN-AGD-012 trata remarcação como mudança de
-- horário/duração/mensagem). O adaptador rejeita esse caso antes mesmo de
-- chamar a RPC (ver supabase-appointment-adapter.ts).

-- ============================================================================
-- Função interna — validação completa + INSERT de uma única ocorrência
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
  v_client_tenant_id uuid;
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

  select c.tenant_id, c.client_user_id, c.status, c.total_booking_limit, c.daily_booking_limit,
         c.request_window_start, c.request_window_end
    into v_client_tenant_id, v_client_user_id, v_client_status, v_client_total_limit, v_client_daily_limit,
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

  select role into v_caller_role from public.profiles where user_id = p_caller;

  if v_caller_role = 'provider' then
    if not exists (
      select 1 from public.tenants t
      where t.id = v_client_tenant_id and t.owner_user_id = p_caller
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
      where l.tenant_id = v_client_tenant_id
        and l.client_user_id = p_caller
        and l.status = 'active'
    ) then
      raise exception 'CLIENT_LINK_INACTIVE: client link is not active' using errcode = '22023';
    end if;
    v_requested_by := 'client';
  else
    raise exception 'FORBIDDEN: caller has no recognized role' using errcode = '42501';
  end if;

  select timezone into v_tenant_timezone from public.tenants where id = v_client_tenant_id;
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
  where id = p_service_id and tenant_id = v_client_tenant_id and status = 'active';

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
    where b.tenant_id = v_client_tenant_id
      and p_starts_at < b.ends_at
      and v_ends_at > b.starts_at
  ) then
    raise exception 'AGENDA_BLOCKED: requested slot overlaps a provider availability block' using errcode = '22023';
  end if;

  -- RN-AGD-004/008/009: antecedência mínima de 1 dia útil, calculada no fuso
  -- do prestador.
  v_minimum_instant := public.minimum_bookable_instant(now(), v_tenant_timezone);
  if p_starts_at < v_minimum_instant then
    raise exception 'ADVANCE_NOTICE_INVALID: minimum advance notice not met' using errcode = '22023';
  end if;

  -- RN-AGD-015 a 022: política de agendamento do cliente. Aplicada somente a
  -- solicitações do CLIENTE — quando o prestador cria manualmente (ex.:
  -- atendimento combinado por telefone), ele está gerindo a própria agenda,
  -- não "solicitando" no sentido da regra.
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
      v_client_tenant_id, p_client_id, p_service_id, v_service_name, v_service_value_cents,
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
-- 1) create_appointment — criação simples (sem recorrência)
-- ============================================================================

create or replace function public.create_appointment(
  p_client_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_timezone text,
  p_duration_minutes integer,
  p_client_message text default null,
  p_internal_notes text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_row public.appointments;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  -- RN-OBS-010: internal_notes é exclusivo do prestador. Validado ANTES de
  -- chamar a função interna (que não repete esta checagem de papel para
  -- este campo específico).
  if p_internal_notes is not null and not exists (
    select 1 from public.profiles where user_id = v_caller and role = 'provider'
  ) then
    raise exception 'FORBIDDEN: only the provider can set internal notes' using errcode = '42501';
  end if;

  v_row := public._create_appointment_row(
    v_caller, p_client_id, p_service_id, p_starts_at, p_timezone, p_duration_minutes,
    p_client_message, p_internal_notes, null, null, null
  );

  return v_row;
end;
$$;

revoke all on function public.create_appointment(uuid, uuid, timestamptz, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.create_appointment(uuid, uuid, timestamptz, text, integer, text, text)
  to authenticated;

-- ============================================================================
-- 2) create_recurring_appointments — série atômica (RN-REC-001 a 007)
-- ============================================================================

create or replace function public.create_recurring_appointments(
  p_client_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_timezone text,
  p_duration_minutes integer,
  p_client_message text default null,
  p_internal_notes text default null,
  p_frequency text default null,
  p_occurrences integer default null,
  p_dates timestamptz[] default null
)
returns setof public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_group_id uuid := gen_random_uuid();
  v_occurrence_starts timestamptz[];
  v_count integer;
  v_step interval;
  v_current timestamptz;
  v_row public.appointments;
  i integer;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  if p_internal_notes is not null and not exists (
    select 1 from public.profiles where user_id = v_caller and role = 'provider'
  ) then
    raise exception 'FORBIDDEN: only the provider can set internal notes' using errcode = '42501';
  end if;

  -- Duas formas de `RecurrenceInput` (domain/agenda/types.ts): datas
  -- explícitas OU frequência+quantidade. `p_dates` tem prioridade quando
  -- informado.
  if p_dates is not null then
    v_occurrence_starts := p_dates;
  elsif p_frequency is not null and p_occurrences is not null then
    v_step := case p_frequency
      when 'weekly' then interval '7 days'
      when 'biweekly' then interval '14 days'
      when 'monthly' then interval '1 month'
      else null
    end;

    if v_step is null then
      raise exception 'INVALID_DATE_TIME: frequency must be weekly, biweekly or monthly' using errcode = '22023';
    end if;

    v_occurrence_starts := array[]::timestamptz[];
    v_current := p_starts_at;
    for i in 1..p_occurrences loop
      v_occurrence_starts := array_append(v_occurrence_starts, v_current);
      v_current := v_current + v_step;
    end loop;
  else
    raise exception 'INVALID_DATE_TIME: recurrence must define frequency+occurrences or an explicit list of dates'
      using errcode = '22023';
  end if;

  v_count := coalesce(array_length(v_occurrence_starts, 1), 0);

  -- Handoff: "entre 2 e 24 ocorrências" (limite desta interface — ver
  -- constraint `appointments_recurrence_count_check`).
  if v_count < 2 or v_count > 24 then
    raise exception 'INVALID_DATE_TIME: recurrence must contain between 2 and 24 occurrences' using errcode = '22023';
  end if;

  -- Atomicidade (RN-REC-007): as N linhas nascem na MESMA transação
  -- implícita desta função. Qualquer exceção lançada por
  -- `_create_appointment_row` propaga e reverte TODAS as linhas já
  -- inseridas por este loop, nesta mesma chamada.
  for i in 1..v_count loop
    v_row := public._create_appointment_row(
      v_caller, p_client_id, p_service_id, v_occurrence_starts[i], p_timezone, p_duration_minutes,
      p_client_message, p_internal_notes, v_group_id, i, v_count
    );
    return next v_row;
  end loop;

  return;
end;
$$;

revoke all on function public.create_recurring_appointments(
  uuid, uuid, timestamptz, text, integer, text, text, text, integer, timestamptz[]
) from public, anon, authenticated;
grant execute on function public.create_recurring_appointments(
  uuid, uuid, timestamptz, text, integer, text, text, text, integer, timestamptz[]
) to authenticated;

-- ============================================================================
-- 3) update_appointment — edição/remarcação (RN-AGD-012)
-- ============================================================================
--
-- Parâmetros `p_client_message_provided`/`p_internal_notes_provided`
-- distinguem "não altere este campo" (parâmetro omitido) de "defina como
-- null" (campo explicitamente limpo) — mesma necessidade de
-- `UpdateClientInput`/`UpdateServiceInput` no adapter, mas resolvida aqui
-- via parâmetro extra porque RPCs não têm o `undefined` do TypeScript.

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

  select a.client_id, a.state, a.starts_at, a.duration_minutes
    into v_client_id, v_current_state, v_current_starts_at, v_current_duration
  from public.appointments a
  where a.id = p_id
  for update of a;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND: appointment does not exist' using errcode = '22023';
  end if;

  select c.tenant_id, c.client_user_id, c.total_booking_limit, c.daily_booking_limit,
         c.request_window_start, c.request_window_end
    into v_client_tenant_id, v_client_user_id, v_client_total_limit, v_client_daily_limit,
         v_client_window_start, v_client_window_end
  from public.clients c
  where c.id = v_client_id;

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

-- ============================================================================
-- 4) cancel_appointment — RN-CAN-001 a 007
-- ============================================================================

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

  select a.client_id, a.state, a.starts_at into v_client_id, v_current_state, v_starts_at
  from public.appointments a
  where a.id = p_id
  for update of a;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND: appointment does not exist' using errcode = '22023';
  end if;

  select c.tenant_id, c.client_user_id into v_client_tenant_id, v_client_user_id
  from public.clients c where c.id = v_client_id;

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

-- ============================================================================
-- 5) confirm_appointment_manually — só prestador, idempotente
-- ============================================================================

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

  select a.client_id, a.confirmation_status, a.state
    into v_client_id, v_current_confirmation, v_current_state
  from public.appointments a
  where a.id = p_id
  for update of a;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND: appointment does not exist' using errcode = '22023';
  end if;

  select c.tenant_id into v_client_tenant_id from public.clients c where c.id = v_client_id;

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
-- Testes executados na própria migration (mesmo padrão de
-- 20260806101900_national_holidays.sql) — cobrem apenas a lógica que roda
-- inteiramente em SQL puro, sem depender de auth.uid()/sessão real (que só
-- existe num Postgres com PostgREST/GoTrue por trás). Cenários que dependem
-- de sessão (autorização, criação, remarcação completas) são cobertos pelos
-- testes de TypeScript do adapter com o cliente Supabase mockado — este
-- arquivo NÃO foi executado contra um Postgres real neste ambiente (Docker
-- inacessível ao sandbox, mesma limitação já registrada em BLG-050/DEC-073).
-- ============================================================================

do $$
declare
  v_count integer;
begin
  -- Verificação estrutural: a exclusion constraint de appointments existe e
  -- está marcada como tipo 'x' (exclusion) no catálogo, restrita por WHERE.
  select count(*) into v_count
  from pg_constraint
  where conrelid = 'public.appointments'::regclass
    and conname = 'appointments_no_overlap_exclude'
    and contype = 'x';

  assert v_count = 1,
    'appointments_no_overlap_exclude deveria existir como exclusion constraint (contype = x)';

  -- Verificação estrutural do critério de aceite "o cliente nunca recebe
  -- internalNotes": a view appointments_client_view não pode ter essa
  -- coluna, seja qual for a implementação futura do adapter.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'appointments_client_view'
    and column_name = 'internal_notes';

  assert v_count = 0,
    'appointments_client_view NUNCA deveria expor a coluna internal_notes';

  raise notice 'appointments / appointment_rpcs: verificações estruturais passaram (sem execução contra Postgres real).';
end $$;
