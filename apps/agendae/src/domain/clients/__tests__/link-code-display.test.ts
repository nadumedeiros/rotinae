import { isLongLinkCode } from "../link-code-display";

describe("isLongLinkCode", () => {
  it("trata string vazia (nenhum código gerado) como curta", () => {
    expect(isLongLinkCode("")).toBe(false);
  });

  it("trata o formato de mock legado (12 caracteres) como curto", () => {
    expect(isLongLinkCode("AG-M4R8-K2Q7")).toBe(false);
  });

  it("trata o código real de 32 caracteres hexadecimais retornado pelo backend como longo", () => {
    expect(isLongLinkCode("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6")).toBe(true);
  });

  it("usa o limite de 20 caracteres como fronteira", () => {
    expect(isLongLinkCode("a".repeat(20))).toBe(false);
    expect(isLongLinkCode("a".repeat(21))).toBe(true);
  });
});
