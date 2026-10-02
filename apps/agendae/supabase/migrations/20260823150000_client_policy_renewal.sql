-- ============================================================================
-- Renovação de política de cliente (pacote): zera o ciclo de contagem do
-- limite total e arquiva os valores antigos em histórico.
-- ============================================================================
--
-- PROBLEMA (pedido de produto): o prestador reconfigura periodicamente, para
-- um cliente já cadastrado, a quantidade de aulas do pacote
-- (`total_booking_limit`), o valor do serviço (`service_value_cents`) e o
-- período para solicitar (`request_window_start`/`request_window_end`). Hoje
-- isso já é possível via `updateClient`/UPDATE direto em `clients`
-- (20260806101500_clients_registry.sql), mas a contagem usada para decidir se
-- o limite total foi atingido (`_create_appointment_row`,
-- 20260819100000_provider_plan_horizon_limit.sql, bloco
-- `if v_client_total_limit is not null then ...`) sempre soma TODOS os
-- agendamentos não cancelados do cliente "desde sempre" — um cliente que já
-- bateu o limite do pacote anterior nunca volta a poder agendar só por o
-- prestador ter subido o número, porque o UPDATE simples não reseta nenhum
-- contador (não existe contador algum, é um COUNT ao vivo sobre a tabela
-- `appointments` inteira).
--
-- DECISÃO DE PRODUTO (já confirmada, não reaberta aqui): renovar precisa (a)
-- zerar efetivamente a contagem usada para o limite total a partir do momento
-- da renovação, e (b) arquivar os valores antigos (incluindo quantas vagas do
-- pacote anterior foram efetivamente usadas) num histórico, para exibição
-- futura no Perfil do Cliente (fora de escopo desta migration).
--
-- ============================================================================
-- DECISÃO DE ARQUITETURA 1 — ciclo marcado por coluna, não por tabela de
-- períodos
-- ============================================================================
-- `clients.policy_cycle_started_at` marca o início do ciclo VIGENTE de
-- contagem do limite total. Cada renovação: (1) lê o valor atual dessa coluna
-- para calcular quantos agendamentos foram consumidos no ciclo que está
-- sendo encerrado; (2) grava esse retrato em `client_policy_renewals`
-- (histórico, ver abaixo); (3) escreve `now()` na própria coluna. A partir
-- daí, `_create_appointment_row` (única barreira de segurança real — ver
-- nota 3 abaixo) para de contar "todos os agendamentos não cancelados desde
-- sempre" e passa a contar apenas os do ciclo atual.
--
-- Alternativa descartada: uma tabela `client_policy_cycles` versionada
-- (linha por ciclo, com `started_at`/`ended_at`). Rejeitada por YAGNI: nada
-- além desta própria feature precisa saber "qual ciclo está vigente agora"
-- como uma entidade separada — uma única coluna com timestamp já responde
-- exatamente essa pergunta, e o HISTÓRICO de ciclos passados já é coberto
-- pela tabela de renovações abaixo (cada linha de `client_policy_renewals`
-- registra, implicitamente, o fim de um ciclo). Se um dia for necessário
-- listar/auditar ciclos que nunca tiveram renovação alguma além do inicial,
-- essa é a evolução natural (mesmo raciocínio de DEC-070/DEC-personalizada em
-- 20260806101500_clients_registry.sql, seção "Decisão de design").
--
-- ============================================================================
-- DECISÃO DE ARQUITETURA 2 — critério de corte do ciclo: `created_at` do
-- agendamento, NUNCA `starts_at`
-- ============================================================================
-- A pergunta "este agendamento pertence ao ciclo antigo ou ao novo?" precisa
-- de um critério que NUNCA classifique o mesmo agendamento físico nos dois
-- ciclos ao mesmo tempo (senão o "usado" arquivado no histórico e o "usado"
-- recontado pelo novo ciclo se sobrepõem, e os números divergem — exatamente
-- a garantia que o pedido de produto exige: "as duas contagens... têm que
-- usar exatamente o mesmo critério, senão os números não batem").
--
-- `created_at` tem essa garantia por construção: é gravado uma única vez, no
-- INSERT, e nunca muda depois. No instante da renovação (`now()`), TODO
-- agendamento já existente tem `created_at < now()` (cai inteiramente no
-- ciclo antigo, contado no snapshot do histórico) e TODO agendamento inserido
-- depois tem `created_at >= now()` (cai inteiramente no ciclo novo). A
-- partição é exata, sem zona cinzenta.
--
-- `starts_at` NÃO tem essa garantia: um agendamento criado ANTES da
-- renovação pode ter `starts_at` (a aula em si) agendado para depois da
-- renovação (ex.: cliente já tinha uma aula futura marcada para semana que
-- vem, dentro do pacote antigo). Se o corte fosse por `starts_at`, esse
-- mesmo agendamento apareceria: (a) já contado como "usado" no snapshot do
-- ciclo antigo (seu `starts_at` já era >= início do ciclo antigo, então
-- entrava na contagem de então) E (b) contado de novo como consumindo cota do
-- ciclo novo em `_create_appointment_row` (seu `starts_at` também é >= início
-- do ciclo novo) — um único agendamento drenando cota de dois pacotes
-- diferentes. `created_at` elimina esse risco de dupla contagem por
-- construção, sem precisar de nenhuma exceção ou caso especial.
--
-- Esta é, portanto, a MESMA regra usada nos dois lugares (RN explícita do
-- pedido de produto): `renew_client_policy` (arquivamento) e
-- `_create_appointment_row` (nova contagem) filtram por
-- `a.created_at >= c.policy_cycle_started_at`. `daily_booking_limit`
-- continua synthesizing por `starts_at` (não é afetado por ciclo: é sempre
-- "quantos agendamentos NESTE dia", independente de quando foram criados) —
-- nenhuma mudança nesse bloco.
--
-- ============================================================================
-- NOTA 3 — `update_appointment` NÃO reaplica o limite total hoje
-- ============================================================================
-- Investigação confirmada na definição vigente em produção
-- (20260819100000_provider_plan_horizon_limit.sql): `update_appointment`
-- declara `v_client_total_limit` (resquício de uma versão anterior) mas
-- NUNCA o compara com nenhuma contagem — o único limite reaplicado ali, no
-- bloco `if v_time_changed and v_requested_by = 'client' then`, é o diário
-- (`v_client_daily_limit`/`DAILY_LIMIT_REACHED`). Ou seja, remarcar um
-- agendamento existente nunca foi bloqueado pelo limite total, só a criação
-- de um agendamento NOVO é. Como não há checagem de limite total em
-- `update_appointment` para corrigir, esta migration não redefine essa
-- função — nenhuma mudança de comportamento é necessária ali.
--
-- ============================================================================
-- Depende de: 20260806101500_clients_registry.sql (tabela `clients`),
-- 20260819100000_provider_plan_horizon_limit.sql (última definição de
-- `_create_appointment_row`, redefinida aqui por completo — nunca editamos
-- migrations antigas), 20260806101100_audit_creation_triggers.sql
-- (`audit_creation()`, reaproveitada genericamente para a tabela nova, mesmo
-- padrão de `clients_audit_creation`).
-- ============================================================================


-- ============================================================================
-- 1) clients.policy_cycle_started_at — início do ciclo vigente
-- ============================================================================
--
-- Backfill obrigatório (sem regressão): clientes já existentes recebem
-- `created_at` do próprio cadastro como início do ciclo — continuam contando
-- TODOS os agendamentos deles desde sempre, exatamente como hoje, até a
-- primeira renovação real acontecer. `default now()` faz o mesmo valer para
-- cadastros novos: dentro de uma mesma transação de INSERT, `now()` é estável
-- (transaction timestamp do Postgres), então `policy_cycle_started_at` nasce
-- idêntico a `created_at` sem precisar copiar o valor explicitamente.
alter table public.clients
  add column if not exists policy_cycle_started_at timestamptz;

