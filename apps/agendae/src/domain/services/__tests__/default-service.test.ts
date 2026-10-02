import { resolveClientService } from "../default-service";
import type { Service } from "../types";

function service(overrides: Partial<Service> = {}): Service {
  return {
    id: "service-1",
    name: "Atendimento padrão",
    durationMinutes: 60,
    referenceValueCents: 0,
    status: "active",
    isDefault: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveClientService", () => {
  const defaultService = service({ id: "default", name: "Atendimento padrão", isDefault: true });
  const haircut = service({ id: "haircut", name: "Corte simples", referenceValueCents: 5000 });
  const catalog = [defaultService, haircut];

  it("resolve o serviço vinculado ao cliente quando existe no catálogo", () => {
    expect(resolveClientService(catalog, { primaryServiceId: "haircut" })).toBe(haircut);
  });

  it('cai no serviço padrão "Atendimento" quando o cliente não tem serviço vinculado', () => {
    expect(resolveClientService(catalog, { primaryServiceId: null })).toBe(defaultService);
  });

  it("cai no serviço padrão quando o cliente é null/undefined (novo pagamento sem cliente resolvido ainda)", () => {
    expect(resolveClientService(catalog, null)).toBe(defaultService);
    expect(resolveClientService(catalog, undefined)).toBe(defaultService);
  });

  it("cai no serviço padrão quando o vínculo aponta para um serviço que não está mais no catálogo ativo", () => {
    expect(resolveClientService(catalog, { primaryServiceId: "removido" })).toBe(defaultService);
  });

  it('identifica o serviço padrão pelo flag "isDefault", mesmo depois de renomeado pelo prestador (DEC-163)', () => {
    const renamed = service({ id: "x", name: "Consulta inicial", isDefault: true });
    expect(resolveClientService([renamed, haircut], { primaryServiceId: null })).toBe(renamed);
  });

  it('sem "isDefault" em nenhuma linha (catálogo/mocks antigos), cai na correspondência por nome como compatibilidade', () => {
    const customCatalog = [service({ id: "x", name: "  ATENDIMENTO PADRÃO  ", isDefault: false }), haircut];
    expect(resolveClientService(customCatalog, { primaryServiceId: null })?.id).toBe("x");
  });

  it("sem serviço padrão identificável no catálogo, cai no primeiro item como último recurso", () => {
    expect(resolveClientService([haircut], { primaryServiceId: null })).toBe(haircut);
  });

  it("catálogo vazio devolve undefined", () => {
    expect(resolveClientService([], { primaryServiceId: "haircut" })).toBeUndefined();
  });
});
