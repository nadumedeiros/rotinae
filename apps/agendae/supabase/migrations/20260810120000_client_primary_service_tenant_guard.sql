-- Garante que a referência aditiva clients.primary_service_id nunca atravesse
-- tenants. A FK simples criada em 20260806101700_services_catalog.sql garante
-- apenas existência; RLS não participa da validação interna de foreign keys.

create or replace function public.enforce_client_primary_service_tenant()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.primary_service_id is not null and not exists (
    select 1
      from public.services s
     where s.id = new.primary_service_id
       and s.tenant_id = new.tenant_id
  ) then
    raise exception 'FORBIDDEN: primary service must belong to the client tenant'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_client_primary_service_tenant() from public, anon, authenticated;

drop trigger if exists clients_primary_service_tenant_guard on public.clients;
create trigger clients_primary_service_tenant_guard
  before insert or update of primary_service_id, tenant_id on public.clients
  for each row
  execute function public.enforce_client_primary_service_tenant();
