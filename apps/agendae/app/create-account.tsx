import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/src/components/auth-layout';
import { Button } from '@/src/components/ui/button';
import { TextField } from '@/src/components/ui/text-field';
import { formatBrazilianPhone, getRegistrationFieldErrors, validateRegistration, type RegistrationFieldErrors } from '@/src/domain/auth/registration-validation';
import { AuthError, type UserRole } from '@/src/domain/auth/types';
import { authRegistrationService } from '@/src/infra/auth/supabase-auth-registration-adapter';
import { completeGoogleRegistration } from '@/src/infra/auth/google-oauth-service';
import { supabase } from '@/src/infra/supabase/client';
import { colors, elevation, radius, spacing, typography } from '@/src/theme/tokens';

const declarations = [
  'As informações fornecidas são verdadeiras, completas e atualizadas.',
  'É responsável pela confidencialidade das credenciais de acesso da sua conta.',
  'Compreende que a plataforma atua como ferramenta de gestão e organização de atendimentos, não sendo responsável pelas relações comerciais, contratuais, financeiras ou profissionais estabelecidas entre clientes e prestadores de serviços.',
  'Concorda que comunicações operacionais, como recuperação de senha, confirmações, alterações, cancelamentos e avisos de funcionamento, poderão ser enviadas independentemente do consentimento de marketing, por serem indispensáveis ao serviço.',
  'Está ciente de que a plataforma poderá alterar funcionalidades, planos, recursos e integrações, respeitando a legislação vigente e os direitos adquiridos.',
];

function ConsentCheck({ checked, invalid, onPress, children }: { checked: boolean; invalid?: boolean; onPress: () => void; children: React.ReactNode }) {
  return <View style={[styles.consent, invalid && styles.consentInvalid]}><Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel="Alterar consentimento" onPress={onPress} style={[styles.checkbox, checked && styles.checkboxChecked, invalid && styles.checkboxInvalid]}>{checked && <Text style={styles.checkmark}>✓</Text>}</Pressable><Text style={styles.consentText}>{children}</Text></View>;
}

