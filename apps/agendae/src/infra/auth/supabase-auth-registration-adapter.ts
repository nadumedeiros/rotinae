import type { AuthRegistrationPort } from "@/src/domain/auth/auth-port";
import type { SignUpInput, SignUpResult, UpdatePasswordInput } from "@/src/domain/auth/types";
import { authRedirectUrl } from "@/src/infra/auth/auth-url-session";
import { supabase } from "@/src/infra/supabase/client";
import {
  mapNeutralSupabaseAuthError,
  mapSupabaseAuthError,
  type SupabaseAuthErrorLike,
} from "@/src/infra/auth/supabase-auth-adapter";

// Implementação real de `AuthRegistrationPort` (DEC-067/068). Roteiro completo
// em docs/HANDOFF_CADASTRO_RECUPERACAO_CRIS.md, seções 3 e 8. Resumo das
// decisões que este arquivo respeita sem reabrir:
//
// - `signUp` nunca devolve `Session` (DEC-055/056): a confirmação de e-mail é
//   sempre obrigatória antes de qualquer sessão operacional.
// - Nenhum método aqui recebe token manual de confirmação/recuperação: o
//   link do e-mail abre uma sessão temporária detectada pelo próprio SDK
//   (`detectSessionInUrl` na web, deep link no nativo); `updatePassword` só
//   consome essa sessão via `supabase.auth.updateUser`.
// - `profiles`/`legal_acknowledgements`/`consent_events` são criados pelo
//   trigger `handle_new_user()` (`supabase/migrations/20260806101400_signup_registration_trigger.sql`),
//   não por este adapter: no momento do `signUp`, sem confirmação, não existe
//   `auth.uid()` para satisfazer as policies `..._insert_self` dessas
//   tabelas. Este arquivo só precisa alimentar `options.data` com os campos
//   que o trigger consome via `raw_user_meta_data`.
//
// PENDÊNCIA DOCUMENTADA (fora do escopo desta entrega, ver seção 8, item 6 do
// handoff): `emailRedirectTo`/`redirectTo` abaixo usam um placeholder de
// domínio que NUNCA deve chegar a produção. A rota real de retorno (web e
// deep link nativo) depende de infraestrutura de deploy ainda não definida —
// registrar com Dante/infra antes de qualquer teste com usuários reais.
/**
 * GoTrue, com confirmação de e-mail obrigatória e proteção contra enumeração
 * de contas ativa (padrão do projeto desde a criação, ver DEC-055), tende a
 * devolver sucesso aparente para um `signUp` repetido de e-mail já
 * cadastrado — mas dependendo da configuração/versão pode devolver o erro
 * `user_already_exists` (ou a mensagem legada "User already registered").
 * Regra 4 do handoff: em nenhum dos dois casos o adapter pode expor essa
 * diferença ao chamador. Esta função identifica esse sinal específico para
 * tratá-lo como sucesso, e não como erro.
 */
function isAccountAlreadyExistsSignal(error: SupabaseAuthErrorLike): boolean {
  const message = error.message.toLowerCase();
  return (
    error.code === "user_already_exists" ||
    message.includes("already registered") ||
    message.includes("already exists")
  );
}

export class SupabaseAuthRegistrationAdapter implements AuthRegistrationPort {
  async signUp(input: SignUpInput): Promise<SignUpResult> {
    const { name, email, phone, password, role, legalAcceptance, marketingConsent } = input;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Nenhum dado sensível fora de email/password no nível raiz (seção 3
        // da tabela do handoff). `role` viaja aqui porque é a escolha inicial
        // capturada nesta etapa como perfil inicial; o segundo perfil é
        // provisionado posteriormente pela porta AuthPort.addRole.
        data: {
          name,
          phone,
          role,
          consentVersion: legalAcceptance.consentVersion,
          marketingConsent,
          source: legalAcceptance.source,
        },
        emailRedirectTo: authRedirectUrl("confirm-email"),
      },
    });

    if (error) {
      if (isAccountAlreadyExistsSignal(error)) {
        // Anti-enumeração (regra 4 do handoff): mesmo destino visual de um
        // cadastro novo, sem revelar que a conta já existia.
        return { email, emailConfirmationRequired: true };
      }
      throw mapSupabaseAuthError(error);
    }

    return { email, emailConfirmationRequired: true };
  }

  async resendConfirmationEmail(email: string): Promise<void> {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: authRedirectUrl("confirm-email") },
    });
    if (error) {
      // Regra 3 do handoff: sempre neutro — só RATE_LIMITED/NETWORK_ERROR/UNKNOWN.
      throw mapNeutralSupabaseAuthError(error);
    }
  }

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: authRedirectUrl("change-password"),
    });
    if (error) {
      // Regra 3 do handoff: sempre neutro, para e-mail existente ou não.
      throw mapNeutralSupabaseAuthError(error);
    }
  }

  async updatePassword({ newPassword }: UpdatePasswordInput): Promise<void> {
    // Depende inteiramente da sessão de recuperação já aberta pelo clique no
    // link (regra 6 do handoff); nenhum token é recebido aqui. Ausência de
    // sessão faz o próprio SDK lançar `AuthSessionMissingError`, mapeado para
    // `SESSION_EXPIRED` por `mapSupabaseAuthError`.
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      throw mapSupabaseAuthError(error);
    }
  }
}

export const authRegistrationService: AuthRegistrationPort = new SupabaseAuthRegistrationAdapter();
