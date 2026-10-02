import type { AuthPort } from "@/src/domain/auth/auth-port";
import {
  AuthError,
  type Session,
  type SignInInput,
  type SwitchRoleInput,
  type UserRole,
} from "@/src/domain/auth/types";
import { supabase } from "@/src/infra/supabase/client";

type SupabaseProfileRow = {
  user_id: string;
  role: UserRole;
  display_name: string;
  status: "active" | "blocked" | "deleted";
  is_admin: boolean;
};

async function loadProfile(userId: string): Promise<{ profile: SupabaseProfileRow; roles: UserRole[] } | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, role, display_name, status, is_admin")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const profile = data as SupabaseProfileRow;
  const { data: memberships, error: rolesError } = await supabase
    .from("profile_roles")
    .select("role")
    .eq("user_id", userId);
  if (rolesError) return null;
  const roles = Array.isArray(memberships)
    ? memberships.map((membership) => membership.role as UserRole)
    : [profile.role];
  return { profile, roles: roles.length ? roles : [profile.role] };
}

function toSession(
  accessToken: string,
  expiresAtSeconds: number | undefined,
  email: string | undefined,
  context: { profile: SupabaseProfileRow; roles: UserRole[] },
): Session {
  const { profile, roles } = context;
  return {
    accessToken,
    expiresAt: new Date((expiresAtSeconds ?? 0) * 1000).toISOString(),
    user: {
      id: profile.user_id,
      email: email ?? "",
      role: profile.role,
      roles,
      activeRole: profile.role,
      displayName: profile.display_name,
      // Coluna real (`profiles.is_admin`, migration
      // 20260807090000_profiles_admin_flag.sql, DEC-076): só leitura aqui —
      // este adapter nunca grava em `is_admin`; a coluna é protegida por
      // trigger dedicado que só permite alteração via `service_role`
      // (administração direta, fora do app).
      isAdmin: profile.is_admin,
    },
  };
}

// Forma estrutural mínima de um erro do @supabase/auth-js: aceita tanto o
// `AuthError`/`AuthApiError` real (que tem `.code`/`.name` além de
// `.message`/`.status`) quanto objetos simples usados nos testes do adapter.
// `code` é o campo estável documentado pelo SDK para diferenciar causas (ex.:
// 'invalid_credentials', 'email_not_confirmed', 'weak_password'); `message`
// continua como sinal de apoio para GoTrue self-hosted mais antigo, que pode
// não preencher `code`.
export type SupabaseAuthErrorLike = {
  message: string;
  status?: number;
  code?: string;
  name?: string;
};

/**
 * Mapeia erros do GoTrue/@supabase-js para os códigos públicos de `AuthError`
 * (DEC-041/067/068). Compartilhado por `SupabaseAuthAdapter` (signIn) e
 * `SupabaseAuthRegistrationAdapter` (signUp/updatePassword) — ver
 * docs/HANDOFF_CADASTRO_RECUPERACAO_CRIS.md, seção 5.
 *
 * `resendConfirmationEmail`/`requestPasswordReset` NÃO devem usar este
 * mapeador diretamente: usam `mapNeutralSupabaseAuthError`, que restringe a
 * saída a `RATE_LIMITED`/`NETWORK_ERROR`/`UNKNOWN` para não violar a regra de
 * anti-enumeração (seção 2.3 do handoff).
 */
