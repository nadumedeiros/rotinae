import type {
  AdminPlanOverrideInput,
  BillingSummary,
  BillingPortalSession,
  CheckoutSession,
  CreateCheckoutInput,
  PaymentCardTokenInput,
  ProviderEntitlement,
  SubscriptionMutationResult,
} from "./types";

/** Porta do plano SaaS do Rotinaê. Não representa pagamentos entre prestador e cliente. */
export interface SubscriptionPort {
  getEntitlement(): Promise<ProviderEntitlement>;
  getBillingSummary(): Promise<BillingSummary>;
  createPremiumSubscription(input: PaymentCardTokenInput): Promise<SubscriptionMutationResult>;
  updatePaymentCard(input: PaymentCardTokenInput): Promise<SubscriptionMutationResult>;
  createPremiumCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  scheduleCancellation(idempotencyKey: string): Promise<ProviderEntitlement>;
  resumeSubscription(idempotencyKey: string): Promise<ProviderEntitlement>;
  createBillingPortal(returnUrl: string): Promise<BillingPortalSession>;
}

/** Operações de suporte restritas e obrigatoriamente auditadas no servidor. */
export interface AdminSubscriptionPort {
  setPlanOverride(input: AdminPlanOverrideInput): Promise<ProviderEntitlement>;
  clearPlanOverride(
    providerUserId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<ProviderEntitlement>;
}
