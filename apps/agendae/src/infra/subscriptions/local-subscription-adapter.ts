import { Platform } from "react-native";

import type { SubscriptionPort } from "@/src/domain/subscriptions/subscription-port";
import type {
  BillingPortalSession,
  BillingSummary,
  CheckoutSession,
  CreateCheckoutInput,
  PaymentCardTokenInput,
  ProviderEntitlement,
  SubscriptionMutationResult,
  SubscriptionStatus,
} from "@/src/domain/subscriptions/types";
import {
  providerPlanStorageKey,
  providerPlanUpdatedEvent,
  type ProviderPlanState,
} from "@/src/hooks/use-provider-plan";

type LocalSubscriptionState = ProviderPlanState & {
  status?: SubscriptionStatus;
  currentPeriodEndsAt?: string;
  nextPaymentAt?: string;
  paymentMethodLabel?: string;
};

const defaultState: LocalSubscriptionState = {
  plan: "premium",
  source: "trial",
  status: "trialing",
  trialEndsAt: "01/09/2026 às 18:00",
  trialEndsAtIso: "2026-09-01T21:00:00.000Z",
  cancelAtPeriodEnd: false,
};

function readState(): LocalSubscriptionState {
  if (typeof localStorage === "undefined") return defaultState;
  try {
    const stored = localStorage.getItem(providerPlanStorageKey);
    return stored ? { ...defaultState, ...JSON.parse(stored) } : defaultState;
  } catch {
    return defaultState;
  }
}

function writeState(next: LocalSubscriptionState) {
  if (typeof localStorage !== "undefined")
    localStorage.setItem(providerPlanStorageKey, JSON.stringify(next));
  if (Platform.OS === "web")
    window.dispatchEvent(new Event(providerPlanUpdatedEvent));
}

function entitlement(state = readState()): ProviderEntitlement {
  const premium = state.plan === "premium";
  return {
    providerUserId: "local-user",
    plan: state.plan,
    status: state.status ?? (premium ? "active" : "free"),
    source:
      state.source === "subscription"
        ? "subscription"
        : state.source === "trial"
          ? "trial"
          : state.source === "manual"
            ? "manual_admin"
            : "free",
    trialStartedAt: state.source === "trial" ? "2026-08-02T21:00:00.000Z" : null,
    trialEndsAt: state.trialEndsAtIso ?? null,
    currentPeriodEndsAt: state.currentPeriodEndsAt ?? state.trialEndsAtIso ?? null,
    cancelAtPeriodEnd: Boolean(state.cancelAtPeriodEnd),
    dailyAppointmentLimit: premium ? null : 2,
    clientLimit: premium ? null : 5,
    canAddClientNotes: premium,
    canCreateRecurrence: premium,
    usedAppointmentsToday: 1,
    usedClients: 5,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

class LocalSubscriptionAdapter implements SubscriptionPort {
  async getEntitlement() {
    return entitlement();
  }

  async getBillingSummary(): Promise<BillingSummary> {
    const state = readState();
    return {
      status: state.status ?? (state.source === "trial" ? "trialing" : state.plan === "premium" ? "active" : "free"),
      priceCents: 2900,
      currency: "BRL",
      nextPaymentAt: state.nextPaymentAt ?? state.trialEndsAtIso ?? null,
      paymentMethodLabel: state.paymentMethodLabel ?? null,
      cancelAtPeriodEnd: Boolean(state.cancelAtPeriodEnd),
    };
  }

  async createPremiumCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const id = `checkout-${Date.now()}`;
    if (typeof sessionStorage !== "undefined")
      sessionStorage.setItem(`agendae:${id}`, JSON.stringify(input));
    return {
      id,
      url: `/subscription-return?checkoutId=${id}&outcome=success`,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
  }

  async createPremiumSubscription(_input: PaymentCardTokenInput): Promise<SubscriptionMutationResult> {
    completeLocalPremiumCheckout();
    return { accepted: true, subscriptionId: `local-${Date.now()}`, status: "active" };
  }

  async updatePaymentCard(_input: PaymentCardTokenInput): Promise<SubscriptionMutationResult> {
    const current = readState();
    writeState({ ...current, paymentMethodLabel: "Cartão atualizado" });
    return { accepted: true, subscriptionId: `local-${Date.now()}`, status: "active" };
  }

  async scheduleCancellation() {
    const current = readState();
    const next: LocalSubscriptionState = {
      ...current,
      cancelAtPeriodEnd: true,
      status: "cancel_at_period_end",
    };
    writeState(next);
    return entitlement(next);
  }

  async resumeSubscription() {
    const current = readState();
    const next: LocalSubscriptionState = {
      ...current,
      cancelAtPeriodEnd: false,
      status: current.source === "trial" ? "trialing" : "active",
    };
    writeState(next);
    return entitlement(next);
  }

  async createBillingPortal(): Promise<BillingPortalSession> {
    return {
      url: "/subscription-billing?portal=local",
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
  }
}

export function completeLocalPremiumCheckout() {
  const current = readState();
  writeState({
    ...current,
    plan: "premium",
    source: "subscription",
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodEndsAt: "2026-10-01T21:00:00.000Z",
    nextPaymentAt: current.trialEndsAtIso ?? "2026-09-01T21:00:00.000Z",
    paymentMethodLabel: "Mastercard final 4242",
  });
}

export const subscriptionService: SubscriptionPort = new LocalSubscriptionAdapter();
