-- ============================================================================
-- Serviço "Atendimento padrão" auto-provisionado por tenant (DEC-163)
-- ============================================================================
--
-- CONTEXTO: decisão de produto (sessão de 25/08/2026) de que cada cliente
-- carrega no máximo 1 serviço vinculado (`clients.primary_service_id`, sem
-- tabela N:N) e que o "Atendimento padrão" oferecido a um cliente sem serviço
-- específico escolhido deve ser um `Service` REAL do catálogo do próprio
-- tenant — nunca um valor sentinela hardcoded no cliente (ex.: string mágica
-- "padrão" tratada em código) — para que o mesmo contrato de
-- `primary_service_id`/preço/duração já usado por qualquer outro serviço do
-- catálogo sirva também para este caso, sem duplicar regra.
--
-- Identificação determinística para o frontend (Ada): correspondência por
-- nome livre é frágil, pois o nome de um serviço não é imutável (o prestador
-- pode renomeá-lo depois de criado). Por isso esta migration adiciona
-- `services.is_default boolean not null default false`, marcado `true`
-- SOMENTE na linha reconhecida como o serviço padrão do tenant — um contrato
-- estável que sobrevive a um rename futuro do prestador, para o formulário de
-- cliente conseguir pré-selecionar/destacar este serviço sem depender de
-- comparação de string.
alter table public.services
  add column if not exists is_default boolean not null default false;

comment on column public.services.is_default is
  'Marca o serviço padrão do tenant (DEC-163): promovido do seed antigo "Atendimento" (20260814140000) quando já existia, ou criado como "Atendimento padrão" quando não existia. Não impede o prestador de renomear/editar o serviço; usado pelo frontend para localizar o serviço padrão sem comparar por nome.';

-- No máximo um serviço "is_default = true" por tenant: garante que o
-- backfill abaixo e qualquer execução futura da função permaneçam
-- idempotentes mesmo se rodados mais de uma vez (nunca deveria acontecer via
-- `on conflict do nothing`/checagem `exists` explícita no loop abaixo, mas
-- esta constraint transforma um bug de duplicação em erro imediato de banco
-- em vez de silêncio).
create unique index if not exists services_tenant_single_default_uk
  on public.services (tenant_id)
  where is_default;

