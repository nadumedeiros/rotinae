-- Etapa 1 — communication_preferences (docs/ARQUITETURA_BACKEND_ETAPA_1.md, seção 4.7).
-- Projeção do estado atual por user_id + channel + purpose. `purpose` fica
-- livre (não é enum) porque a lista definitiva de finalidades ainda depende
-- de revisão jurídica (seção 14, "Questões ainda abertas"); validar no
-- domínio da aplicação até essa decisão fechar.

create table if not exists public.communication_preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  channel consent_channel not null,
  purpose text not null check (char_length(trim(purpose)) > 0),
  granted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, channel, purpose)
);

drop trigger if exists communication_preferences_set_updated_at on public.communication_preferences;
create trigger communication_preferences_set_updated_at
  before update on public.communication_preferences
  for each row
  execute function public.set_updated_at();

alter table public.communication_preferences enable row level security;

create policy "communication_preferences_select_self"
  on public.communication_preferences for select
  to authenticated
  using (auth.uid() = user_id);

create policy "communication_preferences_upsert_self"
  on public.communication_preferences for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "communication_preferences_update_self"
  on public.communication_preferences for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
