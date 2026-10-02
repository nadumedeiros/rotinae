// Regressão: no primeiro clique em "Continuar com Google" no login, o
// usuário via a tela "Não foi possível concluir a entrada com Google" mesmo
// a sessão tendo sido criada com sucesso (só funcionava numa segunda
// tentativa). Causa raiz: o efeito desta tela tinha `linkingUrl` (de
// `Linking.useURL()`) nas dependências; esse hook começa em `null` e resolve
// de forma assíncrona, então o efeito rodava 2x. A 2ª chamada tentava trocar
// o mesmo código PKCE (uso único) já consumido pela 1ª, falhava, e o
// `catch` sobrescrevia a tela com erro — mesmo com a sessão já válida.
import { render, waitFor } from "@testing-library/react-native";
import React from "react";

import GoogleCallbackScreen from "../callback";

const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => ({}),
}));

jest.mock("expo-linking", () => ({
  getInitialURL: jest.fn().mockResolvedValue("rotinae:///auth/callback?code=one-time-code"),
}));

const mockCompleteAuthSessionFromUrl = jest.fn().mockResolvedValue(undefined);
jest.mock("@/src/infra/auth/auth-url-session", () => ({
  completeAuthSessionFromUrl: (...args: unknown[]) => mockCompleteAuthSessionFromUrl(...args),
}));

const mockGetSession = jest.fn().mockResolvedValue({ user: { isAdmin: false, activeRole: "provider" } });
jest.mock("@/src/infra/auth/supabase-auth-adapter", () => ({
  supabaseAuthService: { getSession: (...args: unknown[]) => mockGetSession(...args) },
}));

describe("GoogleCallbackScreen", () => {
  beforeEach(() => jest.clearAllMocks());

  it("troca o código PKCE uma única vez mesmo quando a tela re-renderiza", async () => {
    const { rerender } = await render(<GoogleCallbackScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());

    // Simula re-renderizações (ex.: mudança de estado num componente pai),
    // que antes também disparavam o efeito de novo.
    rerender(<GoogleCallbackScreen />);
    rerender(<GoogleCallbackScreen />);

    expect(mockCompleteAuthSessionFromUrl).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
  });
});
