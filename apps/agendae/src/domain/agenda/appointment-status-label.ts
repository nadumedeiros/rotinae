import { colors } from "@/src/theme/tokens";

import type { AppointmentState, ConfirmationStatus } from "./types";

export type AppointmentStatusPresentation = {
  label: string;
  bg: string;
  color: string;
};

/**
 * Rótulo, cor de fundo e cor de texto de um agendamento a partir do seu
 * estado (`state`) e status de confirmação (`confirmationStatus`).
 *
 * Fonte única desta regra para o Perfil do Cliente (`app/clients/[id].tsx`)
 * e a Home (`app/dashboard.tsx`) — ambos exibem o mesmo agendamento a
 * partir da mesma tabela/serviço e não podem divergir sobre qual rótulo
 * corresponde a qual estado (BLG: agendamento cancelado aparecendo como
 * "Confirmado" na Home por reimplementação paralela desta regra em cada
 * tela, sem um `else if (state === "cancelled")`).
 *
 * `app/agenda.tsx` mantém seu próprio cálculo de status (`toUiAppointment`,
 * campo `status`) só para alimentar o formulário de criação/edição — o
 * prestador escolhe manualmente entre "Confirmado" / "A confirmar" /
 * "Concluído" / "Cancelado" ao editar, um conjunto de apenas quatro valores
 * que não comporta o quinto estado somente-leitura ("Não compareceu") sem
 * alterar esse formulário (fora de escopo — DECISÃO DE PRODUTO 2026-08-23).
 *
 * Já o SELO VISUAL de status na Agenda (`AppointmentDayList`) usa esta
 * função diretamente a partir de `state`/`confirmationStatus`, com as
 * cores de "Confirmado"/"Concluído" trocadas nesta tela para bater com o
 * Perfil do Cliente e a Home (DECISÃO DE PRODUTO 2026-08-23) — evitando
 * tanto a divergência de cor entre telas quanto o "Não compareceu"
 * aparecendo incorretamente como "Concluído" ali.
 *
 * Cores de "Confirmado"/"Concluído" invertidas (DECISÃO DE PRODUTO
 * 2026-08-23, segunda rodada): verde é a cor de "Concluído" em todo o
 * sistema, não de "Confirmado".
 */
export function getAppointmentStatusLabel(
  state: AppointmentState,
  confirmationStatus: ConfirmationStatus,
): AppointmentStatusPresentation {
  if (state === "cancelled") {
    return { label: "Cancelado", bg: colors.dangerSoft, color: colors.danger };
  }
  if (state === "completed") {
    return { label: "Concluído", bg: colors.successSoft, color: colors.success };
  }
  if (state === "no_show") {
    return { label: "Não compareceu", bg: colors.dangerSoft, color: colors.danger };
  }
  if (confirmationStatus === "pending") {
    return { label: "A confirmar", bg: colors.warningSoft, color: colors.warning };
  }
  return { label: "Confirmado", bg: colors.brandSoft, color: colors.brand };
}
