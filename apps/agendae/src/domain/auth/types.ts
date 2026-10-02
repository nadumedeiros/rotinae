export type UserRole = 'provider' | 'client';

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  roles: UserRole[];
  activeRole: UserRole;
  displayName: string;
  isAdmin?: boolean;
};

export type Session = {
  accessToken: string;
  expiresAt: string;
  user: AuthUser;
};

export type SignInInput = { email: string; password: string; selectedRole?: UserRole };

export type SwitchRoleInput = { role: UserRole };

export type RequiredLegalConsent = {
  userId: string;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string;
  ipHash?: string;
  userAgent?: string;
  source: 'web' | 'android' | 'ios';
};

// --- Cadastro, confirmação de e-mail e recuperação de senha (DEC-067) ---
// Ver AuthRegistrationPort em './auth-port' e
// docs/HANDOFF_CADASTRO_RECUPERACAO_CRIS.md para o roteiro de implementação.

/**
 * Aceite exibido em `create-account.tsx`: Termos de Uso, Política de
 * Privacidade e as declarações de uso são apresentados juntos, sob uma única
 * versão. `consentVersion` deve corresponder à `version` publicada em
 * `legal_documents` para as duas linhas `kind` ('terms' e 'privacy_policy')
 * vigentes no momento do aceite — as duas precisam ser publicadas com o
 * mesmo valor de `version` enquanto a tela apresentar um único aceite
 * combinado. `RequiredLegalConsent` (acima) modela o registro já persistido
 * no servidor (um por documento); este tipo é apenas o aceite enviado pela
 * tela no momento do cadastro.
 */
export type SignUpLegalAcceptance = {
  consentVersion: string;
  /** ISO 8601 em UTC, capturado no clique do botão "Criar conta". */
  acceptedAt: string;
  source: 'web' | 'android' | 'ios';
};

export type SignUpInput = {
  name: string;
  email: string;
  /** E.164 (ex.: +5511999999999), já normalizado por registration-validation.ts. */
  phone: string;
  password: string;
  /** Perfil inicial; a mesma conta pode adicionar o segundo perfil depois. */
  role: UserRole;
  legalAcceptance: SignUpLegalAcceptance;
  /** Sempre um booleano explícito (checkbox opcional do cadastro); nunca omitido. */
  marketingConsent: boolean;
};

/**
 * `signUp` nunca devolve uma `Session` operacional (DEC-055/056): toda conta
 * nova exige confirmação de e-mail antes da ativação. `emailConfirmationRequired`
 * é sempre `true` nesta etapa; o campo existe para deixar essa regra explícita
 * no tipo, e não apenas em comentário.
 */
export type SignUpResult = {
  email: string;
  emailConfirmationRequired: true;
};

/**
 * Efetiva a troca de senha depois que o link de recuperação abriu uma sessão
 * temporária no cliente (fluxo nativo do Supabase Auth). Não recebe token:
 * o adaptador real chama `supabase.auth.updateUser({ password })` usando a
 * sessão de recuperação já ativa; ausência dessa sessão é `SESSION_EXPIRED`.
 */
export type UpdatePasswordInput = {
  newPassword: string;
};

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'RATE_LIMITED'
  | 'SESSION_EXPIRED'
  | 'ROLE_NOT_AVAILABLE'
  | 'NETWORK_ERROR'
  | 'UNKNOWN'
  // Cadastro, confirmação de e-mail e recuperação de senha (DEC-067):
  | 'AUTH_EMAIL_NOT_CONFIRMED'
  | 'AUTH_LINK_INVALID'
  | 'AUTH_WEAK_PASSWORD'
  | 'AUTH_PASSWORD_REUSED';

export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
