// Cobre o bug de escrita de fuso encontrado pelo Leon (QA): `confirmBooking`
// em `app/client-booking.tsx` gravava `starts_at` fazendo
// `new Date(`${dateKey}T${time}:00`).toISOString()`, que interpreta a
// data/hora de parede escolhida pelo cliente no fuso do DISPOSITIVO em
// execução, não no fuso configurado em `tenants.timezone`. A correção
// (Chris) usa `zonedDateTimeToUtcIso` (`src/domain/agenda/timezone.ts`), que
// sempre usa o fuso do TENANT explicitamente, independente do fuso do
// ambiente que executa o código.
//
// Nota sobre a estratégia deste teste: `process.env.TZ` alterado em tempo de
// execução dentro do sandbox do Jest (com fake timers ativos) NÃO afeta a
// interpretação de `new Date(string)` neste projeto (verificado
// empiricamente — o fuso "de dispositivo" observado por `new Date(...)`
// permanece fixo no fuso padrão do ambiente, "America/Sao_Paulo", mesmo após
// reatribuir `process.env.TZ`). Por isso o teste não tenta simular um
// "dispositivo em outro fuso" via `process.env.TZ` — em vez disso, escolhe um
// fuso de TENANT deliberadamente diferente do fuso fixo do ambiente
// ("America/New_York" vs. o "America/Sao_Paulo" do ambiente). Isso ainda
// expõe o bug: com o código antigo, `new Date(...).toISOString()` sempre
// produziria o instante como se fosse America/Sao_Paulo (o fuso do
// ambiente), ignorando o fuso real do tenant — o valor esperado abaixo só é
// alcançado usando `zonedDateTimeToUtcIso` com o fuso do tenant.
import { fireEvent, render, waitFor } from "@testing-library/react-native";
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

const mockCreateAppointment = jest.fn();
jest.mock("@/src/infra/agenda/supabase-appointment-adapter", () => ({
  appointmentService: {
    createAppointment: (...args: unknown[]) => mockCreateAppointment(...args),
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
    attendanceDays: [2], // terça-feira apenas — 18/08/2026 é terça.
    primaryServiceId: "service-1",
    // Deliberadamente diferente do fuso fixo do ambiente de teste
    // (America/Sao_Paulo) — ver nota de estratégia no topo do arquivo.
    timezone: "America/New_York",
    workdayStart: "08:00:00",
    workdayEnd: "12:00:00", // 4 vagas: 08:00, 09:00, 10:00, 11:00
    minimumAdvanceHours: 0,
    services: [{ id: "service-1", name: "Serviço", durationMinutes: 60, referenceValueCents: 10000 }],
    blocks: [],
    occupiedStartsAt: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateAppointment.mockResolvedValue({ id: "appointment-1" });
  jest.useFakeTimers();
  // "Hoje" fixado em 13/08/2026 (quinta-feira), mesma data-base dos demais
  // testes de client-booking; agosto/2026 é o mês inicialmente exibido.
  jest.setSystemTime(new Date(2026, 7, 13, 12, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

describe("app/client-booking.tsx — confirmBooking grava o instante UTC no fuso do tenant", () => {
  it("usa o fuso do tenant (America/New_York) para montar startsAt, não o fuso fixo do ambiente (America/Sao_Paulo)", async () => {
    mockRpc.mockResolvedValue({ data: [bookingContext()], error: null });

    const view = await render(<ClientBookingScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    await waitFor(() => {
      expect(
        view.getByLabelText("18 de agosto de 2026, disponível"),
      ).toBeTruthy();
    });
    await fireEvent.press(view.getByLabelText("18 de agosto de 2026, disponível"));

    await waitFor(() => expect(view.getByText("09:00")).toBeTruthy());
    await fireEvent.press(view.getByText("09:00"));

    await fireEvent.press(view.getByText("Adicionar à seleção"));
    await fireEvent.press(view.getByText("Revisar agendamentos"));

    await waitFor(() => expect(view.getByText("Confirmar")).toBeTruthy());
    await fireEvent.press(view.getByText("Confirmar"));

    await waitFor(() => expect(mockCreateAppointment).toHaveBeenCalled());
    // 09:00 em America/New_York (UTC-04, EDT em agosto) == 13:00 UTC. Se o
    // bug antigo estivesse presente, `new Date("2026-08-18T09:00:00").
    // toISOString()` seria interpretado no fuso fixo do ambiente
    // (America/Sao_Paulo, UTC-03) e produziria "2026-08-18T12:00:00.000Z"
    // — uma hora ANTES do valor correto, ignorando por completo o fuso real
    // do tenant.
    expect(mockCreateAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: "2026-08-18T13:00:00.000Z",
        timezone: "America/New_York",
      }),
    );
  });
});
