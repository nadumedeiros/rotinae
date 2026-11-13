import { supabaseAuthService } from "@/src/infra/auth/supabase-auth-adapter";
import { pushRegistrationService } from "@/src/infra/notifications/push-registration";
import { limparDadosLocais } from "@/src/infra/storage/limpar-dados-locais";

// Único caminho para sair da conta: pelo menu, por inatividade ou depois de
// trocar a senha. Assim nenhuma saída esquece algum passo.
export async function sairDaConta(): Promise<void> {
  // 1. Desliga as notificações push deste celular. Precisa vir antes do
  //    signOut, porque o servidor só aceita o pedido de quem está logado.
  await pushRegistrationService.unregisterCurrentDevice().catch(() => undefined);

  try {
    // 2. Sai da conta no Supabase (ele apaga o token de login do SecureStore).
    await supabaseAuthService.signOut();
  } finally {
    // 3. Limpa o resto, mesmo se o passo 2 falhar (ex.: sem internet).
    await limparDadosLocais();
  }
}