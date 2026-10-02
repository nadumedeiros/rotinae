// Cobre o bug real encontrado em auditoria (Leon/QA) em
// `app/client-booking.tsx`: dentro de `loadContext()`, `unavailableSlots`
// era montado com `flatMap` sobre `occupiedStartsAt` de TODOS os
// prestadores retornados por `get_client_booking_context` no mesmo
// carregamento, sem nenhum identificador de tenant/prestador no id
// (`open-${dateKey}-${time}`). Resultado: um cliente vinculado a 2+
// prestadores que, por coincidência, têm um horário ocupado na mesma
// data/hora civil, via um compromisso do Prestador A, também via como
// indisponível um horário do Prestador B em que ele NÃO tem nenhum
// compromisso — falsa indisponibilidade.
//
// Este teste reproduz exatamente o cenário de colisão: Prestador A tem
// compromissos às 09:00 E às 11:00 de 18/08/2026 (terça); Prestador B tem
// compromisso apenas às 09:00 do MESMO dia (coincidência real com A). A
// correção deve escopar `unavailableSlots` por tenantId, então trocar o
// prestador selecionado nunca pode fazer o horário das 11:00 (só ocupado
// para A) aparecer como indisponível para B.
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
    attendanceDays: [2], // terça-feira apenas, suficiente para 18/08/2026
    primaryServiceId: "service-1",
    timezone: "America/Sao_Paulo",
    workdayStart: "08:00:00",
    workdayEnd: "12:00:00", // 4 vagas: 08:00, 09:00, 10:00, 11:00
    minimumAdvanceHours: 0,
    services: [{ id: "service-1", name: "Serviço", durationMinutes: 60, referenceValueCents: 10000 }],
    blocks: [],
    occupiedStartsAt: [],
    ...overrides,
  };
}

/**
 * Sobe a árvore de test instances a partir de um nó (ex.: o Text de um
 * horário de vaga) até encontrar o host View renderizado pelo `Pressable`
 * ancestral — identificado por possuir `accessibilityState`, o mesmo
 * mecanismo usado em `app/client-booking.tsx` via
 * `accessibilityState={{ selected, disabled: unavailable }}`.
 */
function findAncestorPressableHost(instance: unknown) {
  let current = instance as { props?: Record<string, unknown>; parent?: unknown } | null;
  while (current) {
    if (current.props && "accessibilityState" in current.props) return current;
    current = (current.parent ?? null) as typeof current;
  }
  throw new Error("Nenhum host de Pressable ancestral encontrado para o nó informado.");
}

function isSlotDisabled(view: Awaited<ReturnType<typeof render>>, time: string): boolean {
  const timeText = view.getByText(time);
  const slotHost = findAncestorPressableHost(timeText);
  const accessibilityState = slotHost.props?.accessibilityState as { disabled?: boolean } | undefined;
  return accessibilityState?.disabled === true;
}

beforeEach(() => {
  jest.clearAllMocks();
  // "Hoje" fixado em 13/08/2026 (quinta-feira) — mesma data-base usada nos
  // demais testes de client-booking; agosto/2026 é o mês inicialmente
  // exibido pelo calendário e 18/08/2026 (terça) está à frente de "hoje".
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 13, 12, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

describe("app/client-booking.tsx — unavailableSlots escopado por prestador", () => {
  it("não marca o horário livre de um prestador como indisponível por causa de compromisso de outro prestador na mesma data/hora civil", async () => {
    const providerA = bookingContext({
      tenantId: "tenant-1",
      providerId: "provider-1",
      providerName: "Dra. Ana Ribeiro",
      // 09:00 e 11:00 (America/Sao_Paulo, UTC-3) ocupados só para A.
      occupiedStartsAt: ["2026-08-18T12:00:00.000Z", "2026-08-18T14:00:00.000Z"],
    });
    const providerB = bookingContext({
      tenantId: "tenant-2",
      providerId: "provider-2",
      providerName: "Lucas Mendes",
      // Mesma data/hora civil que UM dos compromissos de A (09:00) — a
      // coincidência real descrita na auditoria — mas SEM nenhum
      // compromisso às 11:00.
      occupiedStartsAt: ["2026-08-18T12:00:00.000Z"],
    });
    mockRpc.mockResolvedValue({ data: [providerA, providerB], error: null });

    const view = await render(<ClientBookingScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    // Prestador A (selecionado por padrão) — seleciona o dia 18/08/2026.
    await waitFor(() => {
      expect(
        view.getByLabelText("18 de agosto de 2026, disponível"),
      ).toBeTruthy();
    });
    await fireEvent.press(view.getByLabelText("18 de agosto de 2026, disponível"));

    // Para A: 09:00 e 11:00 devem estar indisponíveis (compromissos reais
    // dele); 08:00 e 10:00 devem continuar livres.
    await waitFor(() => expect(isSlotDisabled(view, "09:00")).toBe(true));
    expect(isSlotDisabled(view, "11:00")).toBe(true);
    expect(isSlotDisabled(view, "08:00")).toBe(false);
    expect(isSlotDisabled(view, "10:00")).toBe(false);

    // Troca para o Prestador B — isso reseta `selectedDay`, então o dia
    // precisa ser selecionado novamente. Há duas ocorrências do texto
    // "Lucas Mendes" na tela: o card de seleção de prestador (Passo 1,
    // primeiro no DOM) e um texto fixo/placeholder no painel de resumo,
    // não relacionado a este bug — usamos a primeira ocorrência.
    await fireEvent.press(view.getAllByText("Lucas Mendes")[0]);
    await waitFor(() => {
      expect(
        view.getByLabelText("18 de agosto de 2026, disponível"),
      ).toBeTruthy();
    });
    await fireEvent.press(view.getByLabelText("18 de agosto de 2026, disponível"));

    // Para B: 09:00 continua indisponível (compromisso real dele, mesma
    // data/hora civil de A). 11:00, porém, NUNCA deveria aparecer como
    // indisponível para B — ele não tem nenhum compromisso ali; isso só
    // ocorreria se `unavailableSlots` ainda estivesse vazando o
    // compromisso de A por falta de escopo por tenant (o bug relatado).
    await waitFor(() => expect(isSlotDisabled(view, "09:00")).toBe(true));
    expect(isSlotDisabled(view, "11:00")).toBe(false);
    expect(isSlotDisabled(view, "08:00")).toBe(false);
    expect(isSlotDisabled(view, "10:00")).toBe(false);
  });
});
