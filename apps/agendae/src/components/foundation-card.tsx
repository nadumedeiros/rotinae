import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, elevation, radius, spacing, typography } from '@/src/theme/tokens';

type FoundationCardProps = PropsWithChildren<{
  eyebrow: string;
  title: string;
}>;

export function FoundationCard({ eyebrow, title, children }: FoundationCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 240,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
    ...elevation.card,
  },
  eyebrow: {
    color: colors.brand,
    fontSize: 12,
    fontFamily: typography.family.semibold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.ink,
    fontSize: 20,
    lineHeight: 25,
    fontFamily: typography.family.bold,
  },
  body: {
    marginTop: spacing.xs,
  },
});
