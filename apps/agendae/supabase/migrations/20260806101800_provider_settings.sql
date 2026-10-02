-- Configurações operacionais e de identidade do prestador
-- (docs/HANDOFF_PERFIL_NOTIFICACOES_CRIS.md, seção "Perfil do prestador";
-- contrato `ProviderSettingsPort`,
-- apps/agendae/src/domain/provider/provider-settings-port.ts / types.ts;
-- BACKLOG.md, DEC-072, BLG-049).
--
-- ============================================================================
-- DECISÃO DE DESIGN — reconciliação do DTO achatado com as tabelas normalizadas
-- ============================================================================
--
-- `ProviderSettings` é um DTO achatado (`id`, `displayName`, `email`, `phone`,
-- `timezone`, `workdayStart`, `workdayEnd`, `minimumAdvanceHours`,
-- `emailNotifications`, `pushNotifications`, `updatedAt`), mas NENHUMA tabela
-- nova é criada aqui: cada campo já tem (ou passa a ter) um lar natural em uma
-- tabela existente, e duplicá-lo numa tabela `provider_settings` própria
-- violaria a norma única sem necessidade (YAGNI, mesma lógica de DEC-069 ao
-- recusar uma tabela `provider_client_booking_policies` antes de existir
-- consumidor real).
--
--   - `displayName`, `phone`            -> `profiles` (20260806100100), já
--     existentes. Identidade da pessoa, não do negócio.
--   - `email`                            -> `auth.users.email`. Nunca gravado
--     por este caminho (handoff: "e-mail não deve ser alterado por este
--     endpoint" — exige fluxo próprio de confirmação, fora de escopo aqui).
--     Resolvido no adaptador via `supabase.auth.getUser()` (é sempre o
--     PRÓPRIO e-mail do chamador, nunca o de terceiros — não precisa de RPC/
--     view dedicada, diferente do caso de `provider_pending_link_requests`,
--     que lê e-mail de OUTRA identidade).
--   - `timezone`                         -> `tenants` (20260806100200), já
--     existente. Fuso é uma propriedade operacional do negócio (agenda), não
--     da pessoa.
--   - `workdayStart`, `workdayEnd`, `minimumAdvanceHours` -> `tenants`,
--     colunas novas adicionadas nesta migration (mesma justificativa: jornada
--     e antecedência mínima são regras da OPERAÇÃO do tenant, insumo direto
--     de RF-AGE/RN-AGD quando a agenda real existir — ver
--     docs/HANDOFF_AGENDA_CRIS.md — não da identidade do prestador).
--   - `emailNotifications`, `pushNotifications` -> `profiles`, colunas novas
--     adicionadas nesta migration. São preferências da IDENTIDADE do
--     prestador (a pessoa decide como quer ser avisada, independente de para
--     qual tenant/negócio a notificação se refere), não dados operacionais do
--     tenant — mesma leitura que já levou `communication_preferences`
--     (20260806100700) a ser indexada por `user_id`, nunca por `tenant_id`.
--     Como `profiles` é compartilhada por `provider` e `client`, as duas
--     colunas também ficam disponíveis para um futuro `NotificationPort` de
--     cliente sem nenhuma migração adicional — não implementado aqui (fora de
--     escopo desta entrega).
--   - `id`                               -> `profiles.user_id` do chamador.
--     Decisão de design: como o DTO não tem tabela própria, `id` precisa
--     apontar para algo estável. Escolhido `user_id` (não `tenant_id`) porque
--     o DTO é centrado na IDENTIDADE do prestador (nome/telefone/preferências
--     moram em `profiles`), e `user_id` também é o valor que
--     `supabase.auth.getUser()` já expõe ao adaptador sem consulta extra.
--   - `updatedAt`                        -> maior valor entre
--     `profiles.updated_at` e `tenants.updated_at`, porque uma mudança em
--     QUALQUER um dos dois já altera "as configurações" do ponto de vista do
--     contrato — calculado no adaptador (`SupabaseProviderSettingsAdapter`),
--     não no banco, para não introduzir uma view só para isso.
--
-- ============================================================================
-- Extensão aditiva de tenants (jornada e antecedência)
-- ============================================================================

alter table public.tenants
  add column if not exists workday_start time not null default '08:00',
  add column if not exists workday_end time not null default '18:00',
  add column if not exists minimum_advance_hours integer not null default 24;

-- Handoff: "horário inicial deve ser anterior ao final". Nomeado
-- explicitamente para o adapter mapear WORKING_HOURS_INVALID sem depender do
-- nome autogerado pelo Postgres (mesma convenção de
-- `services_duration_positive_check`, 20260806101700).
do $$ begin
  alter table public.tenants
    add constraint tenants_workday_order_check check (workday_start < workday_end);
exception when duplicate_object then null; end $$;

-- Handoff: "antecedência aceita 0–720 horas".
do $$ begin
  alter table public.tenants
    add constraint tenants_minimum_advance_hours_range_check
      check (minimum_advance_hours between 0 and 720);
exception when duplicate_object then null; end $$;

-- `tenants.timezone` (20260806100200) nasceu como `text not null` sem
-- validação de formato — fecha a lacuna aqui para que TIMEZONE_INVALID
-- também tenha uma barreira de banco (defesa em profundidade), não só a
-- checagem client-side do adaptador via `Intl.DateTimeFormat`.
-- `pg_timezone_names` é a fonte de verdade de identificadores IANA já
-- carregados pelo próprio Postgres (tzdata do servidor); marcada `stable`
-- (não `immutable`, porque tecnicamente pode mudar entre atualizações de
-- tzdata do servidor) — Postgres não impõe `immutable` em CHECK, apenas
-- recomenda; aceitável aqui pois o conjunto de zonas IANA é praticamente
-- estático em produção.
create or replace function public.is_valid_iana_timezone(p_timezone text)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from pg_timezone_names where name = p_timezone);
$$;

