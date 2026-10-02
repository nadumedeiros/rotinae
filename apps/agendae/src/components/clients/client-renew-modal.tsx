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
  View,
} from "react-native";

import { AppIcon } from "@/src/components/ui/app-icon";
import { CurrencyInput } from "@/src/components/ui/currency-input";
import { DatePickerField } from "@/src/components/ui/date-picker-field";
import { formatDateInput } from "@/src/domain/clients/client-form-utils";
import type { ClientRenewForm } from "@/src/hooks/use-client-renew-form";
import { colors, elevation, opacity, radius, spacing, typography } from "@/src/theme/tokens";

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatCurrentPeriod(start: string | null, end: string | null): string {
  if (!start || !end) return "Livre";
  const [startYear, startMonth, startDay] = start.split("-");
  const [endYear, endMonth, endDay] = end.split("-");
  return `${startDay}/${startMonth}/${startYear} a ${endDay}/${endMonth}/${endYear}`;
}

/**
 * Modal DEDICADO de renovação de pacote do cliente (quantidade de aulas,
 * valor do serviço e período para solicitar) — fluxo conceitualmente
 * diferente do cadastro/edição (`ClientEditModal`): começa por uma etapa
 * informativa/confirmação (pedido explícito do usuário) antes de liberar a
 * edição dos novos valores, porque a ação arquiva os valores atuais no
 * histórico e zera o contador de agendamentos usados.
 */
