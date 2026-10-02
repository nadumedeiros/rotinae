import { router, useLocalSearchParams } from 'expo-router';

import { AuthFeedback } from '@/src/components/auth-feedback';
import { AuthLayout } from '@/src/components/auth-layout';
import { Button } from '@/src/components/ui/button';

const states = {
  'email-confirmed': { tone: 'success' as const, title: 'E-mail confirmado!', description: 'Sua conta foi validada e já está pronta para o primeiro acesso.', action: 'Ir para o login' },
  'password-updated': { tone: 'success' as const, title: 'Senha alterada!', description: 'Sua nova senha foi salva. Agora você já pode entrar com segurança.', action: 'Entrar com a nova senha' },
  'password-reset-requested': { tone: 'info' as const, title: 'Verifique seu e-mail', description: 'Se este e-mail estiver cadastrado, você vai receber um link para criar uma nova senha em poucos minutos.', action: 'Voltar ao login' },
  'link-expired': { tone: 'warning' as const, title: 'Este link expirou', description: 'Por segurança, os links possuem validade limitada. Solicite um novo para continuar.', action: 'Solicitar novo link' },
  error: { tone: 'error' as const, title: 'Não foi possível concluir', description: 'Ocorreu um problema inesperado. Tente novamente em alguns instantes.', action: 'Tentar novamente' },
  'google-pending': { tone: 'info' as const, title: 'Google em preparação', description: 'A interface está pronta. A autenticação será ativada quando as credenciais e o callback seguro do servidor forem configurados.', action: 'Voltar ao login' },
  'google-cancelled': { tone: 'warning' as const, title: 'Acesso cancelado', description: 'Nenhuma conta foi criada ou vinculada. Você pode tentar novamente quando quiser.', action: 'Voltar ao login' },
  'google-callback-error': { tone: 'error' as const, title: 'Não foi possível entrar com Google', description: 'A resposta de autenticação não pôde ser validada. Feche esta mensagem e inicie uma nova tentativa.', action: 'Tentar novamente' },
  'google-account-conflict': { tone: 'warning' as const, title: 'Este e-mail já possui uma conta', description: 'Entre com sua senha atual e confirme a vinculação com Google para evitar uma conta duplicada.', action: 'Entrar com e-mail' },
  'session-expired': { tone: 'warning' as const, title: 'Sua sessão expirou', description: 'Entre novamente para proteger seus dados e continuar de onde parou.', action: 'Entrar novamente' },
  'consent-required': { tone: 'warning' as const, title: 'Aceite necessário', description: 'Leia e aceite os documentos obrigatórios antes de criar sua conta.', action: 'Voltar ao cadastro' },
  'email-delivery-failed': { tone: 'error' as const, title: 'E-mail não enviado', description: 'O cadastro foi preservado, mas o convite não foi entregue. Você poderá solicitar um novo envio.', action: 'Voltar ao login' },
};

export default function FeedbackScreen() {
  const { state = 'email-confirmed' } = useLocalSearchParams<{ state?: keyof typeof states }>();
  const content = states[state] ?? states.error;
  return <AuthLayout eyebrow="Status da solicitação" title="Acompanhe seu acesso." description="Você sempre receberá um retorno claro sobre as ações importantes da sua conta."><AuthFeedback tone={content.tone} title={content.title} description={content.description} /><Button icon="forward" onPress={() => state === 'consent-required' ? router.replace('/create-account') : router.replace('/')}>{content.action}</Button></AuthLayout>;
}
