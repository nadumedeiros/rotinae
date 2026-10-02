import type { Session, SignInInput, SignUpInput, SignUpResult, SwitchRoleInput, UpdatePasswordInput, UserRole } from './types';

export interface AuthPort {
  signIn(input: SignInInput): Promise<Session>;
  signOut(): Promise<void>;
  getSession(): Promise<Session | null>;
  addRole(role: UserRole): Promise<Session>;
  switchRole(input: SwitchRoleInput): Promise<Session>;
}

/**
 * Porta de cadastro, confirmação de e-mail e recuperação de senha (DEC-067).
 * Contrato separado de `AuthPort` de propósito: `MockAuthAdapter` e
 * `SupabaseAuthAdapter` já implementam `AuthPort` hoje e não precisam mudar
 * só porque este contrato foi definido. Segue o mesmo padrão de porta
 * decoupled já usado por `OAuthPort` neste domínio.
 *
 * Nenhum método aqui devolve token manual de confirmação/recuperação: o
 * adaptador real deve seguir o fluxo nativo do Supabase Auth (link ->
 * sessão temporária detectada pelo SDK -> `updateUser`), sem inventar um
 * fluxo próprio. Ver docs/HANDOFF_CADASTRO_RECUPERACAO_CRIS.md.
 */
export interface AuthRegistrationPort {
  /** Nunca devolve sessão operacional; ver `SignUpResult`. */
  signUp(input: SignUpInput): Promise<SignUpResult>;
  /** Resposta neutra (DEC-055): sempre resolve, independentemente de o e-mail existir ou já estar confirmado. */
  resendConfirmationEmail(email: string): Promise<void>;
  /** Resposta neutra (DEC-055): sempre resolve, independentemente de o e-mail existir. */
  requestPasswordReset(email: string): Promise<void>;
  /** Requer sessão de recuperação já ativa (aberta pelo link); lança `SESSION_EXPIRED` na ausência dela. */
  updatePassword(input: UpdatePasswordInput): Promise<void>;
}