export function mapSupabaseAuthError(error: SupabaseAuthErrorLike): AuthError {
  const message = error.message.toLowerCase();
  const code = error.code;

  // Falha de transporte/rede com sinal explícito: `AuthRetryableFetchError`
  // é o nome usado pelo SDK para timeouts/falhas de fetch, e mensagens de
  // rede do próprio `fetch` (`TypeError`) não colidem com nenhum outro
  // vocabulário abaixo (nunca contêm "email", "link", "password" etc.), por
  // isso é seguro checá-las antes das demais regras.
  if (error.name === "AuthRetryableFetchError" || message.includes("network") || message.includes("failed to fetch")) {
    return new AuthError("NETWORK_ERROR", "Falha de conexão. Verifique sua internet e tente novamente.");
  }

  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    code === "over_sms_send_rate_limit" ||
    error.status === 429 ||
    message.includes("rate limit")
  ) {
    return new AuthError("RATE_LIMITED", "Muitas tentativas. Aguarde um instante e tente novamente.");
  }

  if (
    code === "invalid_credentials" ||
    message.includes("invalid login credentials") ||
    message.includes("invalid_credentials")
  ) {
    return new AuthError("INVALID_CREDENTIALS", "Confira seu e-mail e sua senha e tente novamente.");
  }

  // DEC-068 / seção 5 do handoff: GoTrue rejeita `signInWithPassword` antes de
  // qualquer consulta a `profiles`. Sem este ramo, e-mail não confirmado
  // cairia em INVALID_CREDENTIALS ou UNKNOWN, escondendo a causa real do
  // bloqueio (DEC-055) e impedindo a UI de direcionar para `/confirm-email`.
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return new AuthError(
      "AUTH_EMAIL_NOT_CONFIRMED",
      "Confirme seu e-mail para continuar. Reenvie a confirmação se não encontrar a mensagem.",
    );
  }

  // Sessão de recuperação/confirmação ausente (regra 6 do handoff): reaproveita
  // o código já existente `SESSION_EXPIRED` em vez de criar um novo com a
  // mesma semântica. `AuthSessionMissingError` é lançado pelo próprio SDK
  // (sem round-trip à API) quando `updateUser` é chamado sem sessão ativa.
  if (error.name === "AuthSessionMissingError" || message.includes("auth session missing")) {
    return new AuthError("SESSION_EXPIRED", "Sua sessão expirou. Solicite o link novamente.");
  }

  // Link de confirmação ou de recuperação expirado, malformado ou já usado
  // (regra 5 do handoff): resposta única `AUTH_LINK_INVALID`, sem diferenciar
  // o motivo. Códigos nativos do GoTrue para essa família de falha:
  // `otp_expired` (link de signup/recovery vencido), `flow_state_not_found`/
  // `flow_state_expired` (fluxo PKCE da web sem estado válido) e
  // `bad_code_verifier` (code verifier ausente/incorreto ao trocar o código
  // pela sessão).
  if (
    code === "otp_expired" ||
    code === "flow_state_not_found" ||
    code === "flow_state_expired" ||
    code === "bad_code_verifier" ||
    (message.includes("otp") && message.includes("expired")) ||
    (message.includes("link") && (message.includes("expired") || message.includes("invalid")))
  ) {
    return new AuthError("AUTH_LINK_INVALID", "Este link não é mais válido. Solicite um novo.");
  }

  // Senha rejeitada pelo backend mesmo após passar da validação client-side
  // de 8+ caracteres — inclui a proteção de senha vazada do Supabase (reason
  // `pwned` do `AuthWeakPasswordError`), que usa o mesmo código `weak_password`
  // das reasons `length`/`characters` (seção 5 do handoff).
  if (
    code === "weak_password" ||
    message.includes("weak password") ||
    (message.includes("password") && message.includes("pwned"))
  ) {
    return new AuthError("AUTH_WEAK_PASSWORD", "Escolha uma senha diferente e mais segura.");
  }

  // Último recurso para falha de rede: nenhuma regra específica reconheceu a
  // mensagem, e nem `status` nem `code` foram preenchidos — sinal de que o
  // erro nunca chegou a ser uma resposta HTTP do GoTrue (a documentação do
  // SDK registra que `status`/`code` só ficam ausentes juntos nesse caso).
  // Fica no fim de propósito: só se aplica depois que toda mensagem
  // reconhecível já foi tratada acima, para não mascarar sinais válidos que
  // por algum motivo não tragam `status`/`code` preenchidos.
  if (error.status === undefined && code === undefined) {
    return new AuthError("NETWORK_ERROR", "Falha de conexão. Verifique sua internet e tente novamente.");
  }

  return new AuthError("UNKNOWN", "Não foi possível concluir agora. Tente novamente.");
}

