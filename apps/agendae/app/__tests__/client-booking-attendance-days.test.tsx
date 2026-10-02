// RN-AGD-025/029 (BACKLOG.md DEC-139/BLG-080,
// docs/HANDOFF_UX_DIAS_ATENDIMENTO_DANTE.md seções 3/4.1/7.2) — cobre a
// origem real de `policy.allowedWeekdays` em `app/client-booking.tsx`: deve
// vir de `currentContext.attendanceDays` (RPC `get_client_booking_context`),
// não mais do array fixo `[1,2,3,4,5]`, e a defesa em profundidade quando o
// contexto chega com `attendanceDays` vazio.
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
    // Tenant configurado só com terça e quinta (2, 4) — subconjunto real,
    // não os 7 dias nem o mock fixo [1,2,3,4,5] antigo.
    attendanceDays: [2, 4],
    primaryServiceId: "service-1",
    timezone: "America/Sao_Paulo",
    workdayStart: "08:00:00",
    workdayEnd: "18:00:00",
    minimumAdvanceHours: 0,
    services: [{ id: "service-1", name: "Serviço", durationMinutes: 60, referenceValueCents: 10000 }],
    blocks: [],
    occupiedStartsAt: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // "Hoje" fixado em 13/08/2026 (quinta-feira), mesma data-base do
  // ambiente — agosto/2026 é o mês inicialmente exibido pelo calendário.
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 13, 12, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

describe("app/client-booking.tsx — origem real de allowedWeekdays", () => {
  it("marca como disponível apenas os dias reais configurados pelo prestador (terça/quinta), não o array fixo antigo", async () => {
    mockRpc.mockResolvedValue({ data: [bookingContext()], error: null });

    const view = await render(<ClientBookingScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    // 17/08/2026 é segunda-feira — fora do subconjunto [2,4] configurado:
    // deve continuar indisponível mesmo caindo dentro do antigo fixo
    // [1,2,3,4,5] (que incluiria segunda-feira).
    await waitFor(() => {
      expect(
        view.getByLabelText("17 de agosto de 2026, indisponível"),
      ).toBeTruthy();
    });
    // 18/08/2026 é terça-feira — dentro do subconjunto real configurado.
    expect(
      view.getByLabelText("18 de agosto de 2026, disponível"),
    ).toBeTruthy();
    // 20/08/2026 é quinta-feira — também dentro do subconjunto real.
    expect(
      view.getByLabelText("20 de agosto de 2026, disponível"),
    ).toBeTruthy();
  });

  it("exibe aviso defensivo quando attendanceDays chega vazio, em vez de um calendário mudo (RN-AGD-025, defesa em profundidade)", async () => {
    mockRpc.mockResolvedValue({
      data: [bookingContext({ attendanceDays: [] })],
      error: null,
    });

    const view = await render(<ClientBookingScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    expect(
      await view.findByText(
        "Este prestador ainda não tem horários disponíveis configurados. Tente novamente mais tarde.",
      ),
    ).toBeTruthy();
  });

  it("não exibe o aviso defensivo quando attendanceDays vem preenchido normalmente", async () => {
    mockRpc.mockResolvedValue({ data: [bookingContext()], error: null });

    const view = await render(<ClientBookingScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    await waitFor(() => {
      expect(view.getByLabelText("18 de agosto de 2026, disponível")).toBeTruthy();
    });

    expect(
      view.queryByText(
        "Este prestador ainda não tem horários disponíveis configurados. Tente novamente mais tarde.",
      ),
    ).toBeNull();
  });
});
