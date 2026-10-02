-- Feriados nacionais fixos e cálculo de dia útil (RN-AGD-004, RN-AGD-008,
-- RN-AGD-009; docs/REGRAS_DE_NEGOCIO_MVP.md; BACKLOG.md, DEC-073, BLG-050).
--
-- Função de SUPORTE para a futura implementação de `appointments` (RF-AGE):
-- esta migration NÃO cria nenhuma tabela de agendamento. `minimum_bookable_
-- instant` é o que vai bloquear criação/remarcação com antecedência
-- insuficiente quando esse schema existir (ver handoff de agenda, ainda não
-- escrito nesta data).
--
-- ============================================================================
-- DECISÃO PENDENTE — Carnaval, Sexta-feira Santa e Corpus Christi ficam de
-- fora, DE PROPÓSITO, não por esquecimento
-- ============================================================================
--
-- Esta tabela contém SOMENTE os 9 feriados nacionais de data fixa (mês/dia
-- recorrente, sem ano, sem algoritmo de Páscoa) sem nenhuma controvérsia
-- jurídica quanto à obrigatoriedade em todo o território nacional:
-- Confraternização Universal (1º/1), Tiradentes (21/4), Dia do Trabalho
-- (1º/5), Independência do Brasil (7/9), Nossa Senhora Aparecida (12/10),
-- Finados (2/11), Proclamação da República (15/11), Dia da Consciência
-- Negra (20/11, feriado nacional desde a Lei 14.759/2023, vigente a partir
-- de 2024) e Natal (25/12).
--
-- Carnaval e Sexta-feira Santa/Paixão de Cristo são pontos facultativos, não
-- feriados nacionais obrigatórios; Corpus Christi tem status não uniforme
-- entre municípios/estados. Os três dependem do cálculo da Páscoa (data
-- móvel), que esta migration deliberadamente NÃO implementa. Incluir
-- qualquer um deles aqui de forma unilateral bloquearia ou liberaria dias
-- úteis incorretamente para o negócio, sem decisão de produto/jurídico.
-- Registrado como PENDENTE em BACKLOG.md (BLG-050, DEC-073) — se o produto
-- decidir incluir esses feriados no futuro, isso deve ser uma migration
-- própria e aditiva, nunca uma alteração silenciosa desta.

-- ============================================================================
-- Tabela national_holidays
-- ============================================================================

