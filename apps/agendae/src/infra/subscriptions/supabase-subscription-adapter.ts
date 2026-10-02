import type { SubscriptionPort } from "@/src/domain/subscriptions/subscription-port";
import {
  SubscriptionError,
  type BillingPortalSession,
  type BillingSummary,
  type CheckoutSession,
  type CreateCheckoutInput,
  type PaymentCardTokenInput,
  type ProviderEntitlement,
  type SubscriptionMutationResult,
  type SubscriptionErrorCode,
} from "@/src/domain/subscriptions/types";
import { supabase } from "@/src/infra/supabase/client";
import { Platform } from "react-native";

type StatusResponse = ProviderEntitlement & { billing: BillingSummary };

const publicErrorCodes = new Set<SubscriptionErrorCode>([
  "PROVIDER_PROFILE_REQUIRED", "TRIAL_ALREADY_USED", "CHECKOUT_ALREADY_OPEN",
  "SUBSCRIPTION_NOT_FOUND", "PAYMENT_PAST_DUE", "PLAN_LIMIT_REACHED",
  "PAYMENT_PROVIDER_NOT_CONFIGURED", "CARD_TOKEN_INVALID", "CARD_UPDATE_FAILED",
  "SUBSCRIPTION_STORAGE_ERROR", "MERCADO_PAGO_ERROR", "OPERATION_IN_PROGRESS",
  "FORBIDDEN", "SESSION_EXPIRED", "NETWORK_ERROR", "UNKNOWN",
]);

function publicErrorCode(value: unknown, fallback: SubscriptionErrorCode): SubscriptionErrorCode {
  return typeof value === "string" && publicErrorCodes.has(value as SubscriptionErrorCode)
    ? value as SubscriptionErrorCode
    : fallback;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("mercado-pago-subscriptions", { body });
  if (error) {
    let message = "Não foi possível acessar a cobrança agora.";
    let code: SubscriptionErrorCode = "NETWORK_ERROR";
    try {
      const details = await (error as { context?: Response }).context?.clone().json();
      message = details?.detail ?? details?.error ?? message;
      code = publicErrorCode(details?.error, "UNKNOWN");
    } catch {
      // Mantém uma mensagem pública segura se o gateway não devolver JSON.
    }
    throw new SubscriptionError(code, message);
  }
  if (data?.error) {
    const code = publicErrorCode(data.error, "UNKNOWN");
    throw new SubscriptionError(code, data.detail ?? "Não foi possível concluir a operação.");
  }
  return data as T;
}

function absoluteUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  if (Platform.OS !== "web") return `rotinae://${path.replace(/^\/+/, "")}`;
  if (typeof window !== "undefined") return new URL(path, window.location.origin).toString();
  return new URL(path, process.env.EXPO_PUBLIC_APP_URL ?? "https://rotinae.com.br").toString();
}

export class SupabaseSubscriptionAdapter implements SubscriptionPort {
  async getEntitlement() {
    const response = await invoke<StatusResponse>({ action: "status" });
    const { billing: _billing, ...entitlement } = response;
    return entitlement;
  }

  async getBillingSummary() {
    return (await invoke<StatusResponse>({ action: "status" })).billing;
  }

  async createPremiumSubscription(input: PaymentCardTokenInput) {
    return invoke<SubscriptionMutationResult>({
      action: "create_authorized",
      cardTokenId: input.cardTokenId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async updatePaymentCard(input: PaymentCardTokenInput) {
    return invoke<SubscriptionMutationResult>({
      action: "update_card",
      cardTokenId: input.cardTokenId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async createPremiumCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const checkout = await invoke<CheckoutSession>({
      action: "create",
      ...input,
      successUrl: absoluteUrl(input.successUrl),
      cancelUrl: absoluteUrl(input.cancelUrl),
    });
    try {
      const url = new URL(checkout.url);
      if (url.protocol !== "https:") throw new Error("invalid protocol");
    } catch {
      throw new SubscriptionError("UNKNOWN", "O checkout seguro não está disponível agora.");
    }
    return checkout;
  }

  async scheduleCancellation(idempotencyKey: string) {
    await invoke({ action: "cancel", idempotencyKey });
    return this.getEntitlement();
  }

  async resumeSubscription(idempotencyKey: string) {
    await invoke({ action: "resume", idempotencyKey });
    return this.getEntitlement();
  }

  async createBillingPortal(returnUrl: string): Promise<BillingPortalSession> {
    void returnUrl;
    throw new SubscriptionError("UNKNOWN", "O portal de cobrança ainda não está disponível pelo Mercado Pago.");
  }
}

export const subscriptionService: SubscriptionPort = new SupabaseSubscriptionAdapter();
