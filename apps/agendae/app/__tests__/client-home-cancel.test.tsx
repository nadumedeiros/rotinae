// RF-CAN-005, RN-CAN-008/009 (BACKLOG.md DEC-146/DEC-148, BLG-090) — o
// painel "Próximos atendimentos" de `app/client-home.tsx` ganha a ação
// "Cancelar agendamento" pelo cliente, reaproveitando
// `appointmentService.cancelAppointment` (já genérico para o ator
// cliente). Cobre: renderização do botão em cada card, modal de
// confirmação com motivo opcional, sucesso (fecha o modal de confirmação,
// mostra o modal de sucesso e só então refaz `loadHome()`, removendo o
// card) e erro (mensagem inline, modal permanece aberto, motivo já
// digitado não é descartado).
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";

import ClientHomeScreen from "../client-home";
import { AppointmentError } from "@/src/domain/agenda/types";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, []),
}));
jest.mock("@/src/components/layout/authenticated-header", () => ({
  AuthenticatedHeader: () => null,
}));
jest.mock("@/src/components/layout/client-mobile-tab-bar", () => ({
  ClientMobileTabBar: () => null,
}));
// Icon font loading is unrelated to cancellation and schedules native timers.
jest.mock("@/src/components/ui/app-icon", () => ({ AppIcon: () => null }));

const mockGetSession = jest.fn();
jest.mock("@/src/infra/auth/supabase-auth-adapter", () => ({
  supabaseAuthService: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
  },
}));

const mockListClientProviderLinks = jest.fn();
const mockRedeemProviderLinkCode = jest.fn();
jest.mock("@/src/infra/clients/supabase-client-portfolio-adapter", () => ({
  clientPortfolioService: {
    listClientProviderLinks: (...args: unknown[]) => mockListClientProviderLinks(...args),
    redeemProviderLinkCode: (...args: unknown[]) => mockRedeemProviderLinkCode(...args),
  },
}));

const mockListAppointments = jest.fn();
const mockCancelAppointment = jest.fn();
jest.mock("@/src/infra/agenda/supabase-appointment-adapter", () => ({
  appointmentService: {
    listAppointments: (...args: unknown[]) => mockListAppointments(...args),
    cancelAppointment: (...args: unknown[]) => mockCancelAppointment(...args),
  },
}));

const providerLink = {
  id: "link-1",
  tenantId: "tenant-1",
  providerName: "Dra. Ana Ribeiro",
  profession: null,
  status: "active",
  requestedAt: "2026-01-01T00:00:00.000Z",
};

function makeAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: "appt-1",
    tenantId: "tenant-1",
    clientId: "client-1",
    serviceId: "service-1",
    serviceNameSnapshot: "Acompanhamento nutricional",
    valueCentsSnapshot: 10000,
    // Data fixa bem além de qualquer janela de 24h em relação a
    // `jest.setSystemTime` (13/08/2026 12:00) abaixo — mantém os testes já
    // existentes de "Cancelar" (>= 24h) passando sem alteração.
    startsAt: "2026-08-20T15:00:00.000Z",
    timezone: "America/Sao_Paulo",
    durationMinutes: 60,
    state: "scheduled",
    confirmationStatus: "confirmed",
    confirmationSource: "provider_manual",
    confirmedAt: "2026-08-01T00:00:00.000Z",
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

const emptyPage = { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 };

let cancelled = false;

beforeEach(() => {
  jest.clearAllMocks();
  cancelled = false;
  mockGetSession.mockResolvedValue({ user: { displayName: "Maria" } });
  mockListClientProviderLinks.mockResolvedValue([providerLink]);
  mockListAppointments.mockImplementation((query: { month: string }) => {
    if (query.month !== "2026-08") return Promise.resolve(emptyPage);
    return Promise.resolve(
      cancelled
        ? emptyPage
        : { items: [makeAppointment()], page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
    );
  });
  mockCancelAppointment.mockImplementation(async () => {
    cancelled = true;
    return makeAppointment({ state: "cancelled" });
  });

  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 13, 12, 0, 0));
});

