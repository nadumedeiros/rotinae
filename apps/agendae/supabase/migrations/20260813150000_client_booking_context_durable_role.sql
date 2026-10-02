-- Corrige BLG-078 (BACKLOG.md, DEC-138/DEC-139): `get_client_booking_context`
-- (20260810230000, última reescrita em 20260813130000 para adicionar
-- `attendanceDays`) filtra o prestador do vínculo com
-- `join public.profiles p on p.user_id = t.owner_user_id and p.role = 'provider'`.
--
-- Desde 20260811140000 (multi_profile_roles, DEC-110), `profiles.role`/
-- `active_role` deixaram de ser um dado durável: passaram a espelhar apenas o
-- CONTEXTO ATIVO no momento (`switch_profile_role`), sempre sincronizados
-- entre si (`protect_active_profile_role`). A associação durável "esta
-- identidade É um Prestador" vive em `profile_roles`, não em `profiles.role`
-- — exatamente a distinção que `enforce_tenant_owner_is_provider` (mesma
-- migration 20260811140000) já usa corretamente.
--
-- Efeito do bug: se o dono do tenant estiver, no momento em que um CLIENTE
-- dele abre `app/client-booking.tsx`, com o contexto ativo trocado para
-- "client" (conta com os dois perfis), a junção não encontra nenhuma linha
-- para esse tenant e o vínculo simplesmente desaparece da lista — sem erro,
-- sem aviso. O cliente perde a opção de agendar com aquele prestador
-- enquanto a UI cai no fallback local `defaultProviderSchedule` de
-- `app/client-booking.tsx` (dias úteis fixos seg-sex), ignorando por completo
-- os dias de atendimento reais configurados pelo prestador (RN-AGD-025-029,
-- DEC-141/BLG-080) — o vínculo cliente<->prestador nunca deveria depender de
-- em qual contexto o prestador está navegando no momento.
--
-- Correção: mesma verificação já usada por `enforce_tenant_owner_is_provider`
-- — `exists` contra `profile_roles`, não contra `profiles.role`. `profiles p`
-- continua no `join` (sem a condição de role) apenas para obter
-- `display_name`; nenhuma outra linha da função muda. Mesma assinatura
-- (`p_month text`) e mesmo tipo de retorno (`jsonb`), então
-- `create or replace function` é suficiente aqui, como nas duas migrations
-- anteriores que já tocaram esta mesma função.
create or replace function public.get_client_booking_context(p_month text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;
  if p_month !~ '^\d{4}-\d{2}$' then
    raise exception 'INVALID_DATE_TIME: month must use YYYY-MM' using errcode = '22023';
  end if;

  v_start := (p_month || '-01T00:00:00Z')::timestamptz;
  v_end := v_start + interval '1 month';

  select coalesce(jsonb_agg(provider_row order by provider_row->>'providerName'), '[]'::jsonb)
    into v_result
  from (
    select jsonb_build_object(
      'tenantId', t.id,
      'providerId', t.owner_user_id,
      'providerName', coalesce(nullif(trim(p.display_name), ''), 'Prestador'),
      'profession', t.profession,
      'attendanceDays', coalesce(t.attendance_days, array[0,1,2,3,4,5,6]::smallint[]),
      'clientId', c.id,
      'primaryServiceId', c.primary_service_id,
      'timezone', coalesce(t.timezone, 'America/Sao_Paulo'),
      'workdayStart', coalesce(t.workday_start::text, '08:00:00'),
      'workdayEnd', coalesce(t.workday_end::text, '18:00:00'),
      'minimumAdvanceHours', coalesce(t.minimum_advance_hours, 0),
      'services', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'name', s.name, 'durationMinutes', s.duration_minutes,
          'referenceValueCents', s.reference_value_cents
        ) order by s.name)
        from public.services s where s.tenant_id = t.id and s.status = 'active'
      ), '[]'::jsonb),
      'blocks', coalesce((
        select jsonb_agg(jsonb_build_object('startsAt', b.starts_at, 'endsAt', b.ends_at))
        from public.availability_blocks b
        where b.tenant_id = t.id and b.starts_at < v_end and b.ends_at > v_start
      ), '[]'::jsonb),
      'occupiedStartsAt', coalesce((
        select jsonb_agg(a.starts_at order by a.starts_at)
        from public.appointments a
        where a.tenant_id = t.id and a.state = 'scheduled'
          and a.starts_at >= v_start and a.starts_at < v_end
      ), '[]'::jsonb)
    ) provider_row
    from public.provider_client_links l
    join public.tenants t on t.id = l.tenant_id
    join public.profiles p on p.user_id = t.owner_user_id
    join public.clients c on c.tenant_id = t.id and c.client_user_id = v_user and c.status = 'active'
    where l.client_user_id = v_user and l.status = 'active'
      and exists (
        select 1 from public.profile_roles pr
        where pr.user_id = t.owner_user_id and pr.role = 'provider'
      )
  ) linked;

  return v_result;
end;
$$;

revoke all on function public.get_client_booking_context(text) from public, anon;
grant execute on function public.get_client_booking_context(text) to authenticated;
