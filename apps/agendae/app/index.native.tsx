import { router } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabaseAuthService } from "@/src/infra/auth/supabase-auth-adapter";
import { colors, spacing, typography } from "@/src/theme/tokens";

/**
 * Entrada exclusiva do aplicativo instalado.
 *
 * A landing de marketing vive em `index.tsx` e é resolvida apenas pela Web;
 * Android/iOS passam por esta rota nativa e seguem direto para sessão/login.
 */
export default function NativeAppEntry() {
  useEffect(() => {
    let active = true;

    void supabaseAuthService
      .getSession()
      .then((session) => {
        if (!active) return;
        if (!session) {
          router.replace("/login");
          return;
        }
        router.replace(
          session.user.isAdmin
            ? "/admin-users"
            : session.user.activeRole === "provider"
              ? "/dashboard"
              : "/client-home",
        );
      })
      .catch(() => {
        if (active) router.replace("/login");
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <SafeAreaView accessibilityLabel="Abrindo Rotinaê" style={styles.screen}>
      <Text style={styles.logo}>
        rotina<Text style={styles.accent}>ê</Text>
      </Text>
      <ActivityIndicator color={colors.onBrand} size="small" />
      <Text style={styles.label}>Abrindo seu espaço…</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    backgroundColor: colors.brandDark,
  },
  logo: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: 32,
    letterSpacing: -1,
  },
  accent: { color: colors.accent },
  label: {
    color: "#DAD2FF",
    fontFamily: typography.family.medium,
    fontSize: typography.size.body,
  },
});
