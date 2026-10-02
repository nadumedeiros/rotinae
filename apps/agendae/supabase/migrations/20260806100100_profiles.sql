-- Etapa 1 — profiles (docs/ARQUITETURA_BACKEND_ETAPA_1.md, seção 4.1).
-- Invariante: uma identidade (auth.users) possui exatamente um perfil, com papel
-- imutável no MVP. RLS nasce junto com a tabela (seção 10.2).

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role profile_role not null,
  display_name text not null check (char_length(trim(display_name)) > 0),
  phone text,
  status profile_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Papel é imutável no MVP (RN-PER-... / seção 6.1: "selectedRole" nunca eleva privilégio).
create or replace function public.enforce_profile_role_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.role <> old.role then
    raise exception 'PROFILE_ROLE_IMMUTABLE' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_immutable on public.profiles;
create trigger profiles_role_immutable
  before update on public.profiles
  for each row
  execute function public.enforce_profile_role_immutable();

alter table public.profiles enable row level security;

-- Deny-by-default: nenhuma policy = nenhum acesso. As policies abaixo são as
-- únicas exceções explícitas (seção 8.1).

create policy "profiles_select_self"
  on public.profiles for select
  to authenticated
  using (auth.uid() = user_id);

-- Permite ao próprio usuário autenticado criar seu perfil uma única vez
-- (fluxo de onboarding ainda não contratado — seção 6.4 —, mas a tabela já
-- nasce pronta para ele sem exigir service_role para o caso simples).
create policy "profiles_insert_self"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Sem policy de delete: exclusão física fica fora do MVP (seção 5.1 — "deleted"
-- é um estado, não uma remoção de linha).
