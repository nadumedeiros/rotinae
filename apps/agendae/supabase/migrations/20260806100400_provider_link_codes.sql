-- Etapa 1 — provider_link_codes (docs/ARQUITETURA_BACKEND_ETAPA_1.md, seção 4.3).
--
-- Só o hash do código é persistido (`token_hash`); o valor completo é gerado
-- por CSPRNG (>=128 bits) na aplicação/RPC de geração/rotação e nunca é
-- gravado em texto puro. `display_prefix` é o trecho não sensível usado só
-- para identificação em auditoria/UI.
--
-- Igual ao arquivo anterior: não existe policy de select para o papel
-- authenticated além do próprio dono do tenant. A resolução de um código
-- informado por um cliente deve ocorrer em uma função SECURITY DEFINER
-- futura (rate limited, resposta anti-enumeração — seção 4.3), não por
-- leitura direta da tabela.

create table if not exists public.provider_link_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  token_hash text not null unique,
  display_prefix text not null,
  status link_code_status not null default 'active',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists provider_link_codes_tenant_idx on public.provider_link_codes (tenant_id);

-- Interpretação adotada (seção 4.3: "regenerar revoga o anterior atomicamente"):
-- no máximo um código `active` por tenant ao mesmo tempo.
create unique index if not exists provider_link_codes_one_active_per_tenant
  on public.provider_link_codes (tenant_id)
  where status = 'active';

alter table public.provider_link_codes enable row level security;

create policy "provider_link_codes_select_owner"
  on public.provider_link_codes for select
  to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = provider_link_codes.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

create policy "provider_link_codes_insert_owner"
  on public.provider_link_codes for insert
  to authenticated
  with check (
    exists (
      select 1 from public.tenants t
      where t.id = provider_link_codes.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

create policy "provider_link_codes_update_owner"
  on public.provider_link_codes for update
  to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = provider_link_codes.tenant_id
        and t.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tenants t
      where t.id = provider_link_codes.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );
