import { router, usePathname } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/ui/app-icon';
import { breakpoints, colors, elevation, radius, spacing, typography } from '@/src/theme/tokens';

const tabs: { label: string; icon: AppIconName; route: '/client-home' | '/client-providers' | '/client-booking' }[] = [
  { label: 'Início', icon: 'home', route: '/client-home' },
  { label: 'Prestadores', icon: 'provider', route: '/client-providers' },
  { label: 'Agendar', icon: 'calendar', route: '/client-booking' },
];

export function ClientMobileTabBar() {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  // No app nativo a barra fica sempre disponível (celular ou tablet); só a
  // web troca para o header largo a partir do breakpoint de tablet.
  if (Platform.OS === 'web' && width >= breakpoints.tablet) return null;

  return <View accessibilityRole="tablist" style={styles.bar}>{tabs.map((item) => {
    const active = pathname === item.route;
    return <Pressable key={item.route} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => router.replace(item.route as never)} style={styles.action}>
      <View style={[styles.icon, active && styles.iconActive]}><AppIcon name={item.icon} size={20} color={active ? colors.brand : colors.mutedSoft} /></View>
      <Text style={[styles.label, active && styles.labelActive]}>{item.label}</Text>
    </Pressable>;
  })}</View>;
}

const styles = StyleSheet.create({
  bar: { minHeight: 72, paddingTop: spacing.sm, paddingBottom: spacing.xs, paddingHorizontal: spacing.md, flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, ...elevation.floating },
  action: { flex: 1, alignItems: 'center', gap: spacing.xs },
  icon: { width: 42, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  iconActive: { backgroundColor: colors.brandSoft },
  label: { color: colors.mutedSoft, fontFamily: typography.family.medium, fontSize: 10 },
  labelActive: { color: colors.brand, fontFamily: typography.family.bold },
});
