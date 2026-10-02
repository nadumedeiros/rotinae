export type PlanCode = "free" | "premium";
export type SubscriptionStatus =
  | "free"
  | "pending"
  | "trialing"
  | "active"
  | "paused"
  | "cancel_at_period_end"
  | "past_due"
  | "canceled";
export type EntitlementSource = "trial" | "subscription" | "manual_admin" | "free";

export type ProviderEntitlement = {
  providerUserId: string;
  plan: PlanCode;
  status: SubscriptionStatus;
  source: EntitlementSource;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  dailyAppointmentLimit: number | null;
  clientLimit: number | null;
  canAddClientNotes: boolean;
  canCreateRecurrence: boolean;
  usedAppointmentsToday: number;
  usedClients: number;
  version: number;
  updatedAt: string;
};

export type CreateCheckoutInput = {
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
};

export type PaymentCardTokenInput = {
  cardTokenId: string;
  idempotencyKey: string;
};

export type SubscriptionMutationResult = {
  accepted: true;
  subscriptionId: string;
  status: "processing" | "trialing" | "active";
};

export type CheckoutSession = {
  id: string;
  url: string;
  expiresAt: string;
};

export type BillingPortalSession = { url: string; expiresAt: string };

export type BillingSummary = {
  status: SubscriptionStatus;
  priceCents: number;
  currency: "BRL";
  nextPaymentAt: string | null;
  paymentMethodLabel: string | null;
  cancelAtPeriodEnd: boolean;
};

export type AdminPlanOverrideInput = {
  providerUserId: string;
  plan: PlanCode;
  reason: string;
  idempotencyKey: string;
};

export type SubscriptionErrorCode =
  | "PROVIDER_PROFILE_REQUIRED"
  | "TRIAL_ALREADY_USED"
  | "CHECKOUT_ALREADY_OPEN"
  | "SUBSCRIPTION_NOT_FOUND"
  | "PAYMENT_PAST_DUE"
  | "PAYMENT_PROVIDER_NOT_CONFIGURED"
  | "CARD_TOKEN_INVALID"
  | "CARD_UPDATE_FAILED"
  | "SUBSCRIPTION_STORAGE_ERROR"
  | "MERCADO_PAGO_ERROR"
  | "OPERATION_IN_PROGRESS"
  | "PLAN_LIMIT_REACHED"
  | "FORBIDDEN"
  | "SESSION_EXPIRED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export class SubscriptionError extends Error {
  constructor(
    public readonly code: SubscriptionErrorCode,
    message: string,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "SubscriptionError";
  }
}
