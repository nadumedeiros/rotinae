import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, Animated, Easing, ImageBackground, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon, type AppIconName } from '@/src/components/ui/app-icon';
import { breakpoints, colors, elevation, layout, radius, spacing, typography } from '@/src/theme/tokens';

type Props = PropsWithChildren<{ eyebrow: string; mobileEyebrow?: string; title: string; description: string }>;

function FloatingGlassIcon({ name, position, large = false, delay = 0 }: { name: AppIconName; position: object; large?: boolean; delay?: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) { progress.setValue(0); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(progress, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduceMotion]);

  const motion = { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.68, 1] }), transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }, { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] };
  return <View style={[styles.floatingSlot, position]}><Animated.View style={[styles.glassIcon, large && styles.glassIconLarge, motion]}><AppIcon name={name} size={large ? 48 : 40} color="rgba(255,255,255,0.78)" /></Animated.View></View>;
}

export function AuthLayout({ eyebrow, mobileEyebrow, title, description, children }: Props) {
  const { width } = useWindowDimensions();
  // Tablet usa o mesmo layout empilhado do celular; só desktop de verdade
  // ganha a coluna dupla com a imagem ao lado.
  const wide = width >= breakpoints.desktop;
  const showFloatingIcons = width >= breakpoints.desktop;
  const floatingIcons: { name: AppIconName; position: object }[] = [
    { name: 'calendar', position: styles.floatTop },
    { name: 'user', position: styles.floatMiddle },
    { name: 'schedule', position: styles.floatBottom },
  ];
  const backgroundSource = require('@/assets/images/auth-purple-bg.webp');
  const compactEyebrow = mobileEyebrow ?? (eyebrow === 'Bem-vindo ao Rotinaê' ? 'Bem-vindo' : eyebrow);
  const introContent = <><View pointerEvents="none" style={[styles.purpleOverlay, !wide && styles.purpleOverlayMobile]} />{showFloatingIcons && <View pointerEvents="none" style={styles.floatingLayer}>{floatingIcons.map(({ name, position }, index) => <FloatingGlassIcon key={name} name={name} position={position} large={index === 1} delay={index * 320} />)}</View>}<Text style={styles.logo}>rotina<Text style={styles.logoAccent}>ê</Text></Text><View style={[styles.copy, !wide && styles.copyMobile]}><Text style={styles.eyebrow}>{compactEyebrow}</Text><Text accessibilityRole="header" style={[styles.title, wide && styles.titleWide, !wide && styles.titleMobile]}>{title}</Text><Text style={[styles.description, !wide && styles.descriptionMobile]}>{description}</Text></View><Text style={[styles.support, !wide && styles.supportMobile]}>Sua rotina de atendimentos em um só lugar.</Text></>;
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"><View style={[styles.page, wide && styles.pageWide]}>{wide ? <ImageBackground source={backgroundSource} resizeMode="cover" style={[styles.intro, styles.introWide]} imageStyle={styles.introImage}>{introContent}</ImageBackground> : <View style={[styles.intro, styles.introMobile]}>{introContent}</View>}<View style={[styles.card, wide && styles.cardWide]}><View style={[styles.cardContent, wide && styles.cardContentWide]}>{children}</View></View></View></ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.brandDark }, scroll: { flexGrow: 1, backgroundColor: colors.canvas }, page: { flex: 1, width: '100%', maxWidth: layout.contentMax, alignSelf: 'center' }, pageWide: { minHeight: 720, maxWidth: '100%', alignSelf: 'stretch', flexDirection: 'row' },
  intro: { minHeight: 520, padding: spacing.lg, justifyContent: 'space-between', gap: spacing.xl, overflow: 'hidden', backgroundColor: colors.brandDark }, introMobile: { minHeight: 260, gap: spacing.md }, introWide: { flexGrow: 0, flexShrink: 0, flexBasis: '56%', padding: spacing.xxl },
  introImage: { backgroundColor: colors.brandDark }, purpleOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(33,7,92,0.48)' }, purpleOverlayMobile: { display: 'none' },
  floatingLayer: { ...StyleSheet.absoluteFillObject },
  floatingSlot: { position: 'absolute' }, glassIcon: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.10)' }, glassIconLarge: { width: 112, height: 112 },
  floatTop: { top: '10%', right: '9%', transform: [{ rotate: '-8deg' }] }, floatMiddle: { top: '43%', right: '5%', transform: [{ rotate: '7deg' }] }, floatBottom: { right: '22%', bottom: '9%', transform: [{ rotate: '-5deg' }] },
  logo: { zIndex: 1, color: colors.onBrand, fontSize: 30, fontFamily: typography.family.bold, letterSpacing: -1 }, logoAccent: { color: colors.accent }, copy: { zIndex: 1, gap: spacing.md, maxWidth: 560 }, copyMobile: { width: '100%', gap: spacing.sm },
  eyebrow: { color: colors.accentSoft, fontFamily: typography.family.semibold, fontSize: typography.size.caption, textTransform: 'uppercase', letterSpacing: 1.3 }, title: { color: colors.onBrand, fontFamily: typography.family.bold, fontSize: 36, lineHeight: 39, letterSpacing: -1.2 }, titleWide: { fontSize: 52, lineHeight: 54 }, titleMobile: { fontSize: 32, lineHeight: 34 },
  description: { color: colors.accentSoft, fontFamily: typography.family.regular, fontSize: typography.size.bodyLarge, lineHeight: typography.lineHeight.bodyLarge }, descriptionMobile: { display: 'none' }, support: { zIndex: 1, color: colors.accentSoft, fontFamily: typography.family.medium }, supportMobile: { display: 'flex' },
  card: { flex: 1, padding: spacing.lg, backgroundColor: colors.surface }, cardWide: { minWidth: 0, paddingHorizontal: spacing.xxl, paddingVertical: spacing.xl, justifyContent: 'center' },
  cardContent: { width: '100%', gap: spacing.lg }, cardContentWide: { maxWidth: 440, alignSelf: 'center', padding: spacing.xl, borderRadius: radius.lg, ...elevation.floating },
});
