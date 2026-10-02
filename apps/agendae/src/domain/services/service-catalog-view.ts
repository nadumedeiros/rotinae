import type { Service } from "./types";

export type ServiceStatusFilter = "Todos" | "Ativos" | "Inativos";

/**
 * Filtro por status + busca por nome aplicados client-side sobre a lista já
 * carregada (RN-SRV-010, `docs/HANDOFF_UX_SERVICOS_DANTE.md` seção 3.1 — o
 * catálogo não é paginado, então filtro/busca não geram nova chamada de
 * rede). Extraída como função pura para ser testável sem depender de
 * renderizar `app/services.tsx`.
 */
export function selectVisibleServices(services: Service[], filter: ServiceStatusFilter, query: string): Service[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  return services.filter((service) => {
    const matchesQuery = service.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
    const matchesFilter =
      filter === "Todos" ||
      (filter === "Ativos" && service.status === "active") ||
      (filter === "Inativos" && service.status === "inactive");
    return matchesQuery && matchesFilter;
  });
}
