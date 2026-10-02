// RN-CAN-012–014, RF-CAN-006 (BACKLOG.md DEC-147/DEC-148, BLG-091) —
// "Excluir agendamento" em `app/agenda.tsx` deixa de ficar disponível
// sempre que o agendamento tem um cliente com conta de usuário vinculada
// (`clients.client_user_id` preenchido), independentemente do status do
// cadastro do cliente (ativo/inativo). O ícone permanece visível na mesma
// posição (nunca escondido — Nielsen #1/#6, docs/HANDOFF_CANCELAMENTO_
// CLIENTE_UX_DANTE.md seção 6.2), só com opacidade reduzida, e o toque abre
// um modal informativo em vez do modal de exclusão definitiva.
//
// Cobre também o achado técnico da seção 7 do handoff: `loadReferenceData()`
// precisa resolver `clientId -> clientUserId` a partir da lista COMPLETA de
// clientes (ativos + inativos), não apenas da lista filtrada por
// `status: "active"` usada no seletor do formulário — do contrário, um
// cliente inativo com conta vinculada seria tratado como "sem cliente
// vinculado" e "Excluir" ficaria indevidamente habilitado.
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";

import AgendaScreen from "../agenda";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), setParams: jest.fn() },
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

const mockListAppointments = jest.fn();
const mockListAvailabilityBlocks = jest.fn();
const mockDeleteAppointment = jest.fn();
jest.mock("@/src/infra/agenda/supabase-appointment-adapter", () => ({
  appointmentService: {
    listAppointments: (...args: unknown[]) => mockListAppointments(...args),
    listAvailabilityBlocks: (...args: unknown[]) => mockListAvailabilityBlocks(...args),
    createAppointment: jest.fn(),
    createAvailabilityBlock: jest.fn(),
    updateAppointment: jest.fn(),
    deleteAvailabilityBlock: jest.fn(),
    deleteAppointment: (...args: unknown[]) => mockDeleteAppointment(...args),
    cancelAppointment: jest.fn(),
    confirmManually: jest.fn(),
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

const mockListClients = jest.fn();
jest.mock("@/src/infra/clients/supabase-client-portfolio-adapter", () => ({
  clientPortfolioService: { listClients: (...args: unknown[]) => mockListClients(...args) },
}));

const mockListServices = jest.fn();
jest.mock("@/src/infra/services/supabase-service-catalog-adapter", () => ({
  serviceCatalogService: { listServices: (...args: unknown[]) => mockListServices(...args) },
}));

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    id: "client-default",
    clientUserId: null,
    recordOrigin: "provider_created",
    name: "Cliente Padrão",
    email: "cliente@example.com",
    phone: null,
    communicationPreferences: {
      whatsappAppointmentConfirmation: false,
      whatsappAppointmentReminder: false,
    },
    status: "active",
    primaryService: null,
    serviceValueCents: 10000,
    bookingPolicy: {
      totalBookingLimit: null,
      dailyBookingLimit: null,
      requestWindowStart: null,
      requestWindowEnd: null,
    },
    lastServiceAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: "appt-default",
    tenantId: "tenant-1",
    clientId: null,
    serviceId: "service-1",
    serviceNameSnapshot: "Serviço Teste",
    valueCentsSnapshot: 10000,
    title: null,
    startsAt: "2026-08-13T15:00:00.000Z",
    timezone: "America/Sao_Paulo",
    durationMinutes: 60,
    state: "scheduled",
    confirmationStatus: "pending",
    confirmationSource: null,
    confirmedAt: null,
    clientMessage: null,
    internalNotes: null,
    cancellationReason: null,
    cancelledBy: null,
    cancelledAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    recurrenceGroupId: null,
    recurrenceIndex: null,
    recurrenceCount: null,
    ...overrides,
  };
}

const clientNoAccount = makeClient({
  id: "client-no-account",
  name: "Cliente Sem Conta",
  clientUserId: null,
  status: "active",
});
const clientWithAccount = makeClient({
  id: "client-with-account",
  name: "Cliente Com Conta",
  clientUserId: "user-active",
  status: "active",
});
const clientInactiveWithAccount = makeClient({
  id: "client-inactive-with-account",
  name: "Cliente Inativo Com Conta",
  clientUserId: "user-inactive",
  status: "inactive",
});

const apptNone = makeAppointment({
  id: "appt-none",
  clientId: null,
  startsAt: "2026-08-13T15:00:00.000Z",
});
const apptNoAccount = makeAppointment({
  id: "appt-no-account",
  clientId: "client-no-account",
  startsAt: "2026-08-13T15:10:00.000Z",
});
const apptWithAccount = makeAppointment({
  id: "appt-with-account",
  clientId: "client-with-account",
  startsAt: "2026-08-13T15:20:00.000Z",
});
const apptInactiveWithAccount = makeAppointment({
  id: "appt-inactive-with-account",
  clientId: "client-inactive-with-account",
  startsAt: "2026-08-13T15:30:00.000Z",
});

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
  mockListAppointments.mockResolvedValue({
    items: [apptNone, apptNoAccount, apptWithAccount, apptInactiveWithAccount],
    page: 1,
    pageSize: 10,
    totalItems: 4,
    totalPages: 1,
  });
  mockListAvailabilityBlocks.mockResolvedValue([]);
  // Sem filtro de `status` na chamada real (correção da seção 7) — o mock
  // devolve ativos e inativos juntos, como a chamada real passaria a fazer.
  mockListClients.mockResolvedValue({
    items: [clientNoAccount, clientWithAccount, clientInactiveWithAccount],
    page: 1,
    pageSize: 10,
    totalItems: 3,
    totalPages: 1,
  });
  mockListServices.mockResolvedValue([service]);
  mockGetSettings.mockResolvedValue({
    timezone: "America/Sao_Paulo",
    workdayStart: "08:00",
    workdayEnd: "18:00",
    minimumAdvanceHours: 0,
    profession: null,
    attendanceDays: [1, 2, 3, 4, 5],
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 13, 12, 0, 0));
});

