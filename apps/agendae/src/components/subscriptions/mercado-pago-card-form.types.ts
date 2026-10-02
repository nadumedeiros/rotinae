export type MercadoPagoCardFormProps = {
  publicKey: string;
  amount: string;
  disabled?: boolean;
  submitLabel: string;
  onReady?: () => void;
  onLoadingChange?: (loading: boolean) => void;
  onToken: (cardTokenId: string) => void;
  onError: (message: string) => void;
};

export type MercadoPagoCardMessage =
  | { source: "rotinae-mercado-pago"; type: "ready" }
  | { source: "rotinae-mercado-pago"; type: "loading"; loading: boolean }
  | { source: "rotinae-mercado-pago"; type: "token"; cardTokenId: string }
  | { source: "rotinae-mercado-pago"; type: "error"; message: string };

export function parseMercadoPagoCardMessage(value: unknown): MercadoPagoCardMessage | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const parsed = JSON.parse(value) as Partial<MercadoPagoCardMessage>;
    if (parsed.source !== "rotinae-mercado-pago") return null;
    if (parsed.type === "ready") return parsed as MercadoPagoCardMessage;
    if (parsed.type === "loading" && typeof parsed.loading === "boolean") return parsed as MercadoPagoCardMessage;
    if (
      parsed.type === "token" &&
      typeof parsed.cardTokenId === "string" &&
      /^[A-Za-z0-9_-]{20,256}$/.test(parsed.cardTokenId)
    ) return parsed as MercadoPagoCardMessage;
    if (parsed.type === "error" && typeof parsed.message === "string") {
      return { source: "rotinae-mercado-pago", type: "error", message: parsed.message.slice(0, 300) };
    }
  } catch {
    return null;
  }
  return null;
}

export function isMercadoPagoPublicKeyConfigured(value: string | undefined) {
  const key = value?.trim() ?? "";
  return /^(TEST-|APP_USR-)[A-Za-z0-9_-]{12,}$/.test(key) && !key.toLowerCase().includes("sua-chave");
}