-- Diferente de `link_code_pepper()`/`hash_provider_link_code()` (só chamadas
-- de DENTRO de funções `SECURITY DEFINER`, então nunca precisam de EXECUTE
-- para `authenticated`), esta função é invocada pelo PRÓPRIO motor do
-- Postgres ao validar o CHECK constraint em QUALQUER UPDATE/INSERT de
-- `tenants` — inclusive um `update()` direto via PostgREST sob RLS
-- (`tenants_update_owner` continua permitindo isso, não só a RPC abaixo).
-- Sem `grant execute ... to authenticated`, esse caminho falharia com
-- "permission denied for function" antes mesmo de chegar à validação do
-- fuso.
revoke all on function public.is_valid_iana_timezone(text) from public, anon;
grant execute on function public.is_valid_iana_timezone(text) to authenticated;

do $$ begin
  alter table public.tenants
    add constraint tenants_timezone_valid_check check (public.is_valid_iana_timezone(timezone));
exception when duplicate_object then null; end $$;

-- ============================================================================
-- Extensão aditiva de profiles (preferências de notificação)
-- ============================================================================

alter table public.profiles
  add column if not exists email_notifications boolean not null default true,
  add column if not exists push_notifications boolean not null default true;

-- `profiles.phone` (20260806100100) nasceu como `text` opcional sem
-- validação de formato. O fluxo de cadastro já grava sempre em E.164
-- (`src/domain/auth/registration-validation.ts`, `+55...`), mesmo padrão de
-- `clients.phone` (20260806101500); a checagem aqui fecha a mesma lacuna do
-- lado do prestador, nomeada explicitamente para o adapter mapear
-- PHONE_INVALID.
do $$ begin
  alter table public.profiles
    add constraint profiles_phone_format_check
      check (phone is null or phone ~ '^\+[1-9]\d{6,14}$');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- RLS — nenhuma policy nova necessária
-- ============================================================================
--
-- As colunas novas em `tenants`/`profiles` são só mais campos das mesmas
-- linhas já cobertas por `tenants_select_owner`/`tenants_update_owner`
-- (20260806100200) e `profiles_select_self`/`profiles_update_self`
-- (20260806100100) — RLS do Postgres é por LINHA, não por coluna, então as
-- policies existentes já autorizam exatamente o mesmo dono/self a ler e
-- gravar os novos campos, sem exceção nem policy adicional.

-- ============================================================================
-- Auditoria de mudança de configurações (handoff, critério de aceite:
-- "preferências e alterações críticas geram auditoria sem copiar conteúdo
-- sensível")
-- ============================================================================
--
-- `audit_status_change`/`audit_creation` (20260806101000/101100) só cobrem
-- criação e mudança da coluna `status` — não alcançam edição de jornada,
-- antecedência, nome, telefone ou preferências. Mesma lacuna (e mesma
-- solução) de `audit_service_field_change` (20260806101700): uma função
-- dedicada por tabela, disparada só quando os campos relevantes mudam de
-- fato (`when (old... is distinct from new...)`), sem nunca copiar o valor
-- em si — só metadados (`action`, `resource_type`, `resource_id`).

create or replace function public.audit_tenant_schedule_change()
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
    auth.uid(), new.id, 'tenants.schedule_updated', 'tenants', new.id, 'success'
  );

  return new;
