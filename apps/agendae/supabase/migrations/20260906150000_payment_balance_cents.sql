-- BUG relatado pelo usuário, 06/09/2026: uma cobrança (`kind='charge'`) de
-- R$500 com um pagamento parcial de R$250 registrado em setembro (via
-- `register_manual_partial_payment`, que cria um `receipt` filho) continua
-- `pending`/`overdue` com saldo de R$250 em aberto. O mecanismo de carryover
-- (`20260903130000_financial_pending_carryover.sql`) já traz corretamente
-- essa cobrança de volta na tabela principal (`app/payments.tsx`) enquanto
-- ela seguir aberta — isso está certo e não muda aqui. O problema é que a
-- coluna "Valor" da tabela lê `value_cents`, que por decisão de arquitetura
-- (`20260823130000_manual_payments_receipt_history.sql`) representa sempre o
-- TOTAL ORIGINAL da cobrança, imutável por recebimentos parciais — então a
-- tabela mostra R$500 quando o usuário espera ver o saldo ainda em aberto
-- (R$250).
--
-- `value_cents` não muda: continua o total original, do jeito que a
-- migration de 23/08 corrigiu de propósito. Em vez disso, esta migration
-- adiciona um campo NOVO e computado, `balance_cents`, ao lado de
-- `value_cents` em cada item retornado por `list_manual_payments` — mesmo
-- cálculo de saldo já usado em `get_manual_payment_history` e em
-- `pendingTotalCents`/`open_charges` (dentro de `get_financial_monthly_history`)
-- nesta mesma função: total da cobrança menos a soma dos `receipt` filhos já
-- `received`, nunca negativo.
--
-- Observação para quem consumir este campo: `balance_cents` só é calculado a
-- partir dos `receipt` filhos. Para uma cobrança quitada via troca direta de
-- status (`status='received'` sem nenhum `receipt` filho — fluxo de
-- "Recebimento total"), `balance_cents` resulta no valor total, não em zero.
-- Isso é consistente com o restante da função (`pendingTotalCents` e
-- `pendingCount` já filtram por `status in ('pending','overdue')` antes de
-- aplicar essa mesma conta) — cabe a quem consome a lista decidir, a partir
-- do `status` da linha, se deve exibir `balance_cents` ou `value_cents`.

