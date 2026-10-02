import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { PageLoadingOverlay } from "@/src/components/ui/page-loading-overlay";
import { ClientMobileTabBar } from "@/src/components/layout/client-mobile-tab-bar";
import { AppIcon } from "@/src/components/ui/app-icon";
import type { ClientProviderLink } from "@/src/domain/clients/types";
import { clientPortfolioService } from "@/src/infra/clients/supabase-client-portfolio-adapter";
import { breakpoints, colors, elevation, layout, opacity, radius, spacing, typography } from "@/src/theme/tokens";

export default function ClientProvidersScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const [code, setCode] = useState("");
  const [feedback, setFeedback] = useState("");
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [providers, setProviders] = useState<ClientProviderLink[]>([]);
  // Feedback visual de clique (padrão Nero): estado de pendência dedicado do
  // botão "Tentar novamente" — `loadProviders` já zera `loadError` de forma
  // síncrona antes do primeiro `await`, então sem este estado próprio o
  // bloco de erro (e o botão) desmontariam antes de o loading poder ser
  // percebido.
  const [retrying, setRetrying] = useState(false);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setProviders(await clientPortfolioService.listClientProviderLinks());
    } catch (error) {
      setProviders([]);
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar seus vínculos.");
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => { void loadProviders(); }, [loadProviders]);

  async function handleRetry() {
    setRetrying(true);
    try {
      await loadProviders();
    } finally {
      setRetrying(false);
    }
  }

  async function sendRequest() {
    const normalizedCode = code.trim().toUpperCase();
    if (normalizedCode.length < 6) {
      setCodeInvalid(true);
      setFeedback("Confira o código informado.");
      return;
    }
    setSubmitting(true);
    setCodeInvalid(false);
    setFeedback("");
    try {
      await clientPortfolioService.redeemProviderLinkCode(normalizedCode);
      setCode("");
      setFeedback("Solicitação enviada. Aguarde a aprovação do prestador.");
      await loadProviders();
    } catch (error) {
      setCodeInvalid(true);
      setFeedback(error instanceof Error ? error.message : "Não foi possível solicitar o vínculo.");
    } finally {
      setSubmitting(false);
    }
  }

  return <SafeAreaView style={styles.safe}>
    <AuthenticatedHeader />
    {initialLoading && <PageLoadingOverlay />}
    <ScrollView contentContainerStyle={styles.scroll}><View style={[styles.content, !wide && styles.mobile]}>
      <View style={styles.heading}><Text style={styles.eyebrow}>SEUS VÍNCULOS</Text><Text style={[styles.title, !wide && styles.titleMobile]}>Prestadores</Text><Text style={styles.subtitle}>Cada prestador mantém agenda, pacotes e informações separados.</Text></View>
      <View style={styles.linkCard}><View style={styles.iconBox}><AppIcon name="security" size={24} color={colors.brand} /></View><View style={styles.flex}><Text style={styles.cardTitle}>Adicionar com um código<Text style={styles.requiredMark}> *</Text></Text><Text style={styles.cardText}>Use o código compartilhado pelo prestador. O vínculo só fica ativo depois da aprovação.</Text><View style={[styles.form, !wide && styles.formMobile]}><TextInput accessibilityLabel="Código do prestador" value={code} editable={!submitting} onChangeText={(value) => { setCode(value.toUpperCase()); setFeedback(""); setCodeInvalid(false); }} placeholder="Ex.: AGENDA-8F2K" placeholderTextColor={colors.mutedSoft} style={[styles.input, codeInvalid && styles.inputError]} /><Pressable accessibilityRole="button" accessibilityState={{ disabled: submitting, busy: submitting }} disabled={submitting} onPress={() => void sendRequest()} style={({ pressed }) => [styles.button, styles.buttonContent, pressed && !submitting && { opacity: opacity.pressed }, submitting && styles.buttonDisabled]}>{submitting && <ActivityIndicator size="small" color={colors.onBrand} />}<Text style={styles.buttonText}>Solicitar vínculo</Text></Pressable></View>{!!feedback && <Text accessibilityRole="alert" style={[styles.feedback, codeInvalid && styles.feedbackError]}>{feedback}</Text>}</View></View>
      <View style={styles.sectionHead}><Text style={styles.sectionTitle}>Seus prestadores</Text><Text style={styles.count}>{providers.length}</Text></View>
      {loading && !retrying && <View style={styles.card}><Text style={styles.cardText}>Carregando vínculos...</Text></View>}
      {(retrying || (!loading && !!loadError)) && <View style={styles.card}><Text accessibilityRole="alert" style={styles.feedbackError}>{loadError}</Text><Pressable accessibilityRole="button" accessibilityState={{ disabled: retrying, busy: retrying }} disabled={retrying} onPress={() => void handleRetry()} style={({ pressed }) => [styles.retry, styles.retryContent, pressed && !retrying && { opacity: opacity.pressed }]}>{retrying && <ActivityIndicator size="small" color={colors.brand} />}<Text style={styles.retryText}>Tentar novamente</Text></Pressable></View>}
      {!loading && !loadError && !providers.length && <View style={styles.card}><Text style={styles.cardTitle}>Nenhum vínculo</Text><Text style={styles.cardText}>Informe o código de um prestador para enviar sua primeira solicitação.</Text></View>}
      <View style={[styles.grid, wide && styles.gridWide]}>{providers.map((provider) => {
        // Combina profissão (DEC-137, opcional) com o status do vínculo — nunca
        // substitui o status, só complementa quando preenchida (RN-PRF-005,
        // docs/HANDOFF_UX_SERVICOS_DANTE.md seção 12.4).
        const statusLabel = provider.status === "active" ? "Vínculo aprovado" : "Aguardando aprovação";
        const subline = provider.profession ? `${provider.profession} · ${statusLabel}` : statusLabel;
        return <View key={provider.id} style={styles.card}><View style={styles.providerTop}><View style={styles.avatar}><AppIcon name="provider" size={22} color={colors.onBrand} /></View><View style={styles.flex}><Text style={styles.providerName}>{provider.providerName ?? "Prestador"}</Text><Text style={styles.subline}>{subline}</Text></View><View style={[styles.active, provider.status === "pending" && styles.pending]}><Text style={[styles.activeText, provider.status === "pending" && styles.pendingText]}>{provider.status === "active" ? "Ativo" : "Pendente"}</Text></View></View></View>;
      })}</View>
    </View></ScrollView>
    <ClientMobileTabBar />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas }, scroll: { flexGrow: 1 }, content: { width: "100%", maxWidth: layout.contentMax, alignSelf: "center", padding: spacing.xl, gap: spacing.lg }, mobile: { padding: spacing.md, paddingTop: spacing.lg }, heading: { gap: spacing.xs, marginBottom: spacing.sm }, eyebrow: { color: colors.brand, fontFamily: typography.family.bold, fontSize: typography.size.caption, letterSpacing: 1.1 }, title: { color: colors.ink, fontFamily: typography.family.bold, fontSize: 36, lineHeight: 42 }, titleMobile: { fontSize: 30, lineHeight: 36 }, subtitle: { maxWidth: 620, color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.bodyLarge, lineHeight: typography.lineHeight.bodyLarge }, linkCard: { padding: spacing.lg, flexDirection: "row", gap: spacing.md, borderRadius: radius.lg, backgroundColor: colors.brandSoft }, iconBox: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surface }, flex: { flex: 1, minWidth: 0 }, cardTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.subtitle }, cardText: { marginTop: spacing.xs, color: colors.muted, fontFamily: typography.family.regular, lineHeight: typography.lineHeight.body }, form: { marginTop: spacing.md, flexDirection: "row", gap: spacing.sm }, formMobile: { flexDirection: "column" }, input: { minHeight: 48, flex: 1, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, backgroundColor: colors.surface, color: colors.ink, fontFamily: typography.family.semibold }, inputError: { borderColor: colors.danger }, requiredMark: { color: colors.danger }, button: { minHeight: 48, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.brand }, buttonDisabled: { opacity: 0.6 },
  // Layout auxiliar para acomodar o `ActivityIndicator` de loading ao lado
  // do texto, sem alterar a altura/estrutura do botão (mesmo padrão de
  // `app/agenda.tsx`/`app/dashboard.tsx`).
  buttonContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  buttonText: { color: colors.onBrand, fontFamily: typography.family.bold }, feedback: { marginTop: spacing.sm, color: colors.success, fontFamily: typography.family.semibold, fontSize: typography.size.caption }, feedbackError: { color: colors.danger, fontFamily: typography.family.semibold }, sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, sectionTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title }, count: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.brandSoft, color: colors.brand, fontFamily: typography.family.bold }, grid: { gap: spacing.md }, gridWide: { flexDirection: "row", flexWrap: "wrap" }, card: { flex: 1, minWidth: 280, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, ...elevation.card }, providerTop: { flexDirection: "row", alignItems: "center", gap: spacing.md }, avatar: { width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.brand }, providerName: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.bodyLarge }, subline: { marginTop: spacing.xs, color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.caption }, active: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.successSoft }, activeText: { color: colors.success, fontFamily: typography.family.bold, fontSize: 10 }, pending: { backgroundColor: colors.warningSoft }, pendingText: { color: colors.warning }, retry: { alignSelf: "flex-start", padding: spacing.sm }, retryContent: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, retryText: { color: colors.brand, fontFamily: typography.family.bold },
});
