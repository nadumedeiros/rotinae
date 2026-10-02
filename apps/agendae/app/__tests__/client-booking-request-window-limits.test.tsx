// RN-AGD-030 (20260823140000_client_booking_context_request_window_limits.sql)
// — `get_client_booking_context` passou a retornar, por prestador vinculado
// ao cliente, `requestWindowStart`/`requestWindowEnd` ("Período para
// solicitar" configurado para este cliente), `totalBookingLimit`/
// `dailyBookingLimit` e `totalBookingCount`. Antes desta correção, o
// calendário de `app/client-booking.tsx` mostrava dias como disponíveis
// mesmo fora do período liberado ou com o limite total já atingido — o
// cliente só descobria ao tentar confirmar (`OUTSIDE_ALLOWED_PERIOD`/
// `TOTAL_LIMIT_REACHED`, validação real e correta do backend, não alterada
// por esta correção). Este arquivo cobre o feedback visual antecipado.
import { fireEvent, render, waitFor, act } from "@testing-library/react-native";
import { AppState } from "react-native";
import React from "react";

import ClientBookingScreen from "../client-booking";

// BLG-077: `client-booking.tsx` usa `useFocusEffect` (refetch em foco/
// retorno); mesmo mock reduzido a `useEffect(effect, [])` já usado nos
// demais testes deste arquivo — o efeito real de refetch em segundo plano é
// coberto aqui via o listener real de `AppState` (não mockado).
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

const mockCreateAppointment = jest.fn();
jest.mock("@/src/infra/agenda/supabase-appointment-adapter", () => ({
  appointmentService: {
    createAppointment: (...args: unknown[]) => mockCreateAppointment(...args),
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
    attendanceDays: [0, 1, 2, 3, 4, 5, 6],
    primaryServiceId: "service-1",
    timezone: "America/Sao_Paulo",
    workdayStart: "08:00:00",
    workdayEnd: "12:00:00",
    minimumAdvanceHours: 0,
    services: [{ id: "service-1", name: "Serviço", durationMinutes: 60, referenceValueCents: 10000 }],
    blocks: [],
    occupiedStartsAt: [],
    requestWindowStart: null,
    requestWindowEnd: null,
    totalBookingLimit: null,
    dailyBookingLimit: null,
    totalBookingCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  // "Hoje" fixado em 13/08/2026 (quinta-feira) — mesma data-base dos demais
  // testes de client-booking.
  jest.setSystemTime(new Date(2026, 7, 13, 12, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

describe("app/client-booking.tsx — período liberado (requestWindowStart/End)", () => {
  it("desabilita dias fora do período liberado para este cliente, mesmo sendo dia de atendimento normal", async () => {
    mockRpc.mockResolvedValue({
      data: [
        bookingContext({
          requestWindowStart: "2026-08-20",
          requestWindowEnd: "2026-08-22",
        }),
      ],
      error: null,
    });

    const view = await render(<ClientBookingScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    // 18/08/2026 é terça-feira, dia de atendimento normal, mas ANTES do
    // início do período liberado (20/08) — deve aparecer indisponível.
    await waitFor(() => {
      expect(
        view.getByLabelText("18 de agosto de 2026, indisponível"),
      ).toBeTruthy();
    });
    // 21/08/2026 está dentro do período liberado (20 a 22/08).
    expect(
      view.getByLabelText("21 de agosto de 2026, disponível"),
    ).toBeTruthy();
    // 25/08/2026 está depois do fim do período liberado — indisponível.
    expect(
      view.getByLabelText("25 de agosto de 2026, indisponível"),
    ).toBeTruthy();
  });
});

describe("app/client-booking.tsx — limite total de agendamentos já atingido", () => {
  it("bloqueia o calendário inteiro e exibe aviso explicativo em vez de só dias cinza", async () => {
    mockRpc.mockResolvedValue({
      data: [bookingContext({ totalBookingLimit: 4, totalBookingCount: 4 })],
      error: null,
    });

    const view = await render(<ClientBookingScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    await waitFor(() => {
      expect(
        view.getByText(
          "Você atingiu o limite de 4 agendamentos com este prestador. Fale com ele para renovar.",
        ),
      ).toBeTruthy();
    });
    // Qualquer dia de atendimento normal (18/08, terça) fica indisponível.
    expect(
      view.getByLabelText("18 de agosto de 2026, indisponível"),
    ).toBeTruthy();
  });

  it("não exibe o aviso quando o limite total ainda não foi atingido", async () => {
    mockRpc.mockResolvedValue({
      data: [bookingContext({ totalBookingLimit: 4, totalBookingCount: 2 })],
      error: null,
    });

    const view = await render(<ClientBookingScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    await waitFor(() => {
      expect(
        view.getByLabelText("18 de agosto de 2026, disponível"),
      ).toBeTruthy();
    });
    expect(
      view.queryByText(
        "Você atingiu o limite de 4 agendamentos com este prestador. Fale com ele para renovar.",
      ),
    ).toBeNull();
  });
});

describe("app/client-booking.tsx — 'Revisar agendamentos' contra condição de corrida", () => {
  it("mostra um erro claro em vez de abrir a revisão quando o limite total foi atingido por OUTRO agendamento enquanto o cliente navegava", async () => {
    // Primeira carga: sem nenhuma restrição — o cliente consegue planejar
    // um horário normalmente.
    mockRpc.mockResolvedValueOnce({ data: [bookingContext()], error: null });

    const addEventListenerSpy = jest.spyOn(AppState, "addEventListener");

    const view = await render(<ClientBookingScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      expect(
        view.getByLabelText("18 de agosto de 2026, disponível"),
      ).toBeTruthy();
    });
    await fireEvent.press(view.getByLabelText("18 de agosto de 2026, disponível"));
    await waitFor(() => expect(view.getByText("09:00")).toBeTruthy());
    await fireEvent.press(view.getByText("09:00"));
    await fireEvent.press(view.getByText("Adicionar à seleção"));

    // Enquanto o cliente ainda está na tela, o limite total é atingido por
    // outro agendamento (ex.: feito pelo próprio prestador). A próxima
    // recarga de contexto (`AppState` voltando para "active", mesmo listener
    // real usado por `app/client-booking.tsx`) já traz o limite estourado.
    mockRpc.mockResolvedValueOnce({
      data: [bookingContext({ totalBookingLimit: 1, totalBookingCount: 1 })],
      error: null,
    });
    const changeHandler = addEventListenerSpy.mock.calls.find(
      ([eventName]) => eventName === "change",
    )?.[1] as ((state: string) => void) | undefined;
    expect(changeHandler).toBeDefined();
    await act(async () => {
      changeHandler?.("active");
    });
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(2));

    await fireEvent.press(view.getByText("Revisar agendamentos"));

    await waitFor(() => {
      expect(
        view.getByText(
          "Um dos agendamentos da sua seleção não está mais dentro do período ou limite permitido pelo prestador. Remova-o da lista e escolha outro horário.",
        ),
      ).toBeTruthy();
    });
    // A revisão não deve ter sido aberta com um agendamento fadado a falhar.
    expect(view.queryByText("Confirmar")).toBeNull();
    expect(mockCreateAppointment).not.toHaveBeenCalled();
  });
});
