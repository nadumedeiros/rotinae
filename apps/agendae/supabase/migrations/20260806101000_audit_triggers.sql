-- Etapa 1 — gravação automática em audit_events (docs/ARQUITETURA_BACKEND_ETAPA_1.md,
-- seção 4.8 e princípio 7: "Auditoria sem conteúdo sensível").
--
-- audit_events não tem NENHUMA policy para anon/authenticated (ver
-- 20260806100900_audit_events.sql) — de propósito, para que ninguém grave
-- eventos "na mão" e falsifique a trilha. Em vez disso, mudanças de status
-- nas tabelas sensíveis geram o evento sozinhas, via trigger SECURITY
-- DEFINER: a função roda com o privilégio de quem a criou (não do usuário
-- autenticado), então consegue inserir em audit_events mesmo com RLS
-- negando tudo para authenticated.
--
-- Cobre tenants, provider_client_links e provider_link_codes porque as três
-- têm colunas `id` e `status`; nenhum dado sensível (código completo, token,
-- observação) é copiado, só metadados.

create or replace function public.audit_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_resource_id uuid;
begin
  v_resource_id := (to_jsonb(new)->>'id')::uuid;
  -- tenants não tem coluna tenant_id (a própria linha É o tenant); as demais
  -- tabelas têm. Se tenant_id não existir na linha, cai para o próprio id.
  v_tenant_id := coalesce(
    (to_jsonb(new)->>'tenant_id')::uuid,
    v_resource_id
  );

  insert into public.audit_events (
    actor_user_id, tenant_id, action, resource_type, resource_id, result
  )
  values (
    auth.uid(),
    v_tenant_id,
    TG_TABLE_NAME || '.status: ' || old.status || ' -> ' || new.status,
    TG_TABLE_NAME,
    v_resource_id,
    'success'
  );

  return new;
end;
$$;

revoke all on function public.audit_status_change() from public, anon, authenticated;

drop trigger if exists tenants_audit_status_change on public.tenants;
create trigger tenants_audit_status_change
  after update of status on public.tenants
  for each row
  when (old.status is distinct from new.status)
  execute function public.audit_status_change();

drop trigger if exists provider_client_links_audit_status_change on public.provider_client_links;
create trigger provider_client_links_audit_status_change
  after update of status on public.provider_client_links
  for each row
  when (old.status is distinct from new.status)
  execute function public.audit_status_change();

drop trigger if exists provider_link_codes_audit_status_change on public.provider_link_codes;
create trigger provider_link_codes_audit_status_change
  after update of status on public.provider_link_codes
  for each row
  when (old.status is distinct from new.status)
  execute function public.audit_status_change();
