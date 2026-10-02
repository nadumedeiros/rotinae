-- Produtores transacionais para vínculo e adição de perfil. O cliente nunca
-- recebe permissão de INSERT em notifications; os eventos nascem da mesma
-- transação que altera o estado de domínio.

alter table public.notifications
  drop constraint if exists notifications_destination_check;
alter table public.notifications
  add constraint notifications_destination_check check (
    destination in ('/agenda', '/clients', '/client-booking', '/client-providers', '/payments', '/settings', '/switch-profile')
  );

alter table public.notifications add column if not exists producer_key text;
create unique index if not exists notifications_producer_key_uk
  on public.notifications(producer_key) where producer_key is not null;

-- A função nasceu antes de producer_key existir. Inclua a nova coluna na
-- fronteira de imutabilidade também para escritas privilegiadas (triggers
-- continuam valendo para service_role/owners, mesmo quando a RLS é ignorada).
create or replace function public.notifications_read_state_only()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
    or new.recipient_user_id is distinct from old.recipient_user_id
    or new.tenant_id is distinct from old.tenant_id
    or new.type is distinct from old.type
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.destination is distinct from old.destination
    or new.producer_key is distinct from old.producer_key
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

-- Defesa adicional à trigger de imutabilidade: o destinatário só recebe
-- privilégio SQL para mudar read_at, nunca conteúdo ou chave idempotente.
revoke update on public.notifications from authenticated;
grant update(read_at) on public.notifications to authenticated;

create or replace function public.notify_provider_client_link_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider_user_id uuid;
  v_tenant_name text;
  v_actor uuid := auth.uid();
begin
  select t.owner_user_id, t.display_name
    into v_provider_user_id, v_tenant_name
  from public.tenants t
  where t.id = new.tenant_id;

  if v_provider_user_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' and new.status = 'pending' then
    insert into public.notifications (
      recipient_user_id, tenant_id, type, title, description, destination, producer_key
    ) values (
      v_provider_user_id,
      new.tenant_id,
      'link',
      'Nova solicitação de vínculo',
      'Um cliente resgatou seu código e aguarda sua decisão.',
      '/clients',
      'link:' || new.id || ':pending:provider'
    ) on conflict (producer_key) where producer_key is not null do nothing;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'active' then
      insert into public.notifications (
        recipient_user_id, tenant_id, type, title, description, destination, producer_key
      ) values (
        new.client_user_id,
        new.tenant_id,
        'link',
        'Vínculo aprovado',
        format('Seu vínculo com %s foi aprovado.', v_tenant_name),
        '/client-providers',
        'link:' || new.id || ':active:client'
      ) on conflict (producer_key) where producer_key is not null do nothing;
    elsif new.status = 'rejected' then
      insert into public.notifications (
        recipient_user_id, tenant_id, type, title, description, destination, producer_key
      ) values (
        new.client_user_id,
        new.tenant_id,
        'link',
        'Solicitação não aprovada',
        format('%s não aprovou esta solicitação de vínculo.', v_tenant_name),
        '/client-providers',
        'link:' || new.id || ':rejected:client'
      ) on conflict (producer_key) where producer_key is not null do nothing;
    elsif new.status = 'revoked' then
      -- Informa a outra parte. Em alteração administrativa, informa ambas.
      if v_actor is distinct from new.client_user_id then
        insert into public.notifications (
          recipient_user_id, tenant_id, type, title, description, destination, producer_key
        ) values (
          new.client_user_id,
          new.tenant_id,
          'link',
          'Vínculo encerrado',
          format('Seu vínculo com %s foi encerrado.', v_tenant_name),
          '/client-providers',
          'link:' || new.id || ':revoked:client'
        ) on conflict (producer_key) where producer_key is not null do nothing;
      end if;
      if v_actor is distinct from v_provider_user_id then
        insert into public.notifications (
          recipient_user_id, tenant_id, type, title, description, destination, producer_key
        ) values (
          v_provider_user_id,
          new.tenant_id,
          'link',
          'Vínculo encerrado',
          'Um cliente não está mais vinculado ao seu perfil.',
          '/clients',
          'link:' || new.id || ':revoked:provider'
        ) on conflict (producer_key) where producer_key is not null do nothing;
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.notify_provider_client_link_change() from public, anon, authenticated;

