/* eslint-disable @typescript-eslint/no-require-imports -- exigido para
   recarregar o módulo com `jest.resetModules()` entre platforms/estados. */
// BLG-077 / DEC-138 (sugerido): cobre a renovação automática de sessão na
// Web (equivalente ao listener de `AppState` nativo, BLG-073/DEC-127) e
// confirma que o comportamento nativo existente não foi alterado.
//
// O client real (`createClient` do `@supabase/supabase-js`) é substituído
// por um dublê simples: os efeitos colaterais do GoTrue real (timers,
// storage, rede) não são o que este teste verifica — o que importa é que
// `src/infra/supabase/client.ts` conecta corretamente
// `visibilitychange`/`focus`/`blur` a `startAutoRefresh`/`stopAutoRefresh`
// na Web, e continua usando exclusivamente `AppState` no nativo.
//
// `Platform.OS` é mutado diretamente (é uma propriedade gravável do módulo
// real de `react-native`, já usado sem mocks em todo o app) em vez de
// mockar o módulo `react-native` inteiro — mockar `react-native` via
// `jest.requireActual` arrasta telas/nativos reais (Modal, FlatList,
// DevMenu) que não existem fora de um binário nativo.

import { AppState, Platform } from "react-native";

const ORIGINAL_ENV = process.env;
const ORIGINAL_PLATFORM_OS = Platform.OS;

type Listener = () => void;

const listeners: Record<string, Listener[]> = {};

function addListener(target: "document" | "window", event: string, handler: Listener) {
  const key = `${target}:${event}`;
  listeners[key] = [...(listeners[key] ?? []), handler];
}

function fire(target: "document" | "window", event: string) {
  const key = `${target}:${event}`;
  (listeners[key] ?? []).forEach((handler) => handler());
}

const fakeSupabaseClient = {
  auth: {
    startAutoRefresh: jest.fn().mockResolvedValue(undefined),
    stopAutoRefresh: jest.fn().mockResolvedValue(undefined),
  },
};

function mockSupabaseModule() {
  jest.doMock("@supabase/supabase-js", () => ({
    createClient: jest.fn(() => fakeSupabaseClient),
  }));
  jest.doMock("expo-secure-store", () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
  }));
}

describe("infra/supabase/client — renovação automática de sessão", () => {
  beforeEach(() => {
    jest.resetModules();
    Object.keys(listeners).forEach((key) => delete listeners[key]);
    fakeSupabaseClient.auth.startAutoRefresh.mockClear();
    fakeSupabaseClient.auth.stopAutoRefresh.mockClear();
    (AppState.addEventListener as jest.Mock).mockClear();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    (Platform as any).OS = ORIGINAL_PLATFORM_OS;
    delete (global as any).document;
    delete (global as any).window;
  });

  function loadWebClient(initial: { visible: boolean; focused: boolean }) {
    mockSupabaseModule();
    (Platform as any).OS = "web";

    (global as any).document = {
      visibilityState: initial.visible ? "visible" : "hidden",
      hasFocus: () => initial.focused,
      addEventListener: (event: string, handler: Listener) => addListener("document", event, handler),
    };
    (global as any).window = {
      addEventListener: (event: string, handler: Listener) => addListener("window", event, handler),
    };

    return require("@/src/infra/supabase/client");
  }

  it("registra listeners de visibilitychange/focus/blur quando roda na Web", () => {
    loadWebClient({ visible: true, focused: true });

    expect(require("@supabase/supabase-js").createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      expect.objectContaining({ auth: expect.objectContaining({ flowType: "pkce", detectSessionInUrl: false }) }),
    );

    expect(listeners["document:visibilitychange"]).toHaveLength(1);
    expect(listeners["window:focus"]).toHaveLength(1);
    expect(listeners["window:blur"]).toHaveLength(1);
  });

  it("pausa o auto refresh quando a aba fica oculta e retoma quando volta a ficar visível", () => {
    loadWebClient({ visible: true, focused: true });

    (global as any).document.visibilityState = "hidden";
    fire("document", "visibilitychange");
    expect(fakeSupabaseClient.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(fakeSupabaseClient.auth.startAutoRefresh).not.toHaveBeenCalled();

    (global as any).document.visibilityState = "visible";
    fire("document", "visibilitychange");
    expect(fakeSupabaseClient.auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it("pausa o auto refresh quando a janela perde o foco (aba continua visível) e retoma no focus", () => {
    loadWebClient({ visible: true, focused: true });

    (global as any).document.hasFocus = () => false;
    fire("window", "blur");
    expect(fakeSupabaseClient.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);

    (global as any).document.hasFocus = () => true;
    fire("window", "focus");
    expect(fakeSupabaseClient.auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it("não quebra a inicialização quando `document`/`window` não existem na Web (ex.: export estático)", () => {
    mockSupabaseModule();
    (Platform as any).OS = "web";

    expect(() => require("@/src/infra/supabase/client")).not.toThrow();
    expect(fakeSupabaseClient.auth.startAutoRefresh).not.toHaveBeenCalled();
    expect(fakeSupabaseClient.auth.stopAutoRefresh).not.toHaveBeenCalled();
  });

  it("no nativo continua usando somente o AppState existente, sem listeners de DOM", () => {
    mockSupabaseModule();
    (Platform as any).OS = "ios";

    (global as any).document = { addEventListener: jest.fn() };
    (global as any).window = { addEventListener: jest.fn() };

    require("@/src/infra/supabase/client");

    expect(AppState.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect((global as any).document.addEventListener).not.toHaveBeenCalled();
    expect((global as any).window.addEventListener).not.toHaveBeenCalled();
  });

  it("no nativo, o handler do AppState continua chamando start/stopAutoRefresh como antes (BLG-073/DEC-127 preservado)", () => {
    mockSupabaseModule();
    (Platform as any).OS = "android";

    require("@/src/infra/supabase/client");

    expect(AppState.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    const handler = (AppState.addEventListener as jest.Mock).mock.calls[0][1] as (state: string) => void;

    handler("active");
    expect(fakeSupabaseClient.auth.startAutoRefresh).toHaveBeenCalledTimes(1);

    handler("background");
    expect(fakeSupabaseClient.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
  });
});
