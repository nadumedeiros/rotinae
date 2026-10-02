import { resolveReceiptActionLabel } from "../payment-row-actions";

describe("resolveReceiptActionLabel", () => {
  it('pagamento "Pendente" mantém o rótulo "Registrar recebimento"', () => {
    expect(resolveReceiptActionLabel("Pendente")).toBe("Registrar recebimento");
  });

  it('pagamento "Atrasado" mantém o rótulo "Registrar recebimento"', () => {
    expect(resolveReceiptActionLabel("Atrasado")).toBe("Registrar recebimento");
  });

  it('pagamento "Recebido" troca o rótulo para "Editar status"', () => {
    expect(resolveReceiptActionLabel("Recebido")).toBe("Editar status");
  });

  it('pagamento "Cancelado" não oferece a ação (terminal)', () => {
    expect(resolveReceiptActionLabel("Cancelado")).toBeNull();
  });
});
