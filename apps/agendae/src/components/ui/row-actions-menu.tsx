import { useState } from "react";
import type { GestureResponderEvent } from "react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/src/components/ui/app-icon";
import type { ActionsBottomSheetItem } from "@/src/components/ui/actions-bottom-sheet";
import { colors, elevation, radius, spacing, typography } from "@/src/theme/tokens";

const PANEL_WIDTH = 260;

type RowActionsMenuPosition = { top: number; left: number };

/**
 * Estado do menu de ações do desktop ("três pontinhos" nas tabelas): mesmo
 * padrão visual/interação do menu de perfil e notificações do cabeçalho
 * (`authenticated-header.tsx`) — painel flutuante ancorado no ponto do
 * clique, fechado ao clicar fora. Nunca usado pelo mobile, que mantém seu
 * próprio bottom-sheet (`ActionsBottomSheet`/sheets inline) sem alteração.
 */
export function useRowActionsMenu<T>() {
  const [state, setState] = useState<{ item: T; position: RowActionsMenuPosition } | null>(null);

  function open(item: T, event: GestureResponderEvent) {
    const { pageX, pageY } = event.nativeEvent;
    setState({ item, position: { top: pageY + spacing.sm, left: pageX } });
  }

  function close() {
    setState(null);
  }

  return { item: state?.item ?? null, position: state?.position ?? null, open, close };
}

export function RowActionsMenu({
  position,
  onRequestClose,
  items,
}: {
  position: RowActionsMenuPosition | null;
  onRequestClose: () => void;
  items: ActionsBottomSheetItem[];
}) {
  if (!position) return null;
  // Nasce para a esquerda do clique — a coluna de ações é sempre a última à
  // direita da tabela, então abrir para a direita empurraria o painel para
  // fora da tela.
  const left = Math.max(spacing.sm, position.left - PANEL_WIDTH);

  return (
    <>
      <Pressable
        accessibilityLabel="Fechar menu de ações"
        onPress={onRequestClose}
        style={styles.backdrop}
      />
      <View style={[styles.panel, { top: position.top, left }]}>
        {items.map((item) => (
          <Pressable
            key={item.key}
            disabled={item.disabled}
            accessibilityRole="menuitem"
            accessibilityLabel={item.label}
            accessibilityState={{ disabled: item.disabled }}
            style={[styles.row, item.disabled && styles.rowDisabled]}
            onPress={() => {
              item.onPress();
              onRequestClose();
            }}
          >
            <View
              style={[
                styles.icon,
                { backgroundColor: item.iconBackgroundColor ?? colors.brandSoft },
              ]}
            >
              <AppIcon name={item.icon} size={16} color={item.iconColor ?? colors.brand} />
            </View>
            <Text style={[styles.label, item.labelColor ? { color: item.labelColor } : null]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "fixed",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 10,
    backgroundColor: "transparent",
  } as never,
  panel: {
    position: "fixed",
    width: PANEL_WIDTH,
    zIndex: 11,
    padding: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.floating,
  } as never,
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  rowDisabled: { opacity: 0.5 },
  icon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    flex: 1,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    color: colors.ink,
  },
});
