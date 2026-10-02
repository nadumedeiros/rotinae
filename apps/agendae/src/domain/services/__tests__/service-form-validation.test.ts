import {
  findActiveNameConflict,
  parseDurationMinutes,
  parseValueCents,
  validateServiceForm,
  type ServiceFormInput,
} from "../service-form-validation";
import type { Service } from "../types";

function service(overrides: Partial<Service> = {}): Pick<Service, "id" | "name" | "status"> {
  return {
    id: "service-1",
    name: "Corte simples",
    status: "active",
    ...overrides,
  };
}

const validInput: ServiceFormInput = {
  name: "Sessão avulsa 50min",
  durationMinutesInput: "50",
  valueInput: "150,00",
};

describe("parseDurationMinutes", () => {
  it("aceita inteiro positivo", () => {
    expect(parseDurationMinutes("45")).toBe(45);
  });

  it("rejeita vazio, zero, negativo e decimal (RN-SRV-001)", () => {
    expect(parseDurationMinutes("")).toBeNull();
    expect(parseDurationMinutes("0")).toBeNull();
    expect(parseDurationMinutes("-10")).toBeNull();
    expect(parseDurationMinutes("30.5")).toBeNull();
    expect(parseDurationMinutes("30,5")).toBeNull();
  });
});

describe("parseValueCents", () => {
  it("converte reais com vírgula decimal para centavos inteiros", () => {
    expect(parseValueCents("150,00")).toBe(15000);
    expect(parseValueCents("1.234,56")).toBe(123456);
  });

  it("aceita zero como valor válido (RN-SRV-002 — ex.: avaliação gratuita)", () => {
    expect(parseValueCents("0")).toBe(0);
    expect(parseValueCents("0,00")).toBe(0);
  });

  it("converte vazio em 0 e rejeita negativo", () => {
    expect(parseValueCents("")).toBe(0);
    expect(parseValueCents(undefined)).toBe(0);
    expect(parseValueCents("-10")).toBeNull();
  });
});

describe("findActiveNameConflict", () => {
  it("detecta conflito case-insensitive entre serviços ativos", () => {
    const services = [service({ id: "1", name: "Corte Simples", status: "active" })];
    expect(findActiveNameConflict(services, "corte simples")).toBe(true);
  });

  it("permite nome repetido entre um serviço ativo e um inativo (RN-SRV-004)", () => {
    const services = [service({ id: "1", name: "Corte Simples", status: "inactive" })];
    expect(findActiveNameConflict(services, "Corte Simples")).toBe(false);
  });

  it("ignora o próprio registro em edição via excludeId", () => {
    const services = [service({ id: "1", name: "Corte Simples", status: "active" })];
    expect(findActiveNameConflict(services, "Corte Simples", "1")).toBe(false);
  });
});

describe("validateServiceForm", () => {
  it("aceita um formulário válido e devolve o payload convertido", () => {
    const result = validateServiceForm(validInput, []);
    expect(result).toEqual({
      valid: true,
      payload: { name: "Sessão avulsa 50min", durationMinutes: 50, referenceValueCents: 15000 },
    });
  });

  it("faz trim() no nome antes de validar/retornar", () => {
    const result = validateServiceForm({ ...validInput, name: "  Sessão avulsa 50min  " }, []);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.name).toBe("Sessão avulsa 50min");
    }
  });

  it("rejeita nome vazio/só espaços com mensagem no campo nome (RN-SRV-003)", () => {
    const result = validateServiceForm({ ...validInput, name: "   " }, []);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.fieldErrors.name).toBeDefined();
      expect(result.fieldErrors.duration).toBeUndefined();
      expect(result.fieldErrors.value).toBeUndefined();
    }
  });

  it("rejeita duração inválida com mensagem no campo duração, sem reportar nome", () => {
    const result = validateServiceForm({ ...validInput, durationMinutesInput: "0" }, []);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.fieldErrors.duration).toBeDefined();
      expect(result.fieldErrors.name).toBeUndefined();
    }
  });

  it("rejeita valor negativo com mensagem no campo valor se informado", () => {
    const result = validateServiceForm({ ...validInput, valueInput: "-5,00" }, []);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.fieldErrors.value).toBeDefined();
    }
  });

  it("aceita serviço sem informar valor e define 0 centavos como padrão", () => {
    const result = validateServiceForm({ name: "Atendimento Rápido", durationMinutesInput: "30" }, []);
    expect(result).toEqual({
      valid: true,
      payload: { name: "Atendimento Rápido", durationMinutes: 30, referenceValueCents: 0 },
    });
  });

  it("reporta todos os campos inválidos simultaneamente quando aplicável", () => {
    const result = validateServiceForm({ name: "  ", durationMinutesInput: "", valueInput: "-10" }, []);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.fieldErrors.name).toBeDefined();
      expect(result.fieldErrors.duration).toBeDefined();
      expect(result.fieldErrors.value).toBeDefined();
      expect(result.formError).toBe("Confira os campos destacados abaixo.");
    }
  });

  it("bloqueia nome duplicado entre serviços ativos (RN-SRV-004/RF-CAD-012), mesmo com duração/valor válidos", () => {
    const activeServices = [service({ id: "existing", name: validInput.name, status: "active" })];
    const result = validateServiceForm(validInput, activeServices);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.fieldErrors.name).toBe("Já existe um serviço ativo com este nome.");
    }
  });

  it("permite editar o próprio serviço sem disparar falso conflito de nome consigo mesmo", () => {
    const activeServices = [service({ id: "self", name: validInput.name, status: "active" })];
    const result = validateServiceForm(validInput, activeServices, "self");
    expect(result.valid).toBe(true);
  });

  it("não bloqueia nome reaproveitado de um serviço inativo", () => {
    const inactiveServices = [service({ id: "old", name: validInput.name, status: "inactive" })];
    const result = validateServiceForm(validInput, inactiveServices);
    expect(result.valid).toBe(true);
  });
});
