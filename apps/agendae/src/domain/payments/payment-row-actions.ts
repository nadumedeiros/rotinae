export type PaymentActionStatus = "Pendente" | "Recebido" | "Atrasado" | "Cancelado";

/**
 * Rótulo da ação principal de recebimento/edição de status na linha de um
 * pagamento (menu de ações desktop e bottom-sheet mobile de
 * `app/payments.tsx`) — extraída como função pura para os dois pontos de
 * entrada nunca divergirem entre si (bug corrigido nesta revisão: o rótulo
 * "Registrar recebimento" aparecia sempre, mesmo para pagamentos já
 * recebidos ou cancelados).
 *
 * `openPayment` (app/payments.tsx) já decide corretamente o destino da ação
 * por status — pendente/atrasado abre o modal de recebimento total/parcial,
 * qualquer outro caso cai no formulário geral de edição (`openEditForm`).
 * Esta função só resolve o RÓTULO exibido para essa mesma decisão, para que
 * a cópia da tela não prometa "Registrar recebimento" quando na prática o
 * fluxo abre uma edição de status.
 *
 * `null` sinaliza que a ação não deve ser oferecida: cancelado é terminal
 * (RN de pagamentos), então não faz sentido nem "registrar recebimento" nem
 * "editar status" — as únicas ações que permanecem nesse caso são "Ver
 * detalhes" e "Excluir lançamento" (nunca removidas por esta função).
 */
export function resolveReceiptActionLabel(status: PaymentActionStatus): string | null {
  if (status === "Cancelado") return null;
  if (status === "Recebido") return "Editar status";
  return "Registrar recebimento";
}
