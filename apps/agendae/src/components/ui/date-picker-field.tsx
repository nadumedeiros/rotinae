import { useMemo, useState } from "react";
import {
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputProps,
} from "react-native";

import { AppIcon } from "./app-icon";
import {
  buildCalendarMatrix,
  formatBrDate,
  initialCalendarAnchor,
  isDateDisabled,
  isSameUtcDay,
  parseBrDate,
  addMonths,
  todayUtc,
} from "./datetime-picker-utils";
import {
  breakpoints,
  colors,
  control,
  elevation,
  opacity,
  radius,
  spacing,
  typography,
} from "@/src/theme/tokens";

const WEEKDAY_LABELS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];

const longDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const monthTitleFormatter = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export type DatePickerFieldProps = Omit<TextInputProps, "value" | "onChangeText"> & {
  /** Valor formatado `DD/MM/AAAA` — mesmo estado que a digitação manual já escreve. */
  value: string;
  /** Chamado tanto pela digitação manual (texto bruto) quanto pela seleção no calendário (já formatado). */
  onChangeText: (text: string) => void;
  /** Rótulo do campo, usado no `accessibilityLabel` do ícone-gatilho ("Abrir seletor de data para o campo {label}"). */
  label: string;
  /** Limites opcionais — nenhuma regra de negócio nova (Dante, seção 5.5): decisão de quem aplica o componente. */
  minDate?: Date;
  maxDate?: Date;
  /** Estado visual de erro (borda vermelha), equivalente a `inputError`/`fieldInputError` já existentes. */
  invalid?: boolean;
  /** Título do modal — padrão "Selecionar data" (Dante, seção 5.3), sobrescrevível por tela. */
  title?: string;
};

