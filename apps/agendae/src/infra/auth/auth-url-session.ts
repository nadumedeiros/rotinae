import { supabase } from "@/src/infra/supabase/client";
import { Platform } from "react-native";

export type AuthCallbackParams = {
  code: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  type: string | null;
  error: string | null;
};

export type AuthCallbackFlow = "oauth" | "recovery" | "signup";

const CALLBACK_PATH: Record<AuthCallbackFlow, string> = {
  oauth: "/auth/callback",
  recovery: "/change-password",
  signup: "/confirm-email",
};

export function authRedirectUrl(path: "confirm-email" | "change-password" | "auth/callback"): string {
  const normalizedPath = path.replace(/^\/+/, "");
  if (Platform.OS !== "web") return `rotinae:///${normalizedPath}`;

  // Na Web, o callback precisa voltar à origem que iniciou a autenticação.
  // Isso mantém Deploy Previews isolados e, em produção, resolve naturalmente
  // para o domínio oficial que o usuário está acessando.
  if (typeof globalThis.location !== "undefined" && globalThis.location.origin) {
    return `${globalThis.location.origin}/${normalizedPath}`;
  }
  const configuredBaseUrl = process.env.EXPO_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configuredBaseUrl) return `${configuredBaseUrl}/${normalizedPath}`;
  throw new Error("EXPO_PUBLIC_APP_URL precisa estar configurada para autenticação na web.");
}

export function parseAuthCallbackUrl(url: string): AuthCallbackParams {
  const parsed = new URL(url);
  const query = parsed.searchParams;
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const read = (name: string) => query.get(name) ?? fragment.get(name);
  return {
    code: read("code"),
    accessToken: read("access_token"),
    refreshToken: read("refresh_token"),
    type: read("type"),
    error: read("error_description") ?? read("error"),
  };
}

function validateAuthCallbackLocation(url: string, flow: AuthCallbackFlow): void {
  const parsed = new URL(url);
  const path = parsed.protocol === "rotinae:"
    ? `/${parsed.host}${parsed.pathname}`.replace(/\/{2,}/g, "/")
    : parsed.pathname;

  if (path !== CALLBACK_PATH[flow]) throw new Error("AUTH_CALLBACK_PATH_MISMATCH");
  if (parsed.username || parsed.password) throw new Error("AUTH_CALLBACK_ORIGIN_MISMATCH");

  if (parsed.protocol === "rotinae:") return;
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("AUTH_CALLBACK_ORIGIN_MISMATCH");
  }

  const runtimeOrigin = typeof globalThis.location !== "undefined"
    ? globalThis.location.origin
    : undefined;
  const configuredOrigin = process.env.EXPO_PUBLIC_APP_URL
    ? new URL(process.env.EXPO_PUBLIC_APP_URL).origin
    : undefined;
  if (parsed.origin !== runtimeOrigin && parsed.origin !== configuredOrigin) {
    throw new Error("AUTH_CALLBACK_ORIGIN_MISMATCH");
  }
}

/** Conclui apenas callbacks PKCE da rota e origem esperadas. */
export async function completeAuthSessionFromUrl(
  url: string,
  flow: AuthCallbackFlow,
) {
  validateAuthCallbackLocation(url, flow);
  const params = parseAuthCallbackUrl(url);
  if (params.error) throw new Error(params.error);
  if (params.type && flow !== "oauth" && params.type !== flow) {
    throw new Error("AUTH_CALLBACK_TYPE_MISMATCH");
  }
  if (params.accessToken || params.refreshToken) throw new Error("AUTH_CALLBACK_TOKENS_FORBIDDEN");
  if (!params.code) throw new Error("AUTH_CALLBACK_CODE_MISSING");

  const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
  if (error) throw error;
  return data.session;
}