export default function CreateAccountScreen() {
  const { role, oauth } = useLocalSearchParams<{ role?: UserRole; oauth?: string }>();
  const googleRegistration = oauth === 'google';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [marketingAccepted, setMarketingAccepted] = useState(false);
  const [legalDocument, setLegalDocument] = useState<'consent' | 'terms' | 'privacy' | null>(null);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<RegistrationFieldErrors>({});
  const [loading, setLoading] = useState(false);
  const roleLabel = role === 'client' ? 'Cliente' : 'Prestador de serviços';

  useEffect(() => {
    if (!googleRegistration) return;
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.replace('/login'); return; }
      setEmail(data.user.email ?? '');
      const googleName = data.user.user_metadata?.full_name ?? data.user.user_metadata?.name;
      if (typeof googleName === 'string') setName(googleName);
    });
  }, [googleRegistration]);

  function clearFieldError(field: keyof RegistrationFieldErrors) {
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function submit() {
    const effectivePassword = googleRegistration ? 'google-oauth' : password;
    const effectiveConfirmation = googleRegistration ? 'google-oauth' : passwordConfirmation;
    const nextFieldErrors = getRegistrationFieldErrors({ name, email, phone, password: effectivePassword, passwordConfirmation: effectiveConfirmation, legalAccepted });
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) { setError(''); return; }
    const validation = validateRegistration({ name, email, phone, password: effectivePassword, passwordConfirmation: effectiveConfirmation, legalAccepted });
    if (!validation.valid) { setError(validation.message); return; }
    setError('');
    setLoading(true);
    try {
      if (googleRegistration) {
        const selectedRole = role === 'client' ? 'client' : 'provider';
        await completeGoogleRegistration(selectedRole, validation.normalized.phone);
        router.replace(selectedRole === 'provider' ? '/dashboard' : '/client-home');
        return;
      }
      const result = await authRegistrationService.signUp({
        ...validation.normalized,
        password,
        role: role === 'client' ? 'client' : 'provider',
        legalAcceptance: {
          consentVersion: '2026-08-04',
          acceptedAt: new Date().toISOString(),
          source: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'web',
        },
        marketingConsent: marketingAccepted,
      });
      router.replace({ pathname: '/confirm-email', params: { email: result.email } });
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : 'Não foi possível criar sua conta agora. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return <>
    <AuthLayout eyebrow={`Novo cadastro · ${roleLabel}`} title="Crie sua conta." description="Informe seus dados, leia o consentimento e confirme as declarações obrigatórias.">
      <View style={styles.form}>
        <TextField label="Nome" icon="user" value={name} onChangeText={(value) => { setName(value); clearFieldError('name'); }} autoCapitalize="words" autoComplete="name" placeholder="Seu nome completo" error={fieldErrors.name} />
        <TextField label="E-mail" icon="email" value={email} editable={!googleRegistration} onChangeText={(value) => { setEmail(value); clearFieldError('email'); }} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="voce@exemplo.com" error={fieldErrors.email} />
        <TextField label="Telefone" icon="user" value={phone} onChangeText={(value) => { setPhone(formatBrazilianPhone(value)); clearFieldError('phone'); }} autoComplete="tel" keyboardType="phone-pad" maxLength={15} placeholder="(11) 99999-9999" error={fieldErrors.phone} />
        {!googleRegistration && <><TextField label="Senha" icon="lock" value={password} onChangeText={(value) => { setPassword(value); clearFieldError('password'); }} secureTextEntry autoComplete="new-password" placeholder="Mínimo de 8 caracteres" error={fieldErrors.password} /><TextField label="Confirmar senha" icon="lock" value={passwordConfirmation} onChangeText={(value) => { setPasswordConfirmation(value); clearFieldError('passwordConfirmation'); }} secureTextEntry autoComplete="new-password" placeholder="Digite a senha novamente" error={fieldErrors.passwordConfirmation} /></>}
        <View style={styles.declarations}>
          <ConsentCheck checked={legalAccepted} invalid={!!fieldErrors.legalAccepted} onPress={() => { setLegalAccepted((value) => !value); setError(''); clearFieldError('legalAccepted'); }}>Li e concordo com os <Text accessibilityRole="link" onPress={() => setLegalDocument('terms')} style={styles.inlineLink}>Termos de Uso</Text> e com a <Text accessibilityRole="link" onPress={() => setLegalDocument('privacy')} style={styles.inlineLink}>Política de Privacidade</Text>. <Text style={styles.required}>(Obrigatório)</Text></ConsentCheck>
          {!!fieldErrors.legalAccepted && <Text accessibilityRole="alert" style={styles.errorText}>{fieldErrors.legalAccepted}</Text>}
          <ConsentCheck checked={marketingAccepted} onPress={() => setMarketingAccepted((value) => !value)}>Desejo receber comunicações promocionais, novidades, pesquisas de satisfação e informações sobre novos recursos. <Text style={styles.optional}>(Opcional)</Text></ConsentCheck>
        </View>
        {error && <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text></View>}
        <Button disabled={loading} icon="forward" onPress={submit}>{loading ? 'Criando conta…' : googleRegistration ? 'Concluir cadastro com Google' : 'Criar conta'}</Button>
        {loading && <ActivityIndicator accessibilityLabel="Criando conta" color={colors.brand} />}
      </View>
      <Button variant="ghost" icon="back" onPress={() => router.back()}>Voltar</Button>
    </AuthLayout>

    <Modal visible={legalDocument !== null} transparent animationType="fade" onRequestClose={() => setLegalDocument(null)}>
      <Pressable style={styles.backdrop} onPress={() => setLegalDocument(null)}><Pressable accessibilityViewIsModal onPress={(event) => event.stopPropagation()} style={styles.modalCard}>
        <View style={styles.modalHeader}><View style={styles.modalHeaderCopy}><Text style={styles.modalEyebrow}>DOCUMENTO LEGAL</Text><Text style={styles.modalTitle}>{legalDocument === 'terms' ? 'Termos de Uso' : legalDocument === 'privacy' ? 'Política de Privacidade' : 'Consentimento para Criação de Conta'}</Text></View><Pressable accessibilityLabel="Fechar documento" onPress={() => setLegalDocument(null)} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable></View>
        <ScrollView style={styles.documentScroll} contentContainerStyle={styles.document} showsVerticalScrollIndicator={true}>
          {legalDocument === 'terms' ? <><Text style={styles.paragraph}>Estes Termos regulam o acesso e o uso do Rotinaê. Ao criar uma conta, você declara possuir capacidade legal, fornecer informações verdadeiras e manter suas credenciais protegidas.</Text><Text style={styles.paragraph}>O Rotinaê oferece ferramentas de organização de clientes, agenda, comunicações operacionais e controle financeiro interno. A plataforma não realiza pagamentos e não integra as relações comerciais, contratuais, financeiras ou profissionais estabelecidas entre clientes e prestadores.</Text><Text style={styles.paragraph}>Para operar autenticação, banco de dados e recursos de segurança, o Rotinaê utiliza serviços tecnológicos do Supabase. A disponibilidade desses recursos também pode depender da infraestrutura e das políticas aplicáveis desse fornecedor, sem afastar as responsabilidades legais do Rotinaê perante seus usuários.</Text><Text style={styles.paragraph}>O usuário deve utilizar o serviço de forma lícita, respeitar direitos de terceiros e não tentar acessar contas, vínculos ou dados sem autorização. Funcionalidades, planos e integrações poderão ser alterados com comunicação adequada e respeito à legislação e aos direitos adquiridos.</Text></> : legalDocument === 'privacy' ? <><Text style={styles.paragraph}>Esta Política explica o tratamento dos dados pessoais necessários ao funcionamento do Rotinaê, incluindo identificação, contato, autenticação, vínculos, agenda, preferências, registros financeiros internos e dados técnicos de segurança.</Text><Text style={styles.paragraph}>Os dados são tratados para prestar as funcionalidades solicitadas, proteger contas, cumprir obrigações legais, prevenir abuso e aprimorar a experiência. O acesso é limitado ao contexto autorizado e os dados não devem ser usados para marketing sem consentimento específico.</Text><Text style={styles.paragraph}>O Rotinaê utiliza o Supabase como fornecedor de infraestrutura para autenticação, armazenamento e processamento de dados. Nesse contexto, dados pessoais podem ser processados nos ambientes contratados desse fornecedor, inclusive fora do Brasil quando aplicável, com adoção das salvaguardas exigidas pela LGPD e limitação às finalidades descritas nesta Política.</Text><Text style={styles.paragraph}>O Supabase atua como fornecedor tecnológico e operador de dados nas atividades realizadas em nome do Rotinaê, observados os contratos, medidas de segurança e políticas aplicáveis. O uso dessa infraestrutura não autoriza o Supabase ou o Rotinaê a utilizar dados pessoais para finalidades incompatíveis com a prestação do serviço.</Text><Text style={styles.paragraph}>Você pode solicitar acesso, correção, informação, revogação de consentimentos opcionais e demais direitos previstos na Lei nº 13.709/2018 — LGPD. Retenção e exclusão respeitarão obrigações legais, segurança e exercício regular de direitos.</Text></> : <><Text style={styles.paragraph}>Ao prosseguir com o cadastro, você declara que possui capacidade legal para contratar, leu integralmente e concorda com os Termos de Uso e a Política de Privacidade da plataforma.</Text><Text style={styles.paragraph}>Você autoriza a coleta, o armazenamento, o tratamento e a utilização dos dados pessoais fornecidos durante o cadastro e ao longo da utilização da plataforma, exclusivamente para viabilizar a prestação dos serviços oferecidos, cumprimento de obrigações legais, aprimoramento da experiência do usuário e execução das funcionalidades contratadas.</Text></>}
          <Text style={styles.documentSubtitle}>Ao utilizar a plataforma, você declara que:</Text>
          {declarations.map((item) => <View key={item} style={styles.bulletRow}><Text style={styles.bullet}>•</Text><Text style={styles.bulletText}>{item}</Text></View>)}
          <Text style={styles.paragraph}>Ao marcar os campos e clicar em Criar conta, você manifesta seu consentimento livre, informado e inequívoco para o tratamento dos dados necessários à utilização da plataforma.</Text>
          <Text style={styles.version}>Versão do consentimento: 04/08/2026</Text>
        </ScrollView>
        <Button onPress={() => setLegalDocument(null)}>Entendi</Button>
      </Pressable></Pressable>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  declarations: { gap: spacing.sm },
  consent: { padding: spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  consentInvalid: { borderColor: colors.danger },
  checkbox: { width: 24, height: 24, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.borderStrong, borderRadius: radius.xs, backgroundColor: colors.surface },
  checkboxChecked: { borderColor: colors.brand, backgroundColor: colors.brand }, checkboxInvalid: { borderColor: colors.danger }, checkmark: { color: colors.onBrand, fontFamily: typography.family.bold, fontSize: 16 },
  consentText: { flex: 1, color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.caption, lineHeight: typography.lineHeight.caption },
  required: { color: colors.danger, fontFamily: typography.family.bold }, optional: { color: colors.brand, fontFamily: typography.family.bold },
  inlineLink: { color: colors.brand, fontFamily: typography.family.bold, textDecorationLine: 'underline' },
  error: { padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.dangerSoft }, errorText: { color: colors.danger, fontFamily: typography.family.medium, lineHeight: typography.lineHeight.body },
  backdrop: { flex: 1, padding: spacing.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay },
  modalCard: { width: '100%', maxWidth: 680, maxHeight: '90%', paddingTop: spacing.xl, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, ...elevation.floating },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, modalHeaderCopy: { flex: 1 },
  modalEyebrow: { color: colors.brand, fontFamily: typography.family.bold, fontSize: typography.size.caption, letterSpacing: 1 },
  modalTitle: { marginTop: spacing.xs, color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surfaceSubtle }, closeText: { color: colors.muted, fontFamily: typography.family.regular, fontSize: 28, lineHeight: 30 },
  documentScroll: { flex: 1 },
  document: { gap: spacing.md, paddingRight: spacing.xs }, paragraph: { color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.body, lineHeight: typography.lineHeight.body },
  documentSubtitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.bodyLarge }, bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, bullet: { color: colors.brand, fontFamily: typography.family.bold, fontSize: typography.size.body }, bulletText: { flex: 1, color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.body, lineHeight: typography.lineHeight.body }, version: { color: colors.mutedSoft, fontFamily: typography.family.medium, fontSize: typography.size.caption },
});