update public.clients
set policy_cycle_started_at = created_at
where policy_cycle_started_at is null;

alter table public.clients
  alter column policy_cycle_started_at set default now(),
  alter column policy_cycle_started_at set not null;


-- ============================================================================
-- 2) client_policy_renewals — histórico de renovações (snapshot dos valores
--    ANTIGOS no momento de cada renovação)
-- ============================================================================
--
-- Tabela só-inserção: nenhuma policy de update/delete é criada (mesmo padrão
-- de `plan_horizon_auto_cancellations`, 20260819100000) — a única escrita
-- possível pela API é o INSERT feito dentro de `renew_client_policy`
-- (SECURITY DEFINER, roda com o privilégio do dono da função e por isso
-- ignora RLS na escrita, igual às demais RPCs deste projeto).
create table public.client_policy_renewals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id),
  -- Valores ANTIGOS (lidos de `clients` antes do UPDATE de renovação).
  -- `total_booking_limit`/janela preservam o significado null = livre já
  -- usado em `clients`; `service_value_cents` espelha a mesma constraint de
  -- não-negatividade da tabela de origem.
  total_booking_limit integer,
  service_value_cents integer not null check (service_value_cents >= 0),
  request_window_start date,
  request_window_end date,
  constraint client_policy_renewals_window_pair check (
    (request_window_start is null and request_window_end is null)
    or (request_window_start is not null and request_window_end is not null)
  ),
  -- Quantos agendamentos do ciclo que está sendo encerrado foram
  -- efetivamente consumidos (mesmo critério de corte do item 3 abaixo) —
  -- alimenta o "usou 8 de 10" no histórico exibido no Perfil do Cliente.
  appointments_used integer not null default 0 check (appointments_used >= 0),
  renewed_by_user_id uuid not null references public.profiles (user_id),
  renewed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index client_policy_renewals_client_idx on public.client_policy_renewals (client_id);
