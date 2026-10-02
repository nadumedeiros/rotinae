-- ============================================================================
-- Lançamento financeiro automático ao vincular serviço + valor a um cliente
-- (DEC-164)
-- ============================================================================
--
-- REQUISITO (decisão de produto já fechada com o usuário, sessão de
-- 25/08/2026): quando um cliente é cadastrado ou editado com
-- `primary_service_id` + `service_value_cents` definidos (> 0), deve nascer
-- automaticamente um lançamento em `manual_payments` (Cliente + Serviço +
-- Valor + Status), sem exigir que o prestador registre manualmente o mesmo
-- pagamento na tela Financeiro.
--
-- ============================================================================
-- DECISÃO DE ARQUITETURA — trigger de banco em `clients`, não orquestração em
-- código de aplicação
-- ============================================================================
--
-- Duas abordagens foram avaliadas:
-- (a) Trigger `after insert or update` em `public.clients`, criando a linha
--     em `manual_payments` na mesma transação da escrita do cliente.
-- (b) Orquestrar em `SupabaseClientPortfolioAdapter.createClient`/
--     `updateClient`: depois de gravar o cliente, chamar
--     `paymentService.createPayment(...)` como uma segunda operação de rede.
--
-- Escolhida (a), pelos mesmos motivos que já levaram este projeto a colocar
-- lógica sensível em RPC/trigger em vez de código de aplicação (ver
-- `register_manual_partial_payment`, `prevent_cancelling_payment_with_receipts`,
-- `enforce_client_primary_service_tenant`):
-- 1. Atomicidade: (b) cria uma janela real onde o cliente é gravado com
--    sucesso mas a criação do lançamento financeiro falha (rede, RLS,
--    validação) — o app teria que implementar sua própria lógica de
--    compensação/retry para um caso que (a) simplesmente não permite
--    acontecer (mesma transação, ou os dois efeitos ocorrem, ou nenhum).
-- 2. Superfície única: qualquer caminho de escrita futuro em `clients`
--    (import em lote, uma RPC administrativa, um script de suporte) herda a
--    regra automaticamente. Com (b), CADA chamador de `createClient`/
--    `updateClient` no app precisaria lembrar de chamar o lançamento
--    financeiro goal explicitamente — um contrato implícito fácil de
--    esquecer, e exatamente o tipo de acoplamento silencioso que já causou
--    bugs anteriores neste projeto (ex.: `get_provider_dashboard_snapshot`
--    referenciando uma coluna que nunca existiu, 20260823130000).
-- 3. `manual_payments_owner_all` já garante que o `client_id` referenciado
--    pertence ao mesmo tenant do pagamento (RLS `with check`, mesma tabela
--    que teria que ser validada em (b) de qualquer forma) — o trigger não
--    precisa atravessar RLS (roda `security invoker`, mesmo raciocínio já
--    documentado em `register_manual_partial_payment`): o `INSERT`/`UPDATE`
--    em `clients` já foi autorizado pelas policies de `clients` (dono do
--    tenant), e o `INSERT` subsequente em `manual_payments` acontece na MESMA
--    sessão/`auth.uid()`, então `manual_payments_owner_all` autoriza pelo
--    mesmo motivo que autorizaria um lançamento manual feito por essa mesma
--    conta.
--
-- ============================================================================
-- QUANDO o lançamento nasce (evita duplicar em edição trivial)
-- ============================================================================
--
-- Dois triggers separados apontam para a mesma função — não é possível usar
-- uma única `WHEN` clause comparando OLD/NEW num trigger que também dispara
-- em INSERT (OLD não existe nesse evento):
-- 1. `after insert` — dispara sempre que `primary_service_id is not null` e
--    `service_value_cents > 0` no INSERT (cliente já nasce vinculado a um
--    serviço com preço).
-- 2. `after update of primary_service_id, service_value_cents`, com `when
--    (old.primary_service_id is distinct from new.primary_service_id or
--    old.service_value_cents is distinct from new.service_value_cents)` —
--    a cláusula `of` já restringe o disparo a UPDATEs que TOQUEM essas
--    colunas (edições de nome/telefone/status/política de agendamento nunca
--    disparam este trigger); o `when` é uma segunda camada defensiva para o
--    caso de um chamador futuro reenviar explicitamente o mesmo valor já
--    vigente dentro do `SET` (ex.: um formulário que sempre envia o objeto
--    inteiro) — nesse caso `is distinct from` é falso e nenhum lançamento
--    novo é criado. Resultado combinado: editar nome/telefone/status/limites
--    de agendamento NUNCA cria um lançamento novo; mudar o serviço vinculado
--    OU o valor do serviço SEMPRE cria (ver decisão seguinte sobre por quê
--    "sempre cria" em vez de "atualiza o lançamento pendente existente").
--
-- ============================================================================
-- DECISÃO — mudar serviço/valor cria um NOVO lançamento, não edita um
-- lançamento automático anterior
-- ============================================================================
--
-- Alternativa considerada: ao detectar uma mudança de
-- `primary_service_id`/`service_value_cents`, localizar um lançamento
-- automático `pending` anterior deste cliente e fazer `UPDATE` nele em vez de
-- `INSERT` de um novo. Descartada porque exigiria decidir "qual lançamento
-- pendente é o automático" sem nenhuma coluna hoje que distinga um
-- lançamento gerado por este trigger de um lançamento manual do prestador
-- para o mesmo cliente/serviço (`manual_payments` não tem hoje um marcador
-- de origem) — sobrescrever o lançamento errado seria pior que duplicar.
-- Além disso, o próprio projeto já trata mudança de valor/serviço como um
-- evento que merece registro próprio, não uma edição silenciosa (mesma
-- filosofia de `manual_payments_value_history`, 20260811120000: preservar o
-- que existia antes em vez de sobrescrever). Se essa duplicação se mostrar um
-- problema real de uso (prestador editando o valor do serviço repetidamente
-- e acumulando cobranças pendentes), a evolução recomendada é adicionar uma
-- coluna `manual_payments.auto_generated_for_client_service boolean`/`origin
-- key` dedicada para permitir localizar e atualizar com segurança — registrar
-- como nova decisão quando o caso concreto aparecer (YAGNI por ora).
--
-- ============================================================================
-- Status inicial e vencimento (decisões desta migration, ajustáveis depois)
-- ============================================================================
--
-- Status: `pending` — o vínculo cliente+serviço apenas registra que HÁ um
-- valor a cobrar; a tela Financeiro já tem o fluxo completo de "Registrar
-- recebimento" (total/parcial) para o prestador quitar depois, então nascer
-- `pending` (nunca `received`) evita fingir uma cobrança já paga sem o
-- prestador ter confirmado o recebimento.
--
-- Vencimento: `current_date + 7`. Não existe hoje nenhum campo de
-- periodicidade de cobrança em `clients`/`ClientBookingPolicy` (só limites de
-- QUANTIDADE de agendamento e janela de solicitação, RN diferente de
-- "quando cobrar") de onde derivar uma data melhor, e o cliente pode ainda
-- não ter nenhum agendamento futuro no momento do cadastro/edição para servir
-- de referência. Sete dias corridos é o mesmo tipo de "prazo curto padrão"
-- já usado neste domínio (atendimento individual/personal/terapia — ciclo
-- tipicamente semanal) e, criticamente, NÃO é uma data final imutável: o
-- prestador já tem, na tela Financeiro, o modal dedicado "Alterar vencimento"
-- (`app/payments.tsx`, `updatePayment` com `dueDate`) para qualquer cobrança,
-- incluindo esta. Se o produto (Virgil) decidir uma regra de vencimento mais
-- precisa (ex.: derivada do próximo agendamento real do cliente), esta
-- constante é o único ponto a revisar.
create or replace function public.sync_client_service_charge()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_service_name text;
  v_notes text;
