-- ============================================================================
-- Serviço Padrão "Atendimento" para todo Prestador (Novo e Existente)
-- ============================================================================
-- Cria automaticamente o serviço "Atendimento" (60 min, R$ 0,00) para qualquer
-- novo tenant criado e popula retroativamente para todos os tenants já existentes.

create or replace function public.seed_default_tenant_service()
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
    status
  ) values (
    new.id,
    'Atendimento',
    60,
    0,
    'active'
  )
  on conflict do nothing;

  return new;
end;
$$;

-- Trigger automático para qualquer novo tenant que for criado no sistema
drop trigger if exists trg_seed_default_service on public.tenants;
create trigger trg_seed_default_service
  after insert on public.tenants
  for each row
  execute function public.seed_default_tenant_service();

-- ============================================================================
-- População retroativa para todos os tenants já existentes
-- ============================================================================
insert into public.services (
  tenant_id,
  name,
  duration_minutes,
  reference_value_cents,
  status
)
select
  t.id,
  'Atendimento',
  60,
  0,
  'active'
from public.tenants t
where not exists (
  select 1 from public.services s
  where s.tenant_id = t.id
    and lower(btrim(s.name)) = 'atendimento'
)
on conflict do nothing;
