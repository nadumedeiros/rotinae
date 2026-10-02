-- P0 — corrige "infinite recursion detected in policy for relation
-- 'tenants'" (42P17) que estava derrubando toda leitura de `tenants` em
-- produção e, por consequência, qualquer fluxo que resolva o tenant do
-- prestador (Clientes, Agenda, Pagamentos, bloqueio de agenda, criação de
-- agendamento sem cliente — BLG-051/DEC-127).
--
-- CAUSA RAIZ (confirmada por reprodução direta no Postgres remoto, fora do
-- PostgREST, simulando `role authenticated` + `request.jwt.claims`):
--
--   `tenants_select_active_client` (20260806100300_provider_client_links.sql)
--     using ( exists (
--       select 1 from public.provider_client_links l
--       where l.tenant_id = tenants.id and l.client_user_id = auth.uid()
--         and l.status = 'active'
--     ) )
--
--   `provider_client_links_select_owner` e `provider_client_links_update_owner`
--   (mesma migration) fazem o caminho inverso:
--     using ( exists (
--       select 1 from public.tenants t
--       where t.id = provider_client_links.tenant_id and t.owner_user_id = auth.uid()
--     ) )
--
-- Qualquer SELECT em `tenants` avalia (OR) todas as policies permissivas de
-- SELECT da tabela, inclusive `tenants_select_active_client` — mesmo quando o
-- filtro da query é só `owner_user_id = ...` e nunca bateria nessa policy,
-- porque o Postgres precisa considerar todas as policies para decidir quais
-- linhas expor. Para avaliar essa policy ele precisa expandir o RLS de
-- `provider_client_links` (ela também tem RLS habilitada), e essa expansão
-- reintroduz uma subquery em `tenants` (via `provider_client_links_select_owner`)
-- que ainda está "em expansão" — o planejador detecta o ciclo A -> B -> A e
-- aborta com 42P17 em vez de tentar resolvê-lo. Isso não depende dos dados:
-- acontece para qualquer usuário autenticado, em qualquer SELECT de
-- `tenants`, desde que ambas as policies cruzadas existam — é uma limitação
-- estrutural do RLS do Postgres com policies que se referenciam mutuamente
-- entre duas tabelas, não um bug pontual de uma migration recente.
--
-- CORREÇÃO: mover a leitura de `provider_client_links` feita a partir de uma
-- policy de `tenants` para dentro de uma função SECURITY DEFINER. Funções
-- SECURITY DEFINER executam com o papel do dono da função (aqui, o dono das
-- migrations, que também é dono das tabelas) e por padrão o dono de uma
-- tabela NÃO tem RLS aplicado sobre ela (a menos que a tabela use FORCE ROW
-- LEVEL SECURITY, o que não é o caso aqui) — então a consulta interna a
-- `provider_client_links` deixa de reavaliar as policies dela, e o ciclo
-- desaparece: `tenants` passa a não depender mais, na prática, da RLS de
-- `provider_client_links` (só de uma função opaca ao planejador de RLS). O
-- sentido inverso (`provider_client_links` -> `tenants`) continua existindo e
-- não precisa mudar, pois deixou de fechar um ciclo.
--
-- Mesmo padrão já usado no projeto para lógica sensível a papéis/tenant fora
-- do alcance direto do chamador (ex.: `rotate_provider_link_code`,
-- 20260806101300_provider_link_rpcs.sql).

create or replace function public.is_active_client_of_tenant(p_tenant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.provider_client_links l
    where l.tenant_id = p_tenant_id
      and l.client_user_id = auth.uid()
      and l.status = 'active'
  );
$$;

comment on function public.is_active_client_of_tenant(uuid) is
  'Usada exclusivamente pela policy tenants_select_active_client. SECURITY '
  'DEFINER de propósito: evita reavaliar a RLS de provider_client_links a '
  'partir de uma policy de tenants, o que causava recursão infinita (42P17) '
  'porque provider_client_links_select_owner/_update_owner fazem o caminho '
  'inverso (consultam tenants). Não expor além de "authenticated" e não '
  'reintroduzir uma consulta direta a tenants/provider_client_links dentro '
  'de outra policy sem passar por uma função equivalente a esta.';

revoke all on function public.is_active_client_of_tenant(uuid) from public, anon;
grant execute on function public.is_active_client_of_tenant(uuid) to authenticated;

drop policy if exists "tenants_select_active_client" on public.tenants;

create policy "tenants_select_active_client"
  on public.tenants for select
  to authenticated
  using (public.is_active_client_of_tenant(tenants.id));
