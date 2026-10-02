import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';

import { AuthLayout } from '@/src/components/auth-layout';
import { Button } from '@/src/components/ui/button';
import { TextField } from '@/src/components/ui/text-field';
import { AuthError } from '@/src/domain/auth/types';
import { supabaseAuthService as authService } from '@/src/infra/auth/supabase-auth-adapter';
import { authRegistrationService } from '@/src/infra/auth/supabase-auth-registration-adapter';
import { completeAuthSessionFromUrl } from '@/src/infra/auth/auth-url-session';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

function goToExpiredLink() {
  router.replace({ pathname: '/feedback', params: { state: 'link-expired' } });
}

export default function ChangePasswordScreen() {
  const linkingUrl = Linking.useURL();
  const [status, setStatus] = useState<'checking' | 'ready'>('checking');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirmation?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function prepareRecoverySession() {
      try {
        const initialUrl = typeof globalThis.location !== 'undefined'
          ? globalThis.location.href
          : linkingUrl ?? await Linking.getInitialURL();
        if (!initialUrl) throw new Error('AUTH_CALLBACK_CODE_MISSING');
        const session = await completeAuthSessionFromUrl(initialUrl, 'recovery');
        if (!active) return;
        if (session) setStatus('ready');
        else goToExpiredLink();
      } catch {
        if (active) goToExpiredLink();
      }
    }
    void prepareRecoverySession();
    return () => { active = false; };
  }, [linkingUrl]);

  async function submit() {
    const nextFieldErrors: { password?: string; confirmation?: string } = {};
    if (password.length < 8) nextFieldErrors.password = 'Use pelo menos 8 caracteres.';
    if (!confirmation || password !== confirmation) nextFieldErrors.confirmation = 'As senhas não coincidem.';
    setFieldErrors(nextFieldErrors);
    if (nextFieldErrors.password || nextFieldErrors.confirmation) { setError(''); return; }
    setError('');
    setSaving(true);
    try {
      await authRegistrationService.updatePassword({ newPassword: password });
      await authService.signOut();
      router.replace({ pathname: '/feedback', params: { state: 'password-updated' } });
    } catch (caught) {
      if (caught instanceof AuthError && caught.code === 'SESSION_EXPIRED') {
        goToExpiredLink();
        return;
      }
      setError(caught instanceof AuthError ? caught.message : 'Não foi possível concluir agora. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  if (status === 'checking') {
    return (
      <AuthLayout eyebrow="Recuperação de acesso" title="Crie uma nova senha." description="Escolha uma senha segura e diferente das utilizadas anteriormente.">
        <View style={styles.checking}>
          <ActivityIndicator accessibilityLabel="Verificando seu link de recuperação" color={colors.brand} />
          <Text style={styles.checkingText}>Verificando seu link de recuperação…</Text>
        </View>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout eyebrow="Recuperação de acesso" title="Crie uma nova senha." description="Escolha uma senha segura e diferente das utilizadas anteriormente.">
      <View style={styles.form}>
        <TextField label="Nova senha" icon="lock" value={password} onChangeText={(value) => { setPassword(value); setFieldErrors((current) => ({ ...current, password: undefined })); }} secureTextEntry autoComplete="new-password" placeholder="Mínimo de 8 caracteres" error={fieldErrors.password} />
        <TextField label="Confirmar nova senha" icon="lock" value={confirmation} onChangeText={(value) => { setConfirmation(value); setFieldErrors((current) => ({ ...current, confirmation: undefined })); }} secureTextEntry autoComplete="new-password" placeholder="Digite novamente" error={fieldErrors.confirmation} />
        {error && <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text></View>}
        <Button disabled={saving} icon="success" onPress={submit}>{saving ? 'Salvando…' : 'Salvar nova senha'}</Button>
        {saving && <ActivityIndicator accessibilityLabel="Salvando nova senha" color={colors.brand} />}
      </View>
      <Button variant="ghost" icon="back" onPress={() => router.replace('/')}>Cancelar e voltar</Button>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  error: { padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.dangerSoft },
  errorText: { color: colors.danger, fontFamily: typography.family.medium, lineHeight: typography.lineHeight.body },
  checking: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  checkingText: { color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.body, textAlign: 'center' },
});
