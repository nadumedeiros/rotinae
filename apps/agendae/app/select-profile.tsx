import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/src/components/auth-layout';
import { AppIcon, type AppIconName } from '@/src/components/ui/app-icon';
import { Button } from '@/src/components/ui/button';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

const profiles: { role: 'provider' | 'client'; title: string; description: string; icon: AppIconName }[] = [
  { role: 'provider', title: 'Prestador de serviços', description: 'Gerencie agenda, clientes, pacotes e sua operação.', icon: 'provider' },
  { role: 'client', title: 'Cliente', description: 'Organize seus atendimentos e vínculos com prestadores.', icon: 'user' },
];

export default function SelectProfileScreen() {
  const { oauth } = useLocalSearchParams<{ oauth?: string }>();
  return <AuthLayout eyebrow="Novo cadastro" title="Como você quer começar?" description="Escolha seu primeiro perfil. Depois, você poderá criar o outro e alternar entre Cliente e Prestador na mesma conta."><View style={styles.list}>{profiles.map((profile) => <Pressable key={profile.role} accessibilityRole="button" onPress={() => router.push({ pathname: '/create-account', params: { role: profile.role, ...(oauth ? { oauth } : {}) } })} style={({ pressed }) => [styles.profile, pressed && styles.pressed]}><View style={styles.icon}><AppIcon name={profile.icon} size={24} color={colors.brand} /></View><View style={styles.copy}><Text style={styles.title}>{profile.title}</Text><Text style={styles.description}>{profile.description}</Text></View><AppIcon name="forward" size={20} color={colors.brand} /></Pressable>)}</View><Button variant="ghost" icon="back" onPress={() => router.back()}>Voltar</Button><Text style={styles.helper}>{oauth === 'google' ? 'Sua conta Google será vinculada após concluir o cadastro.' : 'A conta será ativada somente após a confirmação do e-mail.'}</Text></AuthLayout>;
}

const styles = StyleSheet.create({
  list: { gap: spacing.md }, profile: { minHeight: 104, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface }, pressed: { opacity: 0.72, borderColor: colors.brand }, icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.brandSoft }, copy: { flex: 1, gap: spacing.xs }, title: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.subtitle }, description: { color: colors.muted, fontFamily: typography.family.regular, lineHeight: typography.lineHeight.body }, helper: { color: colors.muted, textAlign: 'center', fontFamily: typography.family.regular, fontSize: typography.size.caption, lineHeight: typography.lineHeight.caption },
});