end;
$$;

revoke all on function public.audit_tenant_schedule_change() from public, anon, authenticated;

drop trigger if exists tenants_audit_schedule_change on public.tenants;
create trigger tenants_audit_schedule_change
  after update of workday_start, workday_end, minimum_advance_hours on public.tenants
  for each row
  when (
    old.workday_start is distinct from new.workday_start
    or old.workday_end is distinct from new.workday_end
    or old.minimum_advance_hours is distinct from new.minimum_advance_hours
  )
  execute function public.audit_tenant_schedule_change();

-- `profiles` não tem `tenant_id`: só prestadores possuem tenant (seção 4.2 da
-- arquitetura). Resolve o tenant do PRÓPRIO prestador quando existir
-- (`owner_user_id = new.user_id`); para um perfil `client` (sem tenant
-- próprio), `tenant_id` fica `null` — `audit_events.tenant_id` já é
-- opcional (20260806100900), então isso não quebra a tabela nem a leitura
-- administrativa.
create or replace function public.audit_profile_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
begin
  select t.id into v_tenant_id from public.tenants t where t.owner_user_id = new.user_id;

  insert into public.audit_events (
    actor_user_id, tenant_id, action, resource_type, resource_id, result
  )
  values (
    auth.uid(), v_tenant_id, 'profiles.settings_updated', 'profiles', new.user_id, 'success'
  );

  return new;
end;
$$;

revoke all on function public.audit_profile_settings_change() from public, anon, authenticated;

drop trigger if exists profiles_audit_settings_change on public.profiles;
create trigger profiles_audit_settings_change
  after update of display_name, phone, email_notifications, push_notifications on public.profiles
  for each row
  when (
    old.display_name is distinct from new.display_name
    or old.phone is distinct from new.phone
    or old.email_notifications is distinct from new.email_notifications
    or old.push_notifications is distinct from new.push_notifications
  )
  execute function public.audit_profile_settings_change();

-- ============================================================================
-- RPC — escrita atômica em duas tabelas (`profiles` + `tenants`)
-- ============================================================================
--
-- `updateSettings` do contrato grava em DUAS tabelas ao mesmo tempo
-- (identidade em `profiles`, operação em `tenants`). Duas chamadas REST
-- sequenciais do adaptador (um UPDATE por tabela) correriam em duas
-- transações independentes: uma falha na segunda deixaria a primeira já
-- persistida, quebrando a consistência do "salvar configurações" como uma
-- única operação. Uma função `SECURITY DEFINER` roda numa única transação
-- implícita — mesma razão de ser de `decide_provider_link_request`
-- (20260806101600) ao reconciliar `provider_client_links` + `clients` numa
-- chamada só. Validação de formato/limite já é reforçada em profundidade
-- pelo adapter (client-side) e pelas constraints acima (banco); a função não
-- repete essas checagens, só propaga o erro do Postgres se alguma constraint
-- for violada mesmo assim.
create or replace function public.update_provider_settings(
  new_display_name text,
  new_phone text,
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
        minimum_advance_hours = new_minimum_advance_hours
  where public.tenants.owner_user_id = v_caller
  returning public.tenants.timezone, public.tenants.workday_start, public.tenants.workday_end,
            public.tenants.minimum_advance_hours, public.tenants.updated_at
  into v_tenant_timezone, v_tenant_workday_start, v_tenant_workday_end,
       v_tenant_minimum_advance_hours, v_tenant_updated_at;

  if not found then
    raise exception 'FORBIDDEN: caller does not own a tenant' using errcode = '42501';
  end if;

  return query
  select v_profile_user_id, v_profile_display_name, v_profile_phone,
         v_profile_email_notifications, v_profile_push_notifications, v_profile_updated_at,
         v_tenant_timezone, v_tenant_workday_start, v_tenant_workday_end,
         v_tenant_minimum_advance_hours, v_tenant_updated_at;
end;
$$;

revoke all on function public.update_provider_settings(
  text, text, text, time, time, integer, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.update_provider_settings(
  text, text, text, time, time, integer, boolean, boolean
) to authenticated;

-- Nota sobre auditoria desta RPC: os dois UPDATEs feitos dentro da função
-- disparam `tenants_audit_schedule_change`/`profiles_audit_settings_change`
-- normalmente (triggers reagem à tabela, não a quem chamou o UPDATE) —
-- mesma nota já registrada em 20260806101300 para as RPCs de vínculo. A
-- função não grava em `audit_events` diretamente, para não duplicar o
-- evento.
