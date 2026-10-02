import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { AppIcon, type AppIconName } from "@/src/components/ui/app-icon";
import { colors, elevation, radius, spacing, typography } from "@/src/theme/tokens";

type Preview = {
  icon: AppIconName;
  tone: "success" | "warning" | "error";
  title: string;
  description: string;
};

const previews: Preview[] = [
  { icon: "success", tone: "success", title: "Agora você é Premium!", description: "Sua assinatura foi confirmada. Todos os recursos Premium já estão disponíveis." },
  { icon: "success", tone: "success", title: "Cartão atualizado", description: "O novo cartão foi confirmado e será usado nas próximas cobranças." },
  { icon: "error", tone: "error", title: "Não foi possível validar o cartão", description: "Confira os dados informados ou tente outro cartão. Nenhuma cobrança foi realizada." },
  { icon: "warning", tone: "warning", title: "Pagamento não aprovado", description: "Atualize o cartão para evitar a interrupção do Premium. O Mercado Pago poderá realizar novas tentativas." },
  { icon: "warning", tone: "warning", title: "Cancelamento agendado", description: "Não haverá novas cobranças. Seu acesso Premium continua até o fim do período atual." },
  { icon: "success", tone: "success", title: "Assinatura reativada", description: "O cancelamento foi desfeito e sua assinatura Premium continuará normalmente." },
];

const toneColors = {
  success: { foreground: colors.success, background: colors.successSoft },
  warning: { foreground: colors.warning, background: colors.warningSoft },
  error: { foreground: colors.danger, background: colors.dangerSoft },
};

export default function SubscriptionNotificationsScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
            <AppIcon name="back" size={18} color={colors.brand} />
            <Text style={styles.backText}>Voltar</Text>
          </Pressable>
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>PRÉVIA DE ESTADOS</Text>
            <Text accessibilityRole="header" style={styles.title}>Mensagens da assinatura</Text>
            <Text style={styles.description}>Prévia visual das mensagens exibidas durante o ciclo do plano Premium.</Text>
          </View>
          <View style={styles.list}>
            {previews.map((item) => {
              const tone = toneColors[item.tone];
              return (
                <View accessibilityRole="alert" key={item.title} style={styles.card}>
                  <View style={[styles.icon, { backgroundColor: tone.background }]}>
                    <AppIcon name={item.icon} size={24} color={tone.foreground} />
                  </View>
                  <View style={styles.copy}>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Text style={styles.cardText}>{item.description}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flexGrow: 1 },
  content: { width: "100%", maxWidth: 800, alignSelf: "center", padding: spacing.lg, gap: spacing.lg },
  back: { minHeight: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: spacing.xs },
  backText: { color: colors.brand, fontFamily: typography.family.semibold },
  heading: { gap: spacing.xs },
  eyebrow: { color: colors.brand, fontFamily: typography.family.bold, fontSize: typography.size.caption, letterSpacing: 1.2 },
  title: { color: colors.ink, fontFamily: typography.family.bold, fontSize: 32 },
  description: { color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.bodyLarge },
  list: { gap: spacing.md },
  card: { padding: spacing.lg, flexDirection: "row", alignItems: "flex-start", gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, ...elevation.card },
  icon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  copy: { flex: 1, gap: spacing.xs },
  cardTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.subtitle },
  cardText: { color: colors.muted, fontFamily: typography.family.regular, lineHeight: 22 },
});
