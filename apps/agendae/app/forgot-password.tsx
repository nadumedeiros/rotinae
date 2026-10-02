import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/src/components/auth-layout';
import { Button } from '@/src/components/ui/button';
import { TextField } from '@/src/components/ui/text-field';
import { AuthError } from '@/src/domain/auth/types';
import { authRegistrationService } from '@/src/infra/auth/supabase-auth-registration-adapter';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError('');
    const trimmed = email.trim();
    if (!trimmed) {
      setFieldError('Informe seu e-mail.');
      return;
    }
    if (!EMAIL_PATTERN.test(trimmed)) {
      setFieldError('Informe um e-mail válido.');
      return;
    }
    setFieldError('');
    setLoading(true);
    try {
      await authRegistrationService.requestPasswordReset(trimmed);
      router.replace({ pathname: '/feedback', params: { state: 'password-reset-requested' } });
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : 'Não foi possível concluir agora. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout eyebrow="Recuperação de acesso" title="Vamos recuperar seu acesso." description="Informe o e-mail da sua conta. Se ele estiver cadastrado, você vai receber um link para criar uma nova senha.">
      <View style={styles.form}>
        <TextField label="E-mail" icon="email" value={email} onChangeText={(value) => { setEmail(value); setFieldError(''); }} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="voce@exemplo.com" error={fieldError} />
        {error && <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text></View>}
        <Button disabled={loading} icon="forward" onPress={submit}>{loading ? 'Enviando…' : 'Enviar link de recuperação'}</Button>
        {loading && <ActivityIndicator accessibilityLabel="Enviando link de recuperação" color={colors.brand} />}
      </View>
      <Button variant="ghost" icon="back" onPress={() => router.replace('/')}>Cancelar e voltar</Button>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  error: { padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.dangerSoft },
  errorText: { color: colors.danger, fontFamily: typography.family.medium, lineHeight: typography.lineHeight.body },
});