create index client_policy_renewals_tenant_idx on public.client_policy_renewals (tenant_id);

alter table public.client_policy_renewals enable row level security;

-- Só o prestador dono do tenant do cliente lê o histórico (mesmo padrão de
-- `client_notes_select_owner`, 20260806101500). Nenhuma policy de select
-- para a identidade associada (`client_user_id`): o histórico de
-- renovações é informação interna do prestador, assim como as anotações.
create policy "client_policy_renewals_select_owner"
  on public.client_policy_renewals for select
  to authenticated
  using (
    exists (
      select 1 from public.clients c
      join public.tenants t on t.id = c.tenant_id
      where c.id = client_policy_renewals.client_id
        and t.owner_user_id = auth.uid()
    )
  );

-- Auditoria de criação: `audit_creation()` (20260806101100) já é genérica o
-- suficiente — lê `id`/`tenant_id` de `new` via jsonb, sem precisar de nada
-- dedicado. Não existe `audit_status_change` aqui porque a tabela não tem
-- coluna `status` nem é mutável (só-inserção, ver comentário da tabela).
create trigger client_policy_renewals_audit_creation
  after insert on public.client_policy_renewals
  for each row
  execute function public.audit_creation();


-- ============================================================================
-- 3) renew_client_policy — RPC de renovação
-- ============================================================================
--
-- Contrato:
--   renew_client_policy(
--     p_client_id uuid,
--     p_total_booking_limit integer,  -- novo valor; null = livre
--     p_service_value_cents integer,  -- novo valor; nunca null (mesma
--                                      -- obrigatoriedade de clients.service_value_cents)
--     p_request_window_start date,    -- novo valor; null junto com end = livre
--     p_request_window_end date
--   ) returns jsonb
--   -- { "client": <linha atualizada de clients>,
--   --   "renewal": <linha inserida em client_policy_renewals> }
--
-- Validações replicam server-side as mesmas regras já aplicadas
-- client-side em `use-client-edit-form.ts` (limite >= 1 quando informado,
-- período com início <= fim quando informado) — esta RPC é chamada fora do
-- formulário genérico de editar cliente, então precisa da própria barreira.
create or replace function public.renew_client_policy(
  p_client_id uuid,
  p_total_booking_limit integer,
  p_service_value_cents integer,
  p_request_window_start date,
  p_request_window_end date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_tenant_id uuid;
  v_old_total_limit integer;
  v_old_service_value_cents integer;
  v_old_window_start date;
  v_old_window_end date;
  v_old_cycle_started_at timestamptz;
  v_appointments_used integer;
  v_renewal public.client_policy_renewals;
  v_client public.clients;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  if p_total_booking_limit is not null and p_total_booking_limit < 1 then
    raise exception 'BOOKING_POLICY_INVALID: total booking limit must be null or >= 1' using errcode = '22023';
  end if;

  if p_service_value_cents is null or p_service_value_cents < 0 then
    raise exception 'BOOKING_POLICY_INVALID: service value must be zero or greater' using errcode = '22023';
  end if;

  if (p_request_window_start is null) is distinct from (p_request_window_end is null) then
    raise exception 'BOOKING_POLICY_INVALID: request window start/end must both be null or both be informed'
      using errcode = '22023';
  end if;

  if p_request_window_start is not null and p_request_window_start > p_request_window_end then
    raise exception 'BOOKING_POLICY_INVALID: request window start must not be after the end date'
      using errcode = '22023';
  end if;

  -- `for update`: serializa renovações concorrentes do mesmo cliente (evita
  -- duas renovações simultâneas lendo o mesmo "ciclo antigo" e arquivando o
  -- mesmo `appointments_used` duas vezes).
  select c.tenant_id, c.total_booking_limit, c.service_value_cents,
         c.request_window_start, c.request_window_end, c.policy_cycle_started_at
    into v_tenant_id, v_old_total_limit, v_old_service_value_cents,
         v_old_window_start, v_old_window_end, v_old_cycle_started_at
  from public.clients c
  where c.id = p_client_id
  for update;

  if not found then
    raise exception 'CLIENT_NOT_FOUND: client does not exist' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.tenants t
    where t.id = v_tenant_id and t.owner_user_id = v_caller
  ) then
    raise exception 'FORBIDDEN: caller does not own this tenant' using errcode = '42501';
  end if;

  -- Mesmo critério de corte de `_create_appointment_row` (ver decisão de
  -- arquitetura 2 no topo desta migration): `created_at` do agendamento,
  -- nunca `starts_at`.
  select count(*) into v_appointments_used
  from public.appointments a
  where a.client_id = p_client_id
    and a.state <> 'cancelled'
    and a.created_at >= v_old_cycle_started_at;

  insert into public.client_policy_renewals (
    client_id, tenant_id, total_booking_limit, service_value_cents,
    request_window_start, request_window_end, appointments_used, renewed_by_user_id
  ) values (
    p_client_id, v_tenant_id, v_old_total_limit, v_old_service_value_cents,
    v_old_window_start, v_old_window_end, v_appointments_used, v_caller
  )
  returning * into v_renewal;

  update public.clients
  set total_booking_limit = p_total_booking_limit,
      service_value_cents = p_service_value_cents,
      request_window_start = p_request_window_start,
      request_window_end = p_request_window_end,
      policy_cycle_started_at = now()
  where id = p_client_id
  returning * into v_client;

  return jsonb_build_object('client', to_jsonb(v_client), 'renewal', to_jsonb(v_renewal));
