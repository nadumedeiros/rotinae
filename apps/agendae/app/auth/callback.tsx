import { router, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { AuthLayout } from "@/src/components/auth-layout";
import { Button } from "@/src/components/ui/button";
import { supabaseAuthService } from "@/src/infra/auth/supabase-auth-adapter";
import { completeAuthSessionFromUrl } from "@/src/infra/auth/auth-url-session";
import { colors, radius, spacing, typography } from "@/src/theme/tokens";

export default function GoogleCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; error?: string }>();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function complete() {
      try {
        if (params.error) throw new Error(params.error);
        const url = typeof globalThis.location !== "undefined"
          ? globalThis.location.href
          : await Linking.getInitialURL();
        if (url) await completeAuthSessionFromUrl(url, "oauth");
        const session = await supabaseAuthService.getSession();
        if (!active) return;
        if (!session) {
          router.replace({ pathname: "/select-profile", params: { oauth: "google" } });
          return;
        }
        router.replace(session.user.isAdmin ? "/admin-users" : session.user.activeRole === "provider" ? "/dashboard" : "/client-home");
      } catch (caught) {
        // O catch antigo descartava o erro real sem logar nada, o que escondeu
        // por bastante tempo o bug abaixo.
        console.error("[auth/callback] falha ao concluir OAuth do Google:", caught);
        if (active) setError("Não foi possível concluir a entrada com Google. Volte e tente novamente.");
      }
    }
    complete();
    // Roda uma única vez: o código PKCE do callback é de uso único.
    // (havia um bug aqui: `Linking.useURL()` resolve de null -> URL de forma
    // assíncrona; incluí-lo nas deps fazia o efeito rodar 2x e a segunda
    // chamada tentava trocar o mesmo código já consumido, exibindo erro
    // mesmo com a sessão já criada pela primeira chamada. No primeiro clique
    // em "Continuar com Google" a tela sempre mostrava "Não foi possível
    // concluir", mesmo com o login tendo funcionado de verdade.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <AuthLayout eyebrow="Autenticação Google" title={error ? "Não foi possível concluir." : "Concluindo seu acesso…"} description="Estamos validando sua conta e preparando seu perfil.">{error ? <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text></View> : <ActivityIndicator accessibilityLabel="Concluindo autenticação" color={colors.brand} />}<Button variant="ghost" onPress={() => router.replace("/login")}>Voltar ao login</Button></AuthLayout>;
}

const styles = StyleSheet.create({ error: { padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.dangerSoft }, errorText: { color: colors.danger, fontFamily: typography.family.medium } });