create table if not exists public.national_holidays (
  id uuid primary key default gen_random_uuid(),
  month smallint not null check (month between 1 and 12),
  day smallint not null check (day between 1 and 31),
  name text not null constraint national_holidays_name_not_blank_check check (char_length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

-- Único índice necessário: garante que não existam dois feriados no mesmo
-- mês/dia e já serve de caminho de busca para `is_national_holiday`.
create unique index if not exists national_holidays_month_day_uk
  on public.national_holidays (month, day);

insert into public.national_holidays (month, day, name) values
  (1, 1, 'Confraternização Universal'),
  (4, 21, 'Tiradentes'),
  (5, 1, 'Dia do Trabalho'),
  (9, 7, 'Independência do Brasil'),
  (10, 12, 'Nossa Senhora Aparecida'),
  (11, 2, 'Finados'),
  (11, 15, 'Proclamação da República'),
  (11, 20, 'Dia da Consciência Negra'),
  (12, 25, 'Natal')
on conflict (month, day) do nothing;

-- ============================================================================
-- RLS — dado público de referência, ainda assim deny-by-default (DEC-022)
-- ============================================================================
--
-- Decisão: manter RLS habilitada com uma única policy de SELECT para
-- `authenticated` e `anon`, em vez de deixar a tabela sem RLS "protegida só
-- por grants". Duas razões: (1) consistência — toda tabela deste projeto
-- segue RLS deny-by-default (DEC-022); uma exceção "tabela sem RLS" criaria
-- um padrão paralelo fácil de copiar por engano para uma tabela que NÃO
-- deveria ser pública; (2) o modelo de privilégios padrão do Supabase já
-- concede DML de tabela a `anon`/`authenticated` — é a própria RLS que nega
-- por padrão neste projeto. Sem RLS aqui, qualquer usuário autenticado
-- poderia inserir/alterar/apagar feriados nacionais pela API. RLS habilitada
-- SEM nenhuma policy de INSERT/UPDATE/DELETE fecha essa porta
-- estruturalmente: só o papel de migração (dono da tabela, que ignora RLS)
-- escreve. `anon` também recebe SELECT porque o dado não é sensível e não
-- pertence a nenhum tenant — não há razão para exigir login só para ler um
-- calendário de feriados nacionais.
alter table public.national_holidays enable row level security;

create policy "national_holidays_select_all"
  on public.national_holidays for select
  to authenticated, anon
  using (true);

-- ============================================================================
-- is_national_holiday — verifica mês/dia, ignorando o ano (RN-AGD-009)
-- ============================================================================

create or replace function public.is_national_holiday(p_date date)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.national_holidays h
    where h.month = extract(month from p_date)::smallint
      and h.day = extract(day from p_date)::smallint
  );
$$;

-- Restrita a `authenticated`: apesar de a TABELA subjacente ser de leitura
-- pública (policy acima), esta função é insumo direto da lógica de
-- agendamento (ação que sempre exige sessão), não uma consulta de calendário
-- de propósito geral — por isso não estendemos a `anon`, diferente da
-- policy de SELECT da tabela.
revoke all on function public.is_national_holiday(date) from public, anon;
grant execute on function public.is_national_holiday(date) to authenticated;

-- ============================================================================
-- next_business_day — próximo dia útil ESTRITAMENTE posterior ao informado
-- ============================================================================
--
-- Segunda a sexta-feira, não feriado nacional fixo. Loop simples dia a dia:
-- o intervalo entre dois dias úteis nunca passa de poucos dias corridos (fim
-- de semana longo + no máximo um feriado fixo emendado), então não há
-- necessidade de uma consulta otimizada.

create or replace function public.next_business_day(p_date date)
returns date
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_candidate date := p_date + 1;
begin
  loop
    if extract(isodow from v_candidate) between 1 and 5
       and not public.is_national_holiday(v_candidate)
    then
      return v_candidate;
    end if;

    v_candidate := v_candidate + 1;
  end loop;
end;
$$;

revoke all on function public.next_business_day(date) from public, anon;
grant execute on function public.next_business_day(date) to authenticated;

-- ============================================================================
-- minimum_bookable_instant — RN-AGD-004 + RN-AGD-008 + RN-AGD-009 de ponta a
-- ponta
-- ============================================================================
--
-- RN-AGD-009: "um dia útil corresponderá ao MESMO horário do PRÓXIMO dia
-- entre segunda e sexta-feira que não seja feriado nacional". Se "amanhã" já
-- é um dia útil, o resultado é o PRÓPRIO amanhã — por isso NÃO chamamos
-- `next_business_day(amanhã)` diretamente (isso sempre pularia amanhã, já
-- que a função devolve um dia ESTRITAMENTE posterior ao argumento, mesmo
-- quando o argumento já seria válido). Comparamos amanhã primeiro e só
-- delegamos ao loop de `next_business_day` quando amanhã cai em fim de
-- semana ou feriado.
create or replace function public.minimum_bookable_instant(p_now timestamptz, p_timezone text)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_local_now timestamp := p_now at time zone p_timezone;
  v_tomorrow date := v_local_now::date + 1;
  v_target_date date;
begin
  if extract(isodow from v_tomorrow) between 1 and 5
     and not public.is_national_holiday(v_tomorrow)
  then
    v_target_date := v_tomorrow;
  else
    v_target_date := public.next_business_day(v_tomorrow);
  end if;

  -- Preserva o horário civil de p_now (v_local_now::time) e converte de
  -- volta ao fuso do tenant: `date + time` produz um `timestamp` (sem fuso),
  -- e `timestamp at time zone p_timezone` o reinterpreta como horário local
  -- naquele fuso, devolvendo o `timestamptz` correspondente.
  return (v_target_date + v_local_now::time) at time zone p_timezone;
end;
$$;

revoke all on function public.minimum_bookable_instant(timestamptz, text) from public, anon;
grant execute on function public.minimum_bookable_instant(timestamptz, text) to authenticated;

-- ============================================================================
-- Testes executados na própria migration — falha a aplicação (ROLLBACK) se
-- qualquer ASSERT quebrar. Datas reais, verificadas manualmente com
-- `date -d '<data>' +%A` (calendário gregoriano) antes de escrever cada
-- caso; o raciocínio de cada um está comentado ao lado.
-- ============================================================================

do $$
declare
  v_date date;
  v_ts timestamptz;
begin
  -- Verificação estrutural da decisão pendente registrada acima: exatamente
  -- os 9 feriados fixos sem controvérsia, nem um a mais (Carnaval,
  -- Sexta-feira Santa e Corpus Christi de fora).
  assert (select count(*) from public.national_holidays) = 9,
    'national_holidays deveria ter exatamente 9 linhas (os 9 feriados fixos sem controvérsia; Carnaval/Sexta-feira Santa/Corpus Christi ficam de fora por decisão pendente, DEC-073/BLG-050)';

  -- is_national_holiday ignora o ano: 1º de janeiro é feriado em qualquer ano.
  assert public.is_national_holiday('2026-01-01'::date),
    '1º de janeiro de 2026 deveria ser feriado nacional (Confraternização Universal)';

  assert public.is_national_holiday('2030-01-01'::date),
    'is_national_holiday deveria ignorar o ano: 1º de janeiro de 2030 também é feriado (mesmo mês/dia)';

  -- 2026-09-08 é uma terça-feira comum (verificado: date -d 2026-09-08 =>
  -- Tuesday), sem nenhum feriado fixo associado a essa combinação de mês/dia.
  assert not public.is_national_holiday('2026-09-08'::date),
    '2026-09-08 não deveria ser feriado nacional';

  -- next_business_day: 2026-09-04 é sexta-feira (verificado: date -d
  -- 2026-09-04 => Friday). Sábado 09-05 e domingo 09-06 são fim de semana;
  -- segunda-feira 09-07 é a Independência do Brasil (feriado fixo, 7 de
  -- setembro). O próximo dia útil estritamente posterior à sexta é,
  -- portanto, terça-feira 2026-09-08 — pulando fim de semana E o feriado.
  v_date := public.next_business_day('2026-09-04'::date);
  assert v_date = '2026-09-08'::date,
    format('next_business_day(2026-09-04) deveria ser 2026-09-08, foi %s', v_date);

  -- next_business_day não quebra na virada de ano: 2027-12-31 é sexta-feira
  -- (verificado: date -d 2027-12-31 => Friday). 2028-01-01 (sábado, que
  -- também é feriado fixo por coincidir com 1º de janeiro) e 2028-01-02
  -- (domingo) são pulados; 2028-01-03 (segunda-feira, verificado Monday) não
  -- é feriado -> primeiro dia útil, já no ano civil seguinte.
  v_date := public.next_business_day('2027-12-31'::date);
  assert v_date = '2028-01-03'::date,
    format('next_business_day(2027-12-31) deveria ser 2028-01-03, foi %s', v_date);

  -- minimum_bookable_instant: segunda-feira comum. 2026-08-10 é segunda-feira
  -- (verificado Monday) às 14:30 no fuso America/Sao_Paulo (-03, sem horário
  -- de verão desde 2019). Amanhã (2026-08-11, terça-feira, verificado
  -- Tuesday) já é dia útil e não é feriado -> a antecedência mínima de um
  -- dia útil (RN-AGD-004) cai no PRÓPRIO amanhã, no mesmo horário civil
  -- (RN-AGD-009), sem avançar além disso.
  v_ts := public.minimum_bookable_instant('2026-08-10 14:30:00-03'::timestamptz, 'America/Sao_Paulo');
  assert v_ts = '2026-08-11 14:30:00-03'::timestamptz,
    format('minimum_bookable_instant(segunda comum, 2026-08-10 14:30 America/Sao_Paulo) deveria ser 2026-08-11 14:30, foi %s', v_ts);

  -- minimum_bookable_instant: sexta-feira antes de feriado fixo. 2026-09-04
  -- é sexta-feira às 09:00 no fuso America/Sao_Paulo. Amanhã seria sábado
  -- 2026-09-05 (fim de semana, não é dia útil) -> avança dia a dia: domingo
  -- 09-06 (fim de semana), segunda 09-07 (feriado fixo, Independência do
  -- Brasil) -> o primeiro dia útil é terça 2026-09-08, no mesmo horário
  -- civil 09:00 — pulando corretamente fim de semana E o feriado.
  v_ts := public.minimum_bookable_instant('2026-09-04 09:00:00-03'::timestamptz, 'America/Sao_Paulo');
  assert v_ts = '2026-09-08 09:00:00-03'::timestamptz,
    format('minimum_bookable_instant(sexta antes do feriado de 07/09, 2026-09-04 09:00 America/Sao_Paulo) deveria ser 2026-09-08 09:00, foi %s', v_ts);

  raise notice 'national_holidays / dia útil (RN-AGD-004/008/009): todos os 7 asserts passaram.';
end $$;
