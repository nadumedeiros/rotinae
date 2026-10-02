-- Etapa 1 — tenants (docs/ARQUITETURA_BACKEND_ETAPA_1.md, seção 4.2).
-- Invariante inicial: cada Prestador possui no máximo um tenant e é seu único
-- proprietário (sem equipes no MVP).

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references public.profiles (user_id),
  display_name text not null check (char_length(trim(display_name)) > 0),
  timezone text not null,
  status tenant_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists tenants_set_updated_at on public.tenants;
create trigger tenants_set_updated_at
  before update on public.tenants
  for each row
  execute function public.set_updated_at();

-- owner_user_id precisa referenciar um perfil com role = 'provider'. Postgres
-- não faz FK condicional por coluna, então validamos via trigger (seção 2,
-- princípio 1: "servidor como autoridade").
create or replace function public.enforce_tenant_owner_is_provider()
returns trigger
language plpgsql
as $$
declare
  owner_role profile_role;
begin
  select role into owner_role from public.profiles where user_id = new.owner_user_id;
  if owner_role is distinct from 'provider' then
    raise exception 'PROFILE_FORBIDDEN: owner_user_id must reference a provider profile' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_owner_is_provider on public.tenants;
create trigger tenants_owner_is_provider
  before insert or update of owner_user_id on public.tenants
  for each row
  execute function public.enforce_tenant_owner_is_provider();

alter table public.tenants enable row level security;

-- Deny-by-default. A policy que permite a um Cliente com vínculo Ativo ler
-- dados mínimos do tenant é adicionada em 20260806100400_provider_client_links.sql,
-- pois depende da tabela provider_client_links (ainda não existe nesta migration).

create policy "tenants_select_owner"
  on public.tenants for select
  to authenticated
  using (auth.uid() = owner_user_id);

create policy "tenants_insert_owner"
  on public.tenants for insert
  to authenticated
  with check (auth.uid() = owner_user_id);

create policy "tenants_update_owner"
  on public.tenants for update
  to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);