-- ============================================================================
-- REVISÃO (mesmo dia, antes de qualquer aplicação em produção) — consolidação
-- em vez de duplicação de serviço padrão
-- ============================================================================
--
-- Esta migration ainda NÃO tinha sido aplicada no Supabase remoto quando este
-- problema foi identificado — por isso ela é reescrita por completo aqui, em
-- vez de corrigida por uma migration corretiva posterior (não há "produção"
-- ainda para este comportamento específico corrigir por cima). A versão
-- original desta migration criava incondicionalmente um SEGUNDO serviço
-- ("Atendimento padrão") em todo tenant, mesmo nos que já tinham o serviço
-- seed antigo ("Atendimento", `20260814140000_default_service_seed.sql`,
-- trigger `trg_seed_default_service`/função `seed_default_tenant_service`) —
-- resultado: todo tenant (novo ou existente) nasceria com DOIS serviços
-- auto-provisionados. Decisão do usuário: consolidar antes de tocar em
-- catálogo real de qualquer tenant em produção.
--
-- DECISÃO: um único serviço padrão por tenant, sempre.
-- 1. `trg_seed_default_service` (a trigger antiga em `tenants`) é
--    DESATIVADA aqui (`drop trigger`, não `drop function` — a função
--    `seed_default_tenant_service` permanece definida, apenas sem nenhuma
--    trigger que a dispare, preservando o histórico/rollback sem alterar o
--    arquivo de migration original, mesmo espírito de "nunca editamos
--    migrations antigas"). A partir desta migration, SOMENTE
--    `seed_default_standard_service()` (abaixo) provisiona o serviço padrão
--    de um tenant novo.
-- 2. Backfill para tenants JÁ EXISTENTES (efeito real em catálogo de
--    produção, sinalizado aqui com destaque — não é dado financeiro, mas é
--    dado real do prestador sendo ajustado):
--    - Tenant que já tem um serviço ATIVO chamado "Atendimento" (o seed
--      antigo, ou um serviço que o prestador por acaso nomeou igual): essa
--      linha existente é PROMOVIDA (`is_default = true`), nome/duração/valor
--      preservados exatamente como estavam — nenhuma coluna além de
--      `is_default` é tocada, então um "Atendimento" já editado/renomeado
--      pelo prestador (ex.: valor ajustado) mantém o valor do prestador,
--      nunca é resetado para o default de fábrica. NENHUMA linha nova é
--      criada para esse tenant.
--    - Tenant sem nenhum serviço ativo chamado "Atendimento" (ex.: nunca
--      teve o seed antigo aplicado, ou o serviço foi desativado/renomeado):
--      recebe uma linha nova "Atendimento padrão" (60 min, R$ 0,00, mesma
--      convenção de valor inicial do seed antigo), exatamente como a versão
--      original desta migration já fazia.
--    Resultado esperado por tenant: TODO tenant termina este backfill com
--    exatamente 1 serviço `is_default = true` — nunca 0, nunca 2 (constraint
--    `services_tenant_single_default_uk` acima barra fisicamente o caso 2).
-- 3. Tenants criados a partir de agora (trigger antiga já desativada) só
--    passam pela trigger nova — nascem sempre com 1 único serviço padrão
--    ("Atendimento padrão"), sem o antigo "Atendimento" nunca ter sido
--    criado. Não há mais duplicação possível daqui em diante.
drop trigger if exists trg_seed_default_service on public.tenants;

create or replace function public.seed_default_standard_service()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.services (
    tenant_id,
    name,
    duration_minutes,
    reference_value_cents,
    status,
    is_default
  ) values (
    new.id,
    'Atendimento padrão',
    -- Duração/valor iniciais espelham a mesma convenção do seed antigo
    -- (`seed_default_tenant_service`, agora desativado): duração é só um
    -- ponto de partida plausível para o cálculo de slots de agenda
    -- (RN-AGD-002/003) e o valor fica deliberadamente zerado para o
    -- prestador ajustar ao seu preço real antes de vincular clientes a este
    -- serviço — nunca inventamos um preço de mercado.
    60,
    0,
    'active',
    true
  )
  -- `services_tenant_single_default_uk` é o único índice que pode colidir
  -- aqui (nome livre não tem unicidade cross-tenant); `on conflict do
  -- nothing` sem especificar coluna cobre esse e qualquer outro conflito
  -- futuro. Como `trg_seed_default_service` foi desativada acima, todo
  -- tenant novo chega aqui sem nenhum serviço `is_default` ainda, então este
  -- conflito só protegeria contra uma execução duplicada desta própria
  -- trigger (não deveria acontecer, mas o padrão é mantido por segurança).
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.seed_default_standard_service() from public, anon, authenticated;

drop trigger if exists trg_seed_default_standard_service on public.tenants;
create trigger trg_seed_default_standard_service
  after insert on public.tenants
  for each row
  execute function public.seed_default_standard_service();

-- ============================================================================
-- Backfill para tenants já existentes — promove "Atendimento" (quando existe)
-- em vez de criar uma segunda linha
-- ============================================================================
-- Só ajusta catálogo (nome/duração/valor do prestador nunca são alterados;
-- só a coluna `is_default`, e apenas em NO MÁXIMO uma linha por tenant) —
-- nenhum `manual_payments`/dado financeiro de cliente é criado ou alterado
-- por este backfill, e nenhuma linha de serviço existente é excluída ou
-- desativada.
do $$
declare
  v_tenant record;
  v_existing_id uuid;
begin
  for v_tenant in select id from public.tenants loop
    -- Idempotência: se este tenant já tem uma linha `is_default = true`
    -- (ex.: esta migration já rodou antes, ou o tenant foi criado depois que
    -- a trigger nova já estava ativa), não faz nada — reexecutar esta
    -- migration nunca duplica nem repromove.
    continue when exists (
      select 1 from public.services where tenant_id = v_tenant.id and is_default
    );

    -- Candidato a promoção: o serviço ATIVO chamado "Atendimento" criado
    -- pelo seed antigo (ou um serviço que o prestador por coincidência
    -- nomeou exatamente igual — mesmo critério de correspondência por nome
    -- já usado pelo backfill original de 20260814140000). `order by
    -- created_at asc limit 1` é só uma desambiguação determinística para o
    -- caso teoricamente impossível de mais de uma linha ativa com o mesmo
    -- nome (o índice único parcial `services_tenant_active_name_uk` já
    -- impede isso na prática).
    select id into v_existing_id
      from public.services
      where tenant_id = v_tenant.id
        and status = 'active'
        and lower(btrim(name)) = 'atendimento'
      order by created_at asc
      limit 1;

    if v_existing_id is not null then
      update public.services set is_default = true where id = v_existing_id;
    else
      insert into public.services (
        tenant_id, name, duration_minutes, reference_value_cents, status, is_default
      ) values (
        v_tenant.id, 'Atendimento padrão', 60, 0, 'active', true
      )
      on conflict do nothing;
    end if;
  end loop;
end $$;

do $$
declare
  v_missing integer;
  v_duplicated integer;
begin
  select count(*) into v_missing
  from public.tenants t
  where not exists (
    select 1 from public.services s where s.tenant_id = t.id and s.is_default
  );

  assert v_missing = 0,
    'default_standard_service_provision: existe tenant sem serviço padrão apos o backfill';

  select count(*) into v_duplicated
  from (
    select tenant_id from public.services where is_default group by tenant_id having count(*) > 1
  ) dup;

  assert v_duplicated = 0,
    'default_standard_service_provision: existe tenant com mais de um serviço padrão apos o backfill';

  raise notice 'default_standard_service_provision: backfill validado — todo tenant tem exatamente 1 servico padrao (promovido ou criado).';
end $$;

notify pgrst, 'reload schema';