export function ClientRenewModal({
  visible,
  wide,
  form,
  onClose,
}: {
  visible: boolean;
  wide: boolean;
  form: ClientRenewForm;
  onClose: () => void;
}) {
  const client = form.client;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
      >
        <View accessibilityViewIsModal style={[styles.modalCard, !wide && styles.modalCardMobile]}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderCopy}>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                Renovar pacote do cliente
              </Text>
              <Text style={styles.modalSubtitle}>
                {form.step === 1
                  ? "Confira o que vai acontecer antes de continuar."
                  : "Defina os novos valores do pacote."}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar renovação"
              onPress={onClose}
              style={styles.closeButton}
            >
              <AppIcon name="error" size={20} color={colors.muted} />
            </Pressable>
          </View>

          {client && form.step === 1 && (
            <ScrollView
              style={styles.formScroll}
              contentContainerStyle={styles.form}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.noticeBox}>
                <AppIcon name="warning" size={20} color={colors.warning} />
                <Text style={styles.noticeText}>
                  Ao renovar, os valores atuais abaixo serão arquivados no histórico de renovações e o
                  contador de agendamentos usados deste cliente será zerado a partir de agora — inclusive
                  se ele já tiver atingido o limite do pacote anterior.
                </Text>
              </View>
              <View style={styles.currentValuesBox}>
                <Text style={styles.currentValuesTitle}>Valores atuais</Text>
                <View style={styles.currentValueRow}>
                  <Text style={styles.currentValueLabel}>Quantidade de aulas</Text>
                  <Text style={styles.currentValueValue}>
                    {client.bookingPolicy.totalBookingLimit?.toString() ?? "Livre"}
                  </Text>
                </View>
                <View style={styles.currentValueRow}>
                  <Text style={styles.currentValueLabel}>Valor do serviço</Text>
                  <Text style={styles.currentValueValue}>
                    {currencyFormatter.format(client.serviceValueCents / 100)}
                  </Text>
                </View>
                <View style={[styles.currentValueRow, styles.currentValueRowLast]}>
                  <Text style={styles.currentValueLabel}>Período para solicitar</Text>
                  <Text style={styles.currentValueValue}>
                    {formatCurrentPeriod(
                      client.bookingPolicy.requestWindowStart,
                      client.bookingPolicy.requestWindowEnd,
                    )}
                  </Text>
                </View>
              </View>
            </ScrollView>
          )}

          {client && form.step === 2 && (
            <ScrollView
              style={styles.formScroll}
              contentContainerStyle={styles.form}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Valor do serviço</Text>
                <CurrencyInput
                  accessibilityLabel="Novo valor do serviço em reais"
                  valueCents={form.serviceValueCents}
                  onChangeValueCents={form.setServiceValueCents}
                  prefixStyle={styles.currencyPrefix}
                />
                <Text style={styles.fieldHelper}>
                  Se maior que zero, uma cobrança pendente será criada automaticamente no Financeiro.
                </Text>
              </View>
              <View style={styles.policyField}>
                <View style={styles.policyFieldHeader}>
                  <View style={styles.policyFieldCopy}>
                    <Text style={styles.fieldLabel}>Quantidade total de aulas</Text>
                    <Text style={styles.fieldHelper}>Novo limite acumulado de marcações permitidas.</Text>
                  </View>
                  <View style={styles.modeToggle}>
                    <Pressable
                      onPress={() => form.setTotalLimitFree(true)}
                      style={[styles.modeOption, form.totalLimitFree && styles.modeOptionActive]}
                    >
                      <Text style={[styles.modeOptionText, form.totalLimitFree && styles.modeOptionTextActive]}>
                        Livre
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => form.setTotalLimitFree(false)}
                      style={[styles.modeOption, !form.totalLimitFree && styles.modeOptionActive]}
                    >
                      <Text style={[styles.modeOptionText, !form.totalLimitFree && styles.modeOptionTextActive]}>
                        Limitado
                      </Text>
                    </Pressable>
                  </View>
                </View>
                {!form.totalLimitFree && (
                  <TextInput
                    accessibilityLabel="Nova quantidade total permitida"
                    value={form.totalLimit}
                    onChangeText={(value) => {
                      form.setTotalLimit(value);
                      form.setFieldErrors((current) => ({ ...current, totalLimit: undefined }));
                    }}
                    keyboardType="number-pad"
                    placeholder="Ex.: 8"
                    placeholderTextColor={colors.mutedSoft}
                    style={[styles.fieldInput, !!form.fieldErrors.totalLimit && styles.fieldInputError]}
                  />
                )}
                {!!form.fieldErrors.totalLimit && (
                  <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                    {form.fieldErrors.totalLimit}
                  </Text>
                )}
              </View>
              <View style={styles.policyField}>
                <View style={styles.policyFieldHeader}>
                  <View style={styles.policyFieldCopy}>
                    <Text style={styles.fieldLabel}>Período para solicitar</Text>
                    <Text style={styles.fieldHelper}>
                      Fora desse intervalo, novas solicitações serão bloqueadas.
                    </Text>
                  </View>
                  <View style={styles.modeToggle}>
                    <Pressable
                      onPress={() => form.setPeriodFree(true)}
                      style={[styles.modeOption, form.periodFree && styles.modeOptionActive]}
                    >
                      <Text style={[styles.modeOptionText, form.periodFree && styles.modeOptionTextActive]}>
                        Livre
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => form.setPeriodFree(false)}
                      style={[styles.modeOption, !form.periodFree && styles.modeOptionActive]}
                    >
                      <Text style={[styles.modeOptionText, !form.periodFree && styles.modeOptionTextActive]}>
                        Definido
                      </Text>
                    </Pressable>
                  </View>
                </View>
                {!form.periodFree && (
                  <View style={[styles.periodFields, !wide && styles.periodFieldsMobile]}>
                    <View style={styles.periodField}>
                      <Text style={styles.miniLabel}>Data inicial</Text>
                      <DatePickerField
                        label="Data inicial"
                        accessibilityLabel="Data inicial no formato dia mês e ano"
                        value={form.requestFrom}
                        onChangeText={(text) => {
                          form.setRequestFrom(formatDateInput(text));
                          form.setFieldErrors((current) => ({ ...current, requestFrom: undefined }));
                        }}
                        keyboardType="number-pad"
                        maxLength={10}
                        placeholder="DD/MM/AAAA"
                        invalid={!!form.fieldErrors.requestFrom}
                      />
                      {!!form.fieldErrors.requestFrom && (
                        <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                          {form.fieldErrors.requestFrom}
                        </Text>
                      )}
                    </View>
                    <View style={styles.periodField}>
                      <Text style={styles.miniLabel}>Data final</Text>
                      <DatePickerField
                        label="Data final"
                        accessibilityLabel="Data final no formato dia mês e ano"
                        value={form.requestUntil}
                        onChangeText={(text) => {
                          form.setRequestUntil(formatDateInput(text));
                          form.setFieldErrors((current) => ({ ...current, requestUntil: undefined }));
                        }}
                        keyboardType="number-pad"
                        maxLength={10}
                        placeholder="DD/MM/AAAA"
                        invalid={!!form.fieldErrors.requestUntil}
                      />
                      {!!form.fieldErrors.requestUntil && (
                        <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                          {form.fieldErrors.requestUntil}
                        </Text>
                      )}
                    </View>
                  </View>
                )}
              </View>
              {form.formError ? (
                <View accessibilityRole="alert" style={styles.formError}>
                  <AppIcon name="warning" size={16} color={colors.danger} />
                  <Text style={styles.formErrorText}>{form.formError}</Text>
                </View>
              ) : null}
            </ScrollView>
          )}

          <View style={[styles.modalActions, !wide && styles.modalActionsMobile]}>
            {form.step === 1 ? (
              <View style={[styles.modalActionGroup, { flex: 1, width: "100%" }]}>
                <Pressable accessibilityRole="button" onPress={onClose} style={[styles.cancelButton, styles.formActionButton]}>
                  <Text style={styles.cancelButtonText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={form.goToStep2}
                  style={({ pressed }) => [
                    styles.saveButton,
                    styles.formActionButton,
                    pressed && { opacity: opacity.pressed },
                  ]}
                >
                  <Text style={styles.saveButtonText}>Continuar</Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.modalActionGroup, { flex: 1, width: "100%" }]}>
                <Pressable
                  accessibilityRole="button"
                  disabled={form.saving}
                  onPress={form.goToStep1}
                  style={[styles.cancelButton, styles.formActionButton, form.saving && { opacity: opacity.disabled }]}
                >
                  <Text style={styles.cancelButtonText}>Voltar</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: form.saving, busy: form.saving }}
                  disabled={form.saving}
                  onPress={() => void form.submit()}
                  style={({ pressed }) => [
                    styles.saveButton,
                    styles.formActionButton,
                    pressed && !form.saving && { opacity: opacity.pressed },
                  ]}
                >
                  {form.saving && <ActivityIndicator size="small" color={colors.onBrand} />}
                  <Text style={styles.saveButtonText}>Renovar</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
  },
  modalCard: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "92%",
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  modalCardMobile: { padding: spacing.md, borderRadius: radius.md },
  modalHeader: {
    flexShrink: 0,
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
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    flexShrink: 0,
  },
  formScroll: { flexShrink: 1 },
  form: { marginTop: spacing.lg, gap: 20, paddingBottom: spacing.md },
  noticeBox: {
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.warningSoft,
  },
  noticeText: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  currentValuesBox: {
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  currentValuesTitle: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  currentValueRow: {
    paddingVertical: spacing.xs,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  currentValueRowLast: { borderBottomWidth: 0 },
  currentValueLabel: { color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.caption },
  currentValueValue: { color: colors.ink, fontFamily: typography.family.semibold, fontSize: typography.size.body },
  fieldGroup: { gap: 6 },
  fieldLabel: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  fieldErrorText: {
    color: colors.danger,
    fontFamily: typography.family.medium,
    fontSize: typography.size.caption,
    marginTop: 4,
  },
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
  fieldInputError: { borderColor: colors.danger },
  fieldHelper: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  currencyPrefix: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  policyField: {
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  policyFieldHeader: { gap: spacing.md },
  policyFieldCopy: { flex: 1, gap: spacing.xs },
  modeToggle: {
    padding: spacing.xs,
    flexDirection: "row",
    gap: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  modeOption: {
    flex: 1,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.xs,
  },
  modeOptionActive: { backgroundColor: colors.brand },
  modeOptionText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  modeOptionTextActive: { color: colors.onBrand },
  periodFields: { flexDirection: "row", gap: spacing.sm },
  periodFieldsMobile: { flexDirection: "column" },
  periodField: { flex: 1, gap: spacing.xs },
  miniLabel: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  formError: {
    flexShrink: 0,
    marginVertical: spacing.xs,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  formErrorText: {
    flex: 1,
    color: colors.danger,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  modalActions: {
    flexShrink: 0,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    flexDirection: "column-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  modalActionsMobile: {
    alignItems: "stretch",
    flexDirection: "column-reverse",
  },
  modalActionGroup: {
    width: "100%",
    flexDirection: "column-reverse",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  formActionButton: { width: "100%", flex: 0, minWidth: 0, paddingHorizontal: spacing.md },
  cancelButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  cancelButtonText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  saveButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  saveButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
});
