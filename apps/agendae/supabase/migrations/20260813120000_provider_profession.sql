-- Profissão/especialidade do prestador (docs/HANDOFF_UX_SERVICOS_DANTE.md,
-- seção 12; docs/HANDOFF_VISUAL_SERVICOS_NERO.md, Bloco B; BACKLOG.md,
-- DEC-134/DEC-135, esta migration fecha DEC-137).
--
-- ============================================================================
-- DECISÃO DE ARQUITETURA — profession mora em `tenants`, não em `profiles`
-- ============================================================================
--
-- Dante (DEC-134) registrou a pendência de backend sem decidir a tabela,
-- cogitando `profiles` por a profissão ser "atributo de identidade do
-- prestador (pessoa/negócio)". Avaliadas as duas opções como autoridade de
-- backend (Chris), a decisão final é `tenants`, por três razões concretas —
-- não por preferência estética:
--
-- 1. PRECEDENTE ARQUITETURAL JÁ ESTABELECIDO E DOCUMENTADO: a própria
--    especificação da Etapa 1 (docs/ARQUITETURA_BACKEND_ETAPA_1.md, seção
--    4.2) descreve `tenants.display_name` como "Nome público/profissional"
--    — em contraste direto com `profiles.display_name` (seção 4.1), que não
--    tem esse qualificador. Ou seja, o próprio desenho original já separa
--    "identidade pessoal" (`profiles`) de "identidade pública/profissional
--    exposta ao cliente" (`tenants`). Profissão/especialidade é, por
--    definição, um dado de identidade PÚBLICA/PROFISSIONAL exibido ao
--    cliente (RN-PRF-005) — pertence à mesma categoria de `display_name` em
--    `tenants`, não à identidade pessoal privada em `profiles`.
--
-- 2. REUTILIZAÇÃO DE SUPERFÍCIE DE RLS JÁ AUDITADA, EM VEZ DE ABRIR UMA NOVA:
--    `profiles` tem RLS estritamente self-only hoje (`profiles_select_self`,
--    20260806100100) — nenhum outro usuário lê a linha de outro. Se
--    profession morasse em `profiles`, exporIa a profissão ao cliente
--    exigiria uma política de leitura cross-user NOVA nessa tabela. Como RLS
--    do Postgres é por LINHA e não por coluna, essa política nova exporia
--    TODA a linha do prestador para o cliente vinculado — incluindo `phone`
--    (dado sensível, hoje nunca lido por um cliente), `email_notifications`/
--    `push_notifications` (preferências privadas) e `status`. Mitigar isso
--    exigiria uma view/RPC dedicada só para expor profession, complexidade
--    nova e desnecessária. `tenants`, ao contrário, JÁ tem uma política de
--    leitura cross-user auditada e corrigida nesta mesma sessão
--    (`tenants_select_active_client`, via `is_active_client_of_tenant`,
--    20260812150000) que expõe exatamente o subconjunto de colunas já
--    considerado seguro para o cliente ver (`display_name`, `timezone`,
--    `workday_start/end`, `minimum_advance_hours`, `status`) — nenhuma delas
--    sensível. Adicionar `profession` a esse mesmo conjunto não abre
--    nenhuma superfície de RLS nova: a policy já existente passa a devolver
--    mais uma coluna de baixa sensibilidade, sem exigir revisão de segurança
--    adicional.
--
-- 3. CONSISTÊNCIA COM O CAMINHO JÁ USADO PARA O "NOME DO PRESTADOR" QUE O
--    CLIENTE VÊ: `SupabaseClientPortfolioAdapter.listClientProviderLinks()`
--    (consumida por `client-providers.tsx`) já resolve `providerName` lendo
--    `tenants.display_name` (não `profiles.display_name`) para o vínculo
--    ativo. Colocar profession em `tenants` mantém profissão e nome do
--    prestador exibidos ao cliente na MESMA fonte/consulta, evitando duas
--    fontes de identidade pública divergentes para o mesmo prestador. (A
--    RPC `get_client_booking_context`, por sua vez, resolve `providerName`
--    de `profiles.display_name` — inconsistência preexistente entre as duas
--    telas, não introduzida nem corrigida por esta migration; fica fora de
--    escopo aqui. `profession` acompanha o mesmo `tenants.id` já presente em
--    ambas as consultas, então funciona corretamente nos dois casos
--    independentemente dessa divergência preexistente.)
--
-- Nenhuma tensão real com a invariante "cada Prestador possui no máximo um
-- tenant e é seu único proprietário, sem equipes no MVP" (seção 4.2): como
-- há exatamente 1 tenant por prestador hoje, "profissão do tenant" e
-- "profissão da pessoa" são operacionalmente idênticas nesta fase do
-- produto — a decisão não perde generalidade nem precisa ser revisitada só
-- por isso.
--
-- Nada disto muda RN-PRF-006 (profissão nunca se sobrepõe a `role`/
-- `activeRole`): a coluna é só mais um campo descritivo de `tenants`, sem
-- nenhuma leitura por `enforce_tenant_owner_is_provider` ou qualquer outro
-- trigger de autorização.

