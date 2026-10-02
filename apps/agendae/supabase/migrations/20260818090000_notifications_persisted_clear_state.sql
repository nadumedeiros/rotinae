-- BUG: o botão "Limpar" da inbox de notificações (authenticated-header.tsx)
-- só gravava um cursor `clearedAt` em SecureStore (nativo) / localStorage
-- (web), por aparelho. Ao entrar novamente em outro aparelho, reinstalar o
-- app, ou perder o storage local, o cursor não existia mais e as
-- notificações "limpas" reapareciam. Esta migration move o estado de
-- "limpo" para o backend, por usuário, para que sobreviva a logout/login e
-- troca de dispositivo (o filtro por `created_at > cleared_at` em
-- `listNotifications` permanece o mesmo, só a fonte do cursor muda).

create table if not exists public.notification_clears (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  cleared_at timestamptz not null default now()
);

alter table public.notification_clears enable row level security;

-- Somente leitura direta do próprio cursor. Não há policy de INSERT/UPDATE:
-- com RLS habilitada, qualquer comando sem policy correspondente é negado
-- por padrão (mesmo padrão de `notifications`, que também não concede
-- INSERT/DELETE a `authenticated`) — a única via de escrita é a RPC abaixo,
-- que impede retroagir `cleared_at` e mantém a operação idempotente.
create policy "notification_clears_select_owner" on public.notification_clears for select to authenticated
  using (user_id = auth.uid());

create or replace function public.clear_notifications()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'SESSION_REQUIRED' using errcode = '42501';
  end if;

  -- Mesma transação: o cursor de "limpo" e a leitura das notificações
  -- pendentes avançam juntos, então nenhuma notificação fica com read_at
  -- nulo "escondida" atrás do novo cursor.
  update public.notifications
  set read_at = now()
  where recipient_user_id = v_user_id
    and read_at is null;

  insert into public.notification_clears (user_id, cleared_at)
  values (v_user_id, now())
  on conflict (user_id) do update
    set cleared_at = excluded.cleared_at
  where notification_clears.cleared_at < excluded.cleared_at;
end;
$$;

revoke all on function public.clear_notifications() from public, anon;
grant execute on function public.clear_notifications() to authenticated;
