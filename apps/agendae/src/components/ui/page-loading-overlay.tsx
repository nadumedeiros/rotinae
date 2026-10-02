import { StyleSheet, View } from "react-native";

import { TableLoadingState } from "@/src/components/ui/table-loading-state";
import { colors, layout, radius, spacing } from "@/src/theme/tokens";

type PageLoadingOverlayProps = {
  coverHeader?: boolean;
};

export function PageLoadingOverlay({ coverHeader = false }: PageLoadingOverlayProps) {
  return (
    <View
      accessibilityLabel="Carregando página"
      accessibilityLiveRegion="polite"
      style={[styles.overlay, coverHeader && styles.overlayWithHeader]}
    >
      {coverHeader && (
        <View style={styles.headerPlaceholder}>
          <View style={styles.headerLogo} />
          <View style={styles.headerActions}>
            <View style={styles.headerAction} />
            <View style={styles.headerAction} />
          </View>
        </View>
      )}
      <View style={styles.content}>
        <View style={styles.heading} />
        <View style={styles.cards}>
          {[0, 1, 2].map((item) => <View key={item} style={styles.card} />)}
        </View>
        <View style={styles.panel}>
          <View style={styles.panelHeading} />
          <TableLoadingState rows={4} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 72,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    backgroundColor: colors.canvas,
  },
  overlayWithHeader: { top: 0 },
  headerPlaceholder: {
    height: 72,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerLogo: {
    width: 124,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  headerActions: { flexDirection: "row", gap: spacing.sm },
  headerAction: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  content: {
    width: "100%",
    maxWidth: layout.contentMax,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  heading: {
    width: 240,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  card: {
    minWidth: 220,
    height: 116,
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  panel: {
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  panelHeading: {
    width: 180,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
});
