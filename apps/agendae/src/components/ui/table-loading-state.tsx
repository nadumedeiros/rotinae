import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "@/src/theme/tokens";

type Props = {
  rows?: number;
  compact?: boolean;
};

export function TableLoadingState({ rows = 4, compact = false }: Props) {
  const opacity = useRef(new Animated.Value(0.42)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.9,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.42,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <View
      accessibilityLabel="Carregando resultados"
      accessibilityLiveRegion="polite"
      style={styles.container}
    >
      {Array.from({ length: rows }, (_, index) => (
        <Animated.View
          key={index}
          style={[
            styles.row,
            compact && styles.rowCompact,
            { opacity },
          ]}
        >
          <View style={styles.time} />
          <View style={styles.copy}>
            <View style={styles.title} />
            <View style={styles.subtitle} />
          </View>
          <View style={styles.status} />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", gap: spacing.sm },
  row: {
    minHeight: 76,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  rowCompact: {
    minHeight: 116,
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  time: {
    width: 72,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  copy: { flex: 1, minWidth: 150, gap: spacing.sm },
  title: {
    width: "62%",
    height: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  subtitle: {
    width: "42%",
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  status: {
    width: 88,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
});
