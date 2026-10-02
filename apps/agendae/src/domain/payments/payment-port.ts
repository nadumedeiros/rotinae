import type {
  CreatePaymentInput,
  FinancialHistoryResult,
  PaymentHistoryResult,
  PaymentListInput,
  PaymentPage,
  PaymentRecord,
  PartialPaymentMutationResult,
  UpdatePaymentInput,
  UpdatePartialPaymentInput,
  RegisterPartialPaymentResult,
} from "./types";

/** Controle manual de valores; esta porta não processa transações bancárias. */
export interface PaymentPort {
  /**
   * Paginado desde DEC-098 (achado do Leon: histórico financeiro cresce
   * continuamente, diferente do catálogo de serviços — DEC-070 — que
   * permanece sem paginação por decisão consciente). `SupabasePaymentAdapter`
   * implementa o corte real no Postgres (`range()` + `count: "exact"`,
   * revisão final de governança); `input` continua opcional por
   * compatibilidade — ao omiti-lo, o adapter aplica `page: 1`/`pageSize: 10`
   * (mesmo default das demais portas paginadas), não mais o histórico
   * inteiro.
   */
  listPayments(input?: PaymentListInput): Promise<PaymentPage>;

  /**
   * Histórico agregado por competência mensal. Recebimentos são agrupados
   * pela data em que o dinheiro entrou; previsto e saldo aberto continuam no
   * mês de vencimento da cobrança.
   */
  getFinancialHistory(): Promise<FinancialHistoryResult>;
  createPayment(input: CreatePaymentInput): Promise<PaymentRecord>;
  updatePayment(id: string, input: UpdatePaymentInput): Promise<PaymentRecord>;
  /**
   * `receivedAt` (ISO, opcional) é a data escolhida pelo prestador no modal
   * de confirmação para quando o dinheiro efetivamente entrou — padrão hoje,
   * ajuste manual. Omitido, o adapter usa o instante do servidor (mesmo
   * comportamento anterior a esta adição).
   */
  registerPartialPayment(
    id: string,
    amountCents: number,
    receivedAt?: string,
  ): Promise<RegisterPartialPaymentResult>;
  deletePayment(id: string): Promise<void>;

  /**
   * Histórico completo de uma cobrança (`kind: "charge"`): total original,
   * status atual, quanto já foi recebido e todos os pagamentos parciais já
   * registrados. Alimenta a tela de "Histórico do Pagamento" vinculada a
   * cada linha da tabela principal (RPC `get_manual_payment_history`,
   * 20260823130000). Lança `PAYMENT_NOT_FOUND` se `chargeId` não existir, não
   * pertencer ao tenant do chamador, ou não for uma cobrança (`kind !==
   * "charge"`).
   */
  getPaymentHistory(chargeId: string): Promise<PaymentHistoryResult>;

  /**
   * Edita um pagamento parcial já registrado (uma linha `kind: "receipt"`
   * devolvida por `registerPartialPayment`/`getPaymentHistory`), reabilitado
   * na tela de Histórico do Pagamento (RPC `update_manual_payment_receipt`).
   * Revalida que a soma de todos os recibos da cobrança (excluindo este,
   * mais o novo valor) não excede o total da cobrança
   * (`PAYMENT_EXCEEDS_BALANCE`), e recalcula o status da cobrança principal
   * — que pode voltar de `received` para `pending`/`overdue` se a edição
   * reduzir o total recebido. Lança `PAYMENT_NOT_FOUND` se `receiptId` não
   * existir/não for um recibo, e `PAYMENT_CANCELLED` se a cobrança à qual
   * ele pertence já foi cancelada.
   */
  updatePartialPayment(
    receiptId: string,
    input: UpdatePartialPaymentInput,
  ): Promise<PartialPaymentMutationResult>;

  /**
   * Exclui um pagamento parcial já registrado (RPC
   * `delete_manual_payment_receipt`) e recalcula o status/saldo da cobrança
   * principal (pode voltar de `received` para `pending`/`overdue`). Mesmos
   * erros de `updatePartialPayment`, exceto `PAYMENT_EXCEEDS_BALANCE` (não
   * se aplica a uma exclusão).
   */
  deletePartialPayment(receiptId: string): Promise<PartialPaymentMutationResult>;
}
