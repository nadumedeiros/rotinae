// Cobre o bug de escrita de fuso encontrado pelo Leon (QA), mesma causa raiz
// já coberta em `client-booking-timezone.test.tsx`: em `app/agenda.tsx`,
// `localDateTimeToIso` fazia `new Date(\`${year}-${month}-${day}T${time}:00\`)
// .toISOString()`, interpretando a data/hora de parede escolhida pelo
// prestador no fuso do DISPOSITIVO em execução, não no fuso configurado em
// `tenants.timezone` (`providerTimezone` na tela). A correção (Chris) usa
// `zonedDateTimeToUtcIso` (`src/domain/agenda/timezone.ts`) nos 4 pontos que
// dependem de `localDateTimeToIso`: criação de bloqueio de agenda (início e
// fim) e criação de agendamento (único e recorrente).
//
// Nota sobre a estratégia deste teste (mesma de
// `client-booking-timezone.test.tsx`): alterar `process.env.TZ` em tempo de
// execução dentro do sandbox do Jest não afeta a interpretação de
// `new Date(string)` neste projeto — o fuso "de dispositivo" observado por
// `new Date(...)` fica fixo no fuso padrão do ambiente
// ("America/Sao_Paulo"). Por isso o teste usa um fuso de PRESTADOR
// deliberadamente diferente ("America/New_York") para expor o bug: com o
// código antigo, o instante persistido sempre refletiria o fuso do ambiente,
// não o do prestador.
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";

import AgendaScreen from "../agenda";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), setParams: jest.fn() },
  // Fábricas de `jest.mock` só podem referenciar identificadores permitidos
  // por `babel-plugin-jest-hoist` (ver documentação do Jest); `React`
  // importado no topo do arquivo não é um deles, então o require inline é
  // necessário aqui.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, []),
  useLocalSearchParams: () => ({}),
}));
jest.mock("@/src/components/layout/authenticated-header", () => ({
  AuthenticatedHeader: () => null,
}));
jest.mock("@/src/components/layout/mobile-tab-bar", () => ({
  MobileTabBar: () => null,
}));

const mockCreateAppointment = jest.fn();
const mockCreateAvailabilityBlock = jest.fn();
const mockListAppointments = jest.fn();
const mockListAvailabilityBlocks = jest.fn();
jest.mock("@/src/infra/agenda/supabase-appointment-adapter", () => ({
  appointmentService: {
    listAppointments: (...args: unknown[]) => mockListAppointments(...args),
    listAvailabilityBlocks: (...args: unknown[]) => mockListAvailabilityBlocks(...args),
    createAppointment: (...args: unknown[]) => mockCreateAppointment(...args),
    createAvailabilityBlock: (...args: unknown[]) => mockCreateAvailabilityBlock(...args),
    updateAppointment: jest.fn(),
    deleteAvailabilityBlock: jest.fn(),
    deleteAppointment: jest.fn(),
    cancelAppointment: jest.fn(),
    confirmManually: jest.fn().mockResolvedValue(undefined),
    // RN-PLN-018/019 (20260819100000_provider_plan_horizon_limit.sql):
    // `useProviderAppointmentHorizon` (app/agenda.tsx) chama este método
    // incondicionalmente no mount — sem teto por padrão, preservando o
    // comportamento anterior a esta migration para os cenários deste teste
    // (não relacionados a horizonte de plano).
    getAppointmentHorizon: jest.fn().mockResolvedValue({ unrestricted: true, maxAllowedDate: null }),
  },
}));

const mockGetSettings = jest.fn();
jest.mock("@/src/infra/provider/supabase-provider-settings-adapter", () => ({
  providerSettingsService: { getSettings: (...args: unknown[]) => mockGetSettings(...args) },
}));

jest.mock("@/src/infra/clients/supabase-client-portfolio-adapter", () => ({
  clientPortfolioService: {
    listClients: jest.fn().mockResolvedValue({ items: [], totalPages: 1 }),
  },
}));

const mockListServices = jest.fn();
jest.mock("@/src/infra/services/supabase-service-catalog-adapter", () => ({
  serviceCatalogService: { listServices: (...args: unknown[]) => mockListServices(...args) },
}));

// Deliberadamente diferente do fuso fixo do ambiente de teste
// (America/Sao_Paulo) — ver nota de estratégia no topo do arquivo.
const PROVIDER_TIMEZONE = "America/New_York";

