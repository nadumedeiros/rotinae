import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInputProps,
} from "react-native";

import { AppIcon } from "./app-icon";
import {
  MINUTE_STEP_VALUES,
  buildLoopedHourData,
  formatBrTime,
  initialLoopedHourIndex,
  isNearLoopEdge,
  parseBrTime,
  recenterLoopedHourIndex,
  roundDownToStep,
  roundUpToStep,
} from "./datetime-picker-utils";
import {
  breakpoints,
  colors,
  control,
  elevation,
  radius,
  spacing,
  typography,
} from "@/src/theme/tokens";

// No React Native Web, o backdrop precisa de `position: fixed` para cobrir
// a tela inteira quando o TimePicker está dentro de outro Modal (ex: formVisible).
// `StyleSheet.create` não aceita `position: 'fixed'`, então usamos um objeto inline
// avaliado uma única vez no nível do módulo.
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

const MINUTE_STEP = 5;
const ROW_HEIGHT = control.heightMd; // 48 — mesmo token de fieldInput/currencyField
const VISIBLE_ROWS = 5;
const VIEWPORT_HEIGHT = ROW_HEIGHT * VISIBLE_ROWS; // 240
const COLUMN_WIDTH = 96;
const COLUMN_PADDING = (VIEWPORT_HEIGHT - ROW_HEIGHT) / 2; // 96 — centraliza o primeiro/último valor real

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

type WheelColumnHandle = { increment: () => void; decrement: () => void };

type WheelColumnProps = {
  mode: "loop" | "clamp";
  initialValue: number;
  onChange: (value: number) => void;
  formatLabel: (value: number) => string;
  accessibilityLabel: string;
  incrementLabel: string;
  decrementLabel: string;
};

/**
 * Uma coluna rolável do Seletor de Hora (Dante, seção 6.3/6.5).
 * `mode="loop"`: hora — carrossel infinito (23 seguido de 00, seção 6.5.1).
 * `mode="clamp"`: minuto — trava em 00/45, nunca gira (seção 6.5.1).
 *
 * Implementação: `ScrollView` com `snapToInterval` + padding vertical que
 * centraliza o item de índice 0 quando `contentOffset.y === 0` (mesmo
 * truque padrão de "wheel picker"); a coluna de hora repete o array de 24
 * valores `HOUR_LOOP_REPEAT` vezes e recentraliza silenciosamente
 * (`animated: false`) sempre que o índice se aproxima de uma borda real do
 * array repetido, preservando a ilusão de rolagem infinita sem preservar um
 * array de fato ilimitado.
 */
