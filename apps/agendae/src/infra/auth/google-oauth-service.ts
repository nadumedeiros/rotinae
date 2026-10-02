import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import type { UserRole } from "@/src/domain/auth/types";
import { authRedirectUrl, completeAuthSessionFromUrl } from "@/src/infra/auth/auth-url-session";
import { supabase } from "@/src/infra/supabase/client";

WebBrowser.maybeCompleteAuthSession();

const consentVersion = "2026-08-04";

async function ensureSession(url?: string) {
  if (url) await completeAuthSessionFromUrl(url, "oauth");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("GOOGLE_SESSION_MISSING");
}

export async function beginGoogleOAuth(): Promise<"redirecting" | "completed"> {
  const redirectTo = authRedirectUrl("auth/callback");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      scopes: "openid email profile",
      queryParams: { prompt: "select_account" },
      skipBrowserRedirect: Platform.OS !== "web",
    },
  });
  if (error) throw error;
  if (Platform.OS === "web") return "redirecting";
  if (!data.url) throw new Error("GOOGLE_AUTH_URL_MISSING");
  // Android usa Custom Tabs e iOS usa ASWebAuthenticationSession: o usuário
  // permanece no contexto do app sem um navegador externo solto. Google não
  // permite OAuth em WebView embutida; estes são os containers seguros de cada SO.
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo, {
    preferEphemeralSession: false,
    showInRecents: false,
  });
  if (result.type !== "success") throw new Error("GOOGLE_AUTH_CANCELLED");
  await ensureSession(result.url);
  return "completed";
}

export async function completeGoogleRegistration(role: UserRole, phone: string): Promise<void> {
  const source = Platform.OS === "android" ? "android" : "web";
  const { error } = await supabase.rpc("complete_google_oauth_onboarding", {
    p_role: role,
    p_consent_version: consentVersion,
    p_source: source,
  });
  if (error) throw error;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("GOOGLE_SESSION_MISSING");
  const { error: phoneError } = await supabase.from("profiles").update({ phone }).eq("user_id", user.id);
  if (phoneError) throw phoneError;
}