afterEach(() => {
  // Ver nota equivalente em `agenda-delete-restriction.test.tsx`: restaurar
  // timers reais e desmontar explicitamente antes do próximo teste evita
  // vazamento de efeitos pendentes (`useFocusEffect`) entre testes.
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("app/client-home.tsx — cancelamento de agendamento pelo cliente", () => {
  it("exibe o botão 'Cancelar' em cada card de 'Próximos atendimentos'", async () => {
    const view = await render(<ClientHomeScreen />);
    await waitFor(() => expect(mockListAppointments).toHaveBeenCalled());

    await waitFor(() =>
      expect(
        view.getByLabelText(
          "Cancelar agendamento de Acompanhamento nutricional em 20/AGO às 12:00",
        ),
      ).toBeTruthy(),
    );
  });

  it("fecha o modal sem chamar cancelAppointment ao pressionar Voltar", async () => {
    const view = await render(<ClientHomeScreen />);
    await waitFor(() =>
      expect(view.getByText("Acompanhamento nutricional")).toBeTruthy(),
    );

    await fireEvent.press(
      view.getByLabelText(
        "Cancelar agendamento de Acompanhamento nutricional em 20/AGO às 12:00",
      ),
    );
    expect(view.getByText("Cancelar agendamento?")).toBeTruthy();

    await fireEvent.press(view.getByText("Voltar"));
    expect(view.queryByText("Cancelar agendamento?")).toBeNull();
    expect(mockCancelAppointment).not.toHaveBeenCalled();
  });

  it("cancela com sucesso, mostra o modal de sucesso e remove o card da lista após 'Entendi'", async () => {
    const view = await render(<ClientHomeScreen />);
    await waitFor(() =>
      expect(view.getByText("Acompanhamento nutricional")).toBeTruthy(),
    );

    await fireEvent.press(
      view.getByLabelText(
        "Cancelar agendamento de Acompanhamento nutricional em 20/AGO às 12:00",
      ),
    );
    await fireEvent.changeText(
      view.getByLabelText("Motivo do cancelamento para o prestador"),
      "Preciso reorganizar minha agenda",
    );
    await fireEvent.press(view.getByText("Confirmar"));

    expect(mockCancelAppointment).toHaveBeenCalledWith("appt-1", {
      reason: "Preciso reorganizar minha agenda",
    });
    expect(view.getByText("Agendamento cancelado")).toBeTruthy();
    expect(view.queryByText("Cancelar agendamento?")).toBeNull();

    await fireEvent.press(view.getByText("Entendi"));

    await waitFor(() =>
      expect(view.queryByText("Acompanhamento nutricional")).toBeNull(),
    );
  });

  it("mantém o modal aberto com erro inline e sem descartar o motivo já digitado quando o cancelamento falha", async () => {
    mockCancelAppointment.mockRejectedValueOnce(new Error("Falha simulada de rede"));

    const view = await render(<ClientHomeScreen />);
    await waitFor(() =>
      expect(view.getByText("Acompanhamento nutricional")).toBeTruthy(),
    );

    await fireEvent.press(
      view.getByLabelText(
        "Cancelar agendamento de Acompanhamento nutricional em 20/AGO às 12:00",
      ),
    );
    await fireEvent.changeText(
      view.getByLabelText("Motivo do cancelamento para o prestador"),
      "Preciso remarcar",
    );
    await fireEvent.press(view.getByText("Confirmar"));

    expect(view.getByText("Falha simulada de rede")).toBeTruthy();
    expect(view.getByText("Cancelar agendamento?")).toBeTruthy();
    expect(view.getByDisplayValue("Preciso remarcar")).toBeTruthy();
  });
});

// RN-CAN-009 (revisada por DEC-150)/RN-CAN-015/016, RF-CAN-007/008
// (BACKLOG.md BLG-092) — estado bloqueado do cancelamento dentro da janela
// de 24h: rótulo/ícone do botão do card, modal informativo "Contatar
// prestador" e o tratamento do erro de corrida
// `CANCELLATION_ADVANCE_NOTICE_INVALID` (botão de confirmação desabilitado
// permanentemente, nunca por comparação de texto).
describe("app/client-home.tsx — estado bloqueado do cancelamento dentro de 24h (DEC-150/DEC-152, BLG-092)", () => {
  it("exibe 'Cancelar' (ícone error) para >= 24h de antecedência e 'Contatar prestador' (ícone warning) para < 24h, cada um abrindo o modal correto", async () => {
    const nowMs = Date.now();
    // Limite exato coberto pela migration/adapter de Chris (DEC-154): 23h59
    // fica bloqueado, 24h01 permanece liberado — mesmo par de casos de borda
    // usado nos testes de aritmética da migration.
    const blockedIso = new Date(nowMs + 23 * 60 * 60 * 1000 + 59 * 60 * 1000).toISOString();
    const allowedIso = new Date(nowMs + 24 * 60 * 60 * 1000 + 60 * 1000).toISOString();

    mockListAppointments.mockImplementation((query: { month: string }) => {
      if (query.month !== "2026-08") return Promise.resolve(emptyPage);
      return Promise.resolve({
        items: [
          makeAppointment({
            id: "appt-blocked",
            startsAt: blockedIso,
            serviceNameSnapshot: "Atendimento em menos de 24h",
          }),
          makeAppointment({
            id: "appt-allowed",
            startsAt: allowedIso,
            serviceNameSnapshot: "Atendimento em mais de 24h",
          }),
        ],
        page: 1,
        pageSize: 10,
        totalItems: 2,
        totalPages: 1,
      });
    });

    const view = await render(<ClientHomeScreen />);
    await waitFor(() =>
      expect(view.getByText("Atendimento em menos de 24h")).toBeTruthy(),
    );
    expect(view.getByText("Atendimento em mais de 24h")).toBeTruthy();

    // Botão bloqueado: rótulo/ícone e accessibilityLabel distintos, nunca
    // oculto (seção 13.2 do handoff de UX).
    const contactButton = view.getByText("Contatar prestador");
    expect(contactButton).toBeTruthy();
    expect(
      view.getByLabelText(
        "Cancelamento indisponível a menos de 24 horas do atendimento — contatar Dra. Ana Ribeiro em vez de cancelar por aqui",
      ),
    ).toBeTruthy();

    // Botão liberado: comportamento hoje já implementado, sem mudança.
    expect(view.getByText("Cancelar")).toBeTruthy();

    await fireEvent.press(contactButton);
    expect(view.getByText("Menos de 24h para o atendimento")).toBeTruthy();
    expect(
      view.getByText(/Entre em contato diretamente com Dra\. Ana Ribeiro/),
    ).toBeTruthy();
    expect(mockCancelAppointment).not.toHaveBeenCalled();
    expect(view.queryByText("Cancelar agendamento?")).toBeNull();

    await fireEvent.press(view.getByText("Entendi"));
    expect(view.queryByText("Menos de 24h para o atendimento")).toBeNull();
  });

  it("desabilita permanentemente o botão de confirmação após o erro CANCELLATION_ADVANCE_NOTICE_INVALID (corrida de tempo), sem permitir nova tentativa", async () => {
    const raceError = new AppointmentError(
      "CANCELLATION_ADVANCE_NOTICE_INVALID",
      "Este atendimento já está a menos de 24 horas do horário marcado. Não é possível concluir o cancelamento por aqui — entre em contato diretamente com o prestador.",
    );
    mockCancelAppointment.mockRejectedValueOnce(raceError);

    const view = await render(<ClientHomeScreen />);
    await waitFor(() =>
      expect(view.getByText("Acompanhamento nutricional")).toBeTruthy(),
    );

    await fireEvent.press(
      view.getByLabelText(
        "Cancelar agendamento de Acompanhamento nutricional em 20/AGO às 12:00",
      ),
    );
    await fireEvent.press(view.getByText("Confirmar"));

    await waitFor(() => expect(mockCancelAppointment).toHaveBeenCalledTimes(1));
    expect(view.getByText(raceError.message)).toBeTruthy();
    // Modal de confirmação continua aberto (não é o mesmo tratamento do
    // modal informativo "Contatar prestador").
    expect(view.getByText("Cancelar agendamento?")).toBeTruthy();

    // Nova tentativa de "Confirmar" está fadada a falhar de
    // novo — o botão fica desabilitado permanentemente, diferente do erro
    // genérico (que reabilita para nova tentativa). Confirma que nenhuma
    // segunda chamada é disparada.
    await fireEvent.press(view.getByText("Confirmar"));
    expect(mockCancelAppointment).toHaveBeenCalledTimes(1);

    // "Voltar" continua disponível como único caminho de saída.
    await fireEvent.press(view.getByText("Voltar"));
    expect(view.queryByText("Cancelar agendamento?")).toBeNull();
  });

  it("distingue o erro de corrida de um erro genérico: erro genérico reabilita o botão para nova tentativa", async () => {
    mockCancelAppointment
      .mockRejectedValueOnce(new Error("Falha simulada de rede"))
      .mockImplementationOnce(async () => {
        cancelled = true;
        return makeAppointment({ state: "cancelled" });
      });

    const view = await render(<ClientHomeScreen />);
    await waitFor(() =>
      expect(view.getByText("Acompanhamento nutricional")).toBeTruthy(),
    );

    await fireEvent.press(
      view.getByLabelText(
        "Cancelar agendamento de Acompanhamento nutricional em 20/AGO às 12:00",
      ),
    );
    await fireEvent.press(view.getByText("Confirmar"));
    await waitFor(() => expect(mockCancelAppointment).toHaveBeenCalledTimes(1));
    expect(view.getByText("Falha simulada de rede")).toBeTruthy();

    // Erro genérico (não `CANCELLATION_ADVANCE_NOTICE_INVALID`): botão
    // continua habilitado e uma nova tentativa dispara nova chamada.
    await fireEvent.press(view.getByText("Confirmar"));
    await waitFor(() => expect(mockCancelAppointment).toHaveBeenCalledTimes(2));
  });
});