drop trigger if exists provider_client_links_notify_change on public.provider_client_links;
create trigger provider_client_links_notify_change
  after insert or update of status on public.provider_client_links
  for each row execute function public.notify_provider_client_link_change();

create or replace function public.notify_added_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- O primeiro papel nasce com a conta e não é uma "adição". A notificação
  -- existe somente quando a identidade passa a possuir os dois perfis.
  if (select count(*) from public.profile_roles where user_id = new.user_id) > 1 then
    insert into public.notifications (
      recipient_user_id, type, title, description, destination, producer_key
    ) values (
      new.user_id,
      'account',
      case new.role when 'provider' then 'Perfil Prestador adicionado' else 'Perfil Cliente adicionado' end,
      case new.role
        when 'provider' then 'Seu perfil Prestador está pronto. Você já pode alternar para gerenciar sua rotina.'
        else 'Seu perfil Cliente está pronto. Você já pode alternar para acompanhar seus atendimentos.'
      end,
      '/switch-profile',
      'profile-role:' || new.user_id || ':' || new.role
    ) on conflict (producer_key) where producer_key is not null do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.notify_added_profile_role() from public, anon, authenticated;

drop trigger if exists profile_roles_notify_added on public.profile_roles;
create trigger profile_roles_notify_added
  after insert on public.profile_roles
  for each row execute function public.notify_added_profile_role();

-- ============================================================================
-- Agendamentos: todos os produtores rodam AFTER na mesma transação da RPC.
-- O destinatário é sempre derivado de tenants/clients; nunca vem do payload.
-- ============================================================================

create or replace function public.notify_appointment_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider_user_id uuid;
  v_client_user_id uuid;
  v_actor uuid := auth.uid();
  v_client_destination text := '/client-booking';
  v_provider_destination text := '/agenda';
  v_version text;
