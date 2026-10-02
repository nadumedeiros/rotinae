import {
  isMercadoPagoPublicKeyConfigured,
  parseMercadoPagoCardMessage,
} from "../mercado-pago-card-form.types";
import { buildMercadoPagoCardFormHtml } from "../mercado-pago-card-form-html";

describe("formulário seguro do Mercado Pago", () => {
  it("aceita apenas mensagens identificadas e tokens descartáveis plausíveis", () => {
    expect(parseMercadoPagoCardMessage(JSON.stringify({
      source: "rotinae-mercado-pago",
      type: "token",
      cardTokenId: "card_token_12345678901234567890",
    }))).toMatchObject({ type: "token" });
    expect(parseMercadoPagoCardMessage(JSON.stringify({
      source: "origem-externa",
      type: "token",
      cardTokenId: "card_token_12345678901234567890",
    }))).toBeNull();
    expect(parseMercadoPagoCardMessage("não é json")).toBeNull();
  });

  it("não trata o placeholder do exemplo como credencial configurada", () => {
    expect(isMercadoPagoPublicKeyConfigured("TEST-sua-chave-publica")).toBe(false);
    expect(isMercadoPagoPublicKeyConfigured("TEST-1234567890_abcdefghijklmnop")).toBe(true);
    expect(isMercadoPagoPublicKeyConfigured(undefined)).toBe(false);
  });

  it("mantém o contrato exigido pelo SDK durante buscas internas", () => {
    const html = buildMercadoPagoCardFormHtml({
      publicKey: "TEST-1234567890_abcdefghijklmnop",
      amount: "29.00",
      submitLabel: "Assinar Premium",
    });
    expect(html).toContain("onFetching()");
    expect(html).toContain("return () =>");
    expect(html).toContain("https://api.mercadolibre.com");
  });
});
