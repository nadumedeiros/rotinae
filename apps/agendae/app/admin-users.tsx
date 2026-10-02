import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { MobileTabBar } from "@/src/components/layout/mobile-tab-bar";
import { PageLoadingOverlay } from "@/src/components/ui/page-loading-overlay";
import { AppIcon } from "@/src/components/ui/app-icon";
import {
  adminUsersService,
  type ManagedUser,
  type UserPlan,
} from "@/src/infra/admin/supabase-admin-adapter";
import { supabaseAuthService as authService } from "@/src/infra/auth/supabase-auth-adapter";
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

type TipPressProps = React.ComponentProps<typeof Pressable> & { title?: string };
const TipPress = Pressable as React.ComponentType<TipPressProps>;

export default function AdminUsersScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const pageSize = wide ? 10 : 5;
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [adminAccess, setAdminAccess] = useState<"loading" | "allowed" | "denied">("loading");
  const [query, setQuery] = useState("");
  const [planFilter, setPlanFilter] = useState<"all" | UserPlan>("all");
  const [planPickerVisible, setPlanPickerVisible] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ManagedUser | null>(null);
  const [pendingPlan, setPendingPlan] = useState<ManagedUser | null>(null);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    setFeedback(null);
    try {
      const data = await adminUsersService.listUsers();
      setUsers(data);
    } catch (err: any) {
      setFeedback({
        tone: "error",
        message: err?.message || "Não foi possível carregar a lista de usuários.",
      });
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    authService.getSession().then((session) => {
      if (session?.user.isAdmin) {
        setAdminAccess("allowed");
        loadUsers();
      } else {
        setAdminAccess("denied");
      }
    });
  }, [loadUsers]);

  const visibleUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return users.filter(
      (user) =>
        (planFilter === "all" || user.plan === planFilter) &&
        (!normalized ||
          `${user.name} ${user.email} ${user.phone} ${user.profile}`
            .toLocaleLowerCase("pt-BR")
            .includes(normalized)),
    );
  }, [planFilter, query, users]);

  const totalPages = Math.max(1, Math.ceil(visibleUsers.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedUsers = visibleUsers.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  useEffect(() => setPage(1), [planFilter, query]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  async function changePlan() {
    if (!pendingPlan) return;
    if (!pendingPlan.profile.toLocaleLowerCase("pt-BR").includes("prestador")) {
      setPendingPlan(null);
      return;
    }
    const nextPlan: UserPlan = pendingPlan.plan === "premium" ? "free" : "premium";
    setSavingPlan(true);
    setFeedback(null);
    try {
      await adminUsersService.updateUserPlan(pendingPlan.id, nextPlan);
      const next = users.map((user) =>
        user.id === pendingPlan.id ? { ...user, plan: nextPlan } : user,
      );
      setUsers(next);
      if (selected?.id === pendingPlan.id) {
        setSelected({ ...selected, plan: nextPlan });
      }
      setFeedback({
        tone: "success",
        message: `Plano de ${pendingPlan.name} alterado para ${nextPlan === "premium" ? "Premium" : "Gratuito"} com sucesso!`,
      });
      setPendingPlan(null);
    } catch (err: any) {
      setFeedback({
        tone: "error",
        message: err?.message || "Erro ao salvar alteração de plano.",
      });
    } finally {
      setSavingPlan(false);
    }
  }

  const premium = users.filter((user) => user.plan === "premium").length;
  const acceptedTerms = users.filter((user) => user.termsAccepted).length;

  if (adminAccess !== "allowed")
    return (
      <SafeAreaView style={styles.safe}>
        <AuthenticatedHeader />
        {adminAccess === "loading" && <PageLoadingOverlay />}
        <View style={styles.accessState}>
          <View style={styles.accessCard}>
            <View style={styles.confirmIcon}>
              <AppIcon
                name={adminAccess === "loading" ? "schedule" : "lock"}
                size={32}
                color={adminAccess === "loading" ? colors.brand : colors.danger}
              />
            </View>
            <Text style={styles.modalTitle}>
              {adminAccess === "loading" ? "Verificando acesso…" : "Acesso restrito"}
            </Text>
            <Text style={styles.confirmText}>
              {adminAccess === "loading"
                ? "Aguarde enquanto validamos sua sessão."
                : "Esta página é exclusiva para administradores do Rotinaê."}
            </Text>
            {adminAccess === "denied" && (
              <Pressable onPress={() => router.replace("/")} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Voltar ao acesso</Text>
              </Pressable>
            )}
          </View>
        </View>
        <MobileTabBar />
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.content, !wide && styles.contentMobile]}>
          <View style={styles.headingRow}>
            <View style={styles.heading}>
              <Text style={styles.eyebrow}>ADMINISTRAÇÃO</Text>
              <Text accessibilityRole="header" style={[styles.title, !wide && styles.titleMobile]}>
                Usuários
              </Text>
              <Text style={styles.description}>
                Consulte dados da conta, aceite dos termos e controle o acesso Premium.
              </Text>
            </View>
            <TipPress
              accessibilityLabel="Atualizar lista de usuários"
              accessibilityRole="button"
              accessibilityState={{ disabled: loadingUsers, busy: loadingUsers }}
              title="Atualizar lista de usuários"
              disabled={loadingUsers}
              onPress={loadUsers}
              style={({ pressed }: { pressed: boolean }) => [
                styles.refreshButton,
                loadingUsers && styles.buttonDisabled,
                pressed && !loadingUsers && { opacity: opacity.pressed },
              ]}
            >
              {loadingUsers ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : (
                <AppIcon name="schedule" size={18} color={colors.brand} />
              )}
              <Text style={styles.refreshButtonText}>Atualizar</Text>
            </TipPress>
          </View>

          {feedback && (
            <View
              style={[
                styles.feedbackBanner,
                feedback.tone === "error" ? styles.feedbackError : styles.feedbackSuccess,
              ]}
            >
              <AppIcon
                name={feedback.tone === "error" ? "error" : "success"}
                size={18}
                color={feedback.tone === "error" ? colors.danger : colors.success}
              />
              <Text
                style={[
                  styles.feedbackText,
                  feedback.tone === "error" ? styles.feedbackTextError : styles.feedbackTextSuccess,
                ]}
              >
                {feedback.message}
              </Text>
            </View>
          )}

          <View style={[styles.summary, wide && styles.summaryWide]}>
            {([
              ["Usuários", String(users.length), "clients" as const],
              ["Premium", String(premium), "success" as const],
              ["Termos aceitos", `${acceptedTerms}/${users.length}`, "file" as const],
            ] as const).map(([label, value, icon]) => (
              <View key={label} style={styles.summaryCard}>
                <View style={styles.summaryIcon}>
                  <AppIcon name={icon} size={20} color={colors.brand} />
                </View>
                <View>
                  <Text style={styles.summaryValue}>{value}</Text>
                  <Text style={styles.summaryLabel}>{label}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={[styles.panel, !wide && styles.panelMobile]}>
            <View style={[styles.toolbar, !wide && styles.toolbarMobile]}>
              <View style={styles.search}>
                <AppIcon name="search" size={18} color={colors.mutedSoft} />
                <TextInput
                  accessibilityLabel="Buscar usuários"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Buscar por nome, e-mail ou telefone"
                  placeholderTextColor={colors.mutedSoft}
                  style={styles.searchInput}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Selecionar plano"
                accessibilityState={{ expanded: planPickerVisible }}
                onPress={() => setPlanPickerVisible(true)}
                style={[styles.planFilter, !wide && styles.planFilterMobile]}
              >
                <View style={styles.planFilterCopy}>
                  <Text style={styles.planFilterLabel}>Plano</Text>
                  <Text style={styles.planFilterValue}>
                    {planFilter === "all" ? "Todos" : planFilter === "free" ? "Gratuito" : "Premium"}
                  </Text>
                </View>
                <AppIcon name="forward" size={16} color={colors.mutedSoft} />
              </Pressable>
            </View>

            <Text style={styles.resultCount}>{visibleUsers.length} usuário(s) encontrado(s)</Text>

            {loadingUsers && users.length === 0 ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.brand} />
                <Text style={styles.loadingText}>Carregando usuários do sistema…</Text>
              </View>
            ) : !visibleUsers.length ? (
              <View style={styles.accessCard}>
                <AppIcon name="clients" size={32} color={colors.mutedSoft} />
                <Text style={styles.modalTitle}>Nenhum usuário encontrado</Text>
                <Text style={styles.confirmText}>
                  {query || planFilter !== "all"
                    ? "Nenhum usuário corresponde aos filtros aplicados."
                    : "Ainda não há outros usuários cadastrados no banco de dados."}
                </Text>
              </View>
            ) : (
              <>
                {wide && (
                  <View style={styles.userTableHeader}>
                    <Text style={[styles.tableHeaderText, styles.identityColumn]}>Usuário</Text>
                    <Text style={[styles.tableHeaderText, styles.profileColumn]}>Perfil</Text>
                    <Text style={[styles.tableHeaderText, styles.indicatorsColumn]}>
                      Plano e termos
                    </Text>
                    <Text style={[styles.tableHeaderText, styles.actionsColumn]}>Ações</Text>
                  </View>
                )}
                <View
                  style={[
                    styles.userList,
                    wide ? styles.userListWide : styles.userListMobile,
                  ]}
                >
                {paginatedUsers.map((user) => (
                  <View key={user.id} style={[styles.userCard, !wide && styles.userCardMobile]}>
                    <View style={[styles.identityColumn, !wide && styles.identityColumnMobile]}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {user.name
                            .split(" ")
                            .slice(0, 2)
                            .map((part) => part[0])
                            .join("")
                            .toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.userCopy}>
                        <View style={styles.nameRow}>
                          <Text style={styles.userName}>{user.name}</Text>
                          <View
                            style={[
                              styles.status,
                              user.status === "Inativo" && styles.statusInactive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusText,
                                user.status === "Inativo" && styles.statusTextInactive,
                              ]}
                            >
                              {user.status}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.userDetail}>
                          {user.email || "Sem e-mail"} {user.phone ? `· ${user.phone}` : ""}
                        </Text>
                        {!wide && (
                          <Text style={styles.userMeta}>
                            {user.profile} · Cadastro em{" "}
                            {user.createdAt
                              ? new Date(user.createdAt).toLocaleDateString("pt-BR")
                              : "—"}
                          </Text>
                        )}
                      </View>
                    </View>
                    {wide && (
                      <Text style={styles.profileColumn}>
                        {user.profile}{"\n"}Cadastro em{" "}
                        {user.createdAt ? new Date(user.createdAt).toLocaleDateString("pt-BR") : "—"}
                      </Text>
                    )}
                    <View
                      style={[
                        styles.indicators,
                        wide ? styles.indicatorsColumn : styles.indicatorsMobile,
                      ]}
                    >
                      <View style={[styles.plan, user.plan === "premium" && styles.planPremium]}>
                        <Text
                          style={[
                            styles.planText,
                            user.plan === "premium" && styles.planTextPremium,
                          ]}
                        >
                          {user.plan === "premium" ? "Premium" : "Gratuito"}
                        </Text>
                      </View>
                      <View style={styles.termsRow}>
                        <AppIcon
                          name={user.termsAccepted ? "success" : "warning"}
                          size={16}
                          color={user.termsAccepted ? colors.success : colors.warning}
                        />
                        <Text style={styles.termsText}>
                          {user.termsAccepted ? "Termos aceitos" : "Termos pendentes"}
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.actions, !wide && styles.actionsMobile]}>
                      <TipPress
                        accessibilityLabel={`Ver dados de ${user.name}`}
                        title={`Ver dados de ${user.name}`}
                        onPress={() => setSelected(user)}
                        style={styles.secondaryButton}
                      >
                        <Text style={styles.secondaryButtonText}>Ver dados</Text>
                      </TipPress>
                      <TipPress
                        accessibilityLabel={
                          user.plan === "premium"
                            ? `Retirar Premium de ${user.name}`
                            : `Conceder Premium a ${user.name}`
                        }
                        title={
                          user.plan === "premium"
                            ? `Retirar Premium de ${user.name}`
                            : `Conceder Premium a ${user.name}`
                        }
                        disabled={!user.profile.toLocaleLowerCase("pt-BR").includes("prestador")}
                        onPress={() => setPendingPlan(user)}
                        style={[
                          styles.primaryButton,
                          !user.profile.toLocaleLowerCase("pt-BR").includes("prestador") &&
                            styles.buttonDisabled,
                        ]}
                      >
                        <Text style={styles.primaryButtonText}>
                          {!user.profile.toLocaleLowerCase("pt-BR").includes("prestador")
                            ? "Plano não aplicável"
                            : user.plan === "premium"
                              ? "Retirar Premium"
                              : "Dar Premium"}
                        </Text>
                      </TipPress>
                    </View>
                  </View>
                ))}
                </View>
              </>
            )}

            {visibleUsers.length > 0 && (
              <View style={[styles.pagination, !wide && styles.paginationMobile]}>
                <Text style={styles.paginationSummary}>
                  {visibleUsers.length
                    ? `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, visibleUsers.length)} de ${visibleUsers.length}`
                    : "Nenhum usuário"}
                </Text>
                <View style={styles.paginationControls}>
                  <Pressable
                    accessibilityLabel="Página anterior"
                    disabled={currentPage === 1}
                    onPress={() => setPage((value) => Math.max(1, value - 1))}
                    style={[styles.pageArrow, currentPage === 1 && styles.pageDisabled]}
                  >
                    <AppIcon
                      name="back"
                      size={16}
                      color={currentPage === 1 ? colors.mutedSoft : colors.brand}
                    />
                  </Pressable>
                  <Text style={styles.pageText}>
                    {currentPage} de {totalPages}
                  </Text>
                  <Pressable
                    accessibilityLabel="Próxima página"
                    disabled={currentPage === totalPages}
                    onPress={() => setPage((value) => Math.min(totalPages, value + 1))}
                    style={[styles.pageArrow, currentPage === totalPages && styles.pageDisabled]}
                  >
                    <AppIcon
                      name="forward"
                      size={16}
                      color={currentPage === totalPages ? colors.mutedSoft : colors.brand}
                    />
                  </Pressable>
                </View>
              </View>
            )}
          </View>

          {Platform.OS === "web" && (
            <View style={[styles.footer, !wide && styles.footerMobile]}>
              <Text style={styles.footerBrand}>
                rotina<Text style={styles.footerAccent}>ê</Text>
              </Text>
              <Text style={styles.footerText}>
                © {new Date().getFullYear()} Rotinaê. Administração com acesso restrito.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      <MobileTabBar />

      <Modal visible={planPickerVisible} transparent animationType="fade" onRequestClose={() => setPlanPickerVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPlanPickerVisible(false)}>
          <Pressable accessibilityViewIsModal style={styles.planPickerModal} onPress={() => undefined}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text accessibilityRole="header" style={styles.pickerTitle}>Filtrar por plano</Text>
                <Text style={styles.modalSubtitle}>Escolha quais usuários deseja visualizar.</Text>
              </View>
              <Pressable accessibilityLabel="Fechar filtro de plano" onPress={() => setPlanPickerVisible(false)} style={styles.pickerClose}>
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.planPickerOptions}>
              {(["all", "free", "premium"] as const).map((item) => {
                const selectedOption = planFilter === item;
                const label = item === "all" ? "Todos" : item === "free" ? "Gratuito" : "Premium";
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedOption }}
                    key={item}
                    onPress={() => { setPlanFilter(item); setPlanPickerVisible(false); }}
                    style={[styles.planPickerOption, selectedOption && styles.planPickerOptionActive]}
                  >
                    <Text style={[styles.planPickerOptionText, selectedOption && styles.planPickerOptionTextActive]}>{label}</Text>
                    {selectedOption && <AppIcon name="success" size={18} color={colors.onBrand} />}
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={selected !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text style={styles.modalTitle}>Dados do usuário</Text>
                <Text style={styles.modalSubtitle}>{selected?.id}</Text>
              </View>
              <Pressable accessibilityLabel="Fechar" onPress={() => setSelected(null)}>
                <AppIcon name="error" size={24} color={colors.muted} />
              </Pressable>
            </View>
            {selected && (
              <ScrollView
                style={styles.detailListScroll}
                contentContainerStyle={styles.detailList}
                showsVerticalScrollIndicator={false}
              >
                {[
                  ["Nome", selected.name],
                  ["E-mail", selected.email || "Não informado"],
                  ["Telefone", selected.phone || "Não informado"],
                  ["Perfil", selected.profile],
                  ["Plano", selected.plan === "premium" ? "Premium" : "Gratuito"],
                  ["Status", selected.status],
                  [
                    "Cadastro",
                    selected.createdAt
                      ? new Date(selected.createdAt).toLocaleString("pt-BR")
                      : "—",
                  ],
                  [
                    "Último acesso",
                    selected.lastAccess
                      ? new Date(selected.lastAccess).toLocaleString("pt-BR")
                      : "—",
                  ],
                  [
                    "Termos de uso",
                    selected.termsAccepted
                      ? `v${selected.termsVersion || "1.0"} · aceitos em ${selected.termsAcceptedAt ? new Date(selected.termsAcceptedAt).toLocaleString("pt-BR") : "—"}`
                      : "Ainda não aceitos",
                  ],
                  [
                    "Política de privacidade",
                    selected.termsAccepted
                      ? `v${selected.privacyVersion || "1.0"} · ${selected.consentSource || "web"}`
                      : "Sem aceite registrado",
                  ],
                ].map(([label, value]) => (
                  <View key={label} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{label}</Text>
                    <Text style={styles.detailValue}>{value}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
            <Pressable
              disabled={!selected?.profile.toLocaleLowerCase("pt-BR").includes("prestador")}
              onPress={() => selected && setPendingPlan(selected)}
              style={[
                styles.primaryButton,
                !selected?.profile.toLocaleLowerCase("pt-BR").includes("prestador") &&
                  styles.buttonDisabled,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {!selected?.profile.toLocaleLowerCase("pt-BR").includes("prestador")
                  ? "Premium exclusivo do prestador"
                  : selected?.plan === "premium"
                    ? "Retirar Premium"
                    : "Dar Premium"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={pendingPlan !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingPlan(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmModal}>
            <View style={styles.confirmIcon}>
              <AppIcon name="warning" size={32} color={colors.warning} />
            </View>
            <Text style={styles.modalTitle}>
              {pendingPlan?.plan === "premium"
                ? "Retirar acesso Premium?"
                : "Conceder acesso Premium?"}
            </Text>
            <Text style={styles.confirmText}>
              A alteração será aplicada imediatamente para {pendingPlan?.name}.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={savingPlan}
                onPress={() => setPendingPlan(null)}
                style={[styles.secondaryButton, styles.formActionButton]}
              >
                <Text style={styles.secondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: savingPlan, busy: savingPlan }}
                disabled={savingPlan}
                onPress={changePlan}
                style={({ pressed }) => [
                  styles.primaryButton,
                  styles.formActionButton,
                  savingPlan && styles.buttonDisabled,
                  pressed && !savingPlan && { opacity: opacity.pressed },
                ]}
              >
                {savingPlan ? (
                  <ActivityIndicator size="small" color={colors.onBrand} />
                ) : (
                  <Text style={styles.primaryButtonText}>Confirmar</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  formActionButton: { width: "100%", flex: 0, minWidth: 0, paddingHorizontal: spacing.md },
  modalHeaderCopy: { flex: 1, minWidth: 0 },
  scroll: { flexGrow: 1 },
  accessState: { flex: 1, padding: spacing.lg, alignItems: "center", justifyContent: "center" },
  accessCard: {
    width: "100%",
    maxWidth: 440,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  content: {
    width: "100%",
    maxWidth: layout.contentMax,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  contentMobile: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  heading: { flex: 1, minWidth: 260, gap: spacing.xs },
  eyebrow: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 1.2,
  },
  title: { color: colors.ink, fontFamily: typography.family.bold, fontSize: 36 },
  titleMobile: { fontSize: 30 },
  description: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.bodyLarge,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  refreshButtonText: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  feedbackBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  feedbackSuccess: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
  },
  feedbackError: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
  },
  feedbackText: {
    flex: 1,
    fontFamily: typography.family.medium,
    fontSize: typography.size.caption,
  },
  feedbackTextSuccess: { color: colors.success },
  feedbackTextError: { color: colors.danger },
  loadingContainer: {
    padding: spacing.xxl,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  loadingText: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  summary: { gap: spacing.md },
  summaryWide: { flexDirection: "row" },
  summaryCard: {
    flex: 1,
    minHeight: 92,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  summaryIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  summaryValue: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  summaryLabel: { color: colors.muted, fontFamily: typography.family.regular },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  panelMobile: { padding: spacing.md },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  toolbarMobile: { width: "100%", flexDirection: "column", alignItems: "stretch", gap: spacing.md },
  search: {
    flex: 1,
    width: "100%",
    minWidth: 0,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  searchInput: { flex: 1, minWidth: 0, width: "100%", color: colors.ink, fontFamily: typography.family.regular },
  planFilter: {
    minWidth: 152,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  planFilterMobile: { width: "100%", minWidth: 0 },
  planFilterCopy: { flex: 1, minWidth: 0 },
  planFilterLabel: { color: colors.mutedSoft, fontFamily: typography.family.regular, fontSize: typography.size.caption },
  planFilterValue: { marginTop: 1, color: colors.ink, fontFamily: typography.family.semibold, fontSize: typography.size.body },
  resultCount: {
    color: colors.mutedSoft,
    fontFamily: typography.family.medium,
    fontSize: typography.size.caption,
  },
  userTableHeader: {
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  tableHeaderText: {
    color: colors.mutedSoft,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  userList: { gap: 0 },
  userListWide: { marginHorizontal: -spacing.lg },
  userListMobile: { marginHorizontal: -spacing.md, gap: 0 },
  userCard: {
    minHeight: 112,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  userCardMobile: {
    minHeight: 0,
    flexShrink: 0,
    width: "100%",
    alignItems: "stretch",
    flexDirection: "column",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  identityColumn: { flex: 2.2, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.md },
  identityColumnMobile: {
    width: "100%",
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    alignItems: "flex-start",
  },
  profileColumn: {
    flex: 1.1,
    minWidth: 0,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: 20,
  },
  indicatorsColumn: { flex: 1.2, minWidth: 130 },
  actionsColumn: { width: 172, flexShrink: 0 },
  avatar: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  avatarText: { color: colors.brand, fontFamily: typography.family.bold },
  userCopy: { flex: 1, minWidth: 0, flexShrink: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  userName: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.bodyLarge },
  userDetail: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    flexShrink: 1,
  },
  userMeta: {
    marginTop: spacing.xs,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  status: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
  },
  statusInactive: { backgroundColor: colors.border },
  statusText: { color: colors.success, fontFamily: typography.family.semibold, fontSize: 10 },
  statusTextInactive: { color: colors.muted },
  indicators: { minWidth: 130, gap: spacing.sm },
  indicatorsMobile: {
    width: "100%",
    minWidth: 0,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  plan: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  planPremium: { backgroundColor: colors.brandSoft },
  planText: {
    color: colors.muted,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
  },
  planTextPremium: { color: colors.brand },
  termsRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  termsText: {
    color: colors.muted,
    fontFamily: typography.family.medium,
    fontSize: typography.size.caption,
  },
  pagination: {
    minHeight: 68,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  paginationMobile: {
    minHeight: 0,
    marginHorizontal: -spacing.md,
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  paginationSummary: {
    flexShrink: 1,
    color: colors.muted,
    fontFamily: typography.family.medium,
    fontSize: typography.size.caption,
  },
  paginationControls: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  pageArrow: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  pageDisabled: { opacity: 0.45 },
  pageText: {
    minWidth: 56,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
    textAlign: "center",
  },
  footer: {
    minHeight: 72,
    paddingTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerMobile: { minHeight: 88, flexDirection: "column", justifyContent: "center", gap: spacing.xs },
  footerBrand: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
  },
  footerAccent: { color: colors.brand },
  footerText: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    textAlign: "center",
  },
  actions: { width: 172, flexShrink: 0, alignItems: "stretch", gap: spacing.sm },
  actionsMobile: {
    width: "100%",
    minWidth: 0,
    flexDirection: "column",
    alignItems: "stretch",
  },
  primaryButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  primaryButtonText: { color: colors.onBrand, fontFamily: typography.family.bold },
  buttonDisabled: { opacity: 0.5 },
  secondaryButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: { color: colors.brand, fontFamily: typography.family.semibold },
  backdrop: {
    flex: 1,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
  },
  planPickerModal: {
    width: "100%",
    maxWidth: 440,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  pickerTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title },
  pickerClose: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  planPickerOptions: { marginTop: spacing.lg, gap: spacing.sm },
  planPickerOption: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  planPickerOptionActive: { borderColor: colors.brand, backgroundColor: colors.brand },
  planPickerOptionText: { color: colors.ink, fontFamily: typography.family.semibold, fontSize: typography.size.body },
  planPickerOptionTextActive: { color: colors.onBrand },
  modal: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "90%",
    padding: spacing.lg,
    gap: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  confirmModal: {
    width: "100%",
    maxWidth: 440,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  modalTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
    textAlign: "center",
  },
  modalSubtitle: { marginTop: spacing.xs, color: colors.mutedSoft, fontFamily: typography.family.regular },
  detailListScroll: { flexShrink: 1 },
  detailList: { gap: spacing.sm },
  detailRow: {
    paddingBottom: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailLabel: { color: colors.muted, fontFamily: typography.family.medium },
  detailValue: { flex: 1, color: colors.ink, fontFamily: typography.family.semibold, textAlign: "right" },
  confirmIcon: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.warningSoft,
  },
  confirmText: { color: colors.muted, fontFamily: typography.family.regular, textAlign: "center" },
  confirmActions: {
    width: "100%",
    flexDirection: "column-reverse",
    justifyContent: "center",
    gap: spacing.sm,
  },
});
