-- Entrega push nativa para a inbox criada em 20260811150000. A inbox segue
-- como fonte de verdade; push é apenas um canal de entrega por aparelho.

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null unique,
  expo_push_token text not null unique check (
    expo_push_token like 'ExponentPushToken[%]'
    or expo_push_token like 'ExpoPushToken[%]'
  ),
  platform text not null check (platform in ('android', 'ios')),
  project_id uuid not null,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_devices_user_enabled_idx
  on public.push_devices(user_id) where enabled;

alter table public.push_devices enable row level security;
create policy "push_devices_select_owner" on public.push_devices for select to authenticated
  using (user_id = auth.uid());
create policy "push_devices_delete_owner" on public.push_devices for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.register_push_device(
  p_installation_id uuid,
  p_expo_push_token text,
  p_platform text,
  p_project_id uuid
)
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
  if p_platform not in ('android', 'ios')
     or not (
       p_expo_push_token like 'ExponentPushToken[%]'
       or p_expo_push_token like 'ExpoPushToken[%]'
     ) then
    raise exception 'INVALID_PUSH_DEVICE' using errcode = '22023';
  end if;

  -- Um token pertence a uma única instalação/conta ativa. Isto também limpa
  -- registros órfãos quando o sistema operacional recria a instalação.
  delete from public.push_devices
  where expo_push_token = p_expo_push_token
    and installation_id is distinct from p_installation_id;

  insert into public.push_devices (
    user_id, installation_id, expo_push_token, platform, project_id,
    enabled, last_seen_at, updated_at
  ) values (
    v_user_id, p_installation_id, p_expo_push_token, p_platform, p_project_id,
    true, now(), now()
  )
  on conflict (installation_id) do update set
    user_id = excluded.user_id,
    expo_push_token = excluded.expo_push_token,
    platform = excluded.platform,
    project_id = excluded.project_id,
    enabled = true,
    last_seen_at = now(),
    updated_at = now();
end;
$$;

create or replace function public.unregister_push_device(p_installation_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.push_devices
  set enabled = false, updated_at = now()
  where user_id = auth.uid() and installation_id = p_installation_id;
$$;

revoke all on function public.register_push_device(uuid, text, text, uuid) from public, anon;
grant execute on function public.register_push_device(uuid, text, text, uuid) to authenticated;
revoke all on function public.unregister_push_device(uuid) from public, anon;
grant execute on function public.unregister_push_device(uuid) to authenticated;

create table public.notification_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'submitted', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  expo_ticket_id text,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  submitted_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, device_id)
);

create index notification_push_pending_idx
  on public.notification_push_deliveries(next_attempt_at, created_at)
  where status in ('pending', 'processing');
create index notification_push_receipts_idx
  on public.notification_push_deliveries(submitted_at)
  where status = 'submitted';

alter table public.notification_push_deliveries enable row level security;
-- A fila é exclusivamente operacional. Nem o destinatário lê ou modifica
-- tokens, tentativas ou respostas do provedor de push.

-- Segredo gerado dentro do banco para autenticar somente o cron no dispatcher.
-- Ele nunca aparece no repositório, no aplicativo ou na resposta da função.
create table public.push_dispatch_config (
  id boolean primary key default true check (id),
  secret text not null,
  created_at timestamptz not null default now()
);
alter table public.push_dispatch_config enable row level security;
revoke all on public.push_dispatch_config from public, anon, authenticated;
grant select on public.push_dispatch_config to service_role;
insert into public.push_dispatch_config (id, secret)
values (true, encode(extensions.gen_random_bytes(32), 'hex'));

create or replace function public.enqueue_notification_push()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notification_push_deliveries (notification_id, device_id)
  select new.id, d.id
  from public.push_devices d
  join public.profiles p on p.user_id = d.user_id
  where d.user_id = new.recipient_user_id
    and d.enabled
    and p.push_notifications;
  return new;
end;
$$;

revoke all on function public.enqueue_notification_push() from public, anon, authenticated;
create trigger notifications_enqueue_native_push
  after insert on public.notifications
  for each row execute function public.enqueue_notification_push();

create or replace function public.claim_notification_push_deliveries(p_limit integer default 100)
returns table (
  delivery_id uuid,
  device_id uuid,
  expo_push_token text,
  notification_id uuid,
  recipient_user_id uuid,
  title text,
  description text,
  destination text,
  attempt_count integer
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with candidates as (
    select q.id
    from public.notification_push_deliveries q
    join public.push_devices d on d.id = q.device_id and d.enabled
    where (
      (q.status = 'pending' and q.next_attempt_at <= now())
      or (q.status = 'processing' and q.updated_at < now() - interval '5 minutes')
    )
      and q.attempt_count < 5
    order by q.created_at
    for update of q skip locked
    limit least(greatest(p_limit, 1), 100)
  ), claimed as (
    update public.notification_push_deliveries q
    set status = 'processing', attempt_count = q.attempt_count + 1,
        updated_at = now(), last_error = null
    from candidates c
    where q.id = c.id
    returning q.id, q.device_id, q.notification_id
  )
  select c.id, c.device_id, d.expo_push_token, n.id,
         n.recipient_user_id, n.title, n.description, n.destination,
         q.attempt_count
  from claimed c
  join public.push_devices d on d.id = c.device_id
  join public.notifications n on n.id = c.notification_id
  join public.notification_push_deliveries q on q.id = c.id;
$$;

revoke all on function public.claim_notification_push_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_push_deliveries(integer) to service_role;

-- A execução é assíncrona e não interfere na transação de agendamento/vínculo.
-- A Edge Function só consome linhas já autorizadas e não aceita conteúdo do request.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'rotinae-native-push-dispatch',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://dgrnymniplveemkilcjr.supabase.co/functions/v1/send-push-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-rotinae-push-secret', (select secret from public.push_dispatch_config where id)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 25000
    );
  $$
);
