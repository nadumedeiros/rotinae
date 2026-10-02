import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/src/components/auth-layout';
import { Button } from '@/src/components/ui/button';
import { TextField } from '@/src/components/ui/text-field';
import { AuthError, type UserRole } from '@/src/domain/auth/types';
import { supabaseAuthService as authService } from '@/src/infra/auth/supabase-auth-adapter';
import { beginGoogleOAuth } from '@/src/infra/auth/google-oauth-service';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

export default function LoginScreen() {
  const params = useLocalSearchParams<{ role?: UserRole }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [credentialsRejected, setCredentialsRejected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    let active = true;
    authService.getSession().then((session) => {
      if (!active || !session) return;
      router.replace(session.user.isAdmin ? '/admin-users' : session.user.activeRole === 'provider' ? '/dashboard' : '/client-home');
    });
    return () => { active = false; };
  }, []);

  async function submit() {
    setError('');
    setCredentialsRejected(false);
    const nextFieldErrors: { email?: string; password?: string } = {};
    if (!email.trim()) nextFieldErrors.email = 'Informe seu e-mail.';
    if (!password) nextFieldErrors.password = 'Informe sua senha.';
    if (nextFieldErrors.email || nextFieldErrors.password) {
      setFieldErrors(nextFieldErrors);
      return;
    }
    setFieldErrors({});
    setLoading(true);
    try {
      await authService.signIn({ email: email.trim(), password, selectedRole: params.role });
      const session = await authService.getSession();
      router.replace(session?.user.isAdmin ? '/admin-users' : session?.user.activeRole === 'provider' ? '/dashboard' : '/client-home');
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : 'Não foi possível entrar agora. Tente novamente.');
      setCredentialsRejected(true);
    } finally {
      setLoading(false);
    }
  }

  async function continueWithGoogle() {
    setError('');
    setGoogleLoading(true);
    try {
      const result = await beginGoogleOAuth();
      if (result === 'completed') router.replace('/auth/callback');
    } catch (caught) {
      setError(caught instanceof Error && caught.message === 'GOOGLE_AUTH_CANCELLED' ? 'A entrada com Google foi cancelada.' : 'Não foi possível entrar com Google agora. Tente novamente.');
      setGoogleLoading(false);
    }
  }

  return (
    <AuthLayout eyebrow="Bem-vindo ao Rotinaê" title="Organize seus atendimentos com leveza." description="Acesse sua rotina como prestador ou cliente com a mesma experiência no computador, tablet e celular.">
      <View style={styles.header}><Text style={styles.heading}>Acesse sua conta</Text><Text style={styles.text}>Informe seus dados para continuar.</Text></View>
      <View style={styles.googleSection}>
        <Text style={styles.methodLabel}>Entre com</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Continuar com Google" disabled={googleLoading} onPress={continueWithGoogle} style={styles.googleButton}>
          <Image source={require('../assets/images/google-g-logo.png')} contentFit="contain" style={styles.googleLogo} />
          <Text style={styles.googleButtonText}>{googleLoading ? 'Abrindo Google…' : 'Continuar com Google'}</Text>
        </Pressable>
        <View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>ou</Text><View style={styles.dividerLine} /></View>
      </View>
      <View style={styles.form}>
        <TextField label="E-mail" icon="email" value={email} onChangeText={(value) => { setEmail(value); setFieldErrors((current) => ({ ...current, email: undefined })); setCredentialsRejected(false); }} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="voce@exemplo.com" error={fieldErrors.email} invalid={credentialsRejected} />
        <TextField label="Senha" icon="lock" value={password} onChangeText={(value) => { setPassword(value); setFieldErrors((current) => ({ ...current, password: undefined })); setCredentialsRejected(false); }} secureTextEntry autoComplete="password" placeholder="Mínimo de 6 caracteres" error={fieldErrors.password} invalid={credentialsRejected} />
        <Button variant="ghost" onPress={() => router.push(email.trim() ? { pathname: '/forgot-password', params: { email: email.trim() } } : '/forgot-password')}>Esqueci minha senha</Button>
        {error && <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text></View>}
        <Button disabled={loading} icon="forward" onPress={submit}>{loading ? 'Entrando…' : 'Entrar'}</Button>
        {loading && <ActivityIndicator accessibilityLabel="Autenticando" color={colors.brand} />}
      </View>
      <Button variant="secondary" onPress={() => router.push('/select-profile')}>Criar uma conta</Button>
      <Button variant="ghost" onPress={() => router.replace('/')}>Voltar para o site</Button>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  heading: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title, lineHeight: typography.lineHeight.title },
  text: { color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.bodyLarge, lineHeight: typography.lineHeight.bodyLarge },
  form: { gap: spacing.md }, error: { padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.dangerSoft }, errorText: { color: colors.danger, fontFamily: typography.family.medium, lineHeight: typography.lineHeight.body },
  googleSection: { marginTop: spacing.sm, gap: spacing.md }, methodLabel: { color: colors.ink, fontFamily: typography.family.semibold, fontSize: typography.size.body }, divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, dividerLine: { flex: 1, height: 1, backgroundColor: colors.border }, dividerText: { color: colors.mutedSoft, fontFamily: typography.family.regular, fontSize: typography.size.caption }, googleButton: { minHeight: 48, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: '#747775', borderRadius: radius.sm, backgroundColor: '#FFFFFF' }, googleLogo: { width: 20, height: 20 }, googleButtonText: { color: '#1F1F1F', fontFamily: typography.family.semibold, fontSize: 14, lineHeight: 20 },
  modalBackdrop: { flex: 1, padding: spacing.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay },
  modalCard: { width: '100%', maxWidth: 440, padding: spacing.lg, gap: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  modalTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title },
  modalText: { color: colors.muted, fontFamily: typography.family.regular },
  roleRow: { flexDirection: 'row', gap: spacing.sm },
  roleOption: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  roleOptionSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  roleText: { color: colors.ink, fontFamily: typography.family.bold },
  consent: { padding: spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  checkbox: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.borderStrong, borderRadius: radius.xs },
  checkboxChecked: { borderColor: colors.brand, backgroundColor: colors.brand },
  checkmark: { color: colors.onBrand, fontFamily: typography.family.bold },
  consentText: { flex: 1, color: colors.muted, fontFamily: typography.family.regular, lineHeight: typography.lineHeight.body },
});
