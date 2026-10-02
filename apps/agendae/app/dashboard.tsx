import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, type NativeScrollEvent, type NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon, type AppIconName } from '@/src/components/ui/app-icon';
import { AuthenticatedHeader } from '@/src/components/layout/authenticated-header';
import { MobileTabBar } from '@/src/components/layout/mobile-tab-bar';
import { PageLoadingOverlay } from '@/src/components/ui/page-loading-overlay';
import { breakpoints, colors, elevation, layout, opacity, radius, spacing, typography } from '@/src/theme/tokens';
import { supabaseAuthService as authService } from '@/src/infra/auth/supabase-auth-adapter';
import { getAppointmentStatusLabel } from '@/src/domain/agenda/appointment-status-label';
import type { DashboardSnapshot } from '@/src/domain/dashboard/types';
import { dashboardService } from '@/src/infra/dashboard/supabase-dashboard-adapter';

const shortDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date());
const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// `dueDate` chega como `YYYY-MM-DD` (coluna `date` do Postgres, sem
// componente de hora/fuso — ver `20260906160000_dashboard_receivable_payments.sql`).
// Mesmo padrão de conversão simples por split usado em `isoToBrazilian`
// (`app/payments.tsx`), sem passar por `Date`/timezone, para não introduzir
// desvio de +-1 dia por fuso horário.
function formatReceivableDueDate(isoDate: string) {
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}/${month}/${year}`;
}

export default function DashboardScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const [summaryIndex, setSummaryIndex] = useState(0);
  const [displayName, setDisplayName] = useState('');
  // Mesma leitura de `session.user.isAdmin` já usada em
  // `AuthenticatedHeader` (`src/components/layout/authenticated-header.tsx`)
  // para decidir se mostra "Administrar usuários" no menu principal —
  // replicada aqui para a seção "Acesso rápido" full-width da Home.
  const [isAdmin, setIsAdmin] = useState(false);
  const defaultSnapshot: DashboardSnapshot = {
    generatedAt: new Date().toISOString(),
    providerDisplayName: displayName || 'Prestador',
    timeZone: 'America/Sao_Paulo',
    summary: {
      activeClients: 0,
      newClientsThisMonth: 0,
      appointmentsToday: 0,
      completedToday: 0,
      pendingConfirmationToday: 0,
      serviceBalanceCents: 0,
      balanceReferenceMonth: new Intl.DateTimeFormat('pt-BR', { month: '2-digit', year: 'numeric' }).format(new Date()),
    },
    todayAppointments: [],
    notifications: [],
  };

  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(defaultSnapshot);
  const [dashboardError, setDashboardError] = useState('');
  const [initialLoading, setInitialLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    void authService.getSession().then((session) => {
      setDisplayName(session?.user.displayName ?? '');
      setIsAdmin(Boolean(session?.user.isAdmin));
    });
  }, []);

  const loadDashboard = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const next = await dashboardService.getSnapshot();
      setSnapshot(next);
      if (next.providerDisplayName) setDisplayName(next.providerDisplayName);
      setDashboardError('');
    } catch {
      // Mantém os dados existentes sem piscar ou desmontar a interface
    } finally {
      loadingRef.current = false;
      setInitialLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadDashboard();
    }, [loadDashboard]),
  );

  async function handleRetry() {
    setRetrying(true);
    try {
      await loadDashboard();
    } finally {
      setRetrying(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void loadDashboard();
    });
    return () => subscription.remove();
  }, [loadDashboard]);

  const summary: { label: string; value: string; detail: string; icon: AppIconName; tone: 'brand' | 'success' | 'warning' }[] = [
    { label: 'Clientes ativos', value: String(snapshot.summary.activeClients), detail: `${snapshot.summary.newClientsThisMonth} novo(s) no mês`, icon: 'clients', tone: 'brand' },
    { label: 'Agenda de hoje', value: String(snapshot.summary.appointmentsToday), detail: `${snapshot.summary.pendingConfirmationToday} aguardando confirmação`, icon: 'calendar', tone: 'warning' },
    { label: 'Atendimentos', value: String(snapshot.summary.completedToday), detail: 'concluído(s) hoje', icon: 'success', tone: 'success' },
    { label: 'Faturamento recebido', value: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(snapshot.summary.serviceBalanceCents / 100), detail: `recebido em ${snapshot.summary.balanceReferenceMonth}`, icon: 'financial', tone: 'brand' },
  ];
  const appointments = snapshot.todayAppointments.map((item) => {
    // Mesma função usada no Perfil do Cliente (`app/clients/[id].tsx`) —
    // nunca recalcular esta regra localmente aqui (BLG: agendamento
    // cancelado aparecendo como "Confirmado" na Home por reimplementação
    // paralela e incompleta desta regra).
    const status = getAppointmentStatusLabel(item.state, item.confirmationStatus);
    return {
      id: item.id,
      time: new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: snapshot.timeZone }).format(new Date(item.startsAt)),
      title: item.title?.trim() || item.serviceName || 'Compromisso',
      client: item.clientId ? item.clientName : null,
      statusLabel: status.label,
      statusBg: status.bg,
      statusColor: status.color,
    };
  });

  // Seção "Acesso rápido" (full-width, entre os KPIs e a Agenda, só
  // desktop/`wide`) — mesma lista de `menuItems` do menu principal
  // (`AuthenticatedHeader`, linhas ~103-131), exceto "Início" (o usuário já
  // está na Home), "Planos" e "Alternar conta" (que nem está em `menuItems`,
  // fica em outro lugar do header).
  const quickAccessItems: { icon: AppIconName; label: string; route: string }[] = [
    { icon: 'services', label: 'Serviços', route: '/services' },
    { icon: 'calendar', label: 'Agenda', route: '/agenda' },
    { icon: 'clients', label: 'Clientes', route: '/clients' },
    { icon: 'financial', label: 'Financeiro', route: '/payments' },
    { icon: 'user', label: 'Configurar perfil', route: '/settings' },
    { icon: 'file', label: 'Manual de uso', route: '/manual' },
    ...(isAdmin ? [{ icon: 'security' as const, label: 'Administrar usuários', route: '/admin-users' }] : []),
  ];

  // Painel "Pagamentos a receber" (`schedulePanel` divide espaço com ele no
  // desktop; empilha abaixo no mobile). Campos opcionais no tipo por decisão
  // do Chris (não quebrar `defaultSnapshot` local acima) — o adapter real
  // sempre preenche com `[]`/`0`, nunca `undefined`, mas os fallbacks abaixo
  // cobrem também o `defaultSnapshot` local enquanto a Home ainda carrega.
  const receivablePayments = snapshot.receivablePayments ?? [];
  const receivableCount = snapshot.receivableCount ?? 0;
  const receivableTotalLabel = currencyFormatter.format((snapshot.receivableTotalCents ?? 0) / 100);

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      {initialLoading && <PageLoadingOverlay />}

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.content, !wide && styles.contentMobile]}>
          <View style={styles.hero}>
            <View style={[styles.heroGlowTop, { pointerEvents: 'none' }]} />
            <View style={[styles.heroGlowBottom, { pointerEvents: 'none' }]} />
            <View style={[styles.welcome, wide && styles.welcomeWide]}>
              <View style={styles.welcomeCopy}>
                <Text style={styles.eyebrow}>VISÃO GERAL</Text>
                <Text accessibilityRole="header" style={[styles.title, !wide && styles.titleMobile]}>Olá{displayName ? `, ${displayName}` : ''}!</Text>
                <Text style={styles.description}>Aqui está o resumo da sua rotina de hoje.</Text>
              </View>
              <View style={styles.datePill}>
                <AppIcon name="calendar" size={20} color={colors.onBrand} />
                <Text style={styles.dateText}>{shortDate}</Text>
              </View>
            </View>
          </View>

          {dashboardError && <View style={[styles.stateBanner, styles.stateBannerError]}><Text style={styles.errorText}>{dashboardError}</Text><Pressable accessibilityRole="button" accessibilityState={{ disabled: retrying, busy: retrying }} disabled={retrying} onPress={() => void handleRetry()} style={({ pressed }) => [styles.retryButton, styles.retryButtonContent, pressed && !retrying && { opacity: opacity.pressed }]}>{retrying && <ActivityIndicator size="small" color={colors.onBrand} />}<Text style={styles.primaryActionText}>Tentar novamente</Text></Pressable></View>}

          <ScrollView style={styles.summaryViewport} horizontal={!wide} showsHorizontalScrollIndicator={false} snapToInterval={272} decelerationRate="fast" onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) => setSummaryIndex(Math.max(0, Math.min(summary.length - 1, Math.round(event.nativeEvent.contentOffset.x / 272))))} contentContainerStyle={[styles.summaryGrid, wide && styles.summaryGridWide]}>
              {summary.map((item) => (
                <View key={item.label} style={[styles.summaryCard, wide && styles.summaryCardWide]}>
                  <View style={[styles.summaryIcon, styles[`${item.tone}Icon`]]}>
                    <AppIcon name={item.icon} size={24} color={styles[`${item.tone}Color`].color} />
                  </View>
                  <Text style={styles.summaryLabel}>{item.label}</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={styles.summaryValue}>{item.value}</Text>
                  <Text style={[styles.summaryDetail, styles[`${item.tone}Color`]]}>{item.detail}</Text>
                </View>
              ))}
          </ScrollView>
          {!wide && <View accessibilityLabel={`Indicador do carrossel: item ${summaryIndex + 1} de ${summary.length}`} style={styles.carouselDots}>{summary.map((item, index) => <View key={item.label} style={[styles.carouselDot, index === summaryIndex && styles.carouselDotActive]} />)}</View>}

          {wide && <View style={[styles.panel, styles.quickSection]}>
            <Text style={styles.panelTitle}>Acesso rápido</Text>
            <Text style={styles.panelSubtitle}>O que você deseja fazer?</Text>
            <View style={styles.quickGrid}>
              {quickAccessItems.map((item) => (
                <Pressable accessibilityRole="button" onPress={() => router.push(item.route as never)} key={item.label} style={[styles.quickTile, styles.quickGridAction]}>
                  <View style={styles.quickTileIcon}><AppIcon name={item.icon} size={16} color={colors.brand} /></View>
                  <Text numberOfLines={1} style={styles.quickTileLabel}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>}

          <View style={[styles.mainGrid, wide && styles.mainGridWide]}>
            <View style={[styles.panel, styles.schedulePanel, !wide && styles.panelMobile]}>
              <View style={[styles.panelHeader, !wide && styles.panelHeaderMobile]}>
                <View><Text style={styles.panelTitle}>Agenda de hoje</Text><Text style={styles.panelSubtitle}>{snapshot ? `${snapshot.summary.appointmentsToday} compromisso(s)` : 'Aguardando dados'}</Text></View>
                <Pressable accessibilityRole="button" onPress={() => router.push('/agenda' as never)}><Text style={styles.link}>Ver agenda completa</Text></Pressable>
              </View>
              <View style={styles.appointmentList}>
                {appointments.map((item) => (
                  <View key={item.id} style={[styles.appointment, !wide && styles.appointmentMobile]}>
                    <View style={styles.appointmentTop}>
                      <View style={styles.timeBadge}>
                        <AppIcon name="schedule" size={16} color={colors.brand} />
                        <Text style={styles.time}>{item.time}</Text>
                      </View>
                      {!wide && <View style={[styles.status, { backgroundColor: item.statusBg }]}>
                        <Text style={[styles.statusText, { color: item.statusColor }]}>{item.statusLabel}</Text>
                      </View>}
                    </View>
                    <View style={styles.appointmentCopy}>
                      <Text style={styles.clientName}>{item.title}</Text>
                      {item.client ? <Text style={styles.service}>{item.client}</Text> : null}
                    </View>
                    {wide && <View style={[styles.status, { backgroundColor: item.statusBg }]}>
                      <Text style={[styles.statusText, { color: item.statusColor }]}>{item.statusLabel}</Text>
                    </View>}
                  </View>
                ))}
                {snapshot && !appointments.length && <Text style={styles.panelSubtitle}>Sua agenda está livre hoje.</Text>}
              </View>
            </View>

            <View style={[styles.panel, styles.receivablePanel, !wide && styles.panelMobile]}>
              <View style={[styles.panelHeader, !wide && styles.panelHeaderMobile]}>
                <View><Text style={styles.panelTitle}>Pagamentos a receber</Text><Text style={styles.panelSubtitle}>{`${receivableCount} cobrança(s) em aberto · ${receivableTotalLabel}`}</Text></View>
                <Pressable accessibilityRole="button" onPress={() => router.push('/payments' as never)}><Text style={styles.link}>Ver mais</Text></Pressable>
              </View>
              <View style={styles.receivableList}>
                {receivablePayments.map((item) => (
                  <Pressable accessibilityRole="button" onPress={() => router.push('/payments' as never)} key={item.id} style={styles.receivableItem}>
                    <View style={styles.receivableCopy}>
                      <Text numberOfLines={1} style={styles.receivableClient}>{item.clientName}</Text>
                      {!!item.origin && <Text numberOfLines={1} style={styles.receivableOrigin}>{item.origin}</Text>}
                    </View>
                    <View style={styles.receivableMeta}>
                      <Text style={styles.receivableAmount}>{currencyFormatter.format(item.balanceCents / 100)}</Text>
                      <Text style={[styles.receivableDue, item.status === 'overdue' && styles.receivableDueOverdue]}>{formatReceivableDueDate(item.dueDate)}</Text>
                    </View>
                  </Pressable>
                ))}
                {!receivablePayments.length && <Text style={styles.panelSubtitle}>Nenhum pagamento em aberto.</Text>}
              </View>
            </View>
          </View>
          {Platform.OS === 'web' && <View style={[styles.footer, !wide && styles.footerMobile]}>
            <Text style={styles.footerBrand}>rotina<Text style={styles.accent}>ê</Text></Text>
            <Text style={styles.footerText}>© {new Date().getFullYear()} Rotinaê. Todos os direitos reservados.</Text>
          </View>}
        </View>
      </ScrollView>
      <MobileTabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  header: { minHeight: 72, justifyContent: 'center', zIndex: 20 },
  headerInner: { width: '100%', maxWidth: layout.contentMax, minHeight: 72, alignSelf: 'center', paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  brandBlock: { flexShrink: 0, justifyContent: 'center' },
  logo: { color: colors.brandDark, fontFamily: typography.family.bold, fontSize: 28 },
  accent: { color: colors.brand },
  headerActions: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  notificationButton: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSubtle },
  notificationBadge: { position: 'absolute', right: -2, top: -3, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.danger, borderWidth: 2, borderColor: colors.canvas },
  notificationBadgeText: { color: colors.onBrand, fontFamily: typography.family.bold, fontSize: 9 },
  notificationsMenu: { position: 'absolute', width: 380, right: 48, top: 54, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, ...elevation.floating },
  notificationsMenuMobile: { width: 300, right: 0 },
  notificationsHeader: { paddingHorizontal: spacing.xs, paddingBottom: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  notificationsTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.subtitle },
  notificationsSubtitle: { marginTop: spacing.xs, color: colors.mutedSoft, fontFamily: typography.family.regular, fontSize: typography.size.caption },
  markAll: { color: colors.brand, fontFamily: typography.family.semibold, fontSize: typography.size.caption },
  notificationList: { gap: spacing.sm },
  notificationItem: { minHeight: 96, padding: spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  notificationItemUnread: { backgroundColor: colors.brandSoft },
  notificationIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surface },
  notificationCopy: { flex: 1, minWidth: 0 },
  notificationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  notificationItemTitle: { flex: 1, color: colors.ink, fontFamily: typography.family.semibold, fontSize: typography.size.body },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.brand },
  notificationDescription: { marginTop: spacing.sm, color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.caption, lineHeight: typography.lineHeight.caption },
  notificationTime: { marginTop: spacing.sm, color: colors.mutedSoft, fontFamily: typography.family.regular, fontSize: 10 },
  avatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brand },
  logout: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  profileMenu: { position: 'absolute', width: 286, right: 0, top: 50, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, ...elevation.floating },
  profileMenuHeader: { padding: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  profileMenuAvatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  profileMenuName: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.bodyLarge },
  profileMenuRole: { marginTop: spacing.xxs, color: colors.mutedSoft, fontFamily: typography.family.regular, fontSize: typography.size.caption },
  profileMenuDivider: { height: 1, marginVertical: spacing.xs, backgroundColor: colors.border },
  profileMenuItem: { minHeight: 46, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.xs },
  profileMenuItemDisabled: { opacity: 0.62 },
  profileMenuItemText: { flex: 1, color: colors.ink, fontFamily: typography.family.semibold, fontSize: typography.size.body },
  profileMenuItemTextDisabled: { color: colors.muted },
  comingSoon: { color: colors.mutedSoft, fontFamily: typography.family.semibold, fontSize: 10 },
  profileMenuLogout: { flex: 1, color: colors.danger, fontFamily: typography.family.semibold, fontSize: typography.size.body },
  scroll: { flexGrow: 1 },
  content: { width: '100%', maxWidth: layout.contentMax, alignSelf: 'center', padding: spacing.lg, gap: spacing.lg },
  contentMobile: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  hero: { minHeight: 210, padding: spacing.lg, justifyContent: 'center', overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.brandDark },
  heroGlowTop: { position: 'absolute', width: 360, height: 360, right: -80, top: -240, borderRadius: radius.pill, backgroundColor: colors.brandMid, opacity: 0.72 },
  heroGlowBottom: { position: 'absolute', width: 260, height: 260, left: -100, bottom: -210, borderRadius: radius.pill, backgroundColor: colors.brand, opacity: 0.5 },
  welcome: { width: '100%', gap: spacing.md },
  welcomeWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  welcomeCopy: { gap: spacing.xs },
  eyebrow: { color: colors.accentSoft, fontFamily: typography.family.bold, fontSize: typography.size.caption, letterSpacing: 1.2 },
  title: { color: colors.onBrand, fontFamily: typography.family.bold, fontSize: 34, lineHeight: 40 },
  titleMobile: { fontSize: 30, lineHeight: 36 },
  description: { color: colors.accentSoft, fontFamily: typography.family.regular, fontSize: typography.size.bodyLarge },
  datePill: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)' },
  dateText: { color: colors.onBrand, fontFamily: typography.family.semibold, fontSize: typography.size.body, textTransform: 'capitalize' },
  summaryViewport: { marginHorizontal: -12, marginVertical: -20 },
  summaryGrid: { gap: spacing.md, paddingHorizontal: 12, paddingVertical: 20 },
  summaryGridWide: { flexDirection: 'row', flexGrow: 1 },
  summaryCard: { width: 256, minHeight: 168, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, ...elevation.card },
  summaryCardWide: { flex: 1, width: 'auto' },
  summaryIcon: { width: 44, height: 44, marginBottom: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  brandIcon: { backgroundColor: colors.brandSoft }, successIcon: { backgroundColor: colors.successSoft }, warningIcon: { backgroundColor: colors.warningSoft },
  brandColor: { color: colors.brand }, successColor: { color: colors.success }, warningColor: { color: colors.warning },
  summaryLabel: { color: colors.muted, fontFamily: typography.family.medium, fontSize: typography.size.body },
  summaryValue: { marginTop: spacing.xs, color: colors.ink, fontFamily: typography.family.bold, fontSize: 28, lineHeight: 34 },
  summaryDetail: { marginTop: spacing.xs, fontFamily: typography.family.semibold, fontSize: typography.size.caption },
  carouselDots: { marginTop: -spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  carouselDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderStrong },
  carouselDotActive: { width: 18, backgroundColor: colors.brand },
  mainGrid: { gap: spacing.md },
  mainGridWide: { flexDirection: 'row', alignItems: 'stretch' },
  panel: { padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, ...elevation.card },
  // Neutraliza o `flex: 2`/`flex: 1` de `schedulePanel`/`receivablePanel`
  // (pensado só para a linha horizontal de `mainGridWide`) quando os dois
  // painéis ficam empilhados no `mainGrid` do mobile (container coluna sem
  // altura própria definida, dentro do `ScrollView` da tela).
  //
  // CUIDADO: `flex: 0` (usado numa correção anterior) NÃO resolve isso — o
  // atalho `flex: N` define implicitamente `flexBasis: `${N * 100}%`` (aqui,
  // '0%'), não `flexBasis: 'auto'`. Com `flexBasis: '0%'` e `flexGrow: 0`
  // (sem chance de crescer de volta), o Yoga reserva ~0 de altura para o
  // painel — mas os filhos (`panelHeader`/`appointmentList` ou
  // `receivableList`) continuam desenhando normalmente além dessa altura
  // quase nula, já que o `overflow` padrão do React Native é `'visible'`.
  // Resultado: o painel seguinte no `mainGrid` (empilhado logo depois, com
  // só o `gap` de distância) começa a poucos pixels do topo do painel
  // anterior, sobrepondo visualmente o conteúdo que "vazou" da caixa
  // anterior (BLG: primeiro card de "Agenda de hoje" sobreposto pelo
  // cabeçalho/lista/rodapé de "Pagamentos a receber" no mobile).
  //
  // `flexBasis: 'auto'` é o que faz o painel voltar a se dimensionar pelo
  // conteúdo real (mesmo efeito de "sem flex nenhum"), com `flexGrow`/
  // `flexShrink: 0` só impedindo a disputa por espaço extra entre os dois.
  panelMobile: { padding: spacing.md, flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  schedulePanel: { flex: 2 }, receivablePanel: { flex: 1 },
  quickSection: { width: '100%' },
  quickGrid: { marginTop: spacing.lg, flexDirection: 'row', flexWrap: 'nowrap', gap: spacing.sm },
  quickGridAction: { flex: 1, minWidth: 0 },
  receivableList: { marginTop: spacing.lg, gap: spacing.sm },
  receivableItem: { minHeight: 64, padding: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surfaceSubtle },
  receivableCopy: { flex: 1, minWidth: 0 },
  receivableClient: { color: colors.ink, fontFamily: typography.family.semibold, fontSize: typography.size.bodyLarge },
  receivableOrigin: { marginTop: spacing.xs, color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.body },
  receivableMeta: { alignItems: 'flex-end', gap: spacing.xxs },
  receivableAmount: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.body },
  receivableDue: { color: colors.mutedSoft, fontFamily: typography.family.regular, fontSize: typography.size.caption },
  receivableDueOverdue: { color: colors.danger, fontFamily: typography.family.semibold },
  panelHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  panelHeaderMobile: { flexDirection: 'column', gap: spacing.sm },
  panelTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.subtitle },
  panelSubtitle: { marginTop: spacing.xs, color: colors.mutedSoft, fontFamily: typography.family.regular, fontSize: typography.size.caption },
  link: { color: colors.brand, fontFamily: typography.family.semibold, fontSize: typography.size.body },
  appointmentList: { marginTop: spacing.lg, gap: spacing.sm },
  appointment: { minHeight: 76, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surfaceSubtle },
  appointmentMobile: { minHeight: 118, alignItems: 'stretch', flexDirection: 'column', gap: spacing.sm, backgroundColor: colors.surface },
  appointmentTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeBadge: { minWidth: 82, minHeight: 38, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.xs, backgroundColor: colors.brandSoft },
  time: { color: colors.brandDark, fontFamily: typography.family.bold, fontSize: typography.size.body },
  appointmentCopy: { flex: 1, minWidth: 0 },
  clientName: { color: colors.ink, fontFamily: typography.family.semibold, fontSize: typography.size.bodyLarge },
  service: { marginTop: spacing.xs, color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.body },
  status: { marginLeft: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill },
  statusText: { fontFamily: typography.family.semibold, fontSize: typography.size.caption },
  quickTile: { minHeight: 68, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  quickTileIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radius.xs, backgroundColor: colors.brandSoft },
  quickTileLabel: { color: colors.ink, fontFamily: typography.family.semibold, fontSize: typography.size.caption, textAlign: 'center' },
  stateBanner: { minHeight: 64, padding: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  stateBannerError: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  errorText: { flex: 1, color: colors.danger, fontFamily: typography.family.semibold },
  retryButton: { minHeight: 40, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.brand },
  retryButtonContent: { flexDirection: 'row', gap: spacing.sm },
  primaryActionText: { color: colors.onBrand, fontFamily: typography.family.bold },
  footer: { minHeight: 72, paddingTop: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  footerMobile: { minHeight: 88, flexDirection: 'column', justifyContent: 'center', gap: spacing.xs },
  footerBrand: { color: colors.brandDark, fontFamily: typography.family.bold, fontSize: typography.size.subtitle },
  footerText: { color: colors.mutedSoft, fontFamily: typography.family.regular, fontSize: typography.size.caption, textAlign: 'center' },
  bottomBar: { minHeight: 72, paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xs, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-around', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, ...elevation.floating },
  bottomAction: { flex: 1, alignItems: 'center', gap: spacing.xs },
  bottomIcon: { height: 28, alignItems: 'center', justifyContent: 'center' },
  bottomPrimary: { width: 46, height: 46, marginTop: -24, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brand, borderWidth: 4, borderColor: colors.canvas },
  bottomLabel: { color: colors.mutedSoft, fontFamily: typography.family.medium, fontSize: 10 },
  bottomLabelActive: { color: colors.brand, fontFamily: typography.family.bold },
});
