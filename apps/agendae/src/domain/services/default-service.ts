import type { Service } from "./types";

/**
 * Nome inicial do serviço "Atendimento padrão" auto-provisionado por tenant
 * (DEC-163, `seed_default_standard_service()`,
 * `supabase/migrations/20260825130000_default_standard_service_provision.sql`).
 * Usado só como rótulo de exibição/fallback de último recurso: a
 * identificação real do serviço padrão é `Service.isDefault`, nunca o nome —
 * o prestador pode renomear este serviço livremente depois de criado (mesmo
 * comentário da migration), e `isDefault` continua `true` mesmo assim.
 */
export const DEFAULT_SERVICE_NAME = "Atendimento padrão";

function normalize(name: string): string {
  return name.trim().toLocaleLowerCase("pt-BR");
}

/**
 * Resolve qual serviço do catálogo deve ser usado como sugestão automática
 * para um cliente, na seguinte ordem (RF do seletor de serviço em
 * `app/payments.tsx` e `src/components/clients/client-edit-modal.tsx`):
 *
 * 1. O serviço vinculado ao cliente (`Client.primaryServiceId`), se ainda
 *    existir e estiver na lista informada (a lista já deve vir filtrada por
 *    `status: "active"` — serviços inativos não são oferecidos aqui).
 * 2. O serviço marcado `isDefault: true` ("Atendimento padrão") — contrato
 *    estável que sobrevive a um rename do prestador (comparar por nome seria
 *    frágil, ver migration DEC-163).
 * 3. Por compatibilidade com catálogos/mocks que ainda não populam
 *    `isDefault` (ex.: dado seedado antes desta coluna existir), cai de
 *    volta na correspondência por nome (`DEFAULT_SERVICE_NAME`).
 * 4. O primeiro serviço da lista, como último recurso (defesa contra um
 *    catálogo que, por algum motivo, não tenha nenhum serviço padrão).
 *
 * Devolve `undefined` apenas quando a lista está vazia — não há serviço
 * nenhum para sugerir.
 */
export function resolveClientService(
  services: Service[],
  client: { primaryServiceId?: string | null } | null | undefined,
): Service | undefined {
  if (services.length === 0) return undefined;

  const linkedServiceId = client?.primaryServiceId;
  if (linkedServiceId) {
    const linked = services.find((item) => item.id === linkedServiceId);
    if (linked) return linked;
  }

  const defaultService =
    services.find((item) => item.isDefault) ??
    services.find((item) => normalize(item.name) === normalize(DEFAULT_SERVICE_NAME));
  return defaultService ?? services[0];
}
