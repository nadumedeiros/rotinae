export type PaymentStatus = "pending" | "received" | "overdue" | "cancelled";
export type PaymentKind = "charge" | "receipt";

export type PaymentRecord = {
  id: string;
  clientId: string;
  origin: string;
  valueCents: number;
  dueDate: string;
  status: PaymentStatus;
  notes: string | null;
  createdAt: string;
  receivedAt: string | null;
  kind?: PaymentKind;
  parentPaymentId?: string | null;
  clientName?: string;
  hasReceipt?: boolean;
  /**
   * Saldo ainda em aberto da cobrança (`valueCents` menos a soma dos
   * `receipt` filhos já `received`, nunca negativo — mesmo cálculo de
   * `PaymentHistoryResult.balanceCents`). Diferente de `valueCents`, que por
   * decisão de arquitetura (20260823130000_manual_payments_receipt_history.sql)
   * é sempre o total original da cobrança, imutável por pagamentos parciais.
   * Só a RPC de listagem (`list_manual_payments`) devolve este valor
   * derivado; os demais métodos deste port (`createPayment`/`updatePayment`/
   * `registerPartialPayment`) não trazem `balance_cents` do banco e usam um
   * fallback razoável no adapter (ver `toPayment`).
   */
  balanceCents: number;
};

export type CreatePaymentInput = Omit<
  PaymentRecord,
  "id" | "createdAt" | "receivedAt" | "balanceCents"
> & {
  /**
   * Data/instante ISO do recebimento, escolhida pelo prestador no modal de
   * confirmação (padrão: data do dia, ajuste manual). Só tem efeito quando
   * `status === "received"`; omitido, o adapter usa o instante do servidor
   * (comportamento anterior a esta adição).
   */
  receivedAt?: string;
};
export type UpdatePaymentInput = Partial<CreatePaymentInput>;

/**
 * Paginação de `listPayments` (DEC-098). Mesma convenção já usada por
 * `ClientListInput`/`AppointmentListQuery`/`NotificationPort.listNotifications`
 * (offset/limit expresso como página civil de 10 itens, não cursor): campos
 * homônimos `page`/`pageSize`, aceitando 5 itens no mobile e 10 no desktop.
 * Opcional (diferente dos três ports citados, onde é obrigatório) porque
 * `listPayments` já existia sem paginação — tornar o parâmetro opcional
 * preserva todo chamador existente (`listPayments()` sem argumentos) sem
 * quebra de compatibilidade, mesmo espírito aditivo de `Client.primaryServiceId`
 * (DEC-070). `SupabasePaymentAdapter` implementa o corte real com `range()`/
 * `count: "exact"` (revisão final de governança), aplicando `page: 1`/
 * `pageSize: 10` quando `input` é omitido.
 */
export type PaymentListInput = {
  page: number;
  pageSize: 5 | 10;
  period?: string;
  status?: PaymentStatus;
  query?: string;
};

export type PaymentSummary = {
  receivedTotalCents: number;
  pendingTotalCents: number;
  pendingCount: number;
};

/**
 * Retorno paginado equivalente a `Page<Client>`/`AppointmentPage`/
 * `NotificationPage`. `totalItems`/`totalPages` refletem o total real de
 * linhas do tenant no Postgres (via `count: "exact"`), não apenas o tamanho
 * de `items` da página atual.
 */
export type PaymentPage = {
  items: PaymentRecord[];
  page: number;
  pageSize: 5 | 10;
  totalItems: number;
  totalPages: number;
  summary: PaymentSummary;
};

/**
 * Resumo mensal do controle financeiro.
 *
 * `receivedTotalCents` usa a data real do recebimento; `expectedTotalCents`
 * é o saldo aberto dos lançamentos cadastrados no mês. Nos meses já alcançados,
 * `outstandingTotalCents` acumula todo saldo que venceu até o fim daquele mês
 * e continua aberto, fazendo a pendência passar de uma competência à outra.
 */
export type FinancialHistoryMonth = {
  month: string;
  receivedTotalCents: number;
  expectedTotalCents: number;
  outstandingTotalCents: number;
  chargeCount: number;
  outstandingCount: number;
};

export type FinancialHistoryResult = {
  months: FinancialHistoryMonth[];
};
export type RegisterPartialPaymentResult = {
  pending: PaymentRecord;
  receipt: PaymentRecord;
};

/**
 * Entrada de edição de um pagamento parcial já registrado (`kind: "receipt"`),
 * via `update_manual_payment_receipt` (20260823130000). Todos os campos são
 * opcionais exceto `amountCents`: campos omitidos permanecem inalterados no
 * banco (mesma convenção de `UpdatePaymentInput`); para limpar `notes`
 * explicitamente, envie string vazia — `undefined`/omitido nunca apaga.
 */
export type UpdatePartialPaymentInput = {
  amountCents: number;
  dueDate?: string;
  notes?: string;
};

/**
 * Retorno de `updatePartialPayment`/`deletePartialPayment`: o recibo editado
 * (ausente na exclusão) e a cobrança principal já recalculada (`status`
 * pode ter voltado de `received` para `pending`/`overdue` se a edição ou
 * exclusão reduziu o total já recebido abaixo do valor total da cobrança).
 */
export type PartialPaymentMutationResult = {
  receipt?: PaymentRecord;
  parent: PaymentRecord;
};

/**
 * Retorno de `getPaymentHistory` (RPC `get_manual_payment_history`,
 * 20260823130000): a cobrança principal (total original imutável + status
 * atual), quanto já foi efetivamente recebido, o saldo restante e todos os
 * pagamentos parciais (`kind: "receipt"`) já registrados para ela, do mais
 * recente para o mais antigo.
 */
export type PaymentHistoryResult = {
  charge: PaymentRecord;
  receipts: PaymentRecord[];
  receivedCents: number;
  balanceCents: number;
};
export type PaymentErrorCode =
  | "CLIENT_NOT_FOUND"
  | "PAYMENT_NOT_FOUND"
  | "DUPLICATE_PAYMENT"
  | "VALUE_INVALID"
  | "DUE_DATE_INVALID"
  | "PAYMENT_VALUE_INVALID"
  | "PAYMENT_EXCEEDS_BALANCE"
  | "PAYMENT_ALREADY_SETTLED"
  | "PAYMENT_CANCELLED"
  // Achado Baixo da revisão final de governança: excluir uma `charge` que já
  // tem um `receipt` filho (`parent_payment_id`, `on delete restrict`) viola
  // FK e, sem este código, caía em `UNKNOWN` genérico.
  | "PAYMENT_HAS_RECEIPTS"
  | "FORBIDDEN"
  | "SESSION_EXPIRED"
  | "NETWORK_ERROR"
  | "STORAGE_ERROR"
  | "UNKNOWN";

export class PaymentError extends Error {
  constructor(
    public readonly code: PaymentErrorCode,
    message: string,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}
