// RN-AGD (BACKLOG.md DEC-143/BLG-080) — o painel de resumo (Passo "RESUMO")
// de `app/client-booking.tsx` usava dois textos hardcoded amarrados ao id
// literal "ana" (`provider === "ana" ? "Acompanhamento" : "Treino
// individual"` / `"Dra. Ana Ribeiro" : "Lucas Mendes"`), que nunca refletiam
// o serviço/prestador reais escolhidos pelo cliente. A correção troca por
// `selectedService?.name ?? "Sem serviço ativo"` (mesmo fallback já usado no
// card do carrossel de prestadores) e
// `currentContext?.providerName ? "com " + providerName : "Selecione um
// prestador"`.
import { render, waitFor } from "@testing-library/react-native";
import React from "react";

import ClientBookingScreen from "../client-booking";

// BLG-077: `client-booking.tsx` passou a usar `useFocusEffect` (refetch em
// foco/retorno, mesmo padrão de `app/payments.tsx`, DEC-109/BLG-064); mesmo
// mock de `agenda-timezone.test.tsx` para não depender de um
// `NavigationContainer` real no teste.
jest.mock("expo-router", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, []),
}));
jest.mock("@/src/components/layout/authenticated-header", () => ({
  AuthenticatedHeader: () => null,
}));
jest.mock("@/src/components/layout/client-mobile-tab-bar", () => ({
  ClientMobileTabBar: () => null,
}));
jest.mock("@/src/infra/agenda/supabase-appointment-adapter", () => ({
  appointmentService: {
    createAppointment: jest.fn(),
    // RN-PLN-018/019 (20260819100000_provider_plan_horizon_limit.sql):
    // `useClientAppointmentHorizon` (app/client-booking.tsx) chama este
    // método assim que um prestador é selecionado — sem teto por padrão,
    // preservando o comportamento anterior a esta migration para os
    // cenários deste teste (não relacionados a horizonte de plano).
    getAppointmentHorizon: jest.fn().mockResolvedValue({ unrestricted: true, maxAllowedDate: null }),
  },
}));

const mockRpc = jest.fn();
jest.mock("@/src/infra/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

function bookingContext(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    providerId: "provider-1",
    providerName: "Dra. Ana Ribeiro",
    profession: null,
    attendanceDays: [2, 4],
    primaryServiceId: "service-1",
    timezone: "America/Sao_Paulo",
    workdayStart: "08:00:00",
    workdayEnd: "18:00:00",
    minimumAdvanceHours: 0,
    services: [
      { id: "service-1", name: "Acompanhamento nutricional", durationMinutes: 60, referenceValueCents: 10000 },
    ],
    blocks: [],
    occupiedStartsAt: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 13, 12, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

describe("app/client-booking.tsx — painel de resumo (serviço e prestador reais)", () => {
  it("exibe o nome real do serviço e, junto ao ícone de prestador, 'com <nome do prestador>' quando o contexto carrega normalmente", async () => {
    mockRpc.mockResolvedValue({ data: [bookingContext()], error: null });

    const view = await render(<ClientBookingScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    await waitFor(() => {
      expect(view.getByText("Acompanhamento nutricional")).toBeTruthy();
    });
    expect(view.getByText("com Dra. Ana Ribeiro")).toBeTruthy();
  });

  it("exibe 'Sem serviço ativo' no título do resumo quando o prestador selecionado não tem nenhum serviço (selectedService indefinido)", async () => {
    mockRpc.mockResolvedValue({
      data: [bookingContext({ services: [] })],
      error: null,
    });

    const view = await render(<ClientBookingScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    // O mesmo fallback aparece também no card do carrossel de prestadores
    // (mesma condição estrutural, reaproveitada por decisão do Dante) —
    // por isso duas ocorrências; o painel de resumo é a segunda no DOM.
    await waitFor(() => {
      expect(view.getAllByText("Sem serviço ativo").length).toBe(2);
    });
    const [, summaryTitle] = view.getAllByText("Sem serviço ativo");
    expect(summaryTitle).toBeTruthy();
    // O prestador continua carregado normalmente — só o serviço está ausente.
    expect(view.getByText("com Dra. Ana Ribeiro")).toBeTruthy();
  });

  it("exibe 'Sem serviço ativo' e 'Selecione um prestador' enquanto o contexto do cliente ainda não carregou", async () => {
    // RPC nunca resolve nesta renderização — reproduz o estado inicial real
    // (`provider === ""`, `contexts === []`) antes de `get_client_booking_context`
    // responder.
    mockRpc.mockReturnValue(new Promise(() => {}));

    const view = await render(<ClientBookingScreen />);

    expect(view.getByText("Sem serviço ativo")).toBeTruthy();
    expect(view.getByText("Selecione um prestador")).toBeTruthy();
  });
});