-- ============================================================================
-- Coluna aditiva, nullable, sem backfill
-- ============================================================================

alter table public.tenants
  add column if not exists profession text;

-- RN-PRF-003 (handoff Dante): limite de 60 caracteres é reforçado no
-- TextInput da ADA (`maxLength={60}`) — este check é defesa em profundidade
-- contra qualquer caminho que não passe pela UI (chamada direta à RPC,
-- futuro cliente diferente etc.), mesmo padrão de
-- `tenants_workday_order_check`/`profiles_phone_format_check`
-- (20260806101800). `null` é sempre permitido (campo opcional, RN-PRF-004);
-- string vazia/só espaços também não é persistida como valor "preenchido"
-- (mesma leitura de "ausente" já usada por `display_name`), então o check
-- exige, quando não nulo, entre 1 e 60 caracteres após `trim`.
do $$ begin
  alter table public.tenants
    add constraint tenants_profession_length_check
      check (profession is null or char_length(trim(profession)) between 1 and 60);
exception when duplicate_object then null; end $$;

-- ============================================================================
-- RLS — nenhuma policy nova necessária (ver decisão acima, item 2)
-- ============================================================================
--
-- `profession` é só mais uma coluna da mesma linha de `tenants` já coberta
-- por `tenants_select_owner`/`tenants_update_owner` (leitura/escrita do
-- próprio prestador, 20260806100200) e por `tenants_select_active_client`
-- (leitura do cliente com vínculo ativo, 20260806100300, corrigida em
-- 20260812150000) — RLS do Postgres é por LINHA, não por coluna, então as
-- três policies já autorizam exatamente o mesmo dono/cliente vinculado a
-- ler/gravar o novo campo, sem exceção nem policy adicional. Mesma nota já
-- registrada para `workday_start`/`workday_end`/`minimum_advance_hours`
-- (20260806101800).

-- ============================================================================
-- Auditoria — mudança de profissão gera evento próprio, distinto do de
-- jornada/antecedência (ação diferente, mesma tabela)
-- ============================================================================
--
-- Não reaproveita `audit_tenant_schedule_change` (20260806101800) para não
-- misturar a ação `tenants.schedule_updated` (jornada/antecedência,
-- operação) com uma mudança de identidade pública/profissional — mesma
-- separação de propósito já aplicada entre `tenants.schedule_updated` e
-- `profiles.settings_updated` na mesma migration. `security definer` +
-- `set search_path` seguem o mesmo padrão de todas as funções de
-- auditoria do projeto.
create or replace function public.audit_tenant_profession_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_events (
    actor_user_id, tenant_id, action, resource_type, resource_id, result
  )
  values (
    auth.uid(), new.id, 'tenants.profession_updated', 'tenants', new.id, 'success'
  );

  return new;
end;
$$;

revoke all on function public.audit_tenant_profession_change() from public, anon, authenticated;

drop trigger if exists tenants_audit_profession_change on public.tenants;
create trigger tenants_audit_profession_change
  after update of profession on public.tenants
  for each row
  when (old.profession is distinct from new.profession)
  execute function public.audit_tenant_profession_change();

