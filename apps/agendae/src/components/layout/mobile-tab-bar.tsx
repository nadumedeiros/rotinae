import { router, usePathname } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { breakpoints, colors, radius, spacing, typography } from '@/src/theme/tokens';
import { AppIcon, type AppIconName } from '@/src/components/ui/app-icon';
import { UniversalCreateMenu } from '@/src/components/layout/universal-create-menu';

const tabs: { label: string; icon: AppIconName; route?: '/dashboard' | '/agenda' | '/clients' | '/payments'; match?: string; primary?: boolean }[] = [
  { label: 'Início', icon: 'home', route: '/dashboard', match: '/dashboard' },
  { label: 'Agenda', icon: 'calendar', route: '/agenda', match: '/agenda' },
  { label: 'Novo', icon: 'add', primary: true },
  { label: 'Clientes', icon: 'clients', route: '/clients', match: '/clients' },
  { label: 'Financeiro', icon: 'financial', route: '/payments', match: '/payments' },
];

export function MobileTabBar() {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const { bottom: bottomInset } = useSafeAreaInsets();
  // No app nativo a barra fica sempre disponível (celular ou tablet); só a
  // web troca para o header largo a partir do breakpoint de tablet.
  if (Platform.OS === 'web' && width >= breakpoints.tablet) return null;

  return (
    <View accessibilityRole="tablist" style={[styles.bar, { marginTop: -bottomInset }]} testID="mobile-tab-bar">
      {tabs.map((item) => {
        if (item.primary) return <UniversalCreateMenu key={item.label} />;
        const active = pathname === item.match || (item.match !== '/dashboard' && pathname.startsWith(item.match ?? ''));
        return (
          <Pressable key={item.label} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={item.label} onPress={() => item.route && router.replace(item.route as never)} style={styles.action}>
            <View style={[styles.icon, active && styles.iconActive]}><AppIcon name={item.icon} size={20} color={active ? colors.brand : colors.mutedSoft} /></View>
            <Text numberOfLines={1} style={[styles.label, active && styles.labelActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { minHeight: 72, paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xs, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-around', borderTopWidth: 0, backgroundColor: colors.surfaceStrong, opacity: 1, shadowColor: 'transparent', shadowOpacity: 0, elevation: 0, zIndex: 10 },
  action: { flex: 1, minWidth: 0, alignItems: 'center', gap: spacing.xs },
  icon: { width: 34, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  iconActive: { backgroundColor: 'transparent' },
  label: { color: colors.mutedSoft, fontFamily: typography.family.medium, fontSize: 10 },
  labelActive: { color: colors.brand, fontFamily: typography.family.bold },
});