begin
  select t.owner_user_id into v_provider_user_id
  from public.tenants t where t.id = new.tenant_id;

  select c.client_user_id into v_client_user_id
  from public.clients c where c.id = new.client_id;

  -- updated_at é materializado pelo trigger BEFORE UPDATE e permite várias
  -- remarcações legítimas, mantendo retries do mesmo evento idempotentes.
  v_version := to_char(coalesce(new.updated_at, new.created_at), 'YYYYMMDDHH24MISSUS');

  if tg_op = 'INSERT' then
    if v_actor is distinct from v_provider_user_id and v_provider_user_id is not null then
      insert into public.notifications (
        recipient_user_id, tenant_id, type, title, description, destination, producer_key
      ) values (
        v_provider_user_id, new.tenant_id, 'appointment',
        'Nova solicitação de agendamento',
        'Um cliente solicitou um novo horário na sua agenda.',
        v_provider_destination,
        'appointment:' || new.id || ':created:provider'
      ) on conflict (producer_key) where producer_key is not null do nothing;
    elsif v_client_user_id is not null and v_actor is distinct from v_client_user_id then
      insert into public.notifications (
        recipient_user_id, tenant_id, type, title, description, destination, producer_key
      ) values (
        v_client_user_id, new.tenant_id, 'appointment',
        'Novo agendamento',
        'Um novo atendimento foi incluído na sua agenda.',
        v_client_destination,
        'appointment:' || new.id || ':created:client'
      ) on conflict (producer_key) where producer_key is not null do nothing;
    end if;
    return new;
  end if;

  -- Confirmação é uma transição única pending -> confirmed. A outra parte é
  -- notificada; em execução administrativa sem ator reconhecido, ambas são.
  if old.confirmation_status is distinct from new.confirmation_status
     and new.confirmation_status = 'confirmed' then
    if v_actor is distinct from v_provider_user_id and v_provider_user_id is not null then
      insert into public.notifications (recipient_user_id, tenant_id, type, title, description, destination, producer_key)
      values (v_provider_user_id, new.tenant_id, 'appointment', 'Agendamento confirmado',
        'O cliente confirmou o atendimento.', v_provider_destination,
        'appointment:' || new.id || ':confirmed:provider')
      on conflict (producer_key) where producer_key is not null do nothing;
    end if;
    if v_client_user_id is not null and v_actor is distinct from v_client_user_id then
      insert into public.notifications (recipient_user_id, tenant_id, type, title, description, destination, producer_key)
      values (v_client_user_id, new.tenant_id, 'appointment', 'Agendamento confirmado',
        'Seu atendimento foi confirmado pelo prestador.', v_client_destination,
        'appointment:' || new.id || ':confirmed:client')
      on conflict (producer_key) where producer_key is not null do nothing;
    end if;
  end if;

  if old.starts_at is distinct from new.starts_at
     or old.duration_minutes is distinct from new.duration_minutes then
    if v_actor is distinct from v_provider_user_id and v_provider_user_id is not null then
      insert into public.notifications (recipient_user_id, tenant_id, type, title, description, destination, producer_key)
      values (v_provider_user_id, new.tenant_id, 'appointment', 'Agendamento remarcado',
        'Um cliente alterou o horário de um atendimento.', v_provider_destination,
        'appointment:' || new.id || ':rescheduled:' || v_version || ':provider')
      on conflict (producer_key) where producer_key is not null do nothing;
    end if;
    if v_client_user_id is not null and v_actor is distinct from v_client_user_id then
      insert into public.notifications (recipient_user_id, tenant_id, type, title, description, destination, producer_key)
      values (v_client_user_id, new.tenant_id, 'appointment', 'Agendamento remarcado',
        'O prestador alterou o horário do seu atendimento.', v_client_destination,
        'appointment:' || new.id || ':rescheduled:' || v_version || ':client')
      on conflict (producer_key) where producer_key is not null do nothing;
    end if;
  end if;

  if old.state is distinct from new.state then
    if new.state = 'cancelled' then
      if new.cancelled_by = 'client' and v_provider_user_id is not null then
        insert into public.notifications (recipient_user_id, tenant_id, type, title, description, destination, producer_key)
        values (v_provider_user_id, new.tenant_id, 'appointment', 'Agendamento cancelado',
          'O cliente cancelou um atendimento.', v_provider_destination,
          'appointment:' || new.id || ':cancelled:provider')
        on conflict (producer_key) where producer_key is not null do nothing;
      elsif new.cancelled_by = 'provider' and v_client_user_id is not null then
        insert into public.notifications (recipient_user_id, tenant_id, type, title, description, destination, producer_key)
        values (v_client_user_id, new.tenant_id, 'appointment', 'Agendamento cancelado',
          'O prestador cancelou seu atendimento.', v_client_destination,
          'appointment:' || new.id || ':cancelled:client')
        on conflict (producer_key) where producer_key is not null do nothing;
      end if;
    elsif new.state = 'completed' and v_client_user_id is not null then
      insert into public.notifications (recipient_user_id, tenant_id, type, title, description, destination, producer_key)
      values (v_client_user_id, new.tenant_id, 'appointment', 'Atendimento concluído',
        'Seu atendimento foi marcado como concluído.', v_client_destination,
        'appointment:' || new.id || ':completed:client')
      on conflict (producer_key) where producer_key is not null do nothing;
    elsif new.state = 'no_show' and v_client_user_id is not null then
      insert into public.notifications (recipient_user_id, tenant_id, type, title, description, destination, producer_key)
      values (v_client_user_id, new.tenant_id, 'appointment', 'Ausência registrada',
        'O prestador registrou ausência neste atendimento.', v_client_destination,
        'appointment:' || new.id || ':no-show:client')
      on conflict (producer_key) where producer_key is not null do nothing;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.notify_appointment_change() from public, anon, authenticated;

drop trigger if exists appointments_notify_change on public.appointments;
create trigger appointments_notify_change
  after insert or update of state, confirmation_status, starts_at, duration_minutes
  on public.appointments
  for each row execute function public.notify_appointment_change();
