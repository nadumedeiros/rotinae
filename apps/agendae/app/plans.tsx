import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { PageLoadingOverlay } from "@/src/components/ui/page-loading-overlay";
import { MobileTabBar } from "@/src/components/layout/mobile-tab-bar";
import { AppIcon } from "@/src/components/ui/app-icon";
import type { ProviderEntitlement } from "@/src/domain/subscriptions/types";
import { getPlansLayout } from "@/src/domain/subscriptions/plans-platform";
import { supabaseAuthService as authService } from "@/src/infra/auth/supabase-auth-adapter";
import { subscriptionService } from "@/src/infra/subscriptions/supabase-subscription-adapter";
import { providerPlanUpdatedEvent } from "@/src/hooks/use-provider-plan";
import { breakpoints, colors, elevation, layout, opacity, radius, spacing, typography } from "@/src/theme/tokens";

type Plan = "free" | "premium";
type PlanState = {
  plan: Plan;
  source: "trial" | "manual" | "subscription";
  trialEndsAt?: string;
  trialEndsAtIso?: string;
  cancelAtPeriodEnd?: boolean;
};
const initialPlan: PlanState = {
  plan: "free",
  source: "manual",
  cancelAtPeriodEnd: false,
};

function toPlanState(entitlement: ProviderEntitlement): PlanState {
  const trialEndsAtIso = entitlement.trialEndsAt ?? undefined;
  return {
    plan: entitlement.plan,
    source: entitlement.source === "trial" ? "trial" : entitlement.source === "subscription" ? "subscription" : "manual",
    trialEndsAtIso,
    trialEndsAt: trialEndsAtIso
      ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(trialEndsAtIso))
      : undefined,
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
  };
}

function cachePlan(state: PlanState) {
  if (Platform.OS !== "web" || typeof localStorage === "undefined") return;
  localStorage.setItem("agendae:provider-plan:v1", JSON.stringify(state));
  window.dispatchEvent(new Event(providerPlanUpdatedEvent));
}

const benefits = {
  free: ["Até 2 agendamentos por dia", "Até 5 clientes cadastrados", "Agenda não recorrente", "Sem inclusão de notas na página do cliente"],
  premium: ["Agendamentos ilimitados", "Recorrência e anexos", "Financeiro e indicadores", "Evolução detalhada e automações"],
};

