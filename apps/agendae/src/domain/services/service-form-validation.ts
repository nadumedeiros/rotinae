import type { Service } from "./types";

/**
 * Validação client-side do formulário de criar/editar serviço
 * (`docs/HANDOFF_UX_SERVICOS_DANTE.md`, seção 4 — RN-SRV-001–004), extraída
 * como função pura para ser testável sem depender de renderizar a tela
 * `app/services.tsx` (mesmo racional de `loadAllClients`/`link-reconciliation`
 * em `src/domain/clients`: lógica de domínio isolada de React/React Native).
 *
 * Ordem de checagem replicada exatamente da especificação (evita chamadas de
 * rede desnecessárias): nome vazio -> duração inválida -> valor inválido ->
 * nome duplicado entre serviços ativos. Espelha as mesmas constraints do
 * backend (`supabase-service-catalog-adapter.ts`), mas falha mais cedo e com
 * mensagem por campo.
 */

export type ServiceFormInput = {
  name: string;
  /** Texto bruto do campo de duração (dígitos esperados, ex.: "45"). */
  durationMinutesInput: string;
  /** Texto bruto opcional do campo de valor em reais com vírgula (ex.: "150,00"). */
  valueInput?: string;
};

export type ServiceFormFieldErrors = {
  name?: string;
  duration?: string;
  value?: string;
};

export type ServiceFormPayload = {
  name: string;
  durationMinutes: number;
  referenceValueCents: number;
};

export type ServiceFormValidation =
  | { valid: true; payload: ServiceFormPayload }
  | { valid: false; fieldErrors: ServiceFormFieldErrors; formError: string };

/** Só aceita dígitos (RN-SRV-001: inteiro de minutos, nunca decimal/negativo). */
export function parseDurationMinutes(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Mesma conversão já usada em `clients.tsx` para "Valor do serviço"
 * (remove separador de milhar, troca vírgula decimal por ponto, converte
 * para centavos com `Math.round`). Zero é um valor válido (RN-SRV-002).
 */
export function parseValueCents(raw?: string | null): number | null {
  if (raw === undefined || raw === null || raw.trim() === "") return 0;
  const parsed = Number(raw.trim().replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/**
 * RN-SRV-004/RN-SRV-009: nome duplicado (case-insensitive) só é bloqueado
 * entre serviços com status ativo; um serviço inativo pode reaproveitar o
 * nome de qualquer outro. `excludeId` evita que o próprio registro em edição
 * conflite consigo mesmo.
 */
export function findActiveNameConflict(
  services: Pick<Service, "id" | "name" | "status">[],
  name: string,
  excludeId?: string,
): boolean {
  const normalized = name.trim().toLocaleLowerCase("pt-BR");
  return services.some(
    (service) =>
      service.status === "active" &&
      service.id !== excludeId &&
      service.name.trim().toLocaleLowerCase("pt-BR") === normalized,
  );
}

export function validateServiceForm(
  input: ServiceFormInput,
  activeServices: Pick<Service, "id" | "name" | "status">[],
  excludeId?: string,
): ServiceFormValidation {
  const fieldErrors: ServiceFormFieldErrors = {};
  const cleanName = input.name.trim();

  if (!cleanName) {
    fieldErrors.name = "Informe o nome do serviço.";
  }

  const durationMinutes = parseDurationMinutes(input.durationMinutesInput);
  if (durationMinutes === null) {
    fieldErrors.duration = "Informe uma duração em minutos, número inteiro maior que zero.";
  }

  const referenceValueCents = parseValueCents(input.valueInput);
  if (referenceValueCents === null) {
    fieldErrors.value = "Informe um valor válido (zero é permitido).";
  }

  if (!fieldErrors.name && findActiveNameConflict(activeServices, cleanName, excludeId)) {
    fieldErrors.name = "Já existe um serviço ativo com este nome.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors, formError: "Confira os campos destacados abaixo." };
  }

  return {
    valid: true,
    payload: {
      name: cleanName,
      durationMinutes: durationMinutes as number,
      referenceValueCents: referenceValueCents as number,
    },
  };
}
