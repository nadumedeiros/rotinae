import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { MobileTabBar } from "@/src/components/layout/mobile-tab-bar";
import { AppIcon } from "@/src/components/ui/app-icon";
import { PageLoadingOverlay } from "@/src/components/ui/page-loading-overlay";
import {
  financialMonthKey,
  financialMonthState,
  formatFinancialMonth,
  summarizeFinancialHistory,
} from "@/src/domain/payments/financial-history";
import { PaymentError, type FinancialHistoryMonth } from "@/src/domain/payments/types";
import { paymentService } from "@/src/infra/payments/supabase-payment-adapter";
import {
  breakpoints,
  colors,
  elevation,
  layout,
  opacity,
  radius,
  spacing,
  typography,
} from "@/src/theme/tokens";

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function MonthCard({ item, wide }: { item: FinancialHistoryMonth; wide: boolean }) {
  const state = financialMonthState(item.month);
  const stateLabel = state === "current" ? "Mês atual" : state === "future" ? "Futuro" : "Encerrado";

  return (
    <View style={styles.monthCard}>
      <View style={[styles.monthHeader, !wide && styles.monthHeaderMobile]}>
        <View style={styles.monthHeadingCopy}>
          <Text accessibilityRole="header" style={styles.monthTitle}>
            {formatFinancialMonth(item.month)}
          </Text>
          <Text style={styles.monthSubtitle}>
            {item.chargeCount} {item.chargeCount === 1 ? "lançamento a receber cadastrado" : "lançamentos a receber cadastrados"}
          </Text>
        </View>
        <View
          style={[
            styles.monthBadge,
            state === "current" && styles.monthBadgeCurrent,
            state === "future" && styles.monthBadgeFuture,
          ]}
        >
          <Text
            style={[
              styles.monthBadgeText,
              state === "current" && styles.monthBadgeTextCurrent,
              state === "future" && styles.monthBadgeTextFuture,
            ]}
          >
            {stateLabel}
          </Text>
        </View>
      </View>

      <View style={[styles.metrics, !wide && styles.metricsMobile]}>
        <View style={[styles.metric, styles.receivedMetric]}>
          <View style={styles.metricLabelRow}>
            <AppIcon name="success" size={17} color={colors.success} />
            <Text style={styles.metricLabel}>Recebido no mês</Text>
          </View>
          <Text style={[styles.metricValue, styles.receivedValue]}>
            {formatCurrency(item.receivedTotalCents)}
          </Text>
          <Text style={styles.metricHelper}>Pela data real do recebimento</Text>
        </View>

        <View style={styles.metric}>
          <View style={styles.metricLabelRow}>
            <AppIcon name="analytics" size={17} color={colors.brand} />
            <Text style={styles.metricLabel}>Previsto para o mês</Text>
          </View>
          <Text style={styles.metricValue}>{formatCurrency(item.expectedTotalCents)}</Text>
          <Text style={styles.metricHelper}>Saldo dos lançamentos cadastrados no mês</Text>
        </View>

        <View style={[styles.metric, item.outstandingTotalCents > 0 && styles.outstandingMetric]}>
          <View style={styles.metricLabelRow}>
            <AppIcon name="schedule" size={17} color={colors.warning} />
            <Text style={styles.metricLabel}>Ainda não recebido</Text>
          </View>
          <Text style={[styles.metricValue, item.outstandingTotalCents > 0 && styles.outstandingValue]}>
            {formatCurrency(item.outstandingTotalCents)}
          </Text>
          <Text style={styles.metricHelper}>
            {item.outstandingCount} {item.outstandingCount === 1 ? "lançamento em aberto" : "lançamentos em aberto"}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function FinancialHistoryScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const currentMonth = financialMonthKey();
  const currentYear = currentMonth.slice(0, 4);
  const [months, setMonths] = useState<FinancialHistoryMonth[]>([]);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await paymentService.getFinancialHistory();
      setMonths(result.months);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof PaymentError
          ? caught.message
          : "Não foi possível carregar o histórico financeiro.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const years = useMemo(
    () => Array.from(new Set(months.map((item) => item.month.slice(0, 4)))).sort((a, b) => b.localeCompare(a)),
    [months],
  );

  useEffect(() => {
    if (years.length > 0 && !years.includes(selectedYear)) setSelectedYear(years[0]);
  }, [selectedYear, years]);

  const visibleMonths = useMemo(
    () => months.filter((item) => item.month.startsWith(selectedYear)),
    [months, selectedYear],
  );
  const summary = useMemo(
    () => summarizeFinancialHistory(months, currentMonth),
    [currentMonth, months],
  );

  async function retry() {
    setRetrying(true);
    try {
      await load();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      {loading && <PageLoadingOverlay />}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.content, !wide && styles.contentMobile]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar para Financeiro"
            onPress={() => router.replace("/payments")}
            style={styles.backButton}
          >
            <AppIcon name="back" size={18} color={colors.brand} />
            <Text style={styles.backText}>Voltar para Financeiro</Text>
          </Pressable>

          <View style={styles.heading}>
            <View style={styles.headingIcon}>
              <AppIcon name="analytics" size={26} color={colors.brand} />
            </View>
            <View style={styles.headingCopy}>
              <Text style={styles.eyebrow}>FINANCEIRO</Text>
              <Text accessibilityRole="header" style={styles.title}>Histórico mensal</Text>
              <Text style={styles.description}>
                Veja quanto entrou em cada mês, o valor previsto e as pendências trazidas dos meses anteriores.
              </Text>
            </View>
          </View>

          {!loading && months.length > 0 && (
            <View style={[styles.overview, !wide && styles.overviewMobile]}>
              <View style={styles.overviewItem}>
                <Text style={styles.overviewLabel}>Recebido neste mês</Text>
                <Text style={[styles.overviewValue, styles.receivedValue]}>
                  {formatCurrency(summary.receivedCurrentMonthCents)}
                </Text>
              </View>
              <View style={styles.overviewItem}>
                <Text style={styles.overviewLabel}>Em aberto acumulado</Text>
                <Text style={[styles.overviewValue, styles.outstandingValue]}>
                  {formatCurrency(summary.outstandingTotalCents)}
                </Text>
              </View>
              <View style={styles.overviewItem}>
                <Text style={styles.overviewLabel}>A receber após este mês</Text>
                <Text style={styles.overviewValue}>
                  {formatCurrency(summary.futureExpectedTotalCents)}
                </Text>
              </View>
            </View>
          )}

          {error ? (
            <View accessibilityRole="alert" style={styles.errorCard}>
              <View style={styles.errorCopy}>
                <AppIcon name="warning" size={20} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: retrying, busy: retrying }}
                disabled={retrying}
                onPress={() => void retry()}
                style={({ pressed }) => [styles.retryButton, pressed && !retrying && { opacity: opacity.pressed }]}
              >
                {retrying && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.retryText}>Tentar novamente</Text>
              </Pressable>
            </View>
          ) : !loading && months.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <AppIcon name="financial" size={28} color={colors.brand} />
              </View>
              <Text style={styles.emptyTitle}>O histórico ainda está vazio</Text>
              <Text style={styles.emptyText}>
                Os meses aparecerão aqui assim que você registrar a primeira cobrança ou recebimento.
              </Text>
              <Pressable accessibilityRole="button" onPress={() => router.replace("/payments")} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Ir para Financeiro</Text>
              </Pressable>
            </View>
          ) : null}

          {!loading && months.length > 0 && (
            <>
              <View style={styles.yearSection}>
                <Text style={styles.sectionLabel}>ANO</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yearList}>
                  {years.map((year) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedYear === year }}
                      key={year}
                      onPress={() => setSelectedYear(year)}
                      style={[styles.yearButton, selectedYear === year && styles.yearButtonActive]}
                    >
                      <Text style={[styles.yearButtonText, selectedYear === year && styles.yearButtonTextActive]}>{year}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.monthList}>
                {visibleMonths.map((item) => <MonthCard item={item} key={item.month} wide={wide} />)}
              </View>
            </>
          )}
        </View>
      </ScrollView>
      <MobileTabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flexGrow: 1 },
  content: { width: "100%", maxWidth: layout.contentMax, alignSelf: "center", padding: spacing.xl, gap: spacing.lg },
  contentMobile: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  backButton: { minHeight: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: spacing.sm },
  backText: { color: colors.brand, fontFamily: typography.family.semibold, fontSize: typography.size.body },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  headingIcon: { width: 54, height: 54, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.brandSoft },
  headingCopy: { flex: 1, gap: spacing.xs },
  eyebrow: { color: colors.brand, fontFamily: typography.family.bold, fontSize: typography.size.caption, letterSpacing: 1.2 },
  title: { color: colors.ink, fontFamily: typography.family.bold, fontSize: 34, lineHeight: 40 },
  description: { maxWidth: 760, color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.bodyLarge, lineHeight: typography.lineHeight.bodyLarge },
  overview: { flexDirection: "row", gap: spacing.md },
  overviewMobile: { flexDirection: "column" },
  overviewItem: { flex: 1, minWidth: 0, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, ...elevation.card },
  overviewLabel: { color: colors.muted, fontFamily: typography.family.semibold, fontSize: typography.size.body },
  overviewValue: { color: colors.ink, fontFamily: typography.family.bold, fontSize: 26 },
  yearSection: { gap: spacing.sm },
  sectionLabel: { color: colors.mutedSoft, fontFamily: typography.family.bold, fontSize: typography.size.caption, letterSpacing: 1.1 },
  yearList: { gap: spacing.sm },
  yearButton: { minWidth: 74, minHeight: 44, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surface },
  yearButtonActive: { borderColor: colors.brand, backgroundColor: colors.brand },
  yearButtonText: { color: colors.brand, fontFamily: typography.family.semibold },
  yearButtonTextActive: { color: colors.onBrand },
  monthList: { gap: spacing.md },
  monthCard: { padding: spacing.lg, gap: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, ...elevation.card },
  monthHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  monthHeaderMobile: { alignItems: "flex-start" },
  monthHeadingCopy: { flex: 1, gap: spacing.xs },
  monthTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title },
  monthSubtitle: { color: colors.muted, fontFamily: typography.family.regular },
  monthBadge: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSubtle },
  monthBadgeCurrent: { backgroundColor: colors.brandSoft },
  monthBadgeFuture: { backgroundColor: colors.warningSoft },
  monthBadgeText: { color: colors.muted, fontFamily: typography.family.semibold, fontSize: typography.size.caption },
  monthBadgeTextCurrent: { color: colors.brand },
  monthBadgeTextFuture: { color: colors.warning },
  metrics: { flexDirection: "row", gap: spacing.md },
  metricsMobile: { flexDirection: "column" },
  metric: { flex: 1, minWidth: 0, padding: spacing.md, gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSubtle },
  receivedMetric: { backgroundColor: colors.successSoft },
  outstandingMetric: { backgroundColor: colors.warningSoft },
  metricLabelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  metricLabel: { flex: 1, color: colors.muted, fontFamily: typography.family.semibold },
  metricValue: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title },
  receivedValue: { color: colors.success },
  outstandingValue: { color: colors.warning },
  metricHelper: { color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.caption, lineHeight: typography.lineHeight.caption },
  errorCard: { padding: spacing.lg, gap: spacing.md, borderRadius: radius.lg, backgroundColor: colors.dangerSoft },
  errorCopy: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  errorText: { flex: 1, color: colors.danger, fontFamily: typography.family.semibold },
  retryButton: { minHeight: 44, alignSelf: "flex-start", paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.danger },
  retryText: { color: colors.onBrand, fontFamily: typography.family.bold },
  emptyCard: { padding: spacing.xl, alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  emptyIcon: { width: 56, height: 56, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  emptyTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title, textAlign: "center" },
  emptyText: { maxWidth: 520, color: colors.muted, fontFamily: typography.family.regular, lineHeight: typography.lineHeight.body, textAlign: "center" },
  primaryButton: { minHeight: 48, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.brand },
  primaryButtonText: { color: colors.onBrand, fontFamily: typography.family.bold },
});
