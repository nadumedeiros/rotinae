import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { MercadoPagoCardForm } from "@/src/components/subscriptions/mercado-pago-card-form";
import { isMercadoPagoPublicKeyConfigured } from "@/src/components/subscriptions/mercado-pago-card-form.types";
import { AppIcon } from "@/src/components/ui/app-icon";
import { supabaseAuthService as authService } from "@/src/infra/auth/supabase-auth-adapter";
import { subscriptionService } from "@/src/infra/subscriptions/supabase-subscription-adapter";
import { colors, elevation, radius, spacing, typography } from "@/src/theme/tokens";

export default function SubscriptionCheckoutScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const updatingCard = mode === "update";
  const publicKey = process.env.EXPO_PUBLIC_MERCADO_PAGO_PUBLIC_KEY?.trim() ?? "";
  const configured = isMercadoPagoPublicKeyConfigured(publicKey);
  const [formKey, setFormKey] = useState(0);
  const [accessReady, setAccessReady] = useState(false);
  const [formLoading, setFormLoading] = useState(configured);
  const [submitting, setSubmitting] = useState(false);
  const submissionRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void authService.getSession().then((session) => {
      if (!active) return;
      if (session?.user.activeRole !== "provider") {
        router.replace("/login");
        return;
      }
      setAccessReady(true);
    });
    return () => { active = false; };
  }, []);

  async function submitCard(cardTokenId: string) {
    if (submissionRef.current) return;
    submissionRef.current = true;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const input = { cardTokenId, idempotencyKey: `${updatingCard ? "card" : "subscription"}-${Date.now()}` };
      if (updatingCard) {
        await subscriptionService.updatePaymentCard(input);
        setSuccess("Cartão confirmado. O novo meio de pagamento será usado nas próximas cobranças.");
      } else {
        await subscriptionService.createPremiumSubscription(input);
        router.replace("/subscription-return");
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível concluir a operação agora.");
      // CardToken é descartável. Remontar o formulário evita reutilização em nova tentativa.
      setFormKey((current) => current + 1);
      setFormLoading(true);
    } finally {
      submissionRef.current = false;
      setSubmitting(false);
    }
  }

  return <SafeAreaView style={styles.safe}>
    <AuthenticatedHeader />
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.content}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backAction}>
          <AppIcon name="back" size={20} color={colors.brand} />
          <Text style={styles.backText}>Voltar aos planos</Text>
        </Pressable>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>ASSINATURA PREMIUM</Text>
          <Text accessibilityRole="header" style={styles.title}>{updatingCard ? "Trocar cartão" : "Finalizar assinatura"}</Text>
          <Text style={styles.description}>{updatingCard ? "Informe o novo cartão que será usado nas próximas cobranças." : "Confira o resumo do plano e preencha os dados de pagamento."}</Text>
        </View>
        <View style={styles.grid}>
          <View style={styles.card}>
            <View style={styles.secureRow}><View style={styles.icon}><AppIcon name="lock" size={24} color={colors.brand} /></View><View style={styles.flex}><Text style={styles.cardTitle}>Dados de pagamento</Text><Text style={styles.muted}>Preencha os campos abaixo.</Text></View></View>
            {!accessReady ? (
              <View style={styles.formPlaceholder}><ActivityIndicator color={colors.brand} /><Text style={styles.muted}>Confirmando sua sessão…</Text></View>
            ) : !configured ? (
              <View style={styles.warning}><AppIcon name="warning" size={20} color={colors.warning} /><Text style={styles.warningText}>Configure a chave pública de teste para carregar o formulário seguro.</Text></View>
            ) : (
              <View style={styles.formHost}>
                {formLoading && <View style={styles.formLoading}><ActivityIndicator color={colors.brand} /><Text style={styles.muted}>Carregando formulário seguro do Mercado Pago…</Text></View>}
                <MercadoPagoCardForm
                  key={formKey}
                  publicKey={publicKey}
                  amount="29.00"
                  disabled={submitting}
                  submitLabel={updatingCard ? "Salvar novo cartão" : "Assinar Premium"}
                  onReady={() => setFormLoading(false)}
                  onLoadingChange={(loading) => {
                    if (loading || !submissionRef.current) setSubmitting(loading);
                  }}
                  onToken={(cardTokenId) => void submitCard(cardTokenId)}
                  onError={(message) => { setError(message); setFormLoading(false); }}
                />
              </View>
            )}
            {error && <View accessibilityRole="alert" style={styles.error}><AppIcon name="error" size={20} color={colors.danger} /><Text style={styles.errorText}>{error}</Text></View>}
            {success && <View accessibilityRole="alert" style={styles.success}><AppIcon name="success" size={20} color={colors.success} /><Text style={styles.successText}>{success}</Text></View>}
            {submitting && <View style={styles.processing}><ActivityIndicator color={colors.brand} /><Text style={styles.muted}>{updatingCard ? "Confirmando o novo cartão…" : "Criando sua assinatura com segurança…"}</Text></View>}
          </View>
          <View style={styles.summary}><Text style={styles.cardTitle}>Resumo</Text><View style={styles.line}><Text style={styles.muted}>Plano</Text><Text style={styles.value}>Premium</Text></View>{!updatingCard && <View style={styles.line}><Text style={styles.muted}>Período inicial</Text><Text style={styles.value}>30 dias grátis</Text></View>}<View style={styles.line}><Text style={styles.muted}>{updatingCard ? "Mensalidade" : "Depois"}</Text><Text style={styles.value}>R$ 29,00/mês</Text></View><Text style={styles.note}>{updatingCard ? "O cartão atual continuará válido até a confirmação do novo cartão." : "Você poderá cancelar antes da próxima cobrança. Seus dados e agendamentos serão preservados."}</Text></View>
        </View>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({safe:{flex:1,backgroundColor:colors.canvas},scroll:{flexGrow:1},content:{width:"100%",maxWidth:1040,alignSelf:"center",padding:spacing.lg,gap:spacing.lg},backAction:{alignSelf:"flex-start",minHeight:44,flexDirection:"row",alignItems:"center",justifyContent:"flex-start",gap:spacing.xs},backText:{color:colors.brand,fontFamily:typography.family.semibold,fontSize:typography.size.body},heading:{gap:spacing.xs},eyebrow:{color:colors.brand,fontFamily:typography.family.bold,fontSize:typography.size.caption,letterSpacing:1.2},title:{color:colors.ink,fontFamily:typography.family.bold,fontSize:32},description:{maxWidth:720,color:colors.muted,fontFamily:typography.family.regular,fontSize:typography.size.bodyLarge},grid:{flexDirection:"row",flexWrap:"wrap",gap:spacing.lg,alignItems:"flex-start"},card:{flex:2,minWidth:300,padding:spacing.lg,gap:spacing.lg,borderWidth:1,borderColor:colors.border,borderRadius:radius.lg,backgroundColor:colors.surface,...elevation.card},summary:{flex:1,minWidth:260,padding:spacing.lg,gap:spacing.md,borderWidth:1,borderColor:colors.border,borderRadius:radius.lg,backgroundColor:colors.surface},secureRow:{flexDirection:"row",alignItems:"center",gap:spacing.md},icon:{width:48,height:48,alignItems:"center",justifyContent:"center",borderRadius:radius.pill,backgroundColor:colors.brandSoft},flex:{flex:1},cardTitle:{color:colors.ink,fontFamily:typography.family.bold,fontSize:typography.size.subtitle},muted:{color:colors.muted,fontFamily:typography.family.regular},warning:{padding:spacing.md,flexDirection:"row",gap:spacing.sm,borderRadius:radius.sm,backgroundColor:colors.warningSoft},warningText:{flex:1,color:colors.warning,fontFamily:typography.family.medium},formPlaceholder:{minHeight:220,alignItems:"center",justifyContent:"center",gap:spacing.sm,borderWidth:1,borderStyle:"dashed",borderColor:colors.borderStrong,borderRadius:radius.md},formHost:{minHeight:570,position:"relative"},formLoading:{...StyleSheet.absoluteFillObject,zIndex:2,alignItems:"center",justifyContent:"center",gap:spacing.sm,backgroundColor:colors.surface},processing:{flexDirection:"row",alignItems:"center",gap:spacing.sm},error:{padding:spacing.md,flexDirection:"row",alignItems:"center",gap:spacing.sm,borderRadius:radius.sm,backgroundColor:colors.dangerSoft},errorText:{flex:1,color:colors.danger,fontFamily:typography.family.semibold},success:{padding:spacing.md,flexDirection:"row",alignItems:"center",gap:spacing.sm,borderRadius:radius.sm,backgroundColor:colors.successSoft},successText:{flex:1,color:colors.success,fontFamily:typography.family.semibold},line:{flexDirection:"row",justifyContent:"space-between",gap:spacing.md},value:{color:colors.ink,fontFamily:typography.family.bold},note:{paddingTop:spacing.md,borderTopWidth:1,borderTopColor:colors.border,color:colors.muted,fontFamily:typography.family.regular,lineHeight:22}});
