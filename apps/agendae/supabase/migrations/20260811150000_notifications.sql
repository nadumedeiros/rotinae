create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(user_id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  type text not null check (type in ('appointment', 'link', 'payment', 'account')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null check (char_length(btrim(description)) between 1 and 500),
  destination text not null check (destination in ('/agenda', '/clients', '/payments', '/settings')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_created_idx
  on public.notifications(recipient_user_id, created_at desc);
create index if not exists notifications_recipient_unread_idx
  on public.notifications(recipient_user_id, created_at desc) where read_at is null;

alter table public.notifications enable row level security;

create policy "notifications_select_recipient" on public.notifications for select to authenticated
  using (recipient_user_id = auth.uid());
create policy "notifications_update_recipient" on public.notifications for update to authenticated
  using (recipient_user_id = auth.uid()) with check (recipient_user_id = auth.uid());

-- Usuários autenticados não recebem INSERT/DELETE: produtores confiáveis
-- (RPCs/Edge Functions/service role) criarão eventos após decisão de domínio.

create or replace function public.notifications_read_state_only()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id
    or new.recipient_user_id is distinct from old.recipient_user_id
    or new.tenant_id is distinct from old.tenant_id
    or new.type is distinct from old.type
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.destination is distinct from old.destination
    or new.created_at is distinct from old.created_at then
    raise exception 'NOTIFICATION_IMMUTABLE: only read_at can be changed' using errcode = '42501';
  end if;
  if new.read_at is null or (old.read_at is not null and new.read_at is distinct from old.read_at) then
    raise exception 'NOTIFICATION_READ_STATE_INVALID: read_at cannot be cleared or rewritten' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.notifications_read_state_only() from public, anon, authenticated;

drop trigger if exists notifications_read_state_only on public.notifications;
create trigger notifications_read_state_only before update on public.notifications
for each row execute function public.notifications_read_state_only();