const WheelColumn = forwardRef<WheelColumnHandle, WheelColumnProps>(function WheelColumn(
  { mode, initialValue, onChange, formatLabel, accessibilityLabel, incrementLabel, decrementLabel },
  ref,
) {
  const data = useMemo(
    () => (mode === "loop" ? buildLoopedHourData() : [...MINUTE_STEP_VALUES]),
    [mode],
  );
  const initialIndex = useMemo(
    () => (mode === "loop" ? initialLoopedHourIndex(initialValue) : Math.max(data.indexOf(initialValue), 0)),
    // Calculado apenas uma vez, no momento em que a coluna é montada (o
    // modal remonta a árvore inteira a cada abertura — ver TimePickerField).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const scrollRef = useRef<ScrollView>(null);

  const scrollToIndex = (index: number, animated: boolean) => {
    // Defensivo: em ambiente de teste (react-test-renderer/jest-expo), o nó
    // nativo do `ScrollView` pode não expor o método imperativo `scrollTo` —
    // a posição inicial já é garantida declarativamente por `contentOffset`.
    scrollRef.current?.scrollTo?.({ y: index * ROW_HEIGHT, animated });
  };

  const commit = (rawIndex: number, animated = true) => {
    const index = Math.min(Math.max(rawIndex, 0), data.length - 1);
    setActiveIndex(index);
    scrollToIndex(index, animated);
    onChange(data[index]);
    if (mode === "loop" && isNearLoopEdge(index)) {
      const recentered = recenterLoopedHourIndex(index);
      requestAnimationFrame(() => {
        setActiveIndex(recentered);
        scrollToIndex(recentered, false);
      });
    }
  };

  useImperativeHandle(ref, () => ({
    increment: () => commit(activeIndexRef.current - 1),
    decrement: () => commit(activeIndexRef.current + 1),
  }));

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const rawIndex = Math.round(event.nativeEvent.contentOffset.y / ROW_HEIGHT);
    const clamped = Math.min(Math.max(rawIndex, 0), data.length - 1);
    setActiveIndex((current) => (current === clamped ? current : clamped));
  };

  const handleScrollSettle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    commit(Math.round(event.nativeEvent.contentOffset.y / ROW_HEIGHT));
  };

  const handleKeyDown = (event: { key: string; preventDefault: () => void }) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      commit(activeIndexRef.current - 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      commit(activeIndexRef.current + 1);
    }
  };
  // Web (Dante, seção 6.8): mesmo elemento em foco (Tab) responde às setas
  // para cima/para baixo com o mesmo efeito de incrementar/decrementar —
  // `react-native-web` repassa props DOM desconhecidas (`tabIndex`,
  // `onKeyDown`) para o elemento nativo subjacente.
  const webKeyProps: Record<string, unknown> =
    Platform.OS === "web" ? { tabIndex: 0, onKeyDown: handleKeyDown } : {};

  return (
    <View
      style={styles.columnViewport}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: formatLabel(data[activeIndex]) }}
      accessibilityActions={[
        { name: "increment", label: incrementLabel },
        { name: "decrement", label: decrementLabel },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") commit(activeIndexRef.current + 1);
        else if (event.nativeEvent.actionName === "decrement") commit(activeIndexRef.current - 1);
      }}
      {...webKeyProps}
    >
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW_HEIGHT}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={handleScroll}
        onMomentumScrollEnd={handleScrollSettle}
        onScrollEndDrag={handleScrollSettle}
        contentOffset={{ x: 0, y: initialIndex * ROW_HEIGHT }}
        contentContainerStyle={styles.columnContent}
      >
        {data.map((itemValue, index) => {
          const distance = Math.abs(index - activeIndex);
          return (
            <Pressable
              key={`${itemValue}-${index}`}
              accessibilityRole="button"
              accessibilityLabel={formatLabel(itemValue)}
              onPress={() => commit(index)}
              style={styles.columnRow}
            >
              <Text
                style={[
                  styles.columnRowText,
                  distance === 1 && styles.columnRowTextNear,
                  distance === 2 && styles.columnRowTextFar,
                  distance >= 3 && styles.columnRowTextEdge,
                  distance === 0 && styles.columnRowTextCenter,
                ]}
              >
                {formatLabel(itemValue)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
});

export type TimePickerFieldProps = Omit<TextInputProps, "value" | "onChangeText"> & {
  /** Valor formatado `HH:MM` — mesmo estado que a digitação manual já escreve. */
  value: string;
  /** Chamado tanto pela digitação manual (texto bruto) quanto pela confirmação no seletor (já formatado). */
  onChangeText: (text: string) => void;
  /** Rótulo do campo, usado no `accessibilityLabel` do ícone-gatilho ("Abrir seletor de horário para o campo {label}"). */
  label: string;
  /** Estado visual de erro (borda vermelha), equivalente a `inputError`/`fieldInputError` já existentes. */
  invalid?: boolean;
  /** Título do modal — padrão "Selecionar horário" (Dante, seção 6.2), sobrescrevível por tela. */
  title?: string;
};

export function TimePickerField({
  value,
  onChangeText,
  label,
  invalid,
  title = "Selecionar horário",
  accessibilityLabel,
  testID,
  ...inputProps
}: TimePickerFieldProps) {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const [visible, setVisible] = useState(false);
  const [pendingHour, setPendingHour] = useState(0);
  const [pendingMinute, setPendingMinute] = useState(0);
  const hourRef = useRef<WheelColumnHandle>(null);
  const minuteRef = useRef<WheelColumnHandle>(null);

  const openModal = () => {
    Keyboard.dismiss();
    const parsed = parseBrTime(value);
    const base = parsed
      ? roundDownToStep(parsed.hour, parsed.minute, MINUTE_STEP)
      : (() => {
          const now = new Date();
          return roundUpToStep(now.getHours(), now.getMinutes(), MINUTE_STEP);
        })();
    setPendingHour(base.hour);
    setPendingMinute(base.minute);
    setVisible(true);
  };

  const closeModal = () => setVisible(false);

  const confirm = () => {
    onChangeText(formatBrTime(pendingHour, pendingMinute));
    closeModal();
  };

  return (
    <>
      <View style={[styles.fieldIconRow, invalid && styles.fieldIconRowError]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          accessibilityLabel={accessibilityLabel ?? label}
          placeholderTextColor={colors.mutedSoft}
          style={styles.fieldIconRowInput}
          testID={testID}
          {...inputProps}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Abrir seletor de horário para o campo ${label}`}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          onPress={openModal}
        >
          <AppIcon name="schedule" size={20} color={colors.brand} />
        </Pressable>
      </View>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={closeModal} statusBarTranslucent>
        <Pressable
          style={WEB_BACKDROP_STYLE ?? styles.backdrop}
          onPress={closeModal}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View accessibilityViewIsModal style={[styles.modalCard, !wide && styles.modalCardMobile]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{title}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fechar seletor de horário"
                  onPress={closeModal}
                  style={styles.closeButton}
                >
                  <AppIcon name="error" size={20} color={colors.muted} />
                </Pressable>
              </View>

              {visible && (
                <PickerBody
                  pendingHour={pendingHour}
                  pendingMinute={pendingMinute}
                  setPendingHour={setPendingHour}
                  setPendingMinute={setPendingMinute}
                  hourRef={hourRef}
                  minuteRef={minuteRef}
                />
              )}

              <View style={styles.confirmActions}>
                <Pressable onPress={closeModal} style={styles.cancelButton}>
                  <Text style={styles.cancelButtonText}>Cancelar</Text>
                </Pressable>
                <Pressable onPress={confirm} style={styles.saveButton}>
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

type PickerBodyProps = {
  pendingHour: number;
  pendingMinute: number;
  setPendingHour: (value: number) => void;
  setPendingMinute: (value: number) => void;
  hourRef: React.RefObject<WheelColumnHandle | null>;
  minuteRef: React.RefObject<WheelColumnHandle | null>;
};

/**
 * Corpo do seletor (colunas + faixa de destaque + setas), isolado num
 * componente próprio só para poder ser condicionalmente montado/desmontado
 * a cada abertura do modal (`{visible && <PickerBody .../>}`) — garante que
 * cada coluna recalcule seu índice inicial a partir do valor vigente do
 * campo, sem herdar posição de rolagem de uma abertura anterior.
 */
function PickerBody({ pendingHour, pendingMinute, setPendingHour, setPendingMinute, hourRef, minuteRef }: PickerBodyProps): ReactNode {
  return (
    <View style={styles.pickerBody}>
      <View style={styles.arrowsRow}>
        <View style={styles.columnArrowSlot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Aumentar hora"
            onPress={() => hourRef.current?.increment()}
            style={styles.columnArrow}
          >
            <AppIcon name="chevronUp" size={18} color={colors.brand} />
          </Pressable>
        </View>
        <View style={styles.separatorSlot} />
        <View style={styles.columnArrowSlot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Aumentar minuto"
            onPress={() => minuteRef.current?.increment()}
            style={styles.columnArrow}
          >
            <AppIcon name="chevronUp" size={18} color={colors.brand} />
          </Pressable>
        </View>
      </View>

      <View style={styles.columnsRow}>
        <View pointerEvents="none" style={styles.timeColumnHighlight} />
        <WheelColumn
          ref={hourRef}
          mode="loop"
          initialValue={pendingHour}
          onChange={setPendingHour}
          formatLabel={pad2}
          accessibilityLabel="Horas"
          incrementLabel="Aumentar hora"
          decrementLabel="Diminuir hora"
        />
        <Text style={styles.timeSeparator}>:</Text>
        <WheelColumn
          ref={minuteRef}
          mode="clamp"
          initialValue={pendingMinute}
          onChange={setPendingMinute}
          formatLabel={pad2}
          accessibilityLabel="Minutos"
          incrementLabel="Aumentar minuto"
          decrementLabel="Diminuir minuto"
        />
      </View>

      <View style={styles.arrowsRow}>
        <View style={styles.columnArrowSlot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Diminuir hora"
            onPress={() => hourRef.current?.decrement()}
            style={styles.columnArrow}
          >
            <AppIcon name="chevronDown" size={18} color={colors.brand} />
          </Pressable>
        </View>
        <View style={styles.separatorSlot} />
        <View style={styles.columnArrowSlot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Diminuir minuto"
            onPress={() => minuteRef.current?.decrement()}
            style={styles.columnArrow}
          >
            <AppIcon name="chevronDown" size={18} color={colors.brand} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldIconRow: {
    width: "100%",
    minWidth: 0,
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
    maxWidth: 420,
    padding: spacing.lg,
    alignItems: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  modalCardMobile: { padding: spacing.md, borderRadius: radius.md },
  modalHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  modalTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  pickerBody: { marginTop: spacing.lg, alignItems: "center" },
  arrowsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md },
  columnArrowSlot: { width: COLUMN_WIDTH, alignItems: "center" },
  separatorSlot: { width: 24 },
  columnArrow: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  columnsRow: {
    marginVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    position: "relative",
  },
  timeColumnHighlight: {
    position: "absolute",
    top: COLUMN_PADDING,
    left: 0,
    right: 0,
    height: ROW_HEIGHT,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  columnViewport: { width: COLUMN_WIDTH, height: VIEWPORT_HEIGHT, overflow: "hidden" },
  columnContent: { paddingVertical: COLUMN_PADDING },
  columnRow: { height: ROW_HEIGHT, alignItems: "center", justifyContent: "center" },
  columnRowText: {
    fontSize: typography.size.title,
    fontFamily: typography.family.regular,
    color: colors.mutedSoft,
    opacity: 0.5,
  },
  columnRowTextFar: { fontFamily: typography.family.medium, color: colors.muted, opacity: 0.65 },
  columnRowTextNear: { fontFamily: typography.family.semibold, color: colors.ink, opacity: 0.8 },
  columnRowTextCenter: { fontFamily: typography.family.bold, color: colors.brandDark, opacity: 1 },
  columnRowTextEdge: { fontFamily: typography.family.regular, color: colors.mutedSoft, opacity: 0.5 },
  timeSeparator: {
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
    color: colors.ink,
  },
  confirmActions: {
    marginTop: spacing.lg,
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
  },
  cancelButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  cancelButtonText: { color: colors.muted, fontFamily: typography.family.semibold },
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
  saveButtonText: { color: colors.onBrand, fontFamily: typography.family.bold },
});