afterEach(async () => {
  // A ordem entre `jest.useRealTimers()` e o `cleanup()` automático do
  // Testing Library importa: sem restaurar os timers reais e desmontar
  // explicitamente antes do próximo teste, o `useFocusEffect`/render
  // anterior pode vazar para o teste seguinte (efeitos pendentes com
  // timers falsos já revertidos), causando "overlapping act() calls" e
  // `appointmentService.listAppointments` não sendo chamado no teste
  // seguinte.
  jest.useRealTimers();
  await cleanup();
});

describe("app/agenda.tsx — restrição do 'Excluir agendamento' a agendamentos sem cliente com conta vinculada", () => {
  it("mantém 'Excluir' habilitado e abre o modal de exclusão definitiva para agendamento sem cliente associado", async () => {
    const view = await render(<AgendaScreen />);
    await waitFor(() => expect(mockListAppointments).toHaveBeenCalled());

    await fireEvent.press(await waitFor(() => view.getByLabelText("Ações para Agendamento manual")));
    await fireEvent.press(view.getByText("Excluir agendamento"));

    expect(view.getByText("Excluir agendamento?")).toBeTruthy();
  });

  it("mantém 'Excluir' habilitado para cliente sem conta vinculada (cadastro manual)", async () => {
    const view = await render(<AgendaScreen />);
    await waitFor(() => expect(mockListAppointments).toHaveBeenCalled());

    await fireEvent.press(await waitFor(() => view.getByLabelText("Ações para Cliente Sem Conta")));
    await fireEvent.press(view.getByText("Excluir agendamento"));

    expect(view.getByText("Excluir agendamento?")).toBeTruthy();
  });

  it("desabilita 'Excluir' e abre o modal informativo (não o de exclusão) para cliente ATIVO com conta vinculada", async () => {
    const view = await render(<AgendaScreen />);
    await waitFor(() => expect(mockListAppointments).toHaveBeenCalled());

    await fireEvent.press(await waitFor(() => view.getByLabelText("Ações para Cliente Com Conta")));
    await fireEvent.press(view.getByText("Excluir (indisponível — use Cancelar)"));

    expect(
      view.getByText("Este agendamento não pode ser excluído"),
    ).toBeTruthy();
    expect(view.queryByText("Excluir agendamento?")).toBeNull();
  });

  it("aplica a mesma restrição para cliente INATIVO com conta vinculada (regressão da correção de loadReferenceData, seção 7 do handoff)", async () => {
    const view = await render(<AgendaScreen />);
    await waitFor(() => expect(mockListAppointments).toHaveBeenCalled());

    // Os dois agendamentos com cliente de conta vinculada (ativo e
    // inativo) devem compartilhar o mesmo rótulo restrito — se a correção
    // da seção 7 não estivesse aplicada, o cliente inativo cairia no mapa
    // incompleto (só ativos) e "Excluir" ficaria diretamente habilitado.
    // Clientes inativos não entram nas opções visuais do formulário e, por
    // isso, o card usa o fallback "Cliente"; o mapa completo de vínculos
    // ainda precisa manter a ação restrita.
    await fireEvent.press(await waitFor(() => view.getByLabelText("Ações para Cliente")));
    await fireEvent.press(view.getByText("Excluir (indisponível — use Cancelar)"));
    expect(view.getByText("Este agendamento não pode ser excluído")).toBeTruthy();
  });

  it("nunca chama deleteAppointment ao tocar no ícone desabilitado", async () => {
    const view = await render(<AgendaScreen />);
    await waitFor(() => expect(mockListAppointments).toHaveBeenCalled());

    await fireEvent.press(await waitFor(() => view.getByLabelText("Ações para Cliente Com Conta")));
    await fireEvent.press(view.getByText("Excluir (indisponível — use Cancelar)"));
    expect(
      view.getByText("Este agendamento não pode ser excluído"),
    ).toBeTruthy();

    await fireEvent.press(view.getByText("Entendi"));
    expect(view.queryByText("Este agendamento não pode ser excluído")).toBeNull();

    expect(mockDeleteAppointment).not.toHaveBeenCalled();
  });
});