const service = {
  id: "service-1",
  name: "Serviço Teste",
  durationMinutes: 60,
  referenceValueCents: 10000,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateAppointment.mockResolvedValue({ id: "appointment-1" });
  mockCreateAvailabilityBlock.mockResolvedValue(undefined);
  mockListAppointments.mockResolvedValue({ items: [], totalPages: 1 });
  mockListAvailabilityBlocks.mockResolvedValue([]);
  mockListServices.mockResolvedValue([service]);
  mockGetSettings.mockResolvedValue({
    timezone: PROVIDER_TIMEZONE,
    workdayStart: "08:00",
    workdayEnd: "18:00",
    minimumAdvanceHours: 0,
    profession: null,
    attendanceDays: [1, 2, 3, 4, 5],
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  jest.useFakeTimers();
  // "Hoje" fixado ao meio-dia para não cruzar fronteira de dia civil.
  jest.setSystemTime(new Date(2026, 7, 13, 12, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

describe("app/agenda.tsx — criação de agendamento e bloqueio grava o instante UTC no fuso do prestador", () => {
  it("usa o fuso do prestador (America/New_York) ao criar um agendamento único, não o fuso fixo do ambiente (America/Sao_Paulo)", async () => {
    const view = await render(<AgendaScreen />);
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());

    await fireEvent.press(view.getAllByText("Novo agendamento")[0]);

    await waitFor(() => expect(view.getByText("Serviço Teste")).toBeTruthy());

    const dateInputs = view.getAllByPlaceholderText("DD/MM/AAAA");
    // Único campo "DD/MM/AAAA" na tela desde a remoção do painel de
    // publicação de vagas (BLG-084/BLG-055, "Publicar horário" era 100%
    // local/fictício e nunca chegava ao cliente) — este é o campo "Data"
    // deste modal de novo agendamento.
    await fireEvent.changeText(dateInputs[0], "20/08/2026");
    await fireEvent.changeText(
      view.getByLabelText("Horário de início no formato hora e minuto"),
      "14:30",
    );

    await fireEvent.press(view.getByText("Agendar"));

    await waitFor(() => expect(mockCreateAppointment).toHaveBeenCalled());
    // 14:30 em America/New_York (UTC-04, EDT em agosto) == 18:30 UTC. Se o
    // bug antigo estivesse presente, o instante seria calculado como se
    // fosse America/Sao_Paulo (fuso fixo do ambiente, UTC-03) e produziria
    // "2026-08-20T17:30:00.000Z" — uma hora ANTES do valor correto.
    expect(mockCreateAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: "2026-08-20T18:30:00.000Z",
        timezone: PROVIDER_TIMEZONE,
      }),
    );
  });

  it("exige título e cria compromisso sem cliente e sem serviço quando o prestador escolhe compromisso livre", async () => {
    const view = await render(<AgendaScreen />);
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());

    await fireEvent.press(view.getAllByText("Novo agendamento")[0]);
    await waitFor(() => expect(view.getByLabelText("Título do compromisso")).toBeTruthy());

    await fireEvent.changeText(view.getByLabelText("Título do compromisso"), "");
    await fireEvent.changeText(view.getByPlaceholderText("DD/MM/AAAA"), "20/08/2026");
    await fireEvent.changeText(
      view.getByLabelText("Horário de início no formato hora e minuto"),
      "14:30",
    );

    await fireEvent.press(view.getByLabelText("Serviço selecionado: Serviço Teste"));
    await fireEvent.press(view.getByLabelText("Criar compromisso sem serviço"));
    await fireEvent.press(view.getByText("Agendar"));

    expect(view.getByText("Informe um título para o compromisso.")).toBeTruthy();
    expect(mockCreateAppointment).not.toHaveBeenCalled();

    await fireEvent.changeText(view.getByLabelText("Título do compromisso"), "Reunião interna");
    await fireEvent.press(view.getByText("Agendar"));

    await waitFor(() => expect(mockCreateAppointment).toHaveBeenCalledTimes(1));
    expect(mockCreateAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: null,
        serviceId: null,
        title: "Reunião interna",
      }),
    );
  });

  it("usa o fuso do prestador (America/New_York) ao criar um bloqueio de agenda, não o fuso fixo do ambiente (America/Sao_Paulo)", async () => {
    const view = await render(<AgendaScreen />);
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());

    await fireEvent.press(view.getByText("Bloquear agenda"));

    const dateInputs = view.getAllByPlaceholderText("DD/MM/AAAA");
    // Desde a remoção do painel de publicação de vagas (BLG-084/BLG-055):
    // índice 0: "Data de início" deste modal de bloqueio; índice 1: "Data de
    // fim".
    await fireEvent.changeText(dateInputs[0], "20/08/2026");
    await fireEvent.changeText(dateInputs[1], "20/08/2026");

    const timeInputs = view.getAllByPlaceholderText("HH:MM");
    // índice 0: "Horário de início"; índice 1: "Horário de fim".
    await fireEvent.changeText(timeInputs[0], "09:00");
    await fireEvent.changeText(timeInputs[1], "10:00");

    await fireEvent.press(view.getByText("Confirmar bloqueio"));

    await waitFor(() => expect(mockCreateAvailabilityBlock).toHaveBeenCalled());
    // 09:00/10:00 em America/New_York (UTC-04, EDT em agosto) ==
    // 13:00/14:00 UTC. Com o bug antigo, o cálculo usaria o fuso fixo do
    // ambiente (America/Sao_Paulo, UTC-03) e produziria
    // "2026-08-20T12:00:00.000Z"/"...T13:00:00.000Z" — uma hora ANTES do
    // valor correto.
    expect(mockCreateAvailabilityBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: "2026-08-20T13:00:00.000Z",
        endsAt: "2026-08-20T14:00:00.000Z",
        timezone: PROVIDER_TIMEZONE,
      }),
    );
  });
});
