-- Pendencias financeiras acompanham a competencia consultada ate serem pagas.
--
-- Regras:
--   * uma cobranca aberta vencida em agosto tambem aparece em setembro;
--   * uma cobranca futura somente entra quando sua competencia for consultada;
--   * uma cobranca recebida aparece pelo mes real de `received_at`;
--   * o historico mensal mostra o saldo aberto acumulado ate cada mes ja
--     alcancado, sem somar o mesmo saldo mais de uma vez na visao geral.

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

create or replace function public.get_financial_monthly_history()
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_timezone text;
  v_current_month date;
  v_first_month date;
  v_last_month date;
  v_months jsonb;
begin
  select t.id, coalesce(t.timezone, 'America/Sao_Paulo')
    into v_tenant_id, v_timezone
  from public.tenants t
  where t.owner_user_id = auth.uid()
    and t.status = 'active'
  limit 1;

  if v_tenant_id is null then
    raise exception 'FORBIDDEN: active provider tenant not found' using errcode = '42501';
  end if;

  v_current_month := date_trunc('month', now() at time zone v_timezone)::date;

  with financial_dates as (
    select date_trunc('month', c.due_date)::date as month_start
    from public.manual_payments c
    where c.tenant_id = v_tenant_id
      and c.kind = 'charge'

    union all

    select date_trunc(
      'month',
      coalesce(p.received_at at time zone v_timezone, p.due_date::timestamp)
    )::date
    from public.manual_payments p
    where p.tenant_id = v_tenant_id
      and p.status = 'received'
  )
  select
    least(coalesce(min(month_start), v_current_month), v_current_month),
    greatest(coalesce(max(month_start), v_current_month), v_current_month)
    into v_first_month, v_last_month
  from financial_dates;

  with months as (
    select generate_series(v_first_month, v_last_month, interval '1 month')::date as month_start
  ),
  receipt_totals_by_charge as (
    select
      r.parent_payment_id,
      sum(r.value_cents)::bigint as received_cents
    from public.manual_payments r
    where r.tenant_id = v_tenant_id
      and r.kind = 'receipt'
      and r.status = 'received'
    group by r.parent_payment_id
  ),
  charge_months as (
    select
      date_trunc('month', c.due_date)::date as month_start,
      coalesce(sum(c.value_cents) filter (where c.status <> 'cancelled'), 0)::bigint as expected_cents,
      count(*) filter (where c.status <> 'cancelled')::integer as charge_count
    from public.manual_payments c
    where c.tenant_id = v_tenant_id
      and c.kind = 'charge'
    group by date_trunc('month', c.due_date)::date
  ),
  open_charges as (
    select
      c.id,
      c.due_date,
      greatest(c.value_cents - coalesce(receipts.received_cents, 0), 0)::bigint as balance_cents
    from public.manual_payments c
    left join receipt_totals_by_charge receipts on receipts.parent_payment_id = c.id
    where c.tenant_id = v_tenant_id
      and c.kind = 'charge'
      and c.status in ('pending', 'overdue')
      and c.value_cents - coalesce(receipts.received_cents, 0) > 0
  ),
  outstanding_months as (
    select
      months.month_start,
      coalesce(sum(open_charges.balance_cents), 0)::bigint as outstanding_cents,
      count(open_charges.id)::integer as outstanding_count
    from months
    left join open_charges on (
      (
        months.month_start <= v_current_month
        and open_charges.due_date < (months.month_start + interval '1 month')::date
      )
      or (
        months.month_start > v_current_month
        and open_charges.due_date >= months.month_start
        and open_charges.due_date < (months.month_start + interval '1 month')::date
      )
    )
    group by months.month_start
  ),
  received_entries as (
    select
      date_trunc(
        'month',
        coalesce(r.received_at at time zone v_timezone, r.due_date::timestamp)
      )::date as month_start,
      r.value_cents::bigint as value_cents
    from public.manual_payments r
    where r.tenant_id = v_tenant_id
      and r.kind = 'receipt'
      and r.status = 'received'

    union all

    select
      date_trunc(
        'month',
        coalesce(c.received_at at time zone v_timezone, c.due_date::timestamp)
      )::date as month_start,
      c.value_cents::bigint as value_cents
    from public.manual_payments c
    where c.tenant_id = v_tenant_id
      and c.kind = 'charge'
      and c.status = 'received'
      and not exists (
        select 1
        from public.manual_payments child
        where child.parent_payment_id = c.id
          and child.kind = 'receipt'
      )
  ),
  received_months as (
    select month_start, sum(value_cents)::bigint as received_cents
    from received_entries
    group by month_start
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'month', to_char(months.month_start, 'YYYY-MM'),
        'receivedTotalCents', coalesce(received.received_cents, 0),
        'expectedTotalCents', coalesce(charges.expected_cents, 0),
        'outstandingTotalCents', coalesce(outstanding.outstanding_cents, 0),
        'chargeCount', coalesce(charges.charge_count, 0),
        'outstandingCount', coalesce(outstanding.outstanding_count, 0)
      )
      order by months.month_start desc
    ),
    '[]'::jsonb
  )
    into v_months
  from months
  left join charge_months charges on charges.month_start = months.month_start
  left join outstanding_months outstanding on outstanding.month_start = months.month_start
  left join received_months received on received.month_start = months.month_start;

  return jsonb_build_object('months', v_months);
end;
$$;

revoke all on function public.get_financial_monthly_history() from public, anon, authenticated;
grant execute on function public.get_financial_monthly_history() to authenticated;

do $$
begin
  if to_regprocedure('public.list_manual_payments(integer,integer,text,text,text)') is null then
    raise exception 'list_manual_payments(integer,integer,text,text,text) was not created';
  end if;
  if to_regprocedure('public.get_financial_monthly_history()') is null then
    raise exception 'get_financial_monthly_history() was not created';
  end if;
end;
$$;
