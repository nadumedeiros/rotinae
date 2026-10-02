import { router } from "expo-router";
import Head from "expo-router/head";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Platform,
  Pressable as NativePressable,
  type PressableProps,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "@/src/components/ui/app-icon";
import { navigateFromLanding } from "@/src/infra/navigation/landing-navigation";
import {
  breakpoints,
  colors,
  elevation,
  layout,
  radius,
  spacing,
  typography,
} from "@/src/theme/tokens";

const highlights = [
  {
    icon: "calendar" as const,
    title: "Agenda sem atrito",
    text: "Disponibilidades, confirmações e mudanças em um fluxo que todo mundo entende.",
  },
  {
    icon: "clients" as const,
    title: "Clientes no contexto",
    text: "Vínculos, histórico e próximos atendimentos no mesmo lugar, sem planilhas soltas.",
  },
  {
    icon: "analytics" as const,
    title: "Decisões mais leves",
    text: "Visão clara da rotina e dos limites do seu plano antes de cada ação.",
  },
];

const steps = [
  {
    number: "01",
    title: "Crie seu espaço",
    text: "Escolha Cliente ou Prestador e configure o seu jeito de trabalhar.",
  },
  {
    number: "02",
    title: "Organize a rotina",
    text: "Publique horários, conecte pessoas e deixe as solicitações chegarem até você.",
  },
  {
    number: "03",
    title: "Atenda melhor",
    text: "Confirme, acompanhe e mantenha tudo registrado sem perder o ritmo.",
  },
];

// Used only by the static StyleSheet definitions below; runtime layout uses the `wide` value in the component.
const wide = false;

