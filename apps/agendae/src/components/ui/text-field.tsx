import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { AppIcon, type AppIconName } from './app-icon';
import { colors, control, radius, spacing, typography } from '@/src/theme/tokens';

type Props = TextInputProps & { label: string; icon: AppIconName; error?: string; invalid?: boolean };

export function TextField({ label, icon, error, invalid, ...inputProps }: Props) {
  const hasError = !!error || !!invalid;
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><View style={[styles.control, hasError && styles.controlError]}><AppIcon name={icon} size={20} color={hasError ? colors.danger : colors.muted} /><TextInput accessibilityLabel={label} placeholderTextColor={colors.mutedSoft} style={styles.input} {...inputProps} /></View>{error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}</View>;
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm }, label: { color: colors.ink, fontFamily: typography.family.semibold, fontSize: typography.size.body },
  control: { minHeight: control.heightMd, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  controlError: { borderColor: colors.danger }, input: { flex: 1, minWidth: 0, color: colors.ink, fontFamily: typography.family.regular, fontSize: typography.size.bodyLarge, outlineStyle: 'none' } as never,
  error: { color: colors.danger, fontFamily: typography.family.medium, fontSize: typography.size.caption },
});
