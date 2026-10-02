import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY precisam estar definidos em apps/agendae/.env.local.",
  );
}

const secureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Sem isso o SDK usa o padrão 'implicit' (tokens no fragmento da URL)
    // enquanto `auth-url-session.ts` só aceita o `code` do fluxo PKCE e
    // recusa qualquer token solto na URL (AUTH_CALLBACK_TOKENS_FORBIDDEN) —
    // quebrava 100% dos logins com Google, recuperação de senha e
    // confirmação de e-mail na Web.
    flowType: "pkce",
    // Web usa o localStorage padrão do SDK; nativo usa o Keychain/Keystore via SecureStore.
    storage: Platform.OS === "web" ? undefined : secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    // Callbacks são consumidos explicitamente pelas rotas de auth em Web e
    // nativo. Isso impede uma sessão antiga de mascarar um novo código PKCE.
    detectSessionInUrl: false,
  },
});

// BLG-073 / DEC-127: no React Native, timers de JS ficam suspensos enquanto o
// app está em background — o refresh automático interno do GoTrue
// (`autoRefreshToken: true`) não dispara nesse período. Sem este listener, ao
// voltar para o app depois de tempo suficiente para o access token expirar
// (ex.: madrugada inteira em background), telas que recarregam dados no
// evento `AppState` "active" (ex.: `app/clients.tsx`) disparam a primeira
// query autenticada com um JWT já expirado, antes de o cliente perceber e
// renovar — resultando em erro real do PostgREST (`401`/`JWT expired`)
// exposto como uma mensagem genérica na tela. Este é o padrão oficialmente
// recomendado pela Supabase para apps React Native/Expo:
// https://supabase.com/docs/guides/auth/quickstarts/react-native
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
}

// BLG-077 / DEC-138 (sugerido — registrar em BACKLOG.md ao aprovar): equivalente Web de BLG-073/DEC-127 acima — mesmo
// sintoma (401 "JWT expired" na primeira chamada autenticada seguinte),
// mesma causa raiz (o ticker de auto refresh do GoTrue não roda enquanto a
// aplicação não está em primeiro plano). O `@supabase/auth-js` já registra
// sozinho um listener de `visibilitychange` (ver `GoTrueClient#
// _handleVisibilityChange`) que pausa/retoma o refresh e tenta recuperar a
// sessão ao voltar a ficar visível — mas isso cobre apenas troca de aba.
// Quando o usuário troca de aplicativo do sistema operacional mantendo a
// mesma aba "visível" em segundo plano (ex.: Alt+Tab, ou o notebook dorme com
// a aba em foco), muitos navegadores não disparam `visibilitychange` — só
// `blur`/`focus` da janela refletem essa troca. Sem cobrir esse caso, a
// mesma janela de tempo que causa o 401 no nativo pode se repetir na Web.
// Reforçamos aqui os dois sinais equivalentes ao `AppState` nativo
// ("ativo" = aba visível E janela focada). Chamar `startAutoRefresh`/
// `stopAutoRefresh` é idempotente (a própria implementação do GoTrue
// reinicia o ticker do zero a cada chamada), então esta camada extra nunca
// conflita com o listener interno do GoTrue — só cobre a lacuna dele.
//
// Decisão de arquitetura: mantido no mesmo `client.ts` (e não dividido em
// `client.web.ts` / `client.native.ts`, convenção já usada no projeto em
// `src/infra/notifications/push-registration.*`) porque, aqui, a criação do
// client — URL, chave, PKCE, seleção de storage por plataforma — é 100%
// idêntica entre Web e nativo; só este listener de ciclo de vida difere.
// Duplicar o arquivo inteiro por uma diferença desse tamanho pioraria a
// manutenção (DRY) em vez de ajudar. A convenção de arquivos por plataforma
// vale quando o módulo inteiro diverge (ex.: push nativo real vs. stub
// inerte na Web), o que não é o caso deste arquivo.
if (Platform.OS === "web") {
  const hasWindowAndDocument =
    typeof document !== "undefined" && typeof window !== "undefined";
  if (hasWindowAndDocument) {
    const isAppInForeground = () =>
      document.visibilityState === "visible" &&
      (typeof document.hasFocus !== "function" || document.hasFocus());
    const syncAutoRefreshWithForegroundState = () => {
      if (isAppInForeground()) {
        void supabase.auth.startAutoRefresh();
      } else {
        void supabase.auth.stopAutoRefresh();
      }
    };
    document.addEventListener("visibilitychange", syncAutoRefreshWithForegroundState);
    window.addEventListener("focus", syncAutoRefreshWithForegroundState);
    window.addEventListener("blur", syncAutoRefreshWithForegroundState);
  }
}
