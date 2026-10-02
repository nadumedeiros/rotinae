import { useState } from "react";
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputProps,
} from "react-native";

import { AppIcon } from "./app-icon";
import {
  breakpoints,
  colors,
  control,
  elevation,
  radius,
  spacing,
  typography,
} from "@/src/theme/tokens";

const WEB_BACKDROP_STYLE =
  Platform.OS === "web"
    ? ({
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        padding: spacing.lg,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.overlay,
      } as object)
    : null;

const PRESET_HOURS = [
  { label: "Livre (0h)", value: 0 },
  { label: "1 hora", value: 1 },
  { label: "2 horas", value: 2 },
  { label: "4 horas", value: 4 },
  { label: "12 horas", value: 12 },
  { label: "24h (1 dia)", value: 24 },
  { label: "48h (2 dias)", value: 48 },
  { label: "72h (3 dias)", value: 72 },
];

export type AdvanceHoursFieldProps = Omit<
  TextInputProps,
  "value" | "onChangeText"
> & {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
  invalid?: boolean;
  title?: string;
};

export function AdvanceHoursField({
  value,
  onChangeText,
  label = "Antecedência mínima",
  invalid,
  title = "Selecionar antecedência mínima",
  accessibilityLabel,
  testID,
  ...inputProps
}: AdvanceHoursFieldProps) {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const [visible, setVisible] = useState(false);
  const [pendingHours, setPendingHours] = useState(0);

  const openModal = () => {
    Keyboard.dismiss();
    const num = parseInt(value, 10);
    setPendingHours(Number.isNaN(num) || num < 0 ? 0 : Math.min(num, 720));
    setVisible(true);
  };

  const closeModal = () => setVisible(false);

  const confirm = () => {
    onChangeText(String(pendingHours));
    closeModal();
  };

  const step = (delta: number) => {
    setPendingHours((prev) => Math.max(0, Math.min(720, prev + delta)));
  };

  return (
    <>
      <View style={[styles.fieldIconRow, invalid && styles.fieldIconRowError]}>
        <TextInput
          value={value}
          onChangeText={(v) => onChangeText(v.replace(/\D/g, "").slice(0, 3))}
          accessibilityLabel={accessibilityLabel ?? label}
          placeholder="Ex.: 0 ou 24"
          placeholderTextColor={colors.mutedSoft}
          keyboardType="number-pad"
          style={styles.fieldIconRowInput}
          testID={testID}
          {...inputProps}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Abrir seletor para o campo ${label}`}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          onPress={openModal}
        >
          <AppIcon name="clock" size={20} color={colors.brand} />
        </Pressable>
      </View>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
        statusBarTranslucent
      >
        <Pressable
          style={WEB_BACKDROP_STYLE ?? styles.backdrop}
          onPress={closeModal}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View
              accessibilityViewIsModal
              style={[styles.modalCard, !wide && styles.modalCardMobile]}
            >
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderInfo}>
                  <Text style={styles.modalTitle}>{title}</Text>
                  <Text style={styles.modalSubtitle}>
                    Tempo prévio para os clientes solicitarem agendamentos.
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fechar seletor"
                  hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
                  onPress={closeModal}
                  style={styles.closeButton}
                >
                  <AppIcon name="close" size={18} color={colors.muted} />
                </Pressable>
              </View>

              {/* Stepper Central */}
              <View style={styles.stepperContainer}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Diminuir 1 hora"
                  onPress={() => step(-1)}
                  disabled={pendingHours <= 0}
                  style={[
                    styles.stepperButton,
                    pendingHours <= 0 && styles.stepperButtonDisabled,
                  ]}
                >
                  <AppIcon
                    name="back"
                    size={18}
                    color={pendingHours <= 0 ? colors.mutedSoft : colors.ink}
                  />
                </Pressable>

                <View style={styles.valueDisplay}>
                  <Text style={styles.valueNumber}>{pendingHours}</Text>
                  <Text style={styles.valueUnit}>
                    {pendingHours === 0
                      ? "horas (Livre / Sem bloqueio)"
                      : pendingHours === 1
                        ? "hora de antecedência"
                        : "horas de antecedência"}
                  </Text>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Aumentar 1 hora"
                  onPress={() => step(1)}
                  disabled={pendingHours >= 720}
                  style={[
                    styles.stepperButton,
                    pendingHours >= 720 && styles.stepperButtonDisabled,
                  ]}
                >
                  <AppIcon
                    name="forward"
                    size={18}
                    color={pendingHours >= 720 ? colors.mutedSoft : colors.ink}
                  />
                </Pressable>
              </View>

              {/* Atalhos Rápidos */}
              <Text style={styles.presetsLabel}>Opções frequentes</Text>
              <View style={styles.presetsGrid}>
                {PRESET_HOURS.map((preset) => {
                  const isSelected = pendingHours === preset.value;
                  return (
                    <Pressable
                      key={preset.value}
                      onPress={() => setPendingHours(preset.value)}
                      style={[
                        styles.presetChip,
                        isSelected && styles.presetChipSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.presetChipText,
                          isSelected && styles.presetChipTextSelected,
                        ]}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.confirmActions}>
                <Pressable onPress={closeModal} style={styles.cancelButton}>
                  <Text style={styles.cancelButtonText}>Cancelar</Text>
                </Pressable>
                <Pressable onPress={confirm} style={styles.saveButton}>
                  <AppIcon name="success" size={18} color={colors.onBrand} />
                  <Text style={styles.saveButtonText}>Confirmar</Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fieldIconRow: {
    width: "100%",
    minWidth: 0,
    height: control.heightMd,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  fieldIconRowError: {
    borderColor: colors.danger,
  },
  fieldIconRowInput: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    color: colors.ink,
    fontSize: typography.size.body,
    fontFamily: typography.family.regular,
    padding: 0,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}),
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
  },
  modalCard: {
    width: 380,
    maxWidth: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    ...elevation.floating,
  },
  modalCardMobile: {
    width: "100%",
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  modalHeaderInfo: {
    flex: 1,
    minWidth: 0,
    paddingRight: spacing.xs,
  },
  modalTitle: {
    fontSize: typography.size.subtitle,
    fontFamily: typography.family.bold,
    color: colors.ink,
  },
  modalSubtitle: {
    fontSize: typography.size.caption,
    fontFamily: typography.family.regular,
    color: colors.muted,
    marginTop: spacing.xxs,
  },
  closeButton: {
    width: 32,
    height: 32,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  stepperContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  stepperButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperButtonDisabled: {
    opacity: 0.4,
    backgroundColor: colors.surfaceSubtle,
  },
  valueDisplay: {
    alignItems: "center",
    justifyContent: "center",
  },
  valueNumber: {
    fontSize: 28,
    fontFamily: typography.family.bold,
    color: colors.brandDark,
  },
  valueUnit: {
    fontSize: typography.size.caption,
    fontFamily: typography.family.medium,
    color: colors.muted,
    marginTop: 2,
  },
  presetsLabel: {
    fontSize: typography.size.caption,
    fontFamily: typography.family.semibold,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  presetsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.xl,
  },
  presetChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  presetChipSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  presetChipText: {
    fontSize: typography.size.caption,
    fontFamily: typography.family.medium,
    color: colors.ink,
  },
  presetChipTextSelected: {
    fontFamily: typography.family.bold,
    color: colors.brandDark,
  },
  confirmActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  cancelButton: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  cancelButtonText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
  },
  saveButton: {
    minHeight: 42,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  saveButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
});
