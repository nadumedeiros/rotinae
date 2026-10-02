-- Etapa 1 — complemento de 20260806101000_audit_triggers.sql: audita também a
-- CRIAÇÃO das linhas (não só a mudança de status). Mesma lógica de
-- SECURITY DEFINER + search_path fixo, para contornar a ausência de policy
-- em audit_events para anon/authenticated.

create or replace function public.audit_creation()
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
    TG_TABLE_NAME || '.created',
    TG_TABLE_NAME,
    v_resource_id,
    'success'
  );

  return new;
end;
$$;

revoke all on function public.audit_creation() from public, anon, authenticated;

drop trigger if exists tenants_audit_creation on public.tenants;
create trigger tenants_audit_creation
  after insert on public.tenants
  for each row
  execute function public.audit_creation();

drop trigger if exists provider_client_links_audit_creation on public.provider_client_links;
create trigger provider_client_links_audit_creation
  after insert on public.provider_client_links
  for each row
  execute function public.audit_creation();

drop trigger if exists provider_link_codes_audit_creation on public.provider_link_codes;
create trigger provider_link_codes_audit_creation
  after insert on public.provider_link_codes
  for each row
  execute function public.audit_creation();
