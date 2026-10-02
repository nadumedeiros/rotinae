import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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

import { AppIcon, type AppIconName } from "@/src/components/ui/app-icon";
import { ActionsBottomSheet, type ActionsBottomSheetItem } from "@/src/components/ui/actions-bottom-sheet";
import { CurrencyInput } from "@/src/components/ui/currency-input";
import { DatePickerField } from "@/src/components/ui/date-picker-field";
import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { PageLoadingOverlay } from "@/src/components/ui/page-loading-overlay";
import { MobileTabBar } from "@/src/components/layout/mobile-tab-bar";
import {
  PaymentError,
  type PaymentHistoryResult,
  type PaymentRecord,
} from "@/src/domain/payments/types";
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

// Utilitários locais de data — mesma duplicação intencional de app/payments.tsx
// (nenhuma tela de formulário do projeto importa esses helpers de um módulo
// compartilhado; cada tela mantém sua própria cópia pequena e pura).
function formatDateInput(input: string) {
  const digits = input.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function isValidBrazilianDate(input: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input);
  if (!match) return false;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function brazilianToIso(input: string) {
  const [day, month, year] = input.split("/");
  return `${year}-${month}-${day}`;
}

function isoToBrazilian(input: string) {
  if (!input) return "";
  const [year, month, day] = input.split("-");
  return `${day}/${month}/${year}`;
}
/** `receivedAt` é um timestamp ISO completo (`AAAA-MM-DDTHH:MM:SS.sssZ`) — usa só a parte da data. */
function receivedAtToBrazilian(input: string | null | undefined) {
  if (!input) return "";
  return isoToBrazilian(input.slice(0, 10));
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

type StatusMeta = {
  label: string;
  bg: string;
  color: string;
  icon: AppIconName;
};

const STATUS_META: Record<PaymentRecord["status"], StatusMeta> = {
  pending: { label: "Pendente", bg: colors.warningSoft, color: colors.warning, icon: "schedule" },
  received: { label: "Recebido", bg: colors.successSoft, color: colors.success, icon: "success" },
  overdue: { label: "Atrasado", bg: colors.dangerSoft, color: colors.danger, icon: "warning" },
  cancelled: { label: "Cancelado", bg: colors.surfaceSubtle, color: colors.muted, icon: "error" },
};

export default function PaymentHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;

  const [history, setHistory] = useState<PaymentHistoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    try {
      const result = await paymentService.getPaymentHistory(id);
      setHistory(result);
      setNotFound(false);
      setLoadError("");
    } catch (caught) {
      if (caught instanceof PaymentError && caught.code === "PAYMENT_NOT_FOUND") {
        setNotFound(true);
        setHistory(null);
      } else {
        setLoadError(
          caught instanceof PaymentError
            ? caught.message
            : "Não foi possível carregar o histórico deste pagamento.",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Re-busca a cada foco da rota — mesmo padrão de app/clients/[id].tsx: uma
  // edição/exclusão feita aqui precisa refletir imediatamente ao voltar para
  // esta tela vindo de outra aba/rota.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function retryLoad() {
    setRetrying(true);
    setLoading(true);
    try {
      await load();
    } finally {
      setRetrying(false);
    }
  }

  // ── Menu de ações (mobile: dots → bottom sheet, mesmo padrão de
  // `app/clients/[id].tsx`/`appointmentMenuId`) ──
  const [receiptMenuId, setReceiptMenuId] = useState<string | null>(null);

  // ── Edição de pagamento parcial ──
  const [editingReceipt, setEditingReceipt] = useState<PaymentRecord | null>(null);
  const [editAmountCents, setEditAmountCents] = useState(0);
  const [editDueDate, setEditDueDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  function openEdit(receipt: PaymentRecord) {
    setEditingReceipt(receipt);
    setEditAmountCents(receipt.valueCents);
    setEditDueDate(isoToBrazilian(receipt.dueDate));
    setEditNotes(receipt.notes ?? "");
    setEditError("");
  }

  function closeEdit() {
    if (savingEdit) return;
    setEditingReceipt(null);
  }

  async function saveEdit() {
    if (!editingReceipt) return;
    if (editAmountCents <= 0) {
      setEditError("Informe um valor maior que zero.");
      return;
    }
    if (!isValidBrazilianDate(editDueDate)) {
      setEditError("Informe uma data válida (DD/MM/AAAA).");
      return;
    }
    setSavingEdit(true);
    setEditError("");
    try {
      await paymentService.updatePartialPayment(editingReceipt.id, {
        amountCents: editAmountCents,
        dueDate: brazilianToIso(editDueDate),
        notes: editNotes.trim(),
      });
      setEditingReceipt(null);
      await load();
    } catch (caught) {
      // Mantém o modal aberto com o erro visível (ex.: PAYMENT_EXCEEDS_BALANCE)
      // em vez de fechar silenciosamente — o usuário precisa saber por que a
      // edição não foi aplicada para poder corrigir o valor.
      setEditError(
        caught instanceof PaymentError
          ? caught.message
          : "Não foi possível salvar as alterações. Verifique sua conexão e tente novamente.",
      );
    } finally {
      setSavingEdit(false);
    }
  }

  // ── Exclusão de pagamento parcial ──
  const [deletingReceipt, setDeletingReceipt] = useState<PaymentRecord | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deletingPartial, setDeletingPartial] = useState(false);

  function closeDelete() {
    setDeletingReceipt(null);
    setDeleteError("");
  }

  async function confirmDeleteReceipt() {
    if (!deletingReceipt) return;
    setDeletingPartial(true);
    setDeleteError("");
    try {
      await paymentService.deletePartialPayment(deletingReceipt.id);
      setDeletingReceipt(null);
      await load();
    } catch (caught) {
      setDeleteError(
        caught instanceof PaymentError
          ? caught.message
          : "Não foi possível excluir este pagamento parcial. Verifique sua conexão e tente novamente.",
      );
    } finally {
      setDeletingPartial(false);
    }
  }

  if (!history) {
    return (
      <SafeAreaView style={styles.safe}>
        <AuthenticatedHeader />
        {loading && <PageLoadingOverlay />}
        {!loading && (
          <View style={styles.notFound}>
            <AppIcon
              name={notFound ? "warning" : "error"}
              size={40}
              color={notFound ? colors.warning : colors.danger}
            />
            <Text style={styles.notFoundTitle}>
              {notFound ? "Pagamento não encontrado" : "Não foi possível carregar este pagamento"}
            </Text>
            {!!loadError && (
              <Text style={styles.notFoundText}>{loadError}</Text>
            )}
            <View style={styles.notFoundActions}>
              {!notFound && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: retrying, busy: retrying }}
                  disabled={retrying}
                  onPress={() => void retryLoad()}
                  style={({ pressed }) => [
                    styles.secondary,
                    retrying && { opacity: opacity.disabled },
                    pressed && !retrying && { opacity: opacity.pressed },
                  ]}
                >
                  {retrying && <ActivityIndicator size="small" color={colors.brand} />}
                  <Text style={styles.secondaryText}>Tentar novamente</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace("/payments")}
                style={styles.primary}
              >
                <Text style={styles.primaryText}>Voltar para pagamentos</Text>
              </Pressable>
            </View>
          </View>
        )}
        <MobileTabBar />
      </SafeAreaView>
    );
  }

  const { charge, receipts, receivedCents, balanceCents } = history;
  const statusMeta = STATUS_META[charge.status];

  const menuReceipt = receipts.find((receipt) => receipt.id === receiptMenuId) ?? null;
  const receiptMenuItems: ActionsBottomSheetItem[] = !menuReceipt
    ? []
    : [
        {
          key: "edit",
          label: "Editar",
          icon: "edit",
          iconBackgroundColor: colors.brandSoft,
          iconColor: colors.brand,
          onPress: () => {
            openEdit(menuReceipt);
            setReceiptMenuId(null);
          },
        },
        {
          key: "delete",
          label: "Excluir",
          icon: "delete",
          iconBackgroundColor: colors.dangerSoft,
          iconColor: colors.danger,
          labelColor: colors.danger,
          onPress: () => {
            setDeleteError("");
            setDeletingReceipt(menuReceipt);
            setReceiptMenuId(null);
          },
        },
      ];

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.content, !wide && styles.contentMobile]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/payments")}
            style={styles.back}
          >
            <AppIcon name="back" size={16} color={colors.brand} />
            <Text style={styles.backText}>Pagamentos</Text>
          </Pressable>

          <View style={[styles.hero, !wide && styles.heroMobile]}>
            <View style={styles.avatar}>
              <AppIcon name="financial" size={32} color={colors.brand} />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>HISTÓRICO DO PAGAMENTO</Text>
              <Text style={styles.title}>{charge.clientName ?? "Cliente"}</Text>
              <Text style={styles.description}>
                {charge.origin} · Vencimento {isoToBrazilian(charge.dueDate)}
              </Text>
            </View>
            <View style={[styles.heroStatus, { backgroundColor: statusMeta.bg }]}>
              <AppIcon name={statusMeta.icon} size={14} color={statusMeta.color} />
              <Text style={[styles.heroStatusText, { color: statusMeta.color }]}>
                {statusMeta.label}
              </Text>
            </View>
          </View>

          <View style={[styles.grid, wide && styles.gridWide]}>
            <View style={[styles.column, wide && styles.columnWide]}>
              <View style={[styles.card, wide ? styles.cardWide : styles.cardMobile]}>
                <Text style={styles.cardEyebrow}>VALOR TOTAL ORIGINAL</Text>
                <Text style={styles.value}>{formatCurrency(charge.valueCents)}</Text>
                <View style={styles.summaryGrid}>
                  <View style={styles.summaryChip}>
                    <Text style={styles.summaryChipValue}>{formatCurrency(receivedCents)}</Text>
                    <Text style={styles.summaryChipLabel}>Recebido</Text>
                  </View>
                  <View style={styles.summaryChip}>
                    <Text style={styles.summaryChipValue}>{formatCurrency(balanceCents)}</Text>
                    <Text style={styles.summaryChipLabel}>A receber</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={[styles.notesCard, wide ? styles.notesCardWide : styles.cardMobile]}>
              <View style={styles.notesHeader}>
                <View>
                  <Text style={styles.cardEyebrow}>PAGAMENTOS PARCIAIS</Text>
                  <Text style={styles.cardTitle}>Recibos registrados</Text>
                </View>
                <View style={styles.count}>
                  <Text style={styles.countText}>{receipts.length}</Text>
                </View>
              </View>
              <View style={styles.receiptList}>
                {receipts.map((receipt) => (
                  <View key={receipt.id} style={styles.receiptItem}>
                    <View style={styles.receiptCopy}>
                      <Text style={styles.receiptValue}>{formatCurrency(receipt.valueCents)}</Text>
                      {/* Bug encontrado (06/09/2026): mostrava `receipt.dueDate`
                          (dia em que o recibo foi CADASTRADO, sempre a data do
                          servidor no momento do registro) em vez de
                          `receipt.receivedAt` (dia em que o dinheiro
                          efetivamente entrou, agora escolhível pelo
                          prestador — DEC-168). Com um recebimento retroativo,
                          mostrava sempre "hoje", nunca a data real recebida. */}
                      <Text style={styles.receiptDate}>Recebido em {receivedAtToBrazilian(receipt.receivedAt)}</Text>
                      {!!receipt.notes && (
                        <Text style={styles.receiptNotes} numberOfLines={3}>
                          {receipt.notes}
                        </Text>
                      )}
                    </View>
                    <View style={styles.receiptActions}>
                      {wide ? (
                        <>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Editar pagamento parcial de ${formatCurrency(receipt.valueCents)}`}
                            onPress={() => openEdit(receipt)}
                            style={styles.receiptEditButton}
                          >
                            <AppIcon name="edit" size={14} color={colors.brand} />
                            <Text style={styles.receiptEditText}>Editar</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Excluir pagamento parcial de ${formatCurrency(receipt.valueCents)}`}
                            onPress={() => {
                              setDeleteError("");
                              setDeletingReceipt(receipt);
                            }}
                            style={styles.receiptDeleteButton}
                          >
                            <AppIcon name="delete" size={14} color={colors.danger} />
                            <Text style={styles.receiptDeleteText}>Excluir</Text>
                          </Pressable>
                        </>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Mais ações para o pagamento parcial de ${formatCurrency(receipt.valueCents)}`}
                          onPress={() => setReceiptMenuId(receipt.id)}
                          style={styles.receiptDotsButton}
                        >
                          <AppIcon name="dots" size={16} color={colors.muted} />
                        </Pressable>
                      )}
                    </View>
                  </View>
                ))}
                {!receipts.length && (
                  <View style={styles.empty}>
                    <AppIcon name="file" size={32} color={colors.mutedSoft} />
                    <Text style={styles.infoLabel}>
                      Nenhum pagamento parcial registrado ainda.
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
      <MobileTabBar />

      <ActionsBottomSheet
        visible={receiptMenuId !== null}
        title={menuReceipt ? `Pagamento de ${formatCurrency(menuReceipt.valueCents)}` : undefined}
        onClose={() => setReceiptMenuId(null)}
        items={receiptMenuItems}
      />

      {/* ─── Modal de edição de pagamento parcial ─── */}
      <Modal
        visible={editingReceipt !== null}
        transparent
        animationType="slide"
        onRequestClose={closeEdit}
      >
        <KeyboardAvoidingView
          style={[styles.modalBackdrop, !wide && styles.modalBackdropMobile]}
          behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
        >
          <View accessibilityViewIsModal style={[styles.formModal, !wide && styles.formModalMobile]}>
            <ScrollView
              contentContainerStyle={[styles.formModalContent, !wide && styles.formModalContentMobile]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderCopy}>
                  <Text accessibilityRole="header" style={styles.modalTitle}>
                    Editar pagamento parcial
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    Ajuste o valor, o vencimento ou a observação deste recibo.
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fechar edição"
                  onPress={closeEdit}
                  style={styles.closeButton}
                >
                  <AppIcon name="close" size={20} color={colors.muted} />
                </Pressable>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Valor</Text>
                <CurrencyInput
                  valueCents={editAmountCents}
                  onChangeValueCents={setEditAmountCents}
                  accessibilityLabel="Valor do pagamento parcial"
                  invalid={!!editError}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Vencimento</Text>
                <DatePickerField
                  label="Vencimento do pagamento parcial"
                  value={editDueDate}
                  onChangeText={(text) => setEditDueDate(formatDateInput(text))}
                  invalid={!!editError}
                  placeholder="DD/MM/AAAA"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>
                  Observação <Text style={styles.optional}>(opcional)</Text>
                </Text>
                <TextInput
                  accessibilityLabel="Observação do pagamento parcial"
                  value={editNotes}
                  onChangeText={setEditNotes}
                  multiline
                  numberOfLines={3}
                  placeholder="Adicione uma informação útil para seu controle"
                  placeholderTextColor={colors.mutedSoft}
                  style={[styles.fieldInput, styles.textArea]}
                />
              </View>

              {!!editError && (
                <View accessibilityRole="alert" style={styles.errorBox}>
                  <AppIcon name="warning" size={16} color={colors.danger} />
                  <Text style={styles.errorText}>{editError}</Text>
                </View>
              )}

              <View style={styles.formActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={savingEdit}
                  onPress={closeEdit}
                  style={[styles.cancelButton, styles.formActionButton, savingEdit && { opacity: opacity.disabled }]}
                >
                  <Text style={styles.cancelText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: savingEdit, busy: savingEdit }}
                  disabled={savingEdit}
                  onPress={() => void saveEdit()}
                  style={({ pressed }) => [
                    styles.saveButton,
                    styles.formActionButton,
                    pressed && !savingEdit && { opacity: opacity.pressed },
                  ]}
                >
                  {savingEdit && <ActivityIndicator size="small" color={colors.onBrand} />}
                  <Text style={styles.saveText}>Salvar alterações</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Modal de confirmação de exclusão ─── */}
      <Modal
        visible={deletingReceipt !== null}
        transparent
        animationType="fade"
        onRequestClose={closeDelete}
      >
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.confirmModal}>
            <View style={styles.confirmIcon}>
              <AppIcon name="delete" size={24} color={colors.danger} />
            </View>
            <Text style={styles.successTitle}>Excluir este pagamento parcial?</Text>
            <Text style={styles.successDescription}>
              O saldo pendente desta cobrança será recalculado. Essa ação não
              pode ser desfeita.
            </Text>
            {deleteError ? (
              <View accessibilityRole="alert" style={styles.errorBox}>
                <AppIcon name="warning" size={16} color={colors.danger} />
                <Text style={styles.errorText}>{deleteError}</Text>
              </View>
            ) : null}
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                disabled={deletingPartial}
                onPress={closeDelete}
                style={[styles.cancelButton, styles.formActionButton, deletingPartial && { opacity: opacity.disabled }]}
              >
                <Text style={styles.cancelText}>{deleteError ? "Fechar" : "Cancelar"}</Text>
              </Pressable>
              {!deleteError && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: deletingPartial, busy: deletingPartial }}
                  disabled={deletingPartial}
                  onPress={() => void confirmDeleteReceipt()}
                  style={({ pressed }) => [
                    styles.confirmDeleteButton,
                    styles.formActionButton,
                    styles.confirmButtonSpinnerRow,
                    pressed && !deletingPartial && { opacity: opacity.pressed },
                  ]}
                >
                  {deletingPartial && <ActivityIndicator size="small" color={colors.onBrand} />}
                  <Text style={styles.confirmDeleteText}>Excluir</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flexGrow: 1 },
  content: {
    width: "100%",
    maxWidth: layout.contentMax,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  contentMobile: { padding: spacing.md, paddingBottom: 96 },
  back: {
    alignSelf: "flex-start",
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  backText: { color: colors.brand, fontFamily: typography.family.semibold },
  hero: {
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brandDark,
    ...elevation.card,
  },
  heroMobile: { alignItems: "flex-start", flexWrap: "wrap" },
  avatar: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  heroCopy: { flex: 1, minWidth: 180 },
  eyebrow: {
    color: colors.accentSoft,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 1.2,
  },
  title: {
    marginTop: spacing.xs,
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: 32,
  },
  description: {
    marginTop: spacing.xs,
    color: colors.accentSoft,
    fontFamily: typography.family.regular,
  },
  heroStatus: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.pill,
  },
  heroStatusText: {
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  grid: { gap: spacing.md },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  column: { gap: spacing.md, width: "100%" },
  columnWide: { flex: 1 },
  card: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  cardWide: { width: "100%" },
  cardMobile: { padding: spacing.md, width: "100%" },
  cardEyebrow: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 1,
  },
  cardTitle: {
    marginTop: spacing.xs,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  value: {
    marginTop: spacing.md,
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: 28,
  },
  summaryGrid: {
    marginTop: spacing.lg,
    flexDirection: "row",
    gap: spacing.sm,
  },
  summaryChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    gap: spacing.xxs,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  summaryChipValue: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
  },
  summaryChipLabel: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  notesCard: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  notesCardWide: { flex: 1 },
  notesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  count: {
    minWidth: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  countText: { color: colors.brand, fontFamily: typography.family.bold },
  receiptList: { marginTop: spacing.lg, gap: spacing.sm },
  receiptItem: {
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  receiptCopy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  receiptValue: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  receiptDate: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  receiptNotes: {
    marginTop: spacing.xxs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  receiptActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  receiptEditButton: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  receiptEditText: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  receiptDeleteButton: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  receiptDeleteText: {
    color: colors.danger,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  receiptDotsButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  empty: {
    padding: spacing.xl,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  infoLabel: { color: colors.muted, fontFamily: typography.family.regular, textAlign: "center" },
  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  notFoundTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title },
  notFoundText: { color: colors.muted, fontFamily: typography.family.regular, textAlign: "center" },
  notFoundActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm },
  primary: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  primaryText: { color: colors.onBrand, fontFamily: typography.family.bold },
  secondary: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryText: { color: colors.brand, fontFamily: typography.family.bold },
  // ── Modais ──
  modalBackdrop: {
    flex: 1,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
  },
  modalBackdropMobile: { padding: spacing.md, justifyContent: "flex-end" },
  formModal: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "92%",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  formModalMobile: { borderRadius: radius.md },
  formModalContent: { padding: spacing.lg, gap: spacing.md },
  formModalContentMobile: { padding: spacing.md, gap: spacing.md },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  modalHeaderCopy: { flex: 1, minWidth: 0 },
  modalTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
  },
  modalSubtitle: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  closeButton: {
    width: 40,
    height: 40,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  field: { gap: spacing.xs },
  fieldLabel: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  optional: { color: colors.mutedSoft, fontFamily: typography.family.regular },
  fieldInput: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  textArea: {
    minHeight: 90,
    paddingTop: spacing.md,
    textAlignVertical: "top",
  },
  errorBox: {
    flexShrink: 0,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  errorText: {
    flex: 1,
    color: colors.danger,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  formActions: {
    marginTop: spacing.sm,
    flexDirection: "column-reverse",
    gap: spacing.sm,
  },
  formActionButton: { width: "100%", flex: 0, minWidth: 0, paddingHorizontal: spacing.md },
  cancelButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  cancelText: { color: colors.muted, fontFamily: typography.family.semibold },
  saveButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  saveText: { color: colors.onBrand, fontFamily: typography.family.bold },
  confirmModal: {
    width: "100%",
    maxWidth: 420,
    padding: spacing.lg,
    alignItems: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  confirmIcon: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSoft,
  },
  successTitle: {
    marginTop: spacing.md,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
    textAlign: "center",
  },
  successDescription: {
    marginTop: spacing.sm,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.bodyLarge,
    lineHeight: typography.lineHeight.bodyLarge,
    textAlign: "center",
  },
  confirmActions: {
    width: "100%",
    marginTop: spacing.lg,
    flexDirection: "column-reverse",
    justifyContent: "center",
    gap: spacing.sm,
  },
  confirmButtonSpinnerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  confirmDeleteButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.danger,
  },
  confirmDeleteText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
});