create or replace function public.list_manual_payments(
  p_page integer default 1,
  p_page_size integer default 10,
  p_period text default null,
  p_status text default null,
  p_query text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := coalesce(p_page_size, 10);
  v_period_start date;
  v_period_end date;
  v_current_month date;
  v_timezone text;
  v_total integer;
  v_items jsonb;
  v_summary jsonb;
begin
  if v_page_size not in (5, 10) then
    raise exception 'PAYMENT_PAGE_SIZE_INVALID: page size must be 5 or 10'
      using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('pending', 'received', 'overdue', 'cancelled') then
    raise exception 'PAYMENT_STATUS_INVALID: invalid status' using errcode = '22023';
  end if;
  if p_period is not null and p_period !~ '^\d{4}(-\d{2})?$' then
    raise exception 'PAYMENT_PERIOD_INVALID: period must be YYYY or YYYY-MM' using errcode = '22023';
  end if;

  select coalesce(t.timezone, 'America/Sao_Paulo')
    into v_timezone
  from public.tenants t
  where t.owner_user_id = auth.uid()
    and t.status = 'active'
  limit 1;

  v_timezone := coalesce(v_timezone, 'America/Sao_Paulo');
  v_current_month := date_trunc('month', now() at time zone v_timezone)::date;

  if length(coalesce(p_period, '')) = 4 then
    v_period_start := make_date(p_period::integer, 1, 1);
    v_period_end := (v_period_start + interval '1 year')::date;
  elsif length(coalesce(p_period, '')) = 7 then
    v_period_start := to_date(p_period || '-01', 'YYYY-MM-DD');
    if to_char(v_period_start, 'YYYY-MM') <> p_period then
      raise exception 'PAYMENT_PERIOD_INVALID: invalid month' using errcode = '22023';
    end if;
    v_period_end := (v_period_start + interval '1 month')::date;
  end if;

  with eligible_payments as (
    select payment.*, client.name as client_name
    from public.manual_payments payment
    join public.clients client on client.id = payment.client_id
    where payment.kind = 'charge'
      and (
        v_period_start is null
        or (
          payment.status in ('pending', 'overdue')
          and payment.due_date < v_period_end
          and (v_period_start <= v_current_month or payment.due_date >= v_period_start)
        )
        or (
          payment.status = 'received'
          and coalesce(
            (payment.received_at at time zone v_timezone)::date,
            payment.due_date
          ) >= v_period_start
          and coalesce(
            (payment.received_at at time zone v_timezone)::date,
            payment.due_date
          ) < v_period_end
        )
        or (
          payment.status = 'cancelled'
          and payment.due_date >= v_period_start
          and payment.due_date < v_period_end
        )
      )
      and (p_status is null or payment.status = p_status)
      and (
        nullif(btrim(p_query), '') is null
        or payment.origin ilike '%' || btrim(p_query) || '%'
        or client.name ilike '%' || btrim(p_query) || '%'
      )
  )
  select count(*)::integer
    into v_total
  from eligible_payments;

  with eligible_payments as (
    select payment.*, client.name as client_name
    from public.manual_payments payment
    join public.clients client on client.id = payment.client_id
    where payment.kind = 'charge'
      and (
        v_period_start is null
        or (
          payment.status in ('pending', 'overdue')
          and payment.due_date < v_period_end
          and (v_period_start <= v_current_month or payment.due_date >= v_period_start)
        )
        or (
          payment.status = 'received'
          and coalesce(
            (payment.received_at at time zone v_timezone)::date,
            payment.due_date
          ) >= v_period_start
          and coalesce(
            (payment.received_at at time zone v_timezone)::date,
            payment.due_date
          ) < v_period_end
        )
        or (
          payment.status = 'cancelled'
          and payment.due_date >= v_period_start
          and payment.due_date < v_period_end
        )
      )
      and (p_status is null or payment.status = p_status)
      and (
        nullif(btrim(p_query), '') is null
        or payment.origin ilike '%' || btrim(p_query) || '%'
        or client.name ilike '%' || btrim(p_query) || '%'
      )
  )
  select coalesce(jsonb_agg(row_data order by sort_date desc, created_at desc), '[]'::jsonb)
    into v_items
  from (
    select
      to_jsonb(payment) - 'client_name' || jsonb_build_object(
        'client_name', payment.client_name,
        'has_receipt', exists (
          select 1
          from public.manual_payments receipt
          where receipt.parent_payment_id = payment.id
            and receipt.kind = 'receipt'
        ),
        'balance_cents', greatest(
          payment.value_cents - coalesce((
            select sum(r.value_cents)
            from public.manual_payments r
            where r.parent_payment_id = payment.id
              and r.kind = 'receipt'
              and r.status = 'received'
          ), 0),
          0
        )
      ) as row_data,
      case
        when payment.status = 'received'
          then coalesce((payment.received_at at time zone v_timezone)::date, payment.due_date)
        else payment.due_date
      end as sort_date,
      payment.created_at
    from eligible_payments payment
    order by sort_date desc, payment.created_at desc
    offset (v_page - 1) * v_page_size
    limit v_page_size
  ) page_rows;

  select jsonb_build_object(
    'receivedTotalCents',
      coalesce((
        select sum(r.value_cents)
        from public.manual_payments r
        where r.kind = 'receipt'
          and r.status = 'received'
          and (
            v_period_start is null
            or (
              coalesce((r.received_at at time zone v_timezone)::date, r.due_date) >= v_period_start
              and coalesce((r.received_at at time zone v_timezone)::date, r.due_date) < v_period_end
            )
          )
      ), 0)
      + coalesce((
        select sum(c.value_cents)
        from public.manual_payments c
        where c.kind = 'charge'
          and c.status = 'received'
          and not exists (
            select 1
            from public.manual_payments cr
            where cr.parent_payment_id = c.id
              and cr.kind = 'receipt'
          )
          and (
            v_period_start is null
            or (
              coalesce((c.received_at at time zone v_timezone)::date, c.due_date) >= v_period_start
              and coalesce((c.received_at at time zone v_timezone)::date, c.due_date) < v_period_end
            )
          )
      ), 0),
    'pendingTotalCents',
      coalesce((
        select sum(
          greatest(
            c.value_cents - coalesce((
              select sum(cr.value_cents)
              from public.manual_payments cr
              where cr.parent_payment_id = c.id
                and cr.kind = 'receipt'
                and cr.status = 'received'
            ), 0),
            0
          )
        )
        from public.manual_payments c
        where c.kind = 'charge'
          and c.status in ('pending', 'overdue')
          and (
            v_period_start is null
            or (
              c.due_date < v_period_end
              and (v_period_start <= v_current_month or c.due_date >= v_period_start)
            )
          )
      ), 0),
    'pendingCount',
      (
        select count(*)
        from public.manual_payments c
        where c.kind = 'charge'
          and c.status in ('pending', 'overdue')
          and c.value_cents - coalesce((
            select sum(cr.value_cents)
            from public.manual_payments cr
            where cr.parent_payment_id = c.id
              and cr.kind = 'receipt'
              and cr.status = 'received'
          ), 0) > 0
          and (
            v_period_start is null
            or (
              c.due_date < v_period_end
              and (v_period_start <= v_current_month or c.due_date >= v_period_start)
            )
          )
      )
  )
    into v_summary;

  return jsonb_build_object(
    'items', v_items,
    'page', v_page,
    'pageSize', v_page_size,
    'totalItems', v_total,
    'totalPages', greatest(1, ceil(v_total::numeric / v_page_size)::integer),
    'summary', v_summary
  );
end;
$$;

revoke all on function public.list_manual_payments(integer, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.list_manual_payments(integer, integer, text, text, text)
  to authenticated;

-- ============================================================================
-- Verificação estrutural (mesmo padrão de 20260906130000/20260906140000)
-- ============================================================================

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'list_manual_payments';

  assert v_definition like '%''balance_cents''%',
    'list_manual_payments deveria retornar balance_cents (saldo ainda em aberto) por item';
  assert v_definition like '%value_cents - coalesce((%',
    'list_manual_payments deveria calcular balance_cents como total menos recibos recebidos';

  assert has_function_privilege('authenticated', 'public.list_manual_payments(integer,integer,text,text,text)', 'execute'),
    'authenticated deveria poder executar list_manual_payments';
  assert not has_function_privilege('anon', 'public.list_manual_payments(integer,integer,text,text,text)', 'execute'),
    'anon nunca deveria poder executar list_manual_payments';
end;
$$;
