import type { ClientPortfolioPort } from "./client-portfolio-port";
import type { Client, ClientListInput } from "./types";

type ClientFilters = Pick<ClientListInput, "query" | "status">;

/**
 * Carrega a carteira completa usando o contrato paginado do servidor.
 *
 * Telas que precisam de todos os clientes (por exemplo, seletores) não devem
 * recorrer a listas locais ou dados de demonstração enquanto a integração
 * real está indisponível.
 */
export async function loadAllClients(
  portfolio: ClientPortfolioPort,
  filters: ClientFilters = {},
): Promise<Client[]> {
  const firstPage = await portfolio.listClients({
    ...filters,
    page: 1,
    pageSize: 10,
  });

  if (firstPage.totalPages <= 1) return firstPage.items;

  const remainingPages = await Promise.all(
    Array.from({ length: firstPage.totalPages - 1 }, (_, index) =>
      portfolio.listClients({
        ...filters,
        page: index + 2,
        pageSize: 10,
      }),
    ),
  );

  return [firstPage, ...remainingPages].flatMap((page) => page.items);
}