/**
 * Versão anti-enumeração de `mapSupabaseAuthError` (regras 2.3/2.4 do
 * handoff): usada por `resendConfirmationEmail` e `requestPasswordReset`, que
 * SEMPRE devem resolver do ponto de vista da UI, exceto por `RATE_LIMITED`
 * ou `NETWORK_ERROR` — nunca por um código que revele se a conta existe, já
 * foi confirmada ou está bloqueada.
 */
export function mapNeutralSupabaseAuthError(error: SupabaseAuthErrorLike): AuthError {
  const mapped = mapSupabaseAuthError(error);
  if (mapped.code === "RATE_LIMITED" || mapped.code === "NETWORK_ERROR") {
    return mapped;
  }
  return new AuthError("UNKNOWN", "Não foi possível concluir agora. Tente novamente.");
}

function mapPublicSignInError(error: SupabaseAuthErrorLike): AuthError {
  const mapped = mapSupabaseAuthError(error);
  return mapped.code === "AUTH_EMAIL_NOT_CONFIRMED"
    ? new AuthError("INVALID_CREDENTIALS", "Confira seu e-mail e sua senha e tente novamente.")
    : mapped;
}

export class SupabaseAuthAdapter implements AuthPort {
  async signIn({ email, password }: SignInInput): Promise<Session> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      throw error
        ? mapPublicSignInError(error)
        : new AuthError("UNKNOWN", "Não foi possível entrar agora. Tente novamente.");
    }

    const context = await loadProfile(data.session.user.id);
    if (!context || context.profile.status !== "active") {
      // Sessão válida no Auth, mas sem perfil operacional ou perfil bloqueado:
      // não entrega sessão completa (seção 6.2, "ausência de perfil válido
      // não produzirá sessão operacional completa").
      await supabase.auth.signOut();
      throw new AuthError(
        "ACCOUNT_DISABLED",
        "Sua conta não está disponível no momento. Fale com o suporte.",
      );
    }

    return toSession(
      data.session.access_token,
      data.session.expires_at,
      data.session.user.email,
      context,
    );
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  }

  async getSession(): Promise<Session | null> {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) return null;

    const context = await loadProfile(data.session.user.id);
    if (!context || context.profile.status !== "active") return null;

    return toSession(
      data.session.access_token,
      data.session.expires_at,
      data.session.user.email,
      context,
    );
  }

  async addRole(role: UserRole): Promise<Session> {
    const { data: authData } = await supabase.auth.getSession();
    if (!authData.session) throw new AuthError("SESSION_EXPIRED", "Sua sessão expirou. Entre novamente.");
    const { error } = await supabase.rpc("add_profile_role", { p_role: role });
    if (error) throw mapRoleContextError(error);
    const context = await loadProfile(authData.session.user.id);
    if (!context) throw new AuthError("UNKNOWN", "Não foi possível carregar seus perfis.");
    return toSession(authData.session.access_token, authData.session.expires_at, authData.session.user.email, context);
  }

  async switchRole({ role }: SwitchRoleInput): Promise<Session> {
    const { data: authData } = await supabase.auth.getSession();
    if (!authData.session) throw new AuthError("SESSION_EXPIRED", "Sua sessão expirou. Entre novamente.");
    const { error } = await supabase.rpc("switch_profile_role", { p_role: role });
    if (error) throw mapRoleContextError(error);
    const context = await loadProfile(authData.session.user.id);
    if (!context) throw new AuthError("UNKNOWN", "Não foi possível carregar seus perfis.");
    return toSession(authData.session.access_token, authData.session.expires_at, authData.session.user.email, context);
  }
}

function mapRoleContextError(error: SupabaseAuthErrorLike): AuthError {
  if (error.message.includes("ROLE_NOT_AVAILABLE")) {
    return new AuthError("ROLE_NOT_AVAILABLE", "Crie este perfil antes de alternar.");
  }
  if (error.message.includes("SESSION_EXPIRED")) {
    return new AuthError("SESSION_EXPIRED", "Sua sessão expirou. Entre novamente.");
  }
  if (error.message.includes("ACCOUNT_DISABLED")) {
    return new AuthError("ACCOUNT_DISABLED", "Sua conta não está disponível no momento.");
  }
  return mapSupabaseAuthError(error);
}

export const supabaseAuthService: AuthPort = new SupabaseAuthAdapter();
