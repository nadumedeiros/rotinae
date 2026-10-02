import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { PageLoadingOverlay } from "@/src/components/ui/page-loading-overlay";
import { MobileTabBar } from "@/src/components/layout/mobile-tab-bar";
import { AppIcon } from "@/src/components/ui/app-icon";
import type { BillingSummary } from "@/src/domain/subscriptions/types";
import { subscriptionService } from "@/src/infra/subscriptions/supabase-subscription-adapter";
import { colors, elevation, opacity, radius, spacing, typography } from "@/src/theme/tokens";

export default function SubscriptionBillingScreen() {
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [feedback, setFeedback] = useState("");
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error">("success");
  const [resuming, setResuming] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [confirmCancellation, setConfirmCancellation] = useState(false);

  useEffect(() => {
    subscriptionService.getBillingSummary().then(setBilling);
  }, []);

  async function resume() {
    setResuming(true);
    try {
      await subscriptionService.resumeSubscription(`resume-${Date.now()}`);
      setBilling(await subscriptionService.getBillingSummary());
      setFeedbackTone("success");
      setFeedback("Cancelamento desfeito. Sua assinatura continuará ativa.");
    } catch (resumeError) {
      setFeedbackTone("error");
      setFeedback(resumeError instanceof Error ? resumeError.message : "Não foi possível desfazer o cancelamento agora.");
    } finally {
      setResuming(false);
    }
  }

  async function cancel() {
    setCanceling(true);
    try {
      await subscriptionService.scheduleCancellation(`cancel-${Date.now()}`);
      setBilling(await subscriptionService.getBillingSummary());
      setConfirmCancellation(false);
      setFeedbackTone("success");
      setFeedback("Cancelamento agendado. O Premium permanece ativo até o fim do período atual.");
    } catch (cancelError) {
      setFeedbackTone("error");
      setFeedback(cancelError instanceof Error ? cancelError.message : "Não foi possível cancelar a assinatura agora.");
    } finally {
      setCanceling(false);
    }
  }

  if (!billing) return <SafeAreaView style={styles.safe}><AuthenticatedHeader /><PageLoadingOverlay /></SafeAreaView>;

  const nextPayment = billing.nextPaymentAt
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(new Date(billing.nextPaymentAt))
    : "Sem cobrança programada";

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <Pressable onPress={() => router.back()} style={styles.back}><AppIcon name="back" size={16} color={colors.brand} /><Text style={styles.backText}>Planos</Text></Pressable>
          <View><Text style={styles.eyebrow}>ASSINATURA PREMIUM</Text><Text accessibilityRole="header" style={styles.title}>Cobrança e pagamento</Text><Text style={styles.description}>Consulte a próxima cobrança e gerencie sua assinatura com segurança.</Text></View>

          {billing.status === "past_due" && <View style={styles.errorNotice}><AppIcon name="warning" size={20} color={colors.danger} /><View style={styles.flex}><Text style={styles.errorTitle}>Falha na cobrança</Text><Text style={styles.helper}>Atualize a forma de pagamento para evitar a mudança para o Gratuito.</Text></View></View>}
          {feedback ? (
            feedbackTone === "error" ? (
              <View style={styles.errorNotice}><AppIcon name="warning" size={20} color={colors.danger} /><Text style={styles.errorTitle}>{feedback}</Text></View>
            ) : (
              <View style={styles.successNotice}><AppIcon name="success" size={20} color={colors.success} /><Text style={styles.successText}>{feedback}</Text></View>
            )
          ) : null}

          <View style={styles.card}>
            <View style={styles.cardHeader}><View style={styles.cardIcon}><AppIcon name="financial" size={24} color={colors.brand} /></View><View style={styles.flex}><Text style={styles.cardLabel}>VALOR MENSAL</Text><Text style={styles.price}>R$ 29,00</Text></View><View style={styles.status}><Text style={styles.statusText}>{billing.cancelAtPeriodEnd ? "Cancelamento agendado" : billing.status === "active" ? "Ativa" : billing.status === "trialing" ? "Em teste" : billing.status}</Text></View></View>
            <View style={styles.rows}>
              <View style={styles.row}><Text style={styles.rowLabel}>Próxima cobrança</Text><Text style={styles.rowValue}>{nextPayment}</Text></View>
              <View style={styles.row}><Text style={styles.rowLabel}>Forma de pagamento</Text><Text style={styles.rowValue}>{billing.paymentMethodLabel ?? "Será definida no checkout"}</Text></View>
            </View>
            <Pressable onPress={() => router.push({ pathname: "/subscription-checkout", params: { mode: "update" } })} style={styles.secondary}><AppIcon name="edit" size={16} color={colors.brand} /><Text style={styles.secondaryText}>Trocar cartão</Text></Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Gerenciar assinatura</Text>
            <Text style={styles.helper}>{billing.cancelAtPeriodEnd ? "O Premium continua ativo até o fim do período. Você ainda pode desfazer o cancelamento." : "Você pode cancelar na página de Planos. O acesso permanece até o fim do período vigente."}</Text>
            {billing.cancelAtPeriodEnd ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: resuming, busy: resuming }}
                disabled={resuming}
                onPress={() => void resume()}
                style={({ pressed }) => [
                  styles.primary,
                  styles.primaryRow,
                  pressed && !resuming && { opacity: opacity.pressed },
                ]}
              >
                {resuming && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.primaryText}>Desfazer cancelamento</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => setConfirmCancellation(true)} style={styles.dangerButton}><Text style={styles.dangerButtonText}>Cancelar plano</Text></Pressable>
            )}
          </View>
        </View>
      </ScrollView>
      <MobileTabBar />
      <Modal transparent visible={confirmCancellation} animationType="fade" onRequestClose={() => setConfirmCancellation(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text accessibilityRole="header" style={styles.cardTitle}>Cancelar plano Premium?</Text>
            <Text style={styles.helper}>As próximas cobranças serão interrompidas. Você continuará com acesso Premium até o fim do período atual.</Text>
            <View style={styles.modalActions}>
              <Pressable disabled={canceling} onPress={() => setConfirmCancellation(false)} style={styles.secondary}><Text style={styles.secondaryText}>Manter plano</Text></Pressable>
              <Pressable disabled={canceling} onPress={() => void cancel()} style={styles.dangerButton}>{canceling && <ActivityIndicator size="small" color={colors.onBrand} />}<Text style={styles.dangerButtonText}>Confirmar cancelamento</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas }, scroll: { flexGrow: 1 }, content: { width: "100%", maxWidth: 800, alignSelf: "center", padding: spacing.lg, gap: spacing.lg }, loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  back: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: spacing.xs }, backText: { color: colors.brand, fontFamily: typography.family.semibold },
  eyebrow: { color: colors.brand, fontFamily: typography.family.bold, fontSize: typography.size.caption, letterSpacing: 1.2 }, title: { marginTop: spacing.xs, color: colors.ink, fontFamily: typography.family.bold, fontSize: 34 }, description: { marginTop: spacing.xs, color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.bodyLarge },
  card: { padding: spacing.lg, gap: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, ...elevation.card }, cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md }, cardIcon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.brandSoft }, flex: { flex: 1 }, cardLabel: { color: colors.mutedSoft, fontFamily: typography.family.bold, fontSize: typography.size.caption }, price: { marginTop: spacing.xs, color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title }, cardTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.subtitle },
  status: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.successSoft }, statusText: { color: colors.success, fontFamily: typography.family.semibold, fontSize: typography.size.caption }, rows: { gap: spacing.sm }, row: { paddingVertical: spacing.sm, flexDirection: "row", justifyContent: "space-between", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, rowLabel: { color: colors.muted, fontFamily: typography.family.medium }, rowValue: { flex: 1, color: colors.ink, fontFamily: typography.family.semibold, textAlign: "right" },
  errorNotice: { padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.dangerSoft }, errorTitle: { color: colors.danger, fontFamily: typography.family.bold }, successNotice: { padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.successSoft }, successText: { flex: 1, color: colors.success, fontFamily: typography.family.semibold }, helper: { color: colors.muted, fontFamily: typography.family.regular },
  primary: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.brand }, primaryRow: { flexDirection: "row", gap: spacing.sm }, primaryText: { color: colors.onBrand, fontFamily: typography.family.bold }, secondary: { minHeight: 48, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm }, secondaryText: { color: colors.brand, fontFamily: typography.family.semibold },
  dangerButton: { minHeight: 48, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.danger }, dangerButtonText: { color: colors.onBrand, fontFamily: typography.family.bold },
  modalBackdrop: { flex: 1, padding: spacing.lg, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(22, 18, 31, 0.55)" }, modalCard: { width: "100%", maxWidth: 480, padding: spacing.lg, gap: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, ...elevation.card }, modalActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.sm },
});