export function DatePickerField({
  value,
  onChangeText,
  label,
  minDate,
  maxDate,
  invalid,
  title = "Selecionar data",
  accessibilityLabel,
  testID,
  ...inputProps
}: DatePickerFieldProps) {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const [visible, setVisible] = useState(false);
  const [viewYear, setViewYear] = useState(() => todayUtc().getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(() => todayUtc().getUTCMonth());

  const selectedDate = useMemo(() => parseBrDate(value), [value]);
  // Recalculado a cada render (barato, sem I/O) em vez de memoizado — precisa
  // refletir o dia civil atual mesmo se o modal ficar aberto durante a
  // virada da meia-noite.
  const today = todayUtc();
  const cells = useMemo(() => buildCalendarMatrix(viewYear, viewMonth), [viewYear, viewMonth]);
  const monthTitle = monthTitleFormatter.format(new Date(Date.UTC(viewYear, viewMonth, 1, 12, 0, 0)));

  const openModal = () => {
    Keyboard.dismiss();
    const anchor = selectedDate ?? initialCalendarAnchor(minDate, maxDate);
    setViewYear(anchor.getUTCFullYear());
    setViewMonth(anchor.getUTCMonth());
    setVisible(true);
  };

  const closeModal = () => setVisible(false);

  const goToMonth = (amount: number) => {
    const next = addMonths(viewYear, viewMonth, amount);
    setViewYear(next.year);
    setViewMonth(next.month);
  };

  const selectDay = (day: number) => {
    const picked = new Date(Date.UTC(viewYear, viewMonth, day, 12, 0, 0));
    if (isDateDisabled(picked, minDate, maxDate)) return;
    onChangeText(formatBrDate(picked));
    closeModal();
  };

  return (
    <>
      <View style={[styles.fieldIconRow, invalid && styles.fieldIconRowError]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          maxLength={10}
          style={styles.fieldIconRowInput}
          accessibilityLabel={accessibilityLabel ?? label}
          placeholderTextColor={colors.mutedSoft}
          testID={testID}
          {...inputProps}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Abrir seletor de data para o campo ${label}`}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          onPress={openModal}
        >
          <AppIcon name="calendar" size={20} color={invalid ? colors.danger : colors.brand} />
        </Pressable>
      </View>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={closeModal}>
        <Pressable style={styles.backdrop} onPress={closeModal}>
          <Pressable
            style={[styles.modalCard, !wide && styles.modalCardMobile]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderInfo}>
                <Text style={styles.modalTitle}>{title}</Text>
                <Text style={styles.modalSubtitle}>
                  {selectedDate
                    ? longDateFormatter.format(
                        new Date(
                          Date.UTC(
                            selectedDate.getUTCFullYear(),
                            selectedDate.getUTCMonth(),
                            selectedDate.getUTCDate(),
                            12,
                            0,
                            0
                          )
                        )
                      )
                    : "Nenhuma data selecionada"}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fechar seletor de data"
                onPress={closeModal}
                style={styles.closeButton}
              >
                <AppIcon name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>

            <View style={styles.calendarHeader}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Mês anterior"
                onPress={() => goToMonth(-1)}
                style={styles.calendarNav}
              >
                <AppIcon name="back" size={18} color={colors.brand} />
              </Pressable>
              <Text style={styles.calendarTitle}>{monthTitle}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Próximo mês"
                onPress={() => goToMonth(1)}
                style={styles.calendarNav}
              >
                <AppIcon name="forward" size={18} color={colors.brand} />
              </Pressable>
            </View>

            <View style={styles.weekHeader}>
              {WEEKDAY_LABELS.map((weekday) => (
                <Text key={weekday} style={styles.weekLabel}>
                  {weekday}
                </Text>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {cells.map((day, index) => {
                if (day === null) {
                  return (
                    <View
                      key={`empty-${index}`}
                      style={[styles.calendarCell, styles.calendarCellEmpty]}
                    />
                  );
                }
                const cellDate = new Date(Date.UTC(viewYear, viewMonth, day));
                const disabled = isDateDisabled(cellDate, minDate, maxDate);
                const isToday = isSameUtcDay(cellDate, today);
                const isSelected = !!selectedDate && isSameUtcDay(cellDate, selectedDate);
                return (
                  <Pressable
                    key={day}
                    disabled={disabled}
                    accessibilityRole="button"
                    accessibilityState={{ disabled, selected: isSelected }}
                    accessibilityLabel={longDateFormatter.format(cellDate)}
                    onPress={() => selectDay(day)}
                    style={[styles.calendarCell, disabled && styles.calendarCellDisabled]}
                  >
                    <Text
                      style={[
                        styles.calendarDay,
                        isToday && styles.calendarDayToday,
                        isSelected && styles.calendarDaySelected,
                        isToday && isSelected && styles.calendarDayTodaySelectedRing,
                      ]}
                    >
                      {day}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fieldIconRow: {
    minHeight: control.heightMd,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  fieldIconRowError: { borderColor: colors.danger },
  fieldIconRowInput: {
    flex: 1,
    minWidth: 0,
    color: colors.ink,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  backdrop: {
    flex: 1,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
  },
  modalCard: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "92%",
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  modalCardMobile: { padding: spacing.md, borderRadius: radius.md },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  modalHeaderInfo: {
    flex: 1,
    minWidth: 0,
  },
  modalTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  modalSubtitle: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    marginTop: spacing.xs,
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
  calendarHeader: {
    marginTop: spacing.lg,
    paddingBottom: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  calendarNav: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  calendarTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
    textAlign: "center",
    textTransform: "capitalize",
  },
  weekHeader: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  weekLabel: {
    width: "14.285%",
    paddingVertical: spacing.sm,
    color: colors.muted,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    textAlign: "center",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  calendarCell: {
    width: "14.285%",
    minHeight: 58,
    padding: 4,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  calendarCellEmpty: { backgroundColor: colors.surfaceSubtle },
  // Fora de minDate/maxDate: opacidade reduzida na célula inteira, nunca
  // escondida (Nero, seção 1.5; mesmo princípio de `deleteButtonDisabled`).
  calendarCellDisabled: { opacity: opacity.disabled },
  calendarDay: {
    width: 28,
    height: 28,
    paddingTop: 5,
    color: colors.ink,
    fontFamily: typography.family.bold,
    textAlign: "center",
    borderRadius: radius.pill,
    alignSelf: "center",
  },
  // "Hoje": anel de contorno, sem preenchimento — nunca comunicado só por
  // cor (Nero, seção 1.5).
  calendarDayToday: {
    borderWidth: 2,
    borderColor: colors.brand,
    color: colors.brand,
  },
  calendarDaySelected: { color: colors.onBrand, backgroundColor: colors.brand, borderWidth: 0 },
  // Hoje + Selecionado ao mesmo tempo: preenchimento vence, anel claro
  // adicional para manter "hoje" perceptível (Nero, seção 1.4).
  calendarDayTodaySelectedRing: { borderWidth: 1, borderColor: colors.onBrand },
});
