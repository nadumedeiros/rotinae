import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { AppIcon } from "@/src/components/ui/app-icon";
import { subscriptionService } from "@/src/infra/subscriptions/supabase-subscription-adapter";
import { colors, elevation, radius, spacing, typography } from "@/src/theme/tokens";

type ReturnState = "processing" | "success" | "failed";

export default function SubscriptionReturnScreen() {
  const [state, setState] = useState<ReturnState>("processing");

  useEffect(() => {
    let active = true;
    let attempts = 0;
    const check = async () => {
      try {
        const entitlement = await subscriptionService.getEntitlement();
        if (!active) return;
        if (entitlement.plan === "premium") {
          setState("success");
          return;
        }
      } catch {
        // O webhook pode chegar alguns segundos depois do redirecionamento.
      }
      attempts += 1;
      if (attempts >= 10) {
        if (active) setState("failed");
        return;
      }
      if (active) setTimeout(check, 2_000);
    };
    void check();
    return () => { active = false; };
  }, []);

  const content = {
    processing: {
      icon: "schedule" as const,
      color: colors.brand,
      title: "Confirmando sua assinatura",
      text: "Estamos aguardando a confirmação segura do pagamento. Não feche esta página.",
    },
    success: {
      icon: "success" as const,
      color: colors.success,
      title: "Premium confirmado",
      text: "Sua assinatura foi confirmada e os recursos Premium já estão disponíveis.",
    },
    failed: {
      icon: "error" as const,
      color: colors.warning,
      title: "Confirmação ainda pendente",
      text: "Ainda não recebemos a confirmação do Mercado Pago. Nenhum acesso foi liberado sem a validação do backend.",
    },
  }[state];

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      <View style={styles.content}>
        <View style={styles.card}>
          <View style={[styles.icon, { backgroundColor: `${content.color}18` }]}>
            <AppIcon name={content.icon} size={40} color={content.color} />
          </View>
          <Text accessibilityRole="header" style={styles.title}>{content.title}</Text>
          <Text style={styles.text}>{content.text}</Text>
          {state === "processing" && <Text style={styles.helper}>A liberação depende da confirmação recebida pelo backend.</Text>}
          {state === "success" && <View style={styles.actions}>
            <Pressable onPress={() => router.replace("/plans")} style={styles.primary}><Text style={styles.primaryText}>Ver meu plano</Text></Pressable>
            <Pressable onPress={() => router.replace("/dashboard")} style={styles.secondary}><Text style={styles.secondaryText}>Ir para o início</Text></Pressable>
          </View>}
          {state === "failed" && <View style={styles.actions}>
            <Pressable onPress={() => router.replace("/plans")} style={styles.primary}><Text style={styles.primaryText}>Tentar novamente</Text></Pressable>
            <Pressable onPress={() => router.replace("/dashboard")} style={styles.secondary}><Text style={styles.secondaryText}>Agora não</Text></Pressable>
          </View>}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { flex: 1, padding: spacing.lg, alignItems: "center", justifyContent: "center" },
  card: { width: "100%", maxWidth: 520, padding: spacing.xl, alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, ...elevation.floating },
  icon: { width: 80, height: 80, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  title: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title, textAlign: "center" },
  text: { color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.bodyLarge, textAlign: "center" },
  helper: { color: colors.mutedSoft, fontFamily: typography.family.regular, fontSize: typography.size.caption, textAlign: "center" },
  actions: { width: "100%", marginTop: spacing.sm, gap: spacing.sm },
  primary: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.brand },
  primaryText: { color: colors.onBrand, fontFamily: typography.family.bold },
  secondary: { minHeight: 48, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  secondaryText: { color: colors.brand, fontFamily: typography.family.semibold },
});
