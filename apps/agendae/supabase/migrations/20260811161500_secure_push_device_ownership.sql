-- Impede que uma sessão autenticada tome posse de uma instalação ou token
-- pertencente a outra conta. Substitui apenas a RPC; a migration 1600 já foi
-- aplicada e permanece imutável no histórico.

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
  v_existing_user_id uuid;
begin
  if v_user_id is null then
    raise exception 'SESSION_REQUIRED' using errcode = '42501';
  end if;
  if p_installation_id is null or p_project_id is null
     or p_platform not in ('android', 'ios')
     or not (
       p_expo_push_token like 'ExponentPushToken[%]'
       or p_expo_push_token like 'ExpoPushToken[%]'
     ) then
    raise exception 'INVALID_PUSH_DEVICE' using errcode = '22023';
  end if;

  -- Bloqueia linhas conflitantes antes da escrita. Se a instalação já
  -- pertence a outra conta, conhecer seu UUID não concede transferência.
  select d.user_id into v_existing_user_id
  from public.push_devices d
  where d.installation_id = p_installation_id
  for update;

  if found and v_existing_user_id is distinct from v_user_id then
    raise exception 'PUSH_DEVICE_OWNERSHIP_CONFLICT' using errcode = '42501';
  end if;

  v_existing_user_id := null;
  select d.user_id into v_existing_user_id
  from public.push_devices d
  where d.expo_push_token = p_expo_push_token
  for update;

  if found and v_existing_user_id is distinct from v_user_id then
    raise exception 'PUSH_TOKEN_OWNERSHIP_CONFLICT' using errcode = '42501';
  end if;

  -- Rotação legítima: o mesmo usuário pode receber o token em uma nova
  -- instalação, removendo somente o registro antigo que ele próprio possui.
  delete from public.push_devices
  where user_id = v_user_id
    and expo_push_token = p_expo_push_token
    and installation_id is distinct from p_installation_id;

  insert into public.push_devices (
    user_id, installation_id, expo_push_token, platform, project_id,
    enabled, last_seen_at, updated_at
  ) values (
    v_user_id, p_installation_id, p_expo_push_token, p_platform, p_project_id,
    true, now(), now()
  )
  on conflict (installation_id) do update set
    expo_push_token = excluded.expo_push_token,
    platform = excluded.platform,
    project_id = excluded.project_id,
    enabled = true,
    last_seen_at = now(),
    updated_at = now()
  -- Defesa contra corrida: mesmo se a linha surgiu depois do SELECT, nunca
  -- atualize uma instalação pertencente a outra conta.
  where public.push_devices.user_id = v_user_id;

  if not found then
    raise exception 'PUSH_DEVICE_OWNERSHIP_CONFLICT' using errcode = '42501';
  end if;
exception
  when unique_violation then
    -- Uma corrida sobre token/instalação ausente pode chegar à constraint
    -- unique. Retorne falha neutra e jamais tente apagar a linha vencedora.
    raise exception 'PUSH_DEVICE_OWNERSHIP_CONFLICT' using errcode = '42501';
end;
$$;

revoke all on function public.register_push_device(uuid, text, text, uuid)
  from public, anon;
grant execute on function public.register_push_device(uuid, text, text, uuid)
  to authenticated;