-- ============================================================================
-- RPC `update_provider_settings` — novo parâmetro/coluna de retorno
-- ============================================================================
--
-- Postgres não permite `create or replace function` alterar a lista de
-- parâmetros nem o shape de `returns table` (isso criaria uma sobrecarga
-- ambígua, não uma substituição) — mesma situação já resolvida em
-- 20260806101600 para `decide_provider_link_request`. A função de 8
-- parâmetros é removida explicitamente antes de recriar a de 9.
drop function if exists public.update_provider_settings(
  text, text, text, time, time, integer, boolean, boolean
);

create or replace function public.update_provider_settings(
  new_display_name text,
  new_phone text,
  new_profession text,
  new_timezone text,
  new_workday_start time,
  new_workday_end time,
  new_minimum_advance_hours integer,
  new_email_notifications boolean,
  new_push_notifications boolean
)
returns table (
  user_id uuid,
  display_name text,
  phone text,
  email_notifications boolean,
  push_notifications boolean,
  profile_updated_at timestamptz,
  timezone text,
  workday_start time,
  workday_end time,
  minimum_advance_hours integer,
  profession text,
  tenant_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_profile_user_id uuid;
  v_profile_display_name text;
  v_profile_phone text;
  v_profile_email_notifications boolean;
  v_profile_push_notifications boolean;
  v_profile_updated_at timestamptz;
  v_tenant_timezone text;
  v_tenant_workday_start time;
  v_tenant_workday_end time;
  v_tenant_minimum_advance_hours integer;
  v_tenant_profession text;
  v_tenant_updated_at timestamptz;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  update public.profiles
    set display_name = new_display_name,
        phone = new_phone,
        email_notifications = new_email_notifications,
        push_notifications = new_push_notifications
  where public.profiles.user_id = v_caller
  returning public.profiles.user_id, public.profiles.display_name, public.profiles.phone,
            public.profiles.email_notifications, public.profiles.push_notifications,
            public.profiles.updated_at
  into v_profile_user_id, v_profile_display_name, v_profile_phone,
       v_profile_email_notifications, v_profile_push_notifications, v_profile_updated_at;

  if not found then
    raise exception 'PROFILE_NOT_FOUND: profile does not exist for the caller' using errcode = '22023';
  end if;

  update public.tenants
    set timezone = new_timezone,
        workday_start = new_workday_start,
        workday_end = new_workday_end,
        minimum_advance_hours = new_minimum_advance_hours,
        profession = new_profession
  where public.tenants.owner_user_id = v_caller
  returning public.tenants.timezone, public.tenants.workday_start, public.tenants.workday_end,
            public.tenants.minimum_advance_hours, public.tenants.profession, public.tenants.updated_at
  into v_tenant_timezone, v_tenant_workday_start, v_tenant_workday_end,
       v_tenant_minimum_advance_hours, v_tenant_profession, v_tenant_updated_at;

  if not found then
    raise exception 'FORBIDDEN: caller does not own a tenant' using errcode = '42501';
  end if;

  return query
  select v_profile_user_id, v_profile_display_name, v_profile_phone,
         v_profile_email_notifications, v_profile_push_notifications, v_profile_updated_at,
         v_tenant_timezone, v_tenant_workday_start, v_tenant_workday_end,
         v_tenant_minimum_advance_hours, v_tenant_profession, v_tenant_updated_at;
end;
$$;

revoke all on function public.update_provider_settings(
  text, text, text, text, time, time, integer, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.update_provider_settings(
  text, text, text, text, time, time, integer, boolean, boolean
) to authenticated;

-- Nota sobre auditoria desta RPC: o `update` de `tenants` acima dispara
-- `tenants_audit_profession_change` normalmente quando `profession` muda
-- (trigger reage à tabela, não a quem chamou o `update`) — mesma nota já
-- registrada em 20260806101800/20260806101300 para as demais RPCs de
-- escrita atômica multi-tabela.

-- ============================================================================
-- RPC `get_client_booking_context` — propaga profession ao cliente
-- ============================================================================
--
-- Mesma função de 20260810230000 (corrigida em 20260810231000 apenas no
-- valor do enum de status), com um campo novo (`profession`) adicionado ao
-- `jsonb_build_object`. Nenhuma outra linha muda. Não há alteração de
-- assinatura (`p_month text`) nem de tipo de retorno (`jsonb`), então
-- `create or replace function` é suficiente aqui — diferente da RPC acima.
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
      'profession', t.profession,
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
