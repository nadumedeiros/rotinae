import { selectVisibleServices } from "../service-catalog-view";
import type { Service } from "../types";

function service(overrides: Partial<Service> = {}): Service {
  return {
    id: "service-1",
    name: "Corte simples",
    durationMinutes: 30,
    referenceValueCents: 5000,
    status: "active",
    isDefault: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("selectVisibleServices", () => {
  const services = [
    service({ id: "1", name: "Corte simples", status: "active" }),
    service({ id: "2", name: "Corte + barba", status: "active" }),
    service({ id: "3", name: "Avaliação gratuita", status: "inactive" }),
  ];

  it('"Todos" sem busca devolve o catálogo inteiro (estado padrão ao abrir a tela)', () => {
    expect(selectVisibleServices(services, "Todos", "")).toHaveLength(3);
  });

  it('filtra por "Ativos"', () => {
    const visible = selectVisibleServices(services, "Ativos", "");
    expect(visible.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it('filtra por "Inativos"', () => {
    const visible = selectVisibleServices(services, "Inativos", "");
    expect(visible.map((item) => item.id)).toEqual(["3"]);
  });

  it("busca por nome é case-insensitive e não sensível a acento adicional", () => {
    expect(selectVisibleServices(services, "Todos", "corte").map((item) => item.id)).toEqual(["1", "2"]);
    expect(selectVisibleServices(services, "Todos", "AVALIAÇÃO").map((item) => item.id)).toEqual(["3"]);
  });

  it("combina filtro por status e busca por nome", () => {
    expect(selectVisibleServices(services, "Ativos", "barba").map((item) => item.id)).toEqual(["2"]);
  });

  it("catálogo vazio devolve lista vazia (estado crítico do RF-CAD-013)", () => {
    expect(selectVisibleServices([], "Todos", "")).toEqual([]);
  });

  it("busca sem correspondência devolve lista vazia mesmo com catálogo não vazio (estado de busca sem resultado)", () => {
    expect(selectVisibleServices(services, "Todos", "inexistente")).toEqual([]);
  });
});
