import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { PageLoadingOverlay } from "@/src/components/ui/page-loading-overlay";
import { AppIcon, type AppIconName } from "@/src/components/ui/app-icon";
import { AuthError, type Session, type UserRole } from "@/src/domain/auth/types";
import { supabaseAuthService as authService } from "@/src/infra/auth/supabase-auth-adapter";
import { colors, elevation, opacity, radius, spacing, typography } from "@/src/theme/tokens";

const options: { role: UserRole; title: string; description: string; icon: AppIconName }[] = [
  { role: "provider", title: "Prestador", description: "Agenda, clientes, serviços e financeiro.", icon: "provider" },
  { role: "client", title: "Cliente", description: "Seus prestadores e próximos atendimentos.", icon: "user" },
];

function destination(role: UserRole) {
  return role === "provider" ? "/dashboard" : "/client-home";
}

export default function SwitchProfileScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingRole, setWorkingRole] = useState<UserRole | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    authService.getSession().then((current) => {
      if (!active) return;
      if (!current) router.replace("/login");
      else setSession(current);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function selectRole(role: UserRole) {
    if (!session || workingRole) return;
    if (role === session.user.activeRole) {
      router.replace(destination(role));
      return;
    }
    setError("");
    setWorkingRole(role);
    try {
      if (!session.user.roles.includes(role)) await authService.addRole(role);
      const next = await authService.switchRole({ role });
      setSession(next);
      router.replace(destination(role));
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : "Não foi possível alterar o perfil agora.");
    } finally {
      setWorkingRole(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      {loading && <PageLoadingOverlay />}
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>CONTA E PERFIS</Text>
          <Text style={styles.title}>Como você quer usar o Rotinaê?</Text>
          <Text style={styles.description}>Alterne entre seus perfis ou crie o perfil que ainda falta, sem sair da conta.</Text>
          {loading ? <ActivityIndicator accessibilityLabel="Carregando perfis" color={colors.brand} /> : (
            <View style={styles.options}>
              {options.map((option) => {
                const exists = session?.user.roles.includes(option.role) ?? false;
                const active = session?.user.activeRole === option.role;
                const working = workingRole === option.role;
                return (
                  <Pressable
                    key={option.role}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: workingRole !== null, busy: working }}
                    disabled={workingRole !== null}
                    onPress={() => void selectRole(option.role)}
                    style={({ pressed }) => [
                      styles.option,
                      active && styles.optionActive,
                      pressed && workingRole === null && { opacity: opacity.pressed },
                    ]}
                  >
                    <View style={styles.optionIcon}><AppIcon name={option.icon} size={24} color={colors.brand} /></View>
                    <View style={styles.optionCopy}>
                      <Text style={styles.optionTitle}>{option.title}</Text>
                      <Text style={styles.optionDescription}>{option.description}</Text>
                      <Text style={styles.action}>{working ? "Aguarde…" : active ? "Perfil ativo" : exists ? "Alternar para este perfil" : "Criar este perfil"}</Text>
                    </View>
                    {working ? <ActivityIndicator color={colors.brand} /> : <AppIcon name={active ? "success" : "forward"} size={20} color={colors.brand} />}
                  </Pressable>
                );
              })}
            </View>
          )}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Pressable disabled={workingRole !== null} onPress={() => router.back()} style={styles.secondary}><Text style={styles.secondaryText}>Voltar</Text></Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { flex: 1, padding: spacing.lg, alignItems: "center", justifyContent: "center" },
  card: { width: "100%", maxWidth: 620, padding: spacing.xl, gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, ...elevation.floating },
  eyebrow: { color: colors.brand, fontFamily: typography.family.bold, fontSize: typography.size.caption, letterSpacing: 1.1 },
  title: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title },
  description: { color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.bodyLarge, lineHeight: typography.lineHeight.bodyLarge },
  options: { gap: spacing.sm },
  option: { minHeight: 104, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  optionActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  optionIcon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.brandSoft },
  optionCopy: { flex: 1, gap: spacing.xs },
  optionTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.subtitle },
  optionDescription: { color: colors.muted, fontFamily: typography.family.regular },
  action: { color: colors.brand, fontFamily: typography.family.semibold, fontSize: typography.size.caption },
  error: { padding: spacing.md, color: colors.danger, backgroundColor: colors.dangerSoft, borderRadius: radius.sm, fontFamily: typography.family.medium },
  secondary: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  secondaryText: { color: colors.brand, fontFamily: typography.family.semibold },
});
