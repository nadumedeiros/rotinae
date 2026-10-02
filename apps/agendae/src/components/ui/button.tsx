import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { AppIcon, type AppIconName } from './app-icon';
import { colors, control, opacity, radius, spacing, typography } from '@/src/theme/tokens';

// Duração mínima em que o estado de loading permanece visível, mesmo que a
// promise resolva mais rápido — evita "flicker" de spinner que aparece e some
// quase instantaneamente, o que reforça a sensação de "clique não registrado".
const MIN_LOADING_VISIBLE_MS = 150;

type Props = PropsWithChildren<{
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: AppIconName;
  disabled?: boolean;
  loading?: boolean;
}>;

export function Button({ children, onPress, variant = 'primary', icon, disabled, loading = false }: Props) {
  const [hovered, setHovered] = useState(false);
  const [visibleLoading, setVisibleLoading] = useState(loading);
  const loadingStartedAt = useRef<number | null>(loading ? Date.now() : null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loading) {
      loadingStartedAt.current = Date.now();
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
      setVisibleLoading(true);
      return;
    }
    const startedAt = loadingStartedAt.current;
    if (startedAt === null) { setVisibleLoading(false); return; }
    const elapsed = Date.now() - startedAt;
    const remaining = MIN_LOADING_VISIBLE_MS - elapsed;
    if (remaining <= 0) {
      loadingStartedAt.current = null;
      setVisibleLoading(false);
    } else {
      hideTimer.current = setTimeout(() => {
        loadingStartedAt.current = null;
        setVisibleLoading(false);
      }, remaining);
    }
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [loading]);

  const foreground = variant === 'primary' || variant === 'danger' ? colors.onBrand : colors.brand;
  const isDisabled = Boolean(disabled) || visibleLoading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: visibleLoading }}
      disabled={isDisabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        hovered && !isDisabled && styles.hovered,
        hovered && !isDisabled && hoveredStyleByVariant[variant],
        pressed && !visibleLoading && styles.pressed,
        disabled && !visibleLoading && styles.disabled,
      ]}
    >
      <View style={styles.content}>
        <Text style={[styles.label, { color: foreground }]}>{children}</Text>
        {visibleLoading ? (
          <ActivityIndicator size="small" color={foreground} />
        ) : (
          icon && <AppIcon name={icon} size={20} color={foreground} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: control.heightMd, paddingHorizontal: spacing.lg, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  primary: { backgroundColor: colors.brand, borderColor: colors.brand },
  secondary: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
  primaryHovered: { backgroundColor: colors.brandMid, borderColor: colors.brandMid },
  secondaryHovered: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  ghostHovered: { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
  hovered: { transform: [{ translateY: -2 }] },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  label: { fontFamily: typography.family.bold, fontSize: typography.size.bodyLarge },
  pressed: { opacity: opacity.pressed }, disabled: { opacity: control.disabledOpacity },
});

// Mapa explícito variante -> estilo de hover: evita indexação genérica de
// `styles` (que faz o TS inferir a união de TODOS os valores do StyleSheet,
// incluindo estilos de texto incompatíveis com `ViewStyle`). `danger` não tem
// hover dedicado (spec do Nero), por isso fica de fora do mapa.
const hoveredStyleByVariant: Partial<Record<NonNullable<Props['variant']>, ViewStyle>> = {
  primary: styles.primaryHovered,
  secondary: styles.secondaryHovered,
  ghost: styles.ghostHovered,
};
