-- Etapa 1 — provider_client_links (docs/ARQUITETURA_BACKEND_ETAPA_1.md, seção 4.4).
--
-- ATENÇÃO — criação do vínculo fica fora desta migration de propósito:
-- a seção 4.3/4.4 exige que a resolução do código de vínculo ocorra no
-- servidor, com rate limiting e resposta anti-enumeração (nunca um INSERT
-- direto do cliente na tabela, que permitiria vincular a qualquer tenant sem
-- possuir um código válido). Por isso NÃO existe policy de insert para o
-- papel authenticated aqui: linhas `pending` só devem nascer por uma função
-- SECURITY DEFINER futura (ex.: `request_provider_link(code text)`) que
-- valida o hash do código antes de inserir. Essa função é um item separado
-- do backlog (seção 12, passo 10) e não faz parte deste schema inicial.

create table if not exists public.provider_client_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  client_user_id uuid not null references public.profiles (user_id),
  status link_status not null default 'pending',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  revoked_at timestamptz,
  decided_by uuid references public.profiles (user_id),
  revoked_by uuid references public.profiles (user_id)
);

create index if not exists provider_client_links_tenant_idx on public.provider_client_links (tenant_id);
create index if not exists provider_client_links_client_idx on public.provider_client_links (client_user_id);

-- No máximo um vínculo não terminal (pending/active) por par tenant+cliente.
create unique index if not exists provider_client_links_one_active_per_pair
  on public.provider_client_links (tenant_id, client_user_id)
  where status in ('pending', 'active');

-- client_user_id precisa referenciar um perfil com role = 'client'.
create or replace function public.enforce_link_client_role()
returns trigger
language plpgsql
as $$
declare
  client_role profile_role;
begin
  select role into client_role from public.profiles where user_id = new.client_user_id;
  if client_role is distinct from 'client' then
    raise exception 'PROFILE_FORBIDDEN: client_user_id must reference a client profile' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists provider_client_links_client_role on public.provider_client_links;
create trigger provider_client_links_client_role
  before insert or update of client_user_id on public.provider_client_links
  for each row
  execute function public.enforce_link_client_role();

-- Transições válidas: pending->active, pending->rejected, pending->revoked,
-- active->revoked (seção 5.2). rejected/revoked são terminais.
create or replace function public.enforce_link_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then
    return new;
  end if;
  if old.status = 'pending' and new.status in ('active', 'rejected', 'revoked') then
    return new;
  end if;
  if old.status = 'active' and new.status = 'revoked' then
    return new;
  end if;
  raise exception 'LINK_INVALID_TRANSITION: % -> %', old.status, new.status using errcode = '22023';
end;
$$;

drop trigger if exists provider_client_links_transition on public.provider_client_links;
create trigger provider_client_links_transition
  before update of status on public.provider_client_links
  for each row
  execute function public.enforce_link_transition();

alter table public.provider_client_links enable row level security;

-- Deny-by-default. Sem policy de insert (ver comentário no topo do arquivo).

create policy "provider_client_links_select_owner"
  on public.provider_client_links for select
  to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = provider_client_links.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

create policy "provider_client_links_select_client"
  on public.provider_client_links for select
  to authenticated
  using (auth.uid() = client_user_id);

-- Aprovação/rejeição/revogação: somente o proprietário do tenant (seção 4.4).
create policy "provider_client_links_update_owner"
  on public.provider_client_links for update
  to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = provider_client_links.tenant_id
        and t.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tenants t
      where t.id = provider_client_links.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

-- Complementa a tabela tenants: cliente com vínculo Ativo lê identificação
-- mínima do tenant (seção 3.2, "Somente identificação mínima autorizada").
create policy "tenants_select_active_client"
  on public.tenants for select
  to authenticated
  using (
    exists (
      select 1 from public.provider_client_links l
      where l.tenant_id = tenants.id
        and l.client_user_id = auth.uid()
        and l.status = 'active'
    )
  );
