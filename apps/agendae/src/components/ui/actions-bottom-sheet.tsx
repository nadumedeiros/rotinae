import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon, type AppIconName } from "@/src/components/ui/app-icon";
import { colors, radius, spacing, typography } from "@/src/theme/tokens";

export type ActionsBottomSheetItem = {
  key: string;
  label: string;
  icon: AppIconName;
  iconBackgroundColor?: string;
  iconColor?: string;
  labelColor?: string;
  onPress: () => void;
  disabled?: boolean;
};

/**
 * Bottom-sheet de ações rápidas ("três pontinhos"), no mesmo padrão de
 * interação já usado em `app/clients.tsx` (ação "Editar cadastro") e
 * `app/agenda.tsx` (ações "Marcar como concluído"/"Cancelar agendamento").
 *
 * Componente genérico para não duplicar a estrutura visual (backdrop, sheet,
 * handle, linha de ação, botão fechar) em cada novo menu de contexto.
 */
export function ActionsBottomSheet({
  visible,
  title,
  onClose,
  items,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  items: ActionsBottomSheetItem[];
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          {!!title && (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          )}
          {items.map((item) => (
            <Pressable
              key={item.key}
              disabled={item.disabled}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ disabled: item.disabled }}
              style={[styles.row, item.disabled && styles.rowDisabled]}
              onPress={item.onPress}
            >
              <View
                style={[
                  styles.icon,
                  { backgroundColor: item.iconBackgroundColor ?? colors.brandSoft },
                ]}
              >
                <AppIcon name={item.icon} size={18} color={item.iconColor ?? colors.brand} />
              </View>
              <Text style={[styles.label, item.labelColor ? { color: item.labelColor } : null]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
          <Pressable style={[styles.row, styles.closeRow]} onPress={onClose}>
            <Text style={styles.closeLabel}>Fechar</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  rowDisabled: { opacity: 0.5 },
  icon: {
    width: 40,
    height: 40,
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
  closeRow: {
    marginTop: spacing.sm,
    justifyContent: "center",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  closeLabel: {
    flex: 1,
    textAlign: "center",
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    color: colors.muted,
  },
});