// react-native-web repassa propriedades de CSS não tipadas pelo RN (backdropFilter
// não existe em ViewStyle); o cast isola esse escape hatch num único lugar.
const glassBlurStyle =
  Platform.OS === "web"
    ? ({ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" } as unknown as import("react-native").ViewStyle)
    : null;

// Mesmo escape hatch acima: transitionProperty/Duration não existem em
// ViewStyle, mas o react-native-web repassa direto pro CSS. Sem isso o hover
// troca de opacidade/posição instantaneamente (sem transição), o que lê como
// um efeito "duro".
const webTransitionStyle =
  Platform.OS === "web"
    ? ({
        transitionProperty: "opacity, transform",
        transitionDuration: "200ms",
        transitionTimingFunction: "ease-out",
      } as unknown as import("react-native").ViewStyle)
    : null;

function Pressable({ style, onHoverIn, onHoverOut, ...props }: PressableProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <NativePressable
      {...props}
      onHoverIn={(event) => {
        if (Platform.OS === "web") setHovered(true);
        onHoverIn?.(event);
      }}
      onHoverOut={(event) => {
        setHovered(false);
        onHoverOut?.(event);
      }}
      style={(state) => [
        typeof style === "function" ? style(state) : style,
        webTransitionStyle,
        Platform.OS === "web" && hovered && !state.pressed && styles.webHover,
      ]}
    />
  );
}

export default function LandingScreen() {
  const { width, height } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const mobileCardWidth = Math.max(248, Math.min(300, width - spacing.xl * 2));
  const featureSnap = mobileCardWidth + spacing.md;
  const mobilePlanWidth = Math.max(280, Math.min(420, width - spacing.lg * 2));
  const planSnap = mobilePlanWidth + spacing.md;
  const scrollY = useRef(new Animated.Value(0)).current;
  const heroFloat = useRef(new Animated.Value(0)).current;
  const orbitFloat = useRef(new Animated.Value(0)).current;
  const orbitProgress = orbitFloat;
  const webBootPulse = useRef(new Animated.Value(0)).current;
  const webBootProgress = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const plansScrollRef = useRef<ScrollView>(null);
  const sectionPositions = useRef<Record<string, number>>({});
  const [sectionY, setSectionY] = useState<Record<string, number>>({});
  // Sem medida ainda = sem teto (Infinity), pra não grudar tudo em 0 antes do
  // primeiro layout do ScrollView.
  const [contentHeight, setContentHeight] = useState(Number.POSITIVE_INFINITY);
  const [showTop, setShowTop] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [featureSlide, setFeatureSlide] = useState(0);
  const [planSlide, setPlanSlide] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // No app nativo esta rota é só a landing de marketing (web); Android/iOS
  // não devem ficar presos numa página de "baixe o app" dentro do próprio
  // app — seguem direto pro login assim que a checagem de sessão terminar.
  const [nativeBootDone, setNativeBootDone] = useState(Platform.OS === "web");
  // Pintar direto sem esperar fonte/hidratação (como uma tentativa anterior
  // fez) expõe o layout "destorcido" por um instante: ícones flutuantes
  // fora do lugar, texto no fallback do sistema até a Urbanist trocar,
  // medidas de `useWindowDimensions` ainda não assentadas. O boot overlay
  // evita esse flash — mantendo o gate original na Web.
  const [webVisualReady, setWebVisualReady] = useState(Platform.OS !== "web");

  async function downloadAndroidApp() {
    try {
      const response = await fetch(`/app-version.json?t=${Date.now()}`, {
        headers: { Accept: "application/json" },
      });
      const manifest = (await response.json()) as { apkUrl?: unknown };
      if (!response.ok || typeof manifest.apkUrl !== "string") {
        throw new Error("APK_URL_MISSING");
      }
      await Linking.openURL(manifest.apkUrl);
    } catch {
      await Linking.openURL("https://github.com/matheusrmesquita/rotinae/releases/latest");
    }
  }

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    let active = true;
    const fallback = setTimeout(() => {
      if (active) setWebVisualReady(true);
    }, 1800);
    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    void fontsReady.then(() => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!active) return;
          clearTimeout(fallback);
          setWebVisualReady(true);
        }),
      );
    });
    return () => {
      active = false;
      clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || webVisualReady) return;
    const animation = Animated.parallel([
      Animated.loop(
        Animated.sequence([
          Animated.timing(webBootPulse, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(webBootPulse, {
            toValue: 0,
            duration: 900,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(webBootProgress, {
            toValue: 1,
            duration: 1100,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(140),
          Animated.timing(webBootProgress, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ),
    ]);
    animation.start();
    return () => animation.stop();
  }, [webBootProgress, webBootPulse, webVisualReady]);

  useEffect(() => {
    let active = true;
    // Auth is not required to paint the public landing. Loading the adapter
    // lazily avoids evaluating Supabase and SecureStore on the critical path.
    import("@/src/infra/auth/supabase-auth-adapter").then(({ supabaseAuthService }) =>
      supabaseAuthService.getSession()
    ).then((session) => {
      if (!active) return;
      if (session) {
        router.replace(
          session.user.isAdmin
            ? "/admin-users"
            : session.user.activeRole === "provider"
              ? "/dashboard"
              : "/client-home",
        );
        return;
      }
      if (Platform.OS !== "web") {
        router.replace("/login");
        return;
      }
      setNativeBootDone(true);
    }).catch(() => {
      if (active && Platform.OS !== "web") router.replace("/login");
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const heroLoop = Animated.loop(Animated.sequence([
      Animated.timing(heroFloat, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(heroFloat, { toValue: 0, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ]));
    const orbitLoop = Animated.loop(Animated.timing(orbitFloat, {
      toValue: 1,
      duration: 24000,
      easing: Easing.linear,
      useNativeDriver: false,
    }));
    heroLoop.start();
    orbitLoop.start();
    return () => {
      heroLoop.stop();
      orbitLoop.stop();
    };
  }, [heroFloat, orbitFloat]);

  const heroY = -Math.min(54, scrollOffset * 0.12);
  const heroOpacity = Math.max(0.7, 1 - scrollOffset * 0.0007);
  const glowY = Math.min(120, scrollOffset * 0.17);
  const reveal = (start: number) =>
    wide
      ? scrollY.interpolate({
          inputRange: [start - 260, start],
          outputRange: [0.15, 1],
          extrapolate: "clamp",
        })
      : 1;

  // Posição de cada seção é medida via onLayout (não estimada), para que o
  // reveal-ao-rolar continue alinhado mesmo quando a altura real do conteúdo
  // muda (viewport, fontes, número de seções antes dela etc.). O gatilho usa
  // a posição absoluta da seção (mesmo comportamento original), só limitado
  // ao scroll máximo real da página — assim a última seção (que às vezes não
  // tem espaço de rolagem depois dela para alcançar sua própria posição)
  // continua revelando, sem adiantar o efeito das seções do topo.
  const maxScrollY = Math.max(0, contentHeight - height);
  const triggerY = (id: string, fallback: number) =>
    Math.min(sectionY[id] ?? fallback, maxScrollY);
  const revealAt = (id: string, fallback: number) => reveal(triggerY(id, fallback));

  function rememberSection(id: string, y: number) {
    sectionPositions.current[id] = y;
    setSectionY((prev) => (prev[id] === y ? prev : { ...prev, [id]: y }));
  }

  function goToSection(id: string) {
    const y = sectionPositions.current[id];
    if (typeof y === "number")
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 18), animated: true });
  }

  function goToPlan(index: number) {
    const nextIndex = Math.max(0, Math.min(1, index));
    setPlanSlide(nextIndex);
    plansScrollRef.current?.scrollTo({ x: nextIndex * planSnap, animated: true });
  }

  function handleScroll(event: {
    nativeEvent: { contentOffset: { y: number } };
  }) {
    const y = event.nativeEvent.contentOffset.y;
    setScrollOffset(y);
    scrollY.setValue(y);
    setShowTop(y > 560);
  }

  if (!nativeBootDone) {
    return (
      <SafeAreaView style={styles.nativeBootSplash}>
        <Animated.Text
          style={[
            styles.nativeBootLogo,
            {
              opacity: heroFloat.interpolate({
                inputRange: [0, 1],
                outputRange: [0.55, 1],
              }),
              transform: [
                {
                  scale: heroFloat.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.94, 1.04],
                  }),
                },
              ],
            },
          ]}
        >
          rotina<Text style={styles.logoAccent}>ê</Text>
        </Animated.Text>
        <ActivityIndicator size="small" color={colors.onBrand} />
        <Text style={styles.nativeBootLabel}>Carregando…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Head>
        <title>Rotinaê | Agenda e gestão de atendimentos</title>
        <meta
          name="description"
          content="O Rotinaê aproxima clientes e prestadores para transformar horários soltos em uma experiência simples, clara e humana."
        />
        <meta name="robots" content="index,follow,max-image-preview:large" />
        <link rel="canonical" href="https://rotinae.com.br/" />
        <meta property="og:type" content="website" />
        <meta property="og:locale" content="pt_BR" />
        <meta property="og:site_name" content="Rotinaê" />
        <meta property="og:title" content="Rotinaê | Agenda e gestão de atendimentos" />
        <meta
          property="og:description"
          content="O Rotinaê aproxima clientes e prestadores para transformar horários soltos em uma experiência simples, clara e humana."
        />
        <meta property="og:url" content="https://rotinae.com.br/" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Rotinaê | Agenda e gestão de atendimentos" />
        <meta
          name="twitter:description"
          content="O Rotinaê aproxima clientes e prestadores para transformar horários soltos em uma experiência simples, clara e humana."
        />
        <meta name="theme-color" content="#21065f" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/app-icon-512.png" />
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Rotinaê",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web, Android",
            url: "https://rotinae.com.br/",
            inLanguage: "pt-BR",
          })}
        </script>
      </Head>
      {!webVisualReady && (
        <View accessibilityLabel="Carregando página inicial" style={styles.webBootOverlay}>
          <Animated.View
            style={[
              styles.webBootMark,
              {
                opacity: webBootPulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.76, 1],
                }),
                transform: [
                  {
                    scale: webBootPulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.98, 1.035],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={styles.webBootLogo}>
              rotina<Text style={styles.logoAccent}>ê</Text>
            </Text>
            <Text style={styles.webBootTagline}>sua rotina em movimento</Text>
          </Animated.View>
          <View style={styles.webBootTrack}>
            <Animated.View
              style={[
                styles.webBootBar,
                {
                  transform: [
                    {
                      translateX: webBootProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-58, 174],
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>
          <Text style={styles.webBootLabel}>Preparando sua rotina…</Text>
        </View>
      )}
      <Animated.ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={handleScroll}
        onContentSizeChange={(_width, contentHeightValue) =>
          setContentHeight(contentHeightValue)
        }
        contentContainerStyle={styles.scrollContent}
        pointerEvents={webVisualReady ? "auto" : "none"}
        style={!webVisualReady ? styles.webContentPending : undefined}
      >
        <View style={[styles.nav, styles.navGrid, wide ? styles.navWide : styles.navMobile]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Rotinaê, voltar ao início"
            onPress={() => goToSection("top")}
            style={styles.logoBlock}
          >
            <Text style={styles.logo}>
              rotina<Text style={styles.logoAccent}>ê</Text>
            </Text>
            <Text style={styles.logoTagline}>sua rotina em movimento</Text>
          </Pressable>
          {wide && (
            <View style={styles.navLinks}>
              {Platform.OS === "web" && (
                <Pressable
                  onPress={() => goToSection("download")}
                  style={styles.navLink}
                >
                  <Text style={styles.navLinkText}>Baixe o app</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => goToSection("features")}
                style={styles.navLink}
              >
                <Text style={styles.navLinkText}>Recursos</Text>
              </Pressable>
              <Pressable
                onPress={() => goToSection("how")}
                style={styles.navLink}
              >
                <Text style={styles.navLinkText}>Como funciona</Text>
              </Pressable>
              <Pressable
                onPress={() => goToSection("plans")}
                style={styles.navLink}
              >
                <Text style={styles.navLinkText}>Planos</Text>
              </Pressable>
            </View>
          )}
          <View style={[styles.navActions, !wide && styles.navActionsMobile]}>
            {wide && (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Entrar na sua conta"
                onPress={() => void navigateFromLanding("/login")}
                style={styles.loginLink}
              >
                <Text style={styles.loginLinkText}>Entrar</Text>
              </Pressable>
            )}
            {wide ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void navigateFromLanding("/select-profile")}
                style={({ pressed }) => [styles.navCta, pressed && styles.pressed]}
              >
                <Text style={styles.navCtaText}>Começar agora</Text>
                <AppIcon name="forward" size={16} color={colors.onBrand} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={mobileNavOpen ? "Fechar menu" : "Abrir menu"}
                accessibilityState={{ expanded: mobileNavOpen }}
                onPress={() => setMobileNavOpen((open) => !open)}
                style={styles.mobileMenuButton}
              >
                <AppIcon name={mobileNavOpen ? "close" : "menu"} size={22} color={colors.brandDark} />
              </Pressable>
            )}
          </View>
        </View>
        {!wide && mobileNavOpen && (
          <View accessibilityRole="menu" style={styles.mobileNavMenu}>
            <View style={styles.mobileNavHeader}>
              <View style={styles.mobileNavHeaderIcon}>
                <AppIcon name="menu" size={18} color={colors.brand} />
              </View>
              <View>
                <Text style={styles.mobileNavEyebrow}>NAVEGAÇÃO</Text>
                <Text style={styles.mobileNavTitle}>Explore o Rotinae</Text>
              </View>
            </View>
            {Platform.OS === "web" && <Pressable accessibilityRole="menuitem" onPress={() => { setMobileNavOpen(false); goToSection("download"); }} style={styles.mobileNavItem}><View style={styles.mobileNavItemIcon}><AppIcon name="android" size={18} color={colors.brand} /></View><Text style={styles.mobileNavItemText}>Baixe o app</Text><AppIcon name="forward" size={14} color={colors.mutedSoft} /></Pressable>}
            <Pressable accessibilityRole="menuitem" onPress={() => { setMobileNavOpen(false); goToSection("features"); }} style={styles.mobileNavItem}><View style={styles.mobileNavItemIcon}><AppIcon name="services" size={18} color={colors.brand} /></View><Text style={styles.mobileNavItemText}>Recursos</Text><AppIcon name="forward" size={14} color={colors.mutedSoft} /></Pressable>
            <Pressable accessibilityRole="menuitem" onPress={() => { setMobileNavOpen(false); goToSection("how"); }} style={styles.mobileNavItem}><View style={styles.mobileNavItemIcon}><AppIcon name="schedule" size={18} color={colors.brand} /></View><Text style={styles.mobileNavItemText}>Como funciona</Text><AppIcon name="forward" size={14} color={colors.mutedSoft} /></Pressable>
            <Pressable accessibilityRole="menuitem" onPress={() => { setMobileNavOpen(false); goToSection("plans"); }} style={styles.mobileNavItem}><View style={styles.mobileNavItemIcon}><AppIcon name="packages" size={18} color={colors.brand} /></View><Text style={styles.mobileNavItemText}>Planos</Text><AppIcon name="forward" size={14} color={colors.mutedSoft} /></Pressable>
            <Pressable accessibilityRole="menuitem" accessibilityLabel="Entrar na sua conta" onPress={() => { setMobileNavOpen(false); void navigateFromLanding("/login"); }} style={styles.mobileNavItem}><View style={styles.mobileNavItemIcon}><AppIcon name="user" size={18} color={colors.brand} /></View><Text style={styles.mobileNavItemText}>Entrar</Text><AppIcon name="forward" size={14} color={colors.mutedSoft} /></Pressable>
            <Pressable onPress={() => { setMobileNavOpen(false); void navigateFromLanding("/select-profile"); }} style={styles.mobileNavCta}><Text style={styles.mobileNavCtaText}>Começar agora</Text><AppIcon name="forward" size={16} color={colors.onBrand} /></Pressable>
          </View>
        )}

        <View
          nativeID="top"
          onLayout={(event) =>
            rememberSection("top", event.nativeEvent.layout.y)
          }
          style={styles.container}
        >
          <Animated.View
            style={[
              styles.hero,
              { opacity: heroOpacity, transform: [{ translateY: heroY }] },
            ]}
          >
            <Image
              pointerEvents="none"
              source={require("../assets/images/landing-hero-planner.webp")}
              contentFit="cover"
            priority="high"
              style={styles.heroImage}
            />
            <Animated.View
              pointerEvents="none"
              style={[styles.glowOne, { transform: [{ translateY: glowY }] }]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.glowTwo,
                {
                  transform: [{ translateY: Animated.multiply(glowY, -0.45) }],
                },
              ]}
            />
            <View style={[styles.heroGrid, wide ? styles.heroGridWide : styles.heroGridMobile]}>
              <View style={styles.heroCopy}>
                <View style={styles.eyebrow}>
                  <View style={styles.eyebrowDot} />
                  <Text style={styles.eyebrowText}>
                    ORGANIZA. CONECTA. AVANÇA.
                  </Text>
                </View>
                <Text accessibilityRole="header" style={styles.heroTitle}>
                  Sua rotina de atendimentos,{" "}
                  <Text style={styles.heroTitleAccent}>mais leve.</Text>
                </Text>
                <Text style={styles.heroDescription}>
                  O Rotinaê aproxima clientes e prestadores para transformar
                  horários soltos em uma experiência simples, clara e humana.
                </Text>
                <View style={styles.heroActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void navigateFromLanding("/select-profile")}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>
                      Começar gratuitamente
                    </Text>
                    <AppIcon name="forward" size={18} color={colors.onBrand} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => goToSection("how")}
                    style={styles.heroSecondary}
                  >
                    <View style={styles.playCircle}>
                      <AppIcon
                        name="forward"
                        size={14}
                        color={colors.brandDark}
                      />
                    </View>
                    <Text style={styles.heroSecondaryText}>
                      Descobrir como funciona
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.heroProof}>
                  <View style={styles.avatarStack}>
                    <View style={[styles.avatar, styles.avatarOne]}>
                      <Text style={styles.avatarText}>MA</Text>
                    </View>
                    <View style={[styles.avatar, styles.avatarTwo]}>
                      <Text style={styles.avatarText}>JR</Text>
                    </View>
                    <View style={[styles.avatar, styles.avatarThree]}>
                      <Text style={styles.avatarText}>LC</Text>
                    </View>
                  </View>
                  <Text style={styles.proofText}>
                    <Text style={styles.proofStrong}>
                      Feito para a rotina real
                    </Text>
                    {"\n"}de quem atende e de quem agenda
                  </Text>
                </View>
              </View>
              <View style={[styles.heroVisual, !wide && styles.heroVisualMobile]}>
                <View style={styles.visualHalo} />
                <Animated.View
                  style={[
                    styles.dashboardMock,
                    !wide && styles.dashboardMockMobile,
                    {
                      transform: [
                        { rotate: "2deg" },
                        {
                          translateY: heroFloat.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, -10],
                          }),
                        },
                        {
                          scale: scrollY.interpolate({
                            inputRange: [0, 500],
                            outputRange: [1, 0.96],
                            extrapolate: "clamp",
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <View style={styles.mockTop}>
                    <View>
                      <Text style={styles.mockTiny}>QUARTA, 06 AGO</Text>
                      <Text style={styles.mockTitle}>
                        Olá, Ana <Text style={styles.wave}>✦</Text>
                      </Text>
                    </View>
                    <View style={styles.mockUser}>
                      <AppIcon name="user" size={15} color={colors.brand} />
                    </View>
                  </View>
                  <View style={styles.mockSummary}>
                    <View>
                      <Text style={styles.mockLabel}>PRÓXIMO ATENDIMENTO</Text>
                      <Text style={styles.mockTime}>10:30</Text>
                      <Text style={styles.mockService}>Acompanhamento</Text>
                    </View>
                    <View style={styles.mockDate}>
                      <Text style={styles.mockDateDay}>06</Text>
                      <Text style={styles.mockDateMonth}>AGO</Text>
                    </View>
                  </View>
                  <View style={styles.mockSection}>
                    <View style={styles.mockSectionHeader}>
                      <Text style={styles.mockSectionTitle}>Sua agenda</Text>
                      <Text style={styles.mockSee}>Ver tudo</Text>
                    </View>
                    <View style={styles.mockItem}>
                      <View style={styles.mockItemTime}>
                        <Text style={styles.mockHour}>10:30</Text>
                        <Text style={styles.mockPeriod}>AM</Text>
                      </View>
                      <View style={styles.mockItemLine} />
                      <View style={styles.mockItemCopy}>
                        <Text style={styles.mockItemTitle}>Acompanhamento</Text>
                        <Text style={styles.mockItemMeta}>
                          Mariana Souza · 50 min
                        </Text>
                      </View>
                      <View style={styles.mockStatus}>
                        <Text style={styles.mockStatusText}>Confirmado</Text>
                      </View>
                    </View>
                    <View style={styles.mockItem}>
                      <View style={styles.mockItemTime}>
                        <Text style={styles.mockHour}>14:00</Text>
                        <Text style={styles.mockPeriod}>PM</Text>
                      </View>
                      <View
                        style={[styles.mockItemLine, styles.mockItemLineMuted]}
                      />
                      <View style={styles.mockItemCopy}>
                        <Text style={styles.mockItemTitle}>
                          Primeira consulta
                        </Text>
                        <Text style={styles.mockItemMeta}>
                          Rafael Martins · 1 h
                        </Text>
                      </View>
                      <View style={[styles.mockStatus, styles.mockStatusMuted]}>
                        <Text style={styles.mockStatusMutedText}>Agendado</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.mockBottom}>
                    <View style={styles.mockBottomIcon}>
                      <AppIcon
                        name="success"
                        size={17}
                        color={colors.success}
                      />
                    </View>
                    <View>
                      <Text style={styles.mockBottomTitle}>
                        Tudo sob controle
                      </Text>
                      <Text style={styles.mockBottomText}>
                        2 confirmações hoje
                      </Text>
                    </View>
                  </View>
                </Animated.View>
                <View style={[styles.floatCard, styles.floatCardTop, !wide && styles.floatCardTopMobile, glassBlurStyle]}>
                  <View style={styles.floatIcon}>
                    <AppIcon name="success" size={17} color={colors.success} />
                  </View>
                  <View>
                    <Text style={styles.floatLabel}>CONFIRMADO</Text>
                    <Text style={styles.floatValue}>Novo agendamento</Text>
                  </View>
                </View>
                <View style={[styles.floatCard, styles.floatCardBottom, !wide && styles.floatCardBottomMobile, glassBlurStyle]}>
                  <View style={styles.floatIconPurple}>
                    <AppIcon name="clients" size={17} color={colors.brand} />
                  </View>
                  <View>
                    <Text style={styles.floatLabel}>SEUS CLIENTES</Text>
                    <Text style={styles.floatValue}>48 ativos</Text>
                  </View>
                </View>
              </View>
            </View>
          </Animated.View>

          <Animated.View
            onLayout={(event) =>
              rememberSection("trustBar", event.nativeEvent.layout.y)
            }
            style={[
              styles.trustBar,
              wide && styles.trustBarWide,
              { opacity: revealAt("trustBar", 300) },
            ]}
          >
            <Text style={styles.trustLabel}>
              UMA EXPERIÊNCIA PARA CADA LADO DA ROTINA
            </Text>
            <View style={[styles.trustStats, !wide && styles.trustStatsMobile]}>
              <View style={styles.trustStat}>
                <Text style={styles.trustValue}>2 em 1</Text>
                <Text style={styles.trustText}>Cliente e Prestador</Text>
              </View>
              <View style={styles.trustDivider} />
              <View style={styles.trustStat}>
                <Text style={styles.trustValue}>24/7</Text>
                <Text style={styles.trustText}>Acesso onde estiver</Text>
              </View>
              <View style={styles.trustDivider} />
              <View style={styles.trustStat}>
                <Text style={styles.trustValue}>1 só lugar</Text>
                <Text style={styles.trustText}>Menos ruído, mais foco</Text>
              </View>
            </View>
          </Animated.View>

          {Platform.OS === "web" && (
            <Animated.View
              nativeID="download"
              onLayout={(event) =>
                rememberSection("download", event.nativeEvent.layout.y)
              }
              style={[
                styles.downloadSection,
                !wide && styles.downloadSectionMobile,
                {
                  opacity: revealAt("download", 480),
                  transform: [
                    {
                      translateY: wide
                        ? scrollY.interpolate({
                            inputRange: [
                              triggerY("download", 480) - 260,
                              triggerY("download", 480),
                            ],
                            outputRange: [26, 0],
                            extrapolate: "clamp",
                          })
                        : 0,
                    },
                  ],
                },
              ]}
            >
              <View style={[styles.downloadCopy, !wide && styles.downloadCopyMobile]}>
                <Text style={[styles.sectionKicker, styles.downloadKicker]}>ROTINAÊ NO SEU BOLSO</Text>
                <Text style={styles.downloadTitle}>
                  Sua agenda, onde você estiver.
                </Text>
                <Text style={styles.downloadText}>
                  Baixe o app para acompanhar atendimentos, clientes e
                  confirmações em tempo real.
                </Text>
              </View>
              <View style={[styles.downloadActions, !wide && styles.downloadActionsMobile]}>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel="Baixar para Android"
                  onPress={() => void downloadAndroidApp()}
                  style={({ pressed }) => [
                    styles.storeButton,
                    !wide && styles.storeButtonMobile,
                    pressed && styles.pressed,
                  ]}
                >
                  <AppIcon name="android" size={22} color={colors.onBrand} />
                  <View>
                    <Text style={styles.storeEyebrow}>BAIXAR PARA</Text>
                    <Text style={styles.storeName}>Android</Text>
                  </View>
                </Pressable>
              </View>
            </Animated.View>
          )}

          <Animated.View
            onLayout={(event) =>
              rememberSection("features", event.nativeEvent.layout.y)
            }
            style={[
              styles.section,
              {
                opacity: revealAt("features", 720),
                transform: [
                  {
                    translateY: scrollY.interpolate({
                      inputRange: [120, 520],
                      outputRange: wide ? [28, 0] : [0, 0],
                      extrapolate: "clamp",
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionKicker}>PENSADO PARA O DIA A DIA</Text>
              <Text style={styles.sectionTitle}>
                Tudo o que importa,{"\n"}
                <Text style={styles.sectionTitleAccent}>sem complicar.</Text>
              </Text>
              <Text style={styles.sectionDescription}>
                Uma base tranquila para você cuidar dos horários, das pessoas e
                do que acontece depois de cada atendimento.
              </Text>
            </View>
            <ScrollView
              horizontal={!wide}
              pagingEnabled={!wide}
              snapToInterval={featureSnap}
              decelerationRate="fast"
              onScroll={(event) => setFeatureSlide(Math.round(event.nativeEvent.contentOffset.x / featureSnap))}
              scrollEventThrottle={16}
              showsHorizontalScrollIndicator={false}
              style={[styles.cardScroller, wide && styles.cardScrollerWide]}
              contentContainerStyle={[styles.featureGrid, wide && styles.featureGridWide]}
            >
              {highlights.map((item, index) => (
                <Animated.View
                  key={item.title}
                  style={[
                    styles.featureCard,
                    !wide && styles.featureCardMobile,
                    !wide && { width: mobileCardWidth },
                    index === 1 && styles.featureCardFeatured,
                    {
                      transform: [
                        {
                          translateY: scrollY.interpolate({
                            inputRange: [350 + index * 80, 650 + index * 80],
                            outputRange: wide ? [22, 0] : [0, 0],
                            extrapolate: "clamp",
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.featureIcon,
                      index === 1 && styles.featureIconFeatured,
                    ]}
                  >
                    <AppIcon
                      name={item.icon}
                      size={24}
                      color={index === 1 ? colors.onBrand : colors.brand}
                    />
                  </View>
                  <Text
                    style={[
                      styles.featureTitle,
                      index === 1 && styles.featureTitleFeatured,
                    ]}
                  >
                    {item.title}
                  </Text>
                  <Text
                    style={[
                      styles.featureText,
                      index === 1 && styles.featureTextFeatured,
                    ]}
                  >
                    {item.text}
                  </Text>
                  <View
                    style={[
                      styles.featureArrow,
                      index === 1 && styles.featureArrowFeatured,
                    ]}
                  >
                    <AppIcon
                      name="forward"
                      size={17}
                      color={index === 1 ? colors.onBrand : colors.brand}
                    />
                  </View>
                </Animated.View>
              ))}
            </ScrollView>
            {!wide && <View style={styles.carouselDots}>{highlights.map((item, index) => <View key={item.title} style={[styles.carouselDot, index === featureSlide && styles.carouselDotActive]} />)}</View>}
          </Animated.View>

          <Animated.View
            onLayout={(event) =>
              rememberSection("how", event.nativeEvent.layout.y)
            }
            style={[
              styles.howSection,
              wide && styles.howSectionWide,
              { opacity: revealAt("how", 1120) },
            ]}
          >
            <Animated.View style={[styles.howVisual, { transform: [{ translateY: orbitFloat.interpolate({ inputRange: [0, 1], outputRange: [0, 3] }) }, { scale: scrollY.interpolate({ inputRange: [triggerY("how", 1120) - 420, triggerY("how", 1120)], outputRange: [0.98, 1], extrapolate: "clamp" }) }] }]}>
              <Animated.View
                style={[
                  styles.orbit,
                  styles.orbitLarge,
                  {
                    transform: [
                      {
                        rotate: orbitProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["0deg", "360deg"],
                        }),
                      },
                    ],
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.orbit,
                  styles.orbitSmall,
                  {
                    transform: [
                      {
                        rotate: orbitProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["360deg", "0deg"],
                        }),
                      },
                    ],
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.howCenter,
                  {
                    transform: [
                      {
                        scale: heroFloat.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, 1.015],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Text style={styles.howCenterLogo}>
                  a<Text style={styles.howCenterAccent}>ê</Text>
                </Text>
                <Text style={styles.howCenterText}>
                  um ritmo{"\n"}mais leve
                </Text>
              </Animated.View>
              <View style={[styles.orbitChip, styles.orbitChipOne]}>
                <AppIcon name="calendar" size={17} color={colors.brand} />
              </View>
              <View style={[styles.orbitChip, styles.orbitChipTwo]}>
                <AppIcon name="clients" size={17} color={colors.brand} />
              </View>
              <View style={[styles.orbitChip, styles.orbitChipThree]}>
                <AppIcon name="success" size={17} color={colors.success} />
              </View>
            </Animated.View>
            <View style={[styles.howCopy, wide && styles.howCopyWide]}>
              <Text style={[styles.sectionKicker, styles.howCopyText]}>
                UM FLUXO QUE ACOMPANHA VOCÊ
              </Text>
              <Text style={[styles.sectionTitle, styles.howCopyText]}>
                Da primeira configuração ao próximo{" "}
                <Text style={styles.sectionTitleAccent}>sim.</Text>
              </Text>
              <Text style={[styles.sectionDescription, styles.howCopyText]}>
                O Rotinaê reduz a distância entre intenção e ação, com cada
                etapa visível para quem precisa decidir.
              </Text>
              <View style={styles.stepList}>
                {steps.map((step) => (
                  <View key={step.number} style={styles.step}>
                    <Text style={styles.stepNumber}>{step.number}</Text>
                    <View style={styles.stepLine}>
                      <Text style={styles.stepTitle}>{step.title}</Text>
                      <Text style={styles.stepText}>{step.text}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </Animated.View>

          <Animated.View
            onLayout={(event) =>
              rememberSection("plans", event.nativeEvent.layout.y)
            }
            style={[
              styles.planSection,
              !wide && styles.planSectionMobile,
              {
                opacity: revealAt("plans", 1320),
                transform: [{
                  translateY: wide
                    ? scrollY.interpolate({ inputRange: [triggerY("plans", 1320) - 260, triggerY("plans", 1320)], outputRange: [30, 0], extrapolate: "clamp" })
                    : 0,
                }],
              },
            ]}
          >
            <View style={[styles.planCopy, !wide && styles.planCopyMobile]}>
              <Text style={[styles.sectionKicker, !wide && styles.planKickerMobile]}>COMECE NO SEU RITMO</Text>
              <Text style={[styles.sectionTitle, !wide && styles.planTitleMobile]}>
                Clareza para começar.{"\n"}
                <Text style={styles.sectionTitleAccent}>
                  Espaço para crescer.
                </Text>
              </Text>
              <Text style={[styles.sectionDescription, !wide && styles.planDescriptionMobile]}>
                Teste o Premium por 30 dias e escolha o que faz sentido para a
                sua rotina. Sem surpresa, sem pressão.
              </Text>
              <Pressable
                onPress={() => void navigateFromLanding("/select-profile")}
                style={({ pressed }) => [
                  styles.outlineButton,
                  !wide && styles.planOutlineButtonMobile,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.outlineButtonText}>Conhecer o Rotinaê</Text>
                <AppIcon name="forward" size={17} color={colors.brand} />
              </Pressable>
              {!wide && (
                <View style={styles.mobilePlansCarousel}>
                  <ScrollView
                    ref={plansScrollRef}
                    horizontal
                    snapToInterval={planSnap}
                    snapToAlignment="start"
                    decelerationRate="fast"
                    disableIntervalMomentum
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={(event) =>
                      setPlanSlide(Math.max(0, Math.min(1, Math.round(event.nativeEvent.contentOffset.x / planSnap))))
                    }
                    accessibilityLabel="Planos disponíveis. Deslize horizontalmente para comparar."
                    style={styles.mobilePlansScroller}
                    contentContainerStyle={styles.mobilePlansScrollerContent}
                  >
                  <View style={[styles.freePlanCard, styles.mobilePlanCard, { width: mobilePlanWidth, minWidth: mobilePlanWidth, maxWidth: mobilePlanWidth }]}>
                    <Text style={styles.freePlanKicker}>PARA COMEÇAR</Text>
                    <Text style={styles.freePlanTitle}>Gratuito</Text>
                    <Text style={styles.freePlanPrice}>R$ 0 <Text style={styles.freePlanSuffix}>para sempre</Text></Text>
                    <View style={styles.freePlanRule} />
                    <Text style={styles.freePlanBenefit}>✓ Até 2 agendamentos por dia</Text>
                    <Text style={styles.freePlanBenefit}>✓ Até 5 clientes</Text>
                    <Text style={styles.freePlanBenefitMuted}>— Sem novas notas internas</Text>
                    <Pressable onPress={() => void navigateFromLanding("/select-profile")} style={({ pressed }) => [styles.freePlanButton, pressed && styles.pressed]}>
                      <Text style={styles.freePlanButtonText}>Começar grátis</Text>
                    </Pressable>
                  </View>
                  <View style={[styles.planCard, styles.mobilePlanCard, { width: mobilePlanWidth, minWidth: mobilePlanWidth, maxWidth: mobilePlanWidth }]}>
                    <View style={styles.planCardGlow} />
                    <View style={[styles.planCardHeader, styles.planCardHeaderMobile]}>
                      <View>
                        <Text style={styles.planCardKicker}>PARA QUEM QUER MAIS FLUIDEZ</Text>
                        <Text style={styles.planCardTitle}>Premium</Text>
                      </View>
                      <View style={styles.planBadge}><Text style={styles.planBadgeText}>30 DIAS GRÁTIS</Text></View>
                    </View>
                    <Text style={styles.planPrice}><Text style={styles.planPriceValue}>R$ 29</Text><Text style={styles.planPriceSuffix}>/mês</Text></Text>
                    <View style={styles.planRule} />
                    <View style={styles.planBenefits}>
                      <Text style={styles.planBenefit}><Text style={styles.planCheck}>✓</Text> Agenda sem limite do Gratuito</Text>
                      <Text style={styles.planBenefit}><Text style={styles.planCheck}>✓</Text> Clientes e notas no seu ritmo</Text>
                      <Text style={styles.planBenefit}><Text style={styles.planCheck}>✓</Text> Controle simples da sua operação</Text>
                    </View>
                    <Pressable onPress={() => void navigateFromLanding("/select-profile")} style={({ pressed }) => [styles.planButton, pressed && styles.pressed]}>
                      <Text style={styles.planButtonText}>Começar meu teste</Text>
                      <AppIcon name="forward" size={16} color={colors.brandDark} />
                    </Pressable>
                  </View>
                  </ScrollView>
                  <View accessibilityRole="tablist" style={styles.planCarouselControls}>
                    {(["Gratuito", "Premium"] as const).map((label, index) => (
                      <Pressable
                        key={label}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: planSlide === index }}
                        accessibilityLabel={`Mostrar plano ${label}`}
                        onPress={() => goToPlan(index)}
                        style={[styles.planCarouselControl, planSlide === index && styles.planCarouselControlActive]}
                      >
                        <Text style={[styles.planCarouselControlText, planSlide === index && styles.planCarouselControlTextActive]}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
            </View>
            {wide && <ScrollView horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.plansScrollerContent} style={[styles.plansScroller, styles.plansScrollerWide]}>
            <View style={[styles.plansGrid, wide && styles.plansGridWide, !wide && styles.plansGridMobile, !wide && { width: mobileCardWidth * 2 + spacing.md, minWidth: mobileCardWidth * 2 + spacing.md }]}>
            <View style={[styles.freePlanCard, !wide && styles.planCardMobile, !wide && { width: mobileCardWidth, minWidth: mobileCardWidth, maxWidth: mobileCardWidth }]}>
              <Text style={styles.freePlanKicker}>PARA COMEÇAR</Text>
              <Text style={styles.freePlanTitle}>Gratuito</Text>
              <Text style={styles.freePlanPrice}>R$ 0 <Text style={styles.freePlanSuffix}>para sempre</Text></Text>
              <View style={styles.freePlanRule} />
              <Text style={styles.freePlanBenefit}>✓ Até 2 agendamentos por dia</Text>
              <Text style={styles.freePlanBenefit}>✓ Até 5 clientes</Text>
              <Text style={styles.freePlanBenefitMuted}>— Sem novas notas internas</Text>
              <Pressable onPress={() => void navigateFromLanding("/select-profile")} style={({ pressed }) => [styles.freePlanButton, pressed && styles.pressed]}><Text style={styles.freePlanButtonText}>Começar grátis</Text></Pressable>
            </View>
            <View style={[styles.planCard, !wide && styles.planCardMobile, !wide && { width: mobileCardWidth, minWidth: mobileCardWidth, maxWidth: mobileCardWidth }]}>
              <View style={styles.planCardGlow} />
              <View style={styles.planCardHeader}>
                <View>
                  <Text style={styles.planCardKicker}>
                    PARA QUEM QUER MAIS FLUIDEZ
                  </Text>
                  <Text style={styles.planCardTitle}>Premium</Text>
                </View>
                <View style={styles.planBadge}>
                  <Text style={styles.planBadgeText}>30 DIAS GRÁTIS</Text>
                </View>
              </View>
              <Text style={styles.planPrice}>
                <Text style={styles.planPriceValue}>R$ 29</Text>
                <Text style={styles.planPriceSuffix}>/mês</Text>
              </Text>
              <View style={styles.planRule} />
              <View style={styles.planBenefits}>
                <Text style={styles.planBenefit}>
                  <Text style={styles.planCheck}>✓</Text> Agenda sem limite do
                  Gratuito
                </Text>
                <Text style={styles.planBenefit}>
                  <Text style={styles.planCheck}>✓</Text> Clientes e notas no
                  seu ritmo
                </Text>
                <Text style={styles.planBenefit}>
                  <Text style={styles.planCheck}>✓</Text> Controle simples da
                  sua operação
                </Text>
              </View>
              <Pressable
                onPress={() => void navigateFromLanding("/select-profile")}
                style={({ pressed }) => [
                  styles.planButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.planButtonText}>Começar meu teste</Text>
                <AppIcon name="forward" size={16} color={colors.brandDark} />
              </Pressable>
            </View>
            </View>
            </ScrollView>}
          </Animated.View>

          <Animated.View
            onLayout={(event) =>
              rememberSection("finalCta", event.nativeEvent.layout.y)
            }
            style={[
              styles.finalCta,
              {
                opacity: revealAt("finalCta", 1650),
                transform: [
                  {
                    scale: scrollY.interpolate({
                      inputRange: [triggerY("finalCta", 1650) - 260, triggerY("finalCta", 1650)],
                      outputRange: wide ? [0.96, 1] : [1, 1],
                      extrapolate: "clamp",
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.finalGlow} />
            <Text style={styles.finalKicker}>
              A PRÓXIMA HORA PODE SER MAIS SIMPLES
            </Text>
            <Text style={styles.finalTitle}>
              Vamos colocar sua rotina{"\n"}em movimento?
            </Text>
            <Text style={styles.finalDescription}>
              Crie seu espaço e descubra um jeito mais leve de organizar cada
              atendimento.
            </Text>
            <Pressable
              onPress={() => void navigateFromLanding("/select-profile")}
              style={({ pressed }) => [
                styles.finalButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.finalButtonText}>Começar gratuitamente</Text>
              <AppIcon name="forward" size={18} color={colors.brandDark} />
            </Pressable>
          </Animated.View>
        </View>
        {Platform.OS === "web" && (
          <View style={[styles.footer, styles.footerModern, !wide && styles.footerModernMobile]}>
            <View style={[styles.footerBrandColumn, !wide && styles.footerBrandColumnMobile]}>
              <Text style={styles.footerLogo}>
                rotina<Text style={styles.logoAccent}>ê</Text>
              </Text>
              <Text style={styles.footerTagline}>
                Sua rotina de atendimentos, mais leve.
              </Text>
            </View>
            <View style={[styles.footerNav, !wide && styles.footerNavMobile]}>
              <Text style={styles.footerNavLabel}>EXPLORE</Text>
              <Pressable onPress={() => goToSection("download")}>
                <Text style={styles.footerLink}>Baixe o app</Text>
              </Pressable>
              <Pressable onPress={() => goToSection("features")}>
                <Text style={styles.footerLink}>Recursos</Text>
              </Pressable>
              <Pressable onPress={() => goToSection("how")}>
                <Text style={styles.footerLink}>Como funciona</Text>
              </Pressable>
              <Pressable onPress={() => goToSection("plans")}>
                <Text style={styles.footerLink}>Planos</Text>
              </Pressable>
            </View>
            <View style={[styles.footerNav, !wide && styles.footerNavMobile]}>
              <Text style={styles.footerNavLabel}>CONTA</Text>
              <Pressable onPress={() => void navigateFromLanding("/login")}>
                <Text style={styles.footerLink}>Entrar</Text>
              </Pressable>
              <Pressable onPress={() => void navigateFromLanding("/select-profile")}>
                <Text style={styles.footerLink}>Criar conta</Text>
              </Pressable>
            </View>
            <View style={[styles.footerMeta, !wide && styles.footerMetaMobile]}>
              <Text style={[styles.footerText, !wide && styles.footerTextMobile]}>Feito para a rotina real.</Text>
              <Text style={styles.footerCopyright}>
                © {new Date().getFullYear()} Rotinaê
              </Text>
            </View>
          </View>
        )}
        {showTop && (
          <View style={styles.topButtonWrap}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Voltar ao topo"
              onPress={() => goToSection("top")}
              style={({ pressed }) => [
                styles.topButton,
                pressed && styles.pressed,
              ]}
            >
              <AppIcon name="back" size={18} color={colors.onBrand} />
              <Text style={styles.topButtonText}>Topo</Text>
            </Pressable>
          </View>
        )}
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  webHover: {
    opacity: 0.96,
    transform: [{ translateY: -1 }],
  },
  webContentPending: { opacity: 0 },
  webBootOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.canvas,
  },
  webBootMark: {
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  webBootLogo: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: 36,
    letterSpacing: -1.5,
  },
  webBootTagline: {
    marginTop: 2,
    color: colors.muted,
    fontFamily: typography.family.medium,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  webBootTrack: {
    width: 168,
    height: 4,
    overflow: "hidden",
    borderRadius: radius.pill,
    backgroundColor: "#E4DDF7",
  },
  webBootBar: {
    width: 54,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  webBootLabel: {
    color: colors.muted,
    fontFamily: typography.family.medium,
    fontSize: typography.size.body,
  },
  nativeBootSplash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    backgroundColor: colors.brandDark,
  },
  nativeBootLogo: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: 32,
    letterSpacing: -1,
  },
  nativeBootLabel: {
    color: "#DAD2FF",
    fontFamily: typography.family.medium,
    fontSize: typography.size.body,
  },
  scrollContent: { paddingBottom: 0 },
  container: {
    width: "100%",
    maxWidth: layout.contentMax,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
  },
  nav: {
    width: "100%",
    minHeight: 76,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    backgroundColor: colors.canvas,
  },
  navWide: { paddingHorizontal: spacing.xxl },
  logoBlock: { flexShrink: 0 },
  logo: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: 27,
    letterSpacing: -1,
  },
  logoAccent: { color: colors.brand },
  logoTagline: {
    marginTop: -2,
    color: colors.mutedSoft,
    fontFamily: typography.family.medium,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  navLinks: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.xl,
  },
  navLink: { padding: spacing.sm },
  navLinkText: {
    color: colors.muted,
    fontFamily: typography.family.medium,
    fontSize: typography.size.body,
  },
  navActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  mobileMenuButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  mobileNavMenu: { position: "fixed", left: spacing.md, right: spacing.md, top: 68, zIndex: 50, padding: spacing.md, gap: spacing.xxs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, ...elevation.floating } as never,
  mobileNavHeader: { padding: spacing.sm, marginBottom: spacing.xs, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  mobileNavHeaderIcon: { width: 28, height: 40, alignItems: "center", justifyContent: "center" },
  mobileNavEyebrow: { color: colors.mutedSoft, fontFamily: typography.family.bold, fontSize: typography.size.caption, letterSpacing: 0.8 },
  mobileNavTitle: { marginTop: spacing.xxs, color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.bodyLarge },
  mobileNavItem: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  mobileNavItemIcon: { width: 28, height: 36, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  mobileNavItemText: { flex: 1, color: colors.ink, fontFamily: typography.family.semibold, fontSize: typography.size.body },
  mobileNavCta: { minHeight: 48, marginTop: spacing.sm, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.brand },
  mobileNavCtaText: { color: colors.onBrand, fontFamily: typography.family.bold, fontSize: typography.size.body },
  loginLink: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
  },
  loginLinkText: {
    color: colors.brandDark,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  navCta: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  navCtaText: {
    color: colors.onBrand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  hero: {
    minHeight: 590,
    overflow: "hidden",
    borderRadius: radius.lg,
    backgroundColor: colors.brandDark,
  },
  heroImage: { ...StyleSheet.absoluteFillObject, opacity: 0.22 },
  glowOne: {
    position: "absolute",
    width: 500,
    height: 500,
    right: -180,
    top: -250,
    borderRadius: radius.pill,
    backgroundColor: colors.brandMid,
    opacity: 0.7,
  },
  glowTwo: {
    position: "absolute",
    width: 340,
    height: 340,
    left: -180,
    bottom: -240,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    opacity: 0.45,
  },
  heroGrid: {
    flex: 1,
    padding: spacing.xl,
    gap: spacing.xl,
    justifyContent: "center",
  },
  heroGridWide: {
    padding: spacing.xxl,
    flexDirection: "row",
    alignItems: "center",
  },
  heroGridMobile: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
  },
  heroCopy: { flex: 1, maxWidth: 600, gap: spacing.md },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  eyebrowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  eyebrowText: {
    color: colors.accent,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 1.2,
  },
  heroTitle: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: wide ? 54 : 40,
    lineHeight: wide ? 60 : 46,
    letterSpacing: -1.3,
  },
  heroTitleAccent: { color: colors.accent },
  heroDescription: {
    maxWidth: 520,
    color: "#E8E4FF",
    fontFamily: typography.family.regular,
    fontSize: typography.size.bodyLarge,
    lineHeight: 26,
  },
  heroActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  primaryButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  heroSecondary: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  playCircle: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.onBrand,
  },
  heroSecondaryText: {
    color: colors.onBrand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  heroProof: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatarStack: { flexDirection: "row", paddingLeft: 8 },
  avatar: {
    width: 32,
    height: 32,
    marginLeft: -8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.brandDark,
    borderRadius: radius.pill,
  },
  avatarOne: { backgroundColor: "#F4C7B8" },
  avatarTwo: { backgroundColor: "#DBC5FF" },
  avatarThree: { backgroundColor: "#F3DD9B" },
  avatarText: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: 9,
  },
  proofText: {
    color: "#CBC2F5",
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: 16,
  },
  proofStrong: {
    color: colors.onBrand,
    fontFamily: typography.family.semibold,
  },
  heroVisual: {
    flex: 1,
    minHeight: 390,
    alignItems: "center",
    justifyContent: "center",
  },
  heroVisualMobile: {
    minHeight: 430,
    width: "100%",
    paddingHorizontal: spacing.sm,
  },
  visualHalo: {
    position: "absolute",
    width: 400,
    height: 400,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: radius.pill,
  },
  dashboardMock: {
    width: "100%",
    maxWidth: 420,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.32)",
    borderRadius: radius.md,
    backgroundColor: "#FAF9FF",
    transform: [{ rotate: "2deg" }],
    ...elevation.floating,
  },
  dashboardMockMobile: {
    width: "96%",
    maxWidth: 360,
  },
  mockTop: {
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mockTiny: {
    color: colors.mutedSoft,
    fontFamily: typography.family.bold,
    fontSize: 9,
    letterSpacing: 0.7,
  },
  mockTitle: {
    marginTop: spacing.xs,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
  },
  wave: { color: colors.brand },
  mockUser: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  mockSummary: {
    padding: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    borderRadius: radius.sm,
    backgroundColor: colors.brandDark,
  },
  mockLabel: {
    color: colors.accent,
    fontFamily: typography.family.bold,
    fontSize: 8,
    letterSpacing: 0.5,
  },
  mockTime: {
    marginTop: spacing.xs,
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: 28,
  },
  mockService: {
    color: "#DAD2FF",
    fontFamily: typography.family.regular,
    fontSize: 11,
  },
  mockDate: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  mockDateDay: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: 21,
  },
  mockDateMonth: {
    color: "#DDD4FF",
    fontFamily: typography.family.bold,
    fontSize: 9,
  },
  mockSection: { paddingTop: spacing.md },
  mockSectionHeader: { flexDirection: "row", justifyContent: "space-between" },
  mockSectionTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  mockSee: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: 11,
  },
  mockItem: {
    minHeight: 58,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  mockItemTime: { width: 43 },
  mockHour: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: 12,
  },
  mockPeriod: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: 8,
  },
  mockItemLine: {
    width: 3,
    height: 34,
    borderRadius: 2,
    backgroundColor: colors.brand,
  },
  mockItemLineMuted: { backgroundColor: colors.accent },
  mockItemCopy: { flex: 1 },
  mockItemTitle: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: 11,
  },
  mockItemMeta: {
    marginTop: 2,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: 9,
  },
  mockStatus: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
  },
  mockStatusText: {
    color: colors.success,
    fontFamily: typography.family.bold,
    fontSize: 8,
  },
  mockStatusMuted: { backgroundColor: colors.brandSoft },
  mockStatusMutedText: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: 8,
  },
  mockBottom: {
    marginTop: spacing.md,
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  mockBottomIcon: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
  },
  mockBottomTitle: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: 10,
  },
  mockBottomText: {
    marginTop: 2,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: 9,
  },
  floatCard: {
    position: "absolute",
    minWidth: 170,
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.45)",
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.65)",
    ...elevation.floating,
  },
  floatCardTop: { top: 56, right: -18 },
  floatCardBottom: { bottom: 58, left: -20 },
  floatCardTopMobile: {
    top: 18,
    right: 0,
    minWidth: 0,
    maxWidth: 176,
  },
  floatCardBottomMobile: {
    bottom: 16,
    left: 0,
    minWidth: 0,
    maxWidth: 160,
  },
  floatIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
  },
  floatIconPurple: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  floatLabel: {
    color: colors.mutedSoft,
    fontFamily: typography.family.bold,
    fontSize: 8,
    letterSpacing: 0.5,
  },
  floatValue: {
    marginTop: 2,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: 11,
  },
  trustBar: {
    paddingVertical: spacing.xl,
    flexDirection: wide ? "row" : "column",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.lg,
  },
  trustLabel: {
    color: colors.mutedSoft,
    fontFamily: typography.family.bold,
    fontSize: 10,
    letterSpacing: 1.1,
  },
  trustStats: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  trustStatsMobile: {
    width: "100%",
    justifyContent: "space-around",
    gap: spacing.xs,
  },
  trustStat: { alignItems: "center" },
  trustValue: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
  },
  trustText: {
    marginTop: 3,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: 10,
  },
  trustDivider: { width: 1, height: 32, backgroundColor: colors.border },
  section: { paddingVertical: wide ? 96 : 64 },
  sectionHeading: { maxWidth: 640, alignSelf: "center", alignItems: "center" },
  sectionKicker: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: 11,
    letterSpacing: 1.2,
    textAlign: "center",
  },
  sectionTitle: {
    marginTop: spacing.sm,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: wide ? 42 : 32,
    lineHeight: wide ? 50 : 39,
    letterSpacing: -0.8,
    textAlign: "center",
  },
  sectionTitleAccent: { color: colors.brand },
  sectionDescription: {
    maxWidth: 560,
    marginTop: spacing.md,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.bodyLarge,
    lineHeight: 25,
    textAlign: "center",
  },
  cardScroller: {
    width: "100%",
    minHeight: 306,
    marginTop: spacing.lg,
  },
  cardScrollerWide: { overflow: "visible" },
  featureGrid: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  featureGridWide: { flexDirection: "row" },
  featureCard: {
    flex: 1,
    minHeight: 250,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  featureCardFeatured: {
    backgroundColor: colors.brandDark,
    borderColor: colors.brandDark,
  },
  featureIcon: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  featureIconFeatured: { backgroundColor: colors.brand },
  featureTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
  },
  featureText: {
    flex: 1,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: 21,
  },
  featureTextFeatured: { color: "#DAD2FF" },
  featureArrow: {
    alignSelf: "flex-start",
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  howSection: {
    paddingVertical: wide ? 100 : 64,
    gap: wide ? spacing.xxl : spacing.xl,
    flexDirection: wide ? "row" : "column",
    alignItems: "center",
  },
  howVisual: {
    flex: 1,
    minHeight: 390,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
  },
  orbit: {
    position: "absolute",
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.pill,
  },
  orbitLarge: { width: 330, height: 330 },
  orbitSmall: { width: 220, height: 220, borderStyle: "dashed" },
  howCenter: {
    width: 145,
    height: 145,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandDark,
    ...elevation.floating,
  },
  howCenterLogo: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: 35,
  },
  howCenterAccent: { color: colors.accent },
  howCenterText: {
    marginTop: 4,
    color: "#DAD2FF",
    fontFamily: typography.family.medium,
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
  },
  orbitChip: {
    position: "absolute",
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  orbitChipOne: { top: 64, right: "22%" },
  orbitChipTwo: { bottom: 64, left: "20%" },
  orbitChipThree: { top: "46%", left: "9%" },
  howCopy: { flex: 1, alignItems: "flex-start" },
  howCopyText: { width: "100%", textAlign: "left" },
  howCopyTitle: { textAlign: wide ? "left" : "center" },
  stepList: {
    width: "100%",
    maxWidth: 500,
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  step: { flexDirection: "row", gap: spacing.md },
  stepNumber: {
    width: 42,
    height: 42,
    paddingTop: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.brandDark,
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: 13,
    textAlign: "center",
  },
  stepLine: {
    flex: 1,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stepTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  stepText: {
    marginTop: 4,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: 21,
  },
  planSection: {
    paddingVertical: wide ? 96 : 64,
    gap: spacing.xxl,
    flexDirection: wide ? "row" : "column",
    alignItems: "center",
  },
  planSectionMobile: {
    width: "100%",
    marginTop: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    gap: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  planCopy: { flex: 1, alignItems: wide ? "flex-start" : "center" },
  planCopyMobile: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    flex: 0,
    marginBottom: spacing.xxl,
  },
  planKickerMobile: {
    width: "100%",
    textAlign: "center",
  },
  planTitleMobile: {
    width: "100%",
    marginTop: spacing.sm,
    fontSize: 30,
    lineHeight: 38,
    textAlign: "center",
  },
  planDescriptionMobile: {
    width: "100%",
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
    fontSize: typography.size.body,
    lineHeight: 23,
    textAlign: "center",
  },
  planOutlineButtonMobile: {
    width: "100%",
    maxWidth: 420,
    minHeight: 52,
    alignSelf: "center",
    justifyContent: "center",
  },
  mobilePlansCarousel: {
    width: "100%",
    marginTop: spacing.xxl,
    alignSelf: "center",
    overflow: "hidden",
  },
  mobilePlansScroller: {
    width: "100%",
    minHeight: 460,
    flexGrow: 0,
  },
  mobilePlansScrollerContent: {
    paddingHorizontal: 0,
    paddingBottom: spacing.sm,
    gap: spacing.md,
    alignItems: "stretch",
  },
  mobilePlanCard: {
    flex: 0,
    minHeight: 440,
    alignSelf: "flex-start",
  },
  planCardHeaderMobile: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  planCarouselControls: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  planCarouselControl: {
    minWidth: 104,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  planCarouselControlActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  planCarouselControlText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  planCarouselControlTextActive: {
    color: colors.brandDark,
  },
  planCard: {
    width: "100%",
    maxWidth: 420,
    minHeight: 430,
    padding: spacing.lg,
    overflow: "hidden",
    borderRadius: radius.lg,
    backgroundColor: colors.brandDark,
    ...elevation.floating,
  },
  planCardGlow: {
    position: "absolute",
    width: 260,
    height: 260,
    right: -130,
    top: -140,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    opacity: 0.7,
  },
  planCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  planCardKicker: {
    color: colors.accent,
    fontFamily: typography.family.bold,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  planCardTitle: {
    marginTop: spacing.xs,
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  planBadge: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  planBadgeText: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: 8,
  },
  planPrice: {
    marginTop: spacing.xl,
    color: colors.onBrand,
    fontFamily: typography.family.regular,
  },
  planPriceValue: { fontFamily: typography.family.bold, fontSize: 48 },
  planPriceSuffix: {
    color: colors.accent,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  planRule: {
    height: 1,
    marginVertical: spacing.md,
    backgroundColor: "rgba(255,255,255,.18)",
  },
  planBenefits: { gap: spacing.sm },
  planBenefit: {
    color: "#E8E4FF",
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: 22,
  },
  planCheck: { color: colors.accent, fontFamily: typography.family.bold },
  planButton: {
    minHeight: 50,
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.onBrand,
  },
  planButtonText: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  outlineButton: {
    minHeight: 48,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.sm,
  },
  outlineButtonText: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  finalCta: {
    marginVertical: spacing.xxl,
    width: "100%",
    alignSelf: "center",
    maxWidth: layout.contentMax,
    padding: wide ? spacing.xxl : spacing.xl,
    alignItems: "center",
    overflow: "hidden",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  finalGlow: {
    position: "absolute",
    width: 500,
    height: 500,
    top: -340,
    right: -100,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    opacity: 0.8,
  },
  finalKicker: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: 10,
    letterSpacing: 1.1,
    textAlign: "center",
  },
  finalTitle: {
    marginTop: spacing.sm,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: wide ? 38 : 30,
    lineHeight: wide ? 46 : 37,
    textAlign: "center",
  },
  finalDescription: {
    maxWidth: 480,
    marginTop: spacing.md,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.bodyLarge,
    lineHeight: 24,
    textAlign: "center",
  },
  finalButton: {
    minHeight: 52,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  finalButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  footer: {
    minHeight: 84,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.canvas,
  },
  footerLogo: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: 26,
  },
  footerText: {
    flex: 1,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    textAlign: "center",
  },
  footerLinks: { flexDirection: "row", gap: spacing.md },
  footerLink: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  trustBarWide: { flexDirection: "row" },
  howSectionWide: {
    flexDirection: "row",
    paddingVertical: 100,
    gap: spacing.xxl,
  },
  howCopyWide: { alignItems: "flex-start" },
  navGrid: {
    maxWidth: layout.contentMax,
    alignSelf: "center",
  },
  topButtonWrap: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.lg,
    zIndex: 10,
  },
  topButton: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.brandDark,
    ...elevation.floating,
  },
  topButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  featureTitleFeatured: { color: colors.onBrand },
  featureArrowFeatured: { backgroundColor: "rgba(255,255,255,0.14)" },
  downloadSection: {
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
    padding: spacing.xxl,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.brandDark,
    borderWidth: 1,
    borderColor: colors.brandMid,
  },
  downloadSectionMobile: {
    padding: spacing.lg,
    alignItems: "stretch",
    marginTop: spacing.xl,
    borderRadius: radius.md,
  },
  downloadCopy: { flex: 1, minWidth: 260, alignItems: "flex-start" },
  downloadCopyMobile: { minWidth: 0, width: "100%" },
  downloadTitle: {
    marginTop: spacing.sm,
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: 30,
    lineHeight: 37,
    textAlign: "left",
  },
  downloadText: {
    maxWidth: 470,
    marginTop: spacing.sm,
    color: "#DAD2FF",
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: 22,
    textAlign: "left",
  },
  downloadKicker: { color: colors.accent, textAlign: "left", alignSelf: "stretch" },
  downloadActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  downloadActionsMobile: { width: "100%", flexDirection: "column" },
  storeButton: {
    minWidth: 172,
    minHeight: 58,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  storeButtonMobile: { width: "100%", minWidth: 0, justifyContent: "flex-start" },
  storeEyebrow: {
    color: "#CFC7F4",
    fontFamily: typography.family.regular,
    fontSize: 8,
    letterSpacing: 0.5,
  },
  storeName: {
    marginTop: 2,
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  footerModern: {
    width: "100%",
    maxWidth: layout.contentMax,
    minHeight: 180,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xl,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.xl,
    backgroundColor: "transparent",
    borderTopWidth: 2,
    borderTopColor: colors.brandSoft,
    alignSelf: "center",
  },
  footerModernMobile: {
    width: "100%",
    maxWidth: "100%",
    minHeight: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    flexDirection: "column",
    alignItems: "stretch",
    alignSelf: "stretch",
    gap: 0,
    overflow: "hidden",
  },
  footerBrandColumn: { flex: 1, minWidth: 180 },
  footerBrandColumnMobile: {
    width: "100%",
    minWidth: 0,
    flex: 0,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  footerTagline: {
    marginTop: spacing.sm,
    maxWidth: 190,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: 18,
  },
  footerNav: { minWidth: 120, gap: spacing.xs },
  footerNavMobile: {
    width: "100%",
    minWidth: 0,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  footerNavLabel: {
    marginBottom: spacing.xs,
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: 10,
    letterSpacing: 1,
  },
  footerMeta: {
    flex: 1,
    minWidth: 150,
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  footerMetaMobile: {
    width: "100%",
    minWidth: 0,
    flex: 0,
    marginTop: spacing.sm,
    paddingTop: spacing.lg,
    alignItems: "flex-start",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerTextMobile: { flex: 0, textAlign: "left" },
  footerCopyright: {
    width: "100%",
    flexShrink: 1,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: 11,
    lineHeight: 16,
  },
  plansGrid: {
    width: "100%",
    maxWidth: 860,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "stretch",
    justifyContent: "center",
    gap: spacing.md,
  },
  plansScroller: {
    width: "100%",
    minHeight: 470,
    flexShrink: 0,
  },
  plansScrollerMobile: {
    height: 470,
    minHeight: 470,
    flexGrow: 0,
    flexShrink: 0,
  },
  plansScrollerContent: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    alignItems: "stretch",
  },
  plansScrollerWide: {
    flex: 0,
    width: 860,
    minWidth: 0,
    maxWidth: 860,
    alignSelf: "center",
    overflow: "visible",
  },
  plansGridWide: {
    flexWrap: "nowrap",
    alignSelf: "center",
    width: 820,
    maxWidth: 820,
  },
  plansGridMobile: {
    width: 636,
    minWidth: 636,
    flexWrap: "nowrap",
    justifyContent: "flex-start",
  },
  planCardMobile: {
    width: 300,
    minWidth: 300,
    maxWidth: 300,
    flex: 0,
  },
  featureCardMobile: {
    width: 286,
    flex: 0,
  },
  navMobile: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  navActionsMobile: { gap: spacing.xs },
  carouselDots: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  carouselDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  carouselDotActive: {
    width: 20,
    backgroundColor: colors.brand,
  },
  freePlanCard: {
    flex: 1,
    minWidth: 260,
    maxWidth: 360,
    minHeight: 430,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  freePlanTitle: {
    marginTop: spacing.xs,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  freePlanKicker: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  freePlanPrice: {
    marginTop: spacing.xl,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: 42,
  },
  freePlanSuffix: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  freePlanRule: {
    height: 1,
    marginVertical: spacing.md,
    backgroundColor: colors.border,
  },
  freePlanBenefit: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: 22,
  },
  freePlanBenefitMuted: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: 22,
  },
  freePlanButton: {
    minHeight: 50,
    marginTop: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.sm,
  },
  freePlanButtonText: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
});