end;
$$;

revoke all on function public.renew_client_policy(uuid, integer, integer, date, date) from public, anon;
grant execute on function public.renew_client_policy(uuid, integer, integer, date, date) to authenticated;


-- ============================================================================
-- 4) Leitura do histórico — query direta via RLS (sem RPC dedicada)
-- ============================================================================
--
-- DECISÃO: `client_policy_renewals_select_owner` (item 2) já restringe a
-- leitura ao prestador dono do tenant do cliente, com a mesma forma de join
-- usada por `client_notes_select_owner`. Como não há nenhuma lógica adicional
-- de negócio na leitura (é literalmente "as linhas deste client_id, mais
-- recente primeiro"), uma RPC dedicada só reimplementaria o que o RLS já
-- garante — mesmo raciocínio de `listClientNotes` no adapter, que lê
-- `client_notes` diretamente via `.from(...)` em vez de uma RPC de leitura.
-- Contrato exposto ao frontend (ver adapter):
--   supabase.from('client_policy_renewals').select('*')
--     .eq('client_id', clientId).order('renewed_at', { ascending: false })


-- ============================================================================
-- 5) _create_appointment_row — contagem do limite total passa a ser por
--    CICLO (desde `clients.policy_cycle_started_at`), não mais desde sempre
-- ============================================================================
--
-- Redefinição completa a partir da última versão vigente em produção
-- (20260819100000_provider_plan_horizon_limit.sql). ÚNICA mudança de
-- comportamento: a query de `v_total_count` ganha
-- `and a.created_at >= v_client_policy_cycle_started_at`. Todo o restante
-- (horizonte de plano, bloqueios de agenda, dia de atendimento, antecedência
-- mínima, período permitido, limite diário) é idêntico, char a char, à
-- versão anterior.
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
      -- RN da renovação de cliente (esta migration): a contagem passa a ser
      -- POR CICLO (`created_at >= policy_cycle_started_at`), não mais desde
      -- sempre. Clientes nunca renovados têm `policy_cycle_started_at =
      -- created_at` (backfill do item 1), então continuam contando TODOS os
      -- agendamentos deles desde sempre — comportamento idêntico ao anterior.
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
-- Verificações estruturais (mesmo padrão de outras migrations desta série,
-- ex.: 20260819100000) — checagens de definição de função/backfill, sem
-- depender de sessão/JWT.
-- ============================================================================

do $$
declare
  v_definition text;
  v_null_cycle_count integer;
begin
  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = '_create_appointment_row';

  assert v_definition like '%v_client_policy_cycle_started_at%',
    '_create_appointment_row deveria consultar policy_cycle_started_at do cliente';
  assert v_definition like '%a.created_at >= v_client_policy_cycle_started_at%',
    '_create_appointment_row deveria filtrar a contagem do limite total pelo ciclo vigente';

  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'renew_client_policy';

  assert v_definition like '%client_policy_renewals%',
    'renew_client_policy deveria inserir em client_policy_renewals';
  assert v_definition like '%policy_cycle_started_at = now()%',
    'renew_client_policy deveria reiniciar o ciclo com now()';

  select count(*) into v_null_cycle_count
  from public.clients
  where policy_cycle_started_at is null;

  assert v_null_cycle_count = 0,
    'client_policy_renewal: todo cliente deveria ter policy_cycle_started_at preenchido após o backfill';

  raise notice 'client_policy_renewal: verificações estruturais passaram.';
end $$;

notify pgrst, 'reload schema';