export default function PlansScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const plansLayout = getPlansLayout(Platform.OS, wide);
  const [access, setAccess] = useState<"loading" | "allowed" | "denied">("loading");
  const [planState, setPlanState] = useState(initialPlan);
  const [premiumPriceCents, setPremiumPriceCents] = useState<number | null>(null);
  const [pending, setPending] = useState<Plan | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const planOrder: Plan[] = plansLayout.order;

  useEffect(() => {
    let active = true;
    void authService.getSession().then(async (session) => {
      if (!active) return;
      if (session?.user.activeRole !== "provider") {
        setAccess("denied");
        return;
      }
      setAccess("allowed");
      try {
        const [entitlement, billing] = await Promise.all([
          subscriptionService.getEntitlement(),
          subscriptionService.getBillingSummary(),
        ]);
        const next = toPlanState(entitlement);
        if (!active) return;
        setPlanState(next);
        setPremiumPriceCents(billing.priceCents);
        cachePlan(next);
      } catch {
        if (active) setFeedback("Não foi possível carregar o plano atual. Tente novamente.");
      }
    });
    return () => { active = false; };
  }, []);

  const premiumPrice = premiumPriceCents === null
    ? null
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(premiumPriceCents / 100);

  async function confirmChange() {
    if (!pending) return;
    setWorking(true);
    if (pending === "premium") {
      setPending(null);
      setWorking(false);
      router.push("/subscription-checkout");
      return;
    }
    try {
      const entitlement = await subscriptionService.scheduleCancellation(`cancel-${Date.now()}`);
      const next = toPlanState(entitlement);
      setPlanState(next);
      cachePlan(next);
      setFeedback("A assinatura foi cancelada e a nova condição já está refletida nesta conta.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível cancelar agora.");
    } finally {
      setPending(null);
      setWorking(false);
    }
  }

  async function resumeCancellation() {
    setWorking(true);
    const entitlement = await subscriptionService.resumeSubscription(`resume-${Date.now()}`);
    const next = toPlanState(entitlement);
    setPlanState(next);
    cachePlan(next);
    setFeedback("Cancelamento desfeito. O Premium continuará ativo normalmente.");
    setWorking(false);
  }

  if (access !== "allowed") return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      {access === "loading" && <PageLoadingOverlay />}
      <View style={styles.accessState}><View style={styles.accessCard}>
        <View style={styles.heroIcon}><AppIcon name={access === "loading" ? "schedule" : "lock"} size={32} color={colors.brand} /></View>
        <Text style={styles.modalTitle}>{access === "loading" ? "Carregando planos…" : "Planos exclusivos do prestador"}</Text>
        <Text style={styles.centerText}>{access === "loading" ? "Aguarde enquanto verificamos o perfil ativo." : "O perfil Cliente não contrata plano no modelo atual do Rotinaê."}</Text>
        {access === "denied" && <>
          <Pressable onPress={() => router.push("/switch-profile")} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Usar perfil de prestador</Text></Pressable>
          <Pressable onPress={() => router.replace("/client-home")} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Continuar como cliente</Text></Pressable>
        </>}
      </View></View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.content, !wide && styles.contentMobile]}>
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>PLANOS E ASSINATURA</Text>
            <Text accessibilityRole="header" style={[styles.title, !wide && styles.titleMobile]}>Escolha o plano ideal</Text>
            <Text style={styles.description}>Compare os recursos com clareza. Seus dados e agendamentos são preservados ao mudar de plano.</Text>
          </View>

          <View style={[styles.currentPlan, !wide && styles.currentPlanMobile]}>
            <View style={[styles.currentHeader, !wide && styles.currentHeaderMobile]}>
              <View style={styles.currentIcon}><AppIcon name="packages" size={24} color={colors.brand} /></View>
              <View style={styles.flex}>
                <Text style={styles.currentLabel}>PLANO ATUAL</Text>
                <Text style={styles.currentTitle}>{planState.plan === "premium" ? "Premium" : "Gratuito"}{planState.source === "trial" ? " · período de teste" : ""}</Text>
              </View>
              {!wide && (
                <View style={[styles.planBadge, planState.plan === "premium" && styles.planBadgePremium]}>
                  <Text style={[styles.planBadgeText, planState.plan === "premium" && styles.planBadgeTextPremium]}>
                    {planState.cancelAtPeriodEnd ? "Downgrade agendado" : planState.plan === "premium" ? "Ativo" : "Gratuito"}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.currentText}>
              {planState.source === "trial" ? planState.cancelAtPeriodEnd ? `Cancelamento agendado: use o Premium até ${planState.trialEndsAt}. Depois, o downgrade para o Gratuito será automático.` : `Seu teste termina em ${planState.trialEndsAt}.` : planState.plan === "free" ? "O Gratuito permite até 2 agendamentos por dia e 5 clientes." : "Agendamentos ilimitados ativos."}
            </Text>
            {wide ? (
              <View style={styles.planStatusActions}>
                <View style={[styles.planBadge, planState.plan === "premium" && styles.planBadgePremium]}><Text style={[styles.planBadgeText, planState.plan === "premium" && styles.planBadgeTextPremium]}>{planState.cancelAtPeriodEnd ? "Downgrade agendado" : planState.plan === "premium" ? "Ativo" : "Gratuito"}</Text></View>
                {planState.source === "subscription" && <Pressable disabled={working} onPress={() => router.push("/subscription-billing")}><Text style={styles.manageLink}>Gerenciar cobrança</Text></Pressable>}
                {planState.cancelAtPeriodEnd && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: working, busy: working }}
                    disabled={working}
                    onPress={() => void resumeCancellation()}
                    style={({ pressed }) => [
                      styles.manageLinkRow,
                      pressed && !working && { opacity: opacity.pressed },
                    ]}
                  >
                    {working && <ActivityIndicator size="small" color={colors.brand} />}
                    <Text style={styles.manageLink}>Desfazer cancelamento</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              (planState.source === "subscription" || planState.cancelAtPeriodEnd) && (
                <View style={styles.manageRowMobile}>
                  {planState.source === "subscription" && (
                    <Pressable disabled={working} onPress={() => router.push("/subscription-billing")} style={styles.manageButtonMobile}>
                      <Text style={styles.manageLink}>Gerenciar cobrança</Text>
                    </Pressable>
                  )}
                  {planState.cancelAtPeriodEnd && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: working, busy: working }}
                      disabled={working}
                      onPress={() => void resumeCancellation()}
                      style={({ pressed }) => [
                        styles.manageButtonMobile,
                        styles.manageLinkRow,
                        pressed && !working && { opacity: opacity.pressed },
                      ]}
                    >
                      {working && <ActivityIndicator size="small" color={colors.brand} />}
                      <Text style={styles.manageLink}>Desfazer cancelamento</Text>
                    </Pressable>
                  )}
                </View>
              )
            )}
          </View>

          <View style={[styles.planGrid, plansLayout.sideBySide && styles.planGridWide]}>
            {planOrder.map((plan) => {
              const current =
                planState.plan === plan &&
                (plan === "free" || planState.source !== "trial");
              const disabled =
                current ||
                (plan === "free" && planState.cancelAtPeriodEnd) ||
                (plan === "premium" && !premiumPrice);
              const actionLabel = current
                ? "Plano atual"
                : plan === "free" && planState.cancelAtPeriodEnd
                  ? "Downgrade agendado"
                  : plan === "premium"
                    ? premiumPrice
                      ? planState.source === "trial"
                        ? "Assinar Premium"
                        : "Começar teste grátis"
                      : "Preço indisponível"
                    : "Mudar para o Gratuito";

              return (
                <View
                  key={plan}
                  style={[
                    styles.planCard,
                    plansLayout.sideBySide ? styles.planCardWide : styles.planCardMobile,
                    plan === "premium" && styles.premiumCard,
                  ]}
                >
                  {plan === "premium" && <View style={styles.premiumGlow} />}

                  <View style={styles.planCardHeader}>
                    <View style={styles.flex}>
                      <Text style={[styles.planKicker, plan === "premium" && styles.planKickerPremium]}>
                        {plan === "free" ? "PARA COMEÇAR" : "PARA QUEM QUER MAIS FLUIDEZ"}
                      </Text>
                      <Text style={[styles.planName, plan === "premium" && styles.planNamePremium]}>
                        {plan === "free" ? "Gratuito" : "Premium"}
                      </Text>
                    </View>
                    {plan === "premium" && (
                      <View style={styles.trialBadge}>
                        <Text style={styles.trialBadgeText}>30 DIAS GRÁTIS</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.priceRow}>
                    <Text style={[styles.price, plan === "premium" && styles.pricePremium]}>
                      {plan === "free" ? "R$ 0" : premiumPrice ?? "Indisponível"}
                    </Text>
                    <Text style={[styles.pricePeriod, plan === "premium" && styles.pricePeriodPremium]}>
                      {plan === "free" ? "para sempre" : premiumPrice ? "/mês" : ""}
                    </Text>
                  </View>

                  <Text style={[styles.planDescription, plan === "premium" && styles.planDescriptionPremium]}>
                    {plan === "free"
                      ? "O essencial para organizar uma rotina menor."
                      : premiumPrice
                        ? `Aproveite tudo por 30 dias. Depois, continue por ${premiumPrice}/mês se fizer sentido para você.`
                        : "Não foi possível consultar o preço oficial agora."}
                  </Text>

                  <View style={[styles.planRule, plan === "premium" && styles.planRulePremium]} />

                  <View style={styles.benefitList}>
                    {benefits[plan].map((benefit) => (
                      <View key={benefit} style={styles.benefit}>
                        <AppIcon
                          name="success"
                          size={18}
                          color={plan === "premium" ? colors.accent : colors.success}
                        />
                        <Text style={[styles.benefitText, plan === "premium" && styles.benefitTextPremium]}>
                          {benefit}
                        </Text>
                      </View>
                    ))}
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${actionLabel}, plano ${plan === "free" ? "Gratuito" : "Premium"}`}
                    accessibilityState={{ disabled }}
                    disabled={disabled}
                    onPress={() => setPending(plan)}
                    style={({ pressed }) => [
                      styles.planAction,
                      plan === "premium" && styles.planActionPremium,
                      disabled && styles.disabled,
                      pressed && !disabled && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.planActionText, plan === "premium" && styles.planActionTextPremium]}>
                      {actionLabel}
                    </Text>
                    {!disabled && plan === "premium" && (
                      <AppIcon name="forward" size={16} color={colors.brandDark} />
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>

          <View style={styles.trustNote}>
            <View style={styles.trustIcon}><AppIcon name="security" size={17} color={colors.brand} /></View>
            <Text style={styles.trustText}>
              Pagamento protegido pelo Mercado Pago. Cancele quando quiser; seus dados e agendamentos continuam preservados.
            </Text>
          </View>

          {Platform.OS === "web" && <View style={[styles.footer, !wide && styles.footerMobile]}><Text style={styles.footerBrand}>rotina<Text style={styles.accent}>ê</Text></Text><Text style={styles.footerText}>© {new Date().getFullYear()} Rotinaê. Planos simples e transparentes.</Text></View>}
        </View>
      </ScrollView>

      <Modal visible={pending !== null} transparent animationType="fade" onRequestClose={() => setPending(null)}><View style={styles.backdrop}><View style={styles.modal}>
        <View style={styles.heroIcon}><AppIcon name="packages" size={32} color={colors.brand} /></View>
        <Text style={styles.modalTitle}>{pending === "premium" ? "Assinar o Premium?" : "Cancelar o Premium?"}</Text>
        <Text style={styles.centerText}>{pending === "premium" ? planState.source === "trial" ? `Você seguirá para o checkout seguro. A primeira cobrança de ${premiumPrice ?? "valor informado"} ficará para o término do seu teste, em ${planState.trialEndsAt}.` : `Você seguirá para o checkout seguro do Rotinaê, com os dados do cartão processados pelo Mercado Pago. Prestadores elegíveis recebem 30 dias grátis; depois, o Premium custa ${premiumPrice ?? "o valor informado no checkout"} por mês.` : "O cancelamento interrompe as próximas cobranças. Seus dados permanecem preservados, mas novas operações incompatíveis com o Gratuito ficam bloqueadas."}</Text>
        <View style={styles.modalActions}>
          <Pressable disabled={working} onPress={() => setPending(null)} style={[styles.secondaryButton, styles.formActionButton]}><Text style={styles.secondaryButtonText}>Cancelar</Text></Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: working, busy: working }}
            disabled={working}
            onPress={() => void confirmChange()}
            style={({ pressed }) => [
              styles.primaryButton,
              styles.formActionButton,
              styles.confirmButtonSpinnerRow,
              working && styles.disabled,
              pressed && !working && { opacity: opacity.pressed },
            ]}
          >
            {working && <ActivityIndicator size="small" color={colors.onBrand} />}
            <Text style={styles.primaryButtonText}>{pending === "premium" ? "Continuar para o checkout" : "Confirmar mudança"}</Text>
          </Pressable>
        </View>
      </View></View></Modal>

      <Modal visible={feedback !== null} transparent animationType="fade" onRequestClose={() => setFeedback(null)}><View style={styles.backdrop}><View style={styles.modal}><View style={styles.successIcon}><AppIcon name="warning" size={32} color={colors.brand} /></View><Text style={styles.modalTitle}>Aviso do plano</Text><Text style={styles.centerText}>{feedback}</Text><Pressable onPress={() => setFeedback(null)} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Entendi</Text></Pressable></View></View></Modal>
      <MobileTabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  formActionButton: { width: "100%", flex: 0, minWidth: 0, paddingHorizontal: spacing.md },
  scroll: { flexGrow: 1 }, content: { width: "100%", maxWidth: layout.contentMax, alignSelf: "center", padding: spacing.lg, gap: spacing.lg }, contentMobile: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  heading: { gap: spacing.xs }, eyebrow: { color: colors.brand, fontFamily: typography.family.bold, fontSize: typography.size.caption, letterSpacing: 1.2 }, title: { color: colors.ink, fontFamily: typography.family.bold, fontSize: 36 }, titleMobile: { fontSize: 30 }, description: { maxWidth: 720, color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.bodyLarge },
  currentPlan: { padding: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, backgroundColor: colors.brandSoft },
  currentPlanMobile: { padding: spacing.md, flexDirection: "column", alignItems: "stretch", gap: spacing.sm },
  currentHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  currentHeaderMobile: { alignItems: "center", gap: spacing.sm },
  currentIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.surface, flexShrink: 0 },
  flex: { flex: 1, minWidth: 0 },
  currentLabel: { color: colors.brand, fontFamily: typography.family.bold, fontSize: typography.size.caption, letterSpacing: 1.2 },
  currentTitle: { marginTop: spacing.xxs, color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.subtitle },
  currentText: { marginTop: spacing.xxs, color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.body, lineHeight: typography.lineHeight.body },
  planStatusActions: { alignItems: "flex-end", gap: spacing.sm, flexShrink: 0 },
  manageRowMobile: { marginTop: spacing.xs, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.borderStrong, flexDirection: "row", alignItems: "center" },
  manageButtonMobile: { minHeight: 36, justifyContent: "center" },
  planBadge: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.border, alignSelf: "flex-start" },
  planBadgePremium: { backgroundColor: colors.successSoft },
  planBadgeText: { color: colors.muted, fontFamily: typography.family.semibold, fontSize: typography.size.caption },
  planBadgeTextPremium: { color: colors.success },
  manageLink: { color: colors.brand, fontFamily: typography.family.bold, fontSize: typography.size.caption },
  manageLinkRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  confirmButtonSpinnerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  planGrid: { gap: spacing.md },
  planGridWide: { flexDirection: "row", alignItems: "stretch" },
  planCard: { minHeight: 474, padding: spacing.lg, gap: spacing.md, overflow: "hidden", borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, ...elevation.card },
  planCardWide: { flex: 1 },
  planCardMobile: { width: "100%" },
  premiumCard: { borderColor: colors.brandDark, backgroundColor: colors.brandDark, ...elevation.floating },
  premiumGlow: { position: "absolute", width: 280, height: 280, right: -140, top: -150, borderRadius: radius.pill, backgroundColor: colors.brand, opacity: 0.7 },
  planCardHeader: { minHeight: 54, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  planKicker: { color: colors.brand, fontFamily: typography.family.bold, fontSize: 10, letterSpacing: 0.9 },
  planKickerPremium: { color: colors.accent },
  planName: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title },
  planNamePremium: { color: colors.onBrand },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs },
  price: { color: colors.ink, fontFamily: typography.family.bold, fontSize: 40 },
  pricePremium: { color: colors.onBrand },
  pricePeriod: { color: colors.mutedSoft, fontFamily: typography.family.medium },
  pricePeriodPremium: { color: colors.accent },
  planDescription: { minHeight: 58, color: colors.muted, fontFamily: typography.family.regular, lineHeight: typography.lineHeight.body },
  planDescriptionPremium: { color: colors.accentSoft },
  planRule: { height: 1, backgroundColor: colors.border },
  planRulePremium: { backgroundColor: colors.brandMid },
  benefitList: { flex: 1, gap: spacing.sm },
  benefit: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  benefitText: { flex: 1, color: colors.ink, fontFamily: typography.family.regular, lineHeight: typography.lineHeight.body },
  benefitTextPremium: { color: colors.onBrand },
  trialBadge: { alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.accent },
  trialBadgeText: { color: colors.brandDark, fontFamily: typography.family.bold, fontSize: 9, letterSpacing: 0.3 },
  planAction: { minHeight: 50, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.sm, backgroundColor: colors.surface },
  planActionPremium: { borderColor: colors.onBrand, backgroundColor: colors.onBrand },
  planActionText: { color: colors.brand, fontFamily: typography.family.bold },
  planActionTextPremium: { color: colors.brandDark },
  disabled: { opacity: opacity.disabled },
  pressed: { opacity: opacity.pressed },
  trustNote: { maxWidth: 720, alignSelf: "center", paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  trustIcon: { width: 34, height: 34, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  trustText: { flexShrink: 1, color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.caption, lineHeight: typography.lineHeight.caption, textAlign: "center" },
  footer: { minHeight: 72, paddingTop: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }, footerMobile: { minHeight: 88, flexDirection: "column", justifyContent: "center", gap: spacing.xs }, footerBrand: { color: colors.brandDark, fontFamily: typography.family.bold, fontSize: typography.size.subtitle }, accent: { color: colors.brand }, footerText: { color: colors.mutedSoft, fontFamily: typography.family.regular, fontSize: typography.size.caption, textAlign: "center" },
  accessState: { flex: 1, padding: spacing.lg, alignItems: "center", justifyContent: "center" }, accessCard: { width: "100%", maxWidth: 440, padding: spacing.lg, alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, ...elevation.card },
  backdrop: { flex: 1, padding: spacing.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.overlay }, modal: { width: "100%", maxWidth: 440, maxHeight: "92%", padding: spacing.lg, alignItems: "center", gap: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, ...elevation.floating }, heroIcon: { width: 64, height: 64, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.brandSoft }, successIcon: { width: 64, height: 64, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.successSoft }, modalTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title, textAlign: "center" }, centerText: { color: colors.muted, fontFamily: typography.family.regular, textAlign: "center" }, modalActions: { width: "100%", flexDirection: "column-reverse", justifyContent: "center", gap: spacing.sm },
  primaryButton: { minHeight: 48, paddingHorizontal: spacing.lg, flexShrink: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.brand }, primaryButtonText: { color: colors.onBrand, fontFamily: typography.family.bold }, secondaryButton: { minHeight: 48, paddingHorizontal: spacing.lg, flexShrink: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm }, secondaryButtonText: { color: colors.brand, fontFamily: typography.family.semibold },
});
