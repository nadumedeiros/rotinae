import { StyleSheet, Text, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/ui/app-icon';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

type Tone = 'success' | 'warning' | 'error' | 'info';

const tones: Record<Tone, { icon: AppIconName; color: string; background: string }> = {
  success: { icon: 'success', color: colors.success, background: colors.successSoft },
  warning: { icon: 'warning', color: colors.warning, background: colors.warningSoft },
  error: { icon: 'error', color: colors.danger, background: colors.dangerSoft },
  info: { icon: 'email', color: colors.brand, background: colors.brandSoft },
};

export function AuthFeedback({ tone, title, description }: { tone: Tone; title: string; description: string }) {
  const visual = tones[tone];
  return <View style={styles.container}><View style={[styles.icon, { backgroundColor: visual.background }]}><AppIcon name={visual.icon} size={40} color={visual.color} /></View><View style={styles.copy}><Text accessibilityRole="header" style={styles.title}>{title}</Text><Text style={styles.description}>{description}</Text></View></View>;
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: spacing.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  icon: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  copy: { gap: spacing.sm }, title: { color: colors.ink, textAlign: 'center', fontFamily: typography.family.bold, fontSize: typography.size.title, lineHeight: typography.lineHeight.title },
  description: { color: colors.muted, textAlign: 'center', fontFamily: typography.family.regular, fontSize: typography.size.bodyLarge, lineHeight: typography.lineHeight.bodyLarge },
});
