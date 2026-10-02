import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AuthFeedback } from '@/src/components/auth-feedback';
import { AuthLayout } from '@/src/components/auth-layout';
import { Button } from '@/src/components/ui/button';
import { AuthError } from '@/src/domain/auth/types';
import { authRegistrationService } from '@/src/infra/auth/supabase-auth-registration-adapter';
import { completeAuthSessionFromUrl, parseAuthCallbackUrl } from '@/src/infra/auth/auth-url-session';
import { supabaseAuthService } from '@/src/infra/auth/supabase-auth-adapter';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

export default function ConfirmEmailScreen() {
  const { email = 'seu e-mail' } = useLocalSearchParams<{ email?: string }>();
  const linkingUrl = Linking.useURL();
  const [resent, setResent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function confirmFromCallback() {
      const url = typeof globalThis.location !== 'undefined'
        ? globalThis.location.href
        : linkingUrl ?? await Linking.getInitialURL();
      if (!url) return;
      const callback = parseAuthCallbackUrl(url);
      if (!callback.code && !callback.accessToken && !callback.error) return;
      try {
        const session = await completeAuthSessionFromUrl(url, 'signup');
        if (!active || !session) return;
        await supabaseAuthService.signOut();
        router.replace({ pathname: '/feedback', params: { state: 'email-confirmed' } });
      } catch {
        if (active) router.replace({ pathname: '/feedback', params: { state: 'link-expired' } });
      }
    }
    void confirmFromCallback();
    return () => { active = false; };
  }, [linkingUrl]);

  async function resend() {
    setError('');
    setLoading(true);
    try {
      await authRegistrationService.resendConfirmationEmail(email);
      setResent(true);
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : 'Não foi possível reenviar agora. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return <AuthLayout eyebrow="Verificação de segurança" title="Só falta confirmar seu e-mail." description="Essa etapa protege sua conta e garante que somente você possa ativar o acesso."><AuthFeedback tone={resent ? 'success' : 'info'} title={resent ? 'E-mail reenviado' : 'Confira sua caixa de entrada'} description={resent ? `Enviamos uma nova mensagem para ${email}.` : `Enviamos um link de confirmação para ${email}.`} />{error && <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text></View>}<Button disabled={loading} icon="email" onPress={resend}>{loading ? 'Reenviando…' : 'Reenviar e-mail'}</Button>{loading && <ActivityIndicator accessibilityLabel="Reenviando confirmação" color={colors.brand} />}<Button variant="ghost" icon="back" onPress={() => router.replace('/')}>Voltar ao login</Button><Text style={styles.helper}>O link terá validade limitada. Verifique também as pastas de spam e promoções.</Text></AuthLayout>;
}

const styles = StyleSheet.create({ error: { padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.dangerSoft }, errorText: { color: colors.danger, fontFamily: typography.family.medium }, helper: { color: colors.muted, textAlign: 'center', fontFamily: typography.family.regular, fontSize: typography.size.caption, lineHeight: typography.lineHeight.caption } });