begin
  -- Nada a fazer sem serviço vinculado ou com valor zero/ausente — um
  -- lançamento de R$ 0,00 não é uma cobrança útil (mesma checagem de
  -- "value_cents >= 0" da tabela, mas aqui exigimos estritamente > 0 porque
  -- a intenção é registrar algo a cobrar, não um evento vazio).
  if new.primary_service_id is null or new.service_value_cents <= 0 then
    return new;
  end if;

  -- `enforce_client_primary_service_tenant` (20260810120000, `before`
  -- trigger, roda antes deste `after` trigger) já garante que
  -- `primary_service_id` pertence ao mesmo tenant do cliente — a busca abaixo
  -- não precisa repetir essa checagem.
  select name into v_service_name
    from public.services
    where id = new.primary_service_id;

  v_notes := case
    when TG_OP = 'INSERT' then
      'Gerado automaticamente ao cadastrar o cliente com serviço vinculado.'
    else
      'Gerado automaticamente ao atualizar o serviço/valor vinculado ao cliente.'
  end;

  insert into public.manual_payments (
    tenant_id, client_id, origin, value_cents, due_date, status, notes, kind
  ) values (
    new.tenant_id,
    new.id,
    coalesce(v_service_name, 'Atendimento'),
    new.service_value_cents,
    current_date + 7,
    'pending',
    v_notes,
    'charge'
  );

  return new;
end;
$$;

revoke all on function public.sync_client_service_charge() from public, anon, authenticated;

drop trigger if exists clients_auto_charge_on_insert on public.clients;
create trigger clients_auto_charge_on_insert
  after insert on public.clients
  for each row
  execute function public.sync_client_service_charge();

drop trigger if exists clients_auto_charge_on_service_change on public.clients;
create trigger clients_auto_charge_on_service_change
  after update of primary_service_id, service_value_cents on public.clients
  for each row
  when (
    old.primary_service_id is distinct from new.primary_service_id
    or old.service_value_cents is distinct from new.service_value_cents
  )
  execute function public.sync_client_service_charge();

-- ============================================================================
-- Sem backfill de clientes já existentes (decisão deliberada, não omissão)
-- ============================================================================
--
-- ATENÇÃO — sinalização proeminente: diferente da migration irmã
-- (20260825130000, que só cria catálogo), esta migration TOCA dado
-- financeiro real se fizer backfill. Clientes já cadastrados hoje com
-- `primary_service_id`/`service_value_cents` preenchidos (o campo já existe
-- desde 20260806101700/20260806101500) NÃO recebem retroativamente um
-- lançamento automático por esta migration. Gerar cobranças novas em massa
-- para clientes já ativos de prestadores reais, sem que o prestador tenha
-- disparado a ação agora, mudaria o extrato financeiro de contas em produção
-- sem uma ação explícita do usuário no momento — exatamente o tipo de
-- mudança que exige aprovação explícita antes de rodar, não uma decisão
-- unilateral deste agente. O trigger passa a valer apenas para
-- cadastros/edições a partir da aplicação desta migration; se o usuário
-- quiser aplicar retroativamente para a base já existente, isso deve ser uma
-- decisão própria (nova migration, aprovada explicitamente, revisando
-- primeiro quantos clientes seriam afetados).
notify pgrst, 'reload schema';
