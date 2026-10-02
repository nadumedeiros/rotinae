// RN-AGD-025/029 (BACKLOG.md DEC-139/BLG-080,
// docs/HANDOFF_UX_DIAS_ATENDIMENTO_DANTE.md seções 2.1-2.4/7.2) — cobre o
// seletor de dias de atendimento em `app/settings.tsx`: validação de grupo
// (zero dias marcados) e envio correto do array real para
// `providerSettingsService.updateSettings`.
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";

import SettingsScreen from "../settings";

jest.mock("expo-router", () => ({ router: { back: jest.fn() } }));
jest.mock("@/src/components/layout/authenticated-header", () => ({
  AuthenticatedHeader: () => null,
}));
jest.mock("@/src/components/layout/client-mobile-tab-bar", () => ({
  ClientMobileTabBar: () => null,
}));
jest.mock("@/src/components/layout/mobile-tab-bar", () => ({
  MobileTabBar: () => null,
}));

const mockGetSettings = jest.fn();
const mockUpdateSettings = jest.fn();
jest.mock("@/src/infra/provider/supabase-provider-settings-adapter", () => ({
  providerSettingsService: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
  },
}));

const mockGetSession = jest.fn();
jest.mock("@/src/infra/auth/supabase-auth-adapter", () => ({
  supabaseAuthService: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
  },
}));

jest.mock("@/src/infra/notifications/push-registration", () => ({
  pushRegistrationService: {
    sync: jest.fn().mockResolvedValue({ status: "registered" }),
  },
}));

jest.mock("@/src/infra/supabase/client", () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const baseSettings = {
  id: "tenant-1",
  displayName: "Marcus Aurelio",
  email: "marcus@exemplo.com",
  phone: "+5511999999999",
  profession: null,
  // Segunda a sexta marcados; sábado e domingo desmarcados — cobre um
  // subconjunto real (não os 7 dias), mesmo padrão dos testes de adapter do
  // Chris.
  attendanceDays: [1, 2, 3, 4, 5],
  timezone: "America/Sao_Paulo",
  workdayStart: "08:00",
  workdayEnd: "18:00",
  minimumAdvanceHours: 24,
  emailNotifications: true,
  pushNotifications: true,
  updatedAt: "2026-08-06T11:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ user: { id: "user-1", email: baseSettings.email, activeRole: "provider" } });
  mockGetSettings.mockResolvedValue(baseSettings);
  mockUpdateSettings.mockResolvedValue(baseSettings);
});

async function renderSettingsScreen() {
  const view = await render(<SettingsScreen />);
  // Aguarda o carregamento assíncrono de `providerSettingsService.getSettings()`
  // popular o formulário (ex.: o rótulo de acessibilidade de segunda-feira
  // reflete o valor real vindo do mock, não o estado inicial vazio).
  await view.findByLabelText("Segunda-feira, dia de atendimento ativado");
  return view;
}

describe("app/settings.tsx — seletor de dias de atendimento", () => {
  it("carrega os chips já marcados conforme o attendanceDays real vindo do backend", async () => {
    const view = await renderSettingsScreen();

    expect(view.getByLabelText("Segunda-feira, dia de atendimento ativado")).toBeTruthy();
    expect(view.getByLabelText("Sexta-feira, dia de atendimento ativado")).toBeTruthy();
    expect(view.getByLabelText("Sábado, dia de atendimento desativado")).toBeTruthy();
    expect(view.getByLabelText("Domingo, dia de atendimento desativado")).toBeTruthy();
  });

  it("bloqueia o salvamento com zero dias marcados, sem chamar a rede", async () => {
    const view = await renderSettingsScreen();

    // Desmarca os 5 dias inicialmente ativos (segunda a sexta); sábado e
    // domingo já começam desmarcados.
    for (const day of ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"]) {
      await fireEvent.press(view.getByLabelText(`${day}, dia de atendimento ativado`));
    }

    await fireEvent.press(view.getByText("Salvar configurações"));

    expect(
      await view.findByText("Selecione pelo menos um dia de atendimento."),
    ).toBeTruthy();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("envia o subconjunto real de attendanceDays ao salvar (não bloqueia interação parcial)", async () => {
    const view = await renderSettingsScreen();

    // Desmarca só sexta-feira (fica só com [1,2,3,4] = segunda a quinta) —
    // continua um grupo não vazio, então o salvamento deve seguir em frente.
    await fireEvent.press(view.getByLabelText("Sexta-feira, dia de atendimento ativado"));

    await fireEvent.press(view.getByText("Salvar configurações"));

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1));
    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ attendanceDays: [1, 2, 3, 4] }),
    );
  });

  it("marcar um dia antes desmarcado limpa o erro de grupo e permite salvar", async () => {
    const view = await renderSettingsScreen();

    for (const day of ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"]) {
      await fireEvent.press(view.getByLabelText(`${day}, dia de atendimento ativado`));
    }
    await fireEvent.press(view.getByText("Salvar configurações"));
    await view.findByText("Selecione pelo menos um dia de atendimento.");

    // Marca sábado — grupo deixa de estar vazio.
    await fireEvent.press(view.getByLabelText("Sábado, dia de atendimento desativado"));
    await fireEvent.press(view.getByText("Salvar configurações"));

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1));
    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ attendanceDays: [6] }),
    );
    expect(view.queryByText("Selecione pelo menos um dia de atendimento.")).toBeNull();
  });
});
