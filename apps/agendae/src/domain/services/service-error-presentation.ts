import type { ServiceErrorCode } from "./types";

/**
 * Mapeamento visual de `ServiceErrorCode` para a tela `app/services.tsx`
 * (`docs/HANDOFF_UX_SERVICOS_DANTE.md`, seção 5, e
 * `docs/HANDOFF_VISUAL_SERVICOS_NERO.md`, seção 6). Extraída como função pura
 * para ser testável sem depender de renderizar a tela (não há
 * `@testing-library/react-native` configurado neste projeto — mesmo racional
 * de `service-form-validation.ts`).
 *
 * `context` distingue erros disparados dentro de um formulário aberto
 * ("form": criar/editar) de erros disparados por uma ação direta sem modal
 * de formulário aberto ("inline-action": ativar/desativar direto na lista ou
 * pelo botão de reativar dentro do modal de edição, que não abre um novo
 * formulário) — a mesma regra de posicionamento do handoff de Nero: "erros de
 * campo específico -> inline; erros que não apontam para um campo -> banner
 * dentro do modal aberto; erros disparados por uma ação sem modal de
 * formulário aberto -> modal de feedback".
 *
 * O caso especial de `SERVICE_NAME_CONFLICT` ao REATIVAR (edge case, seção
 * 3.5 do handoff de Dante) exige um atalho para abrir o modal de edição do
 * próprio serviço — como isso depende do objeto `Service` em memória (não
 * apenas do código de erro), é tratado pelo chamador (`app/services.tsx`)
 * antes de cair nesta função: só chega aqui quando não há esse atalho a
 * oferecer.
 */

export type ServiceErrorContext = "form" | "inline-action";

export type ServiceErrorPresentation =
  | { kind: "field"; field: "name" | "duration" | "value"; message: string }
  | { kind: "banner"; message: string }
  | { kind: "feedback"; tone: "warning" | "error"; message: string; reload?: boolean };

const SERVICE_NOT_FOUND_MESSAGE = "Este serviço não foi encontrado. A lista foi atualizada.";

export function resolveServiceErrorPresentation(
  code: ServiceErrorCode,
  message: string,
  context: ServiceErrorContext,
): ServiceErrorPresentation {
  switch (code) {
    case "SERVICE_NOT_FOUND":
      // Sempre feedback + recarregar, independente do contexto de disparo
      // (pode ocorrer tanto ao salvar/editar quanto ao ativar/desativar).
      return { kind: "feedback", tone: "warning", message: SERVICE_NOT_FOUND_MESSAGE, reload: true };
    case "SESSION_EXPIRED":
      return { kind: "feedback", tone: "error", message };
    case "SERVICE_NAME_INVALID":
      return { kind: "field", field: "name", message };
    case "SERVICE_NAME_CONFLICT":
      // Em "form" (criar/editar), erro inline no campo Nome. Em
      // "inline-action" sem atalho de reativação disponível, cai em
      // feedback genérico (o atalho, quando disponível, é tratado antes de
      // chegar aqui pelo chamador).
      return context === "form"
        ? { kind: "field", field: "name", message }
        : { kind: "feedback", tone: "warning", message };
    case "DURATION_INVALID":
      return { kind: "field", field: "duration", message };
    case "VALUE_INVALID":
      return { kind: "field", field: "value", message };
    case "FORBIDDEN":
      return context === "form"
        ? { kind: "banner", message: "Você não tem permissão para esta ação." }
        : { kind: "feedback", tone: "error", message: "Você não tem permissão para esta ação." };
    case "NETWORK_ERROR":
    case "UNKNOWN":
    default:
      return context === "form" ? { kind: "banner", message } : { kind: "feedback", tone: "error", message };
  }
}
