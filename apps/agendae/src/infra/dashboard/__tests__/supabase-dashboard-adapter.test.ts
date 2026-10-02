jest.mock("@/src/infra/supabase/client", () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), auth: { getUser: jest.fn() } },
}));

import { supabase } from "@/src/infra/supabase/client";
import {
  mapDashboardError,
  SupabaseDashboardAdapter,
} from "../supabase-dashboard-adapter";

const rpc = supabase.rpc as jest.Mock;
const from = supabase.from as jest.Mock;
const getUser = supabase.auth.getUser as jest.Mock;
const snapshot = {
  generatedAt: "2026-08-11T12:00:00Z",
  timeZone: "America/Sao_Paulo",
  providerDisplayName: "Clínica Real",
  summary: {
    activeClients: 0,
    newClientsThisMonth: 0,
    appointmentsToday: 0,
    completedToday: 0,
    pendingConfirmationToday: 0,
    serviceBalanceCents: 0,
    balanceReferenceMonth: "2026-08",
  },
  todayAppointments: [],
  notifications: [],
  receivablePayments: [],
  receivableTotalCents: 0,
  receivableCount: 0,
};

describe("SupabaseDashboardAdapter", () => {
  beforeEach(() => rpc.mockReset());

  it("returns real zero values only when the RPC confirms an empty snapshot", async () => {
    rpc.mockResolvedValue({ data: snapshot, error: null });
    await expect(new SupabaseDashboardAdapter().getSnapshot()).resolves.toEqual(snapshot);
    expect(rpc).toHaveBeenCalledWith("get_provider_dashboard_snapshot", { p_date: null });
  });

  it("passes an explicit civil date to the server", async () => {
    rpc.mockResolvedValue({ data: snapshot, error: null });
    await new SupabaseDashboardAdapter().getSnapshot({ date: "2026-08-12" });
    expect(rpc).toHaveBeenCalledWith("get_provider_dashboard_snapshot", { p_date: "2026-08-12" });
  });

  it("normalizes authorization, session and network errors", () => {
    expect(mapDashboardError({ code: "42501" }).code).toBe("FORBIDDEN");
    expect(mapDashboardError({ message: "JWT expired" }).code).toBe("SESSION_EXPIRED");
    expect(mapDashboardError({ message: "Failed to fetch" }).code).toBe("NETWORK_ERROR");
  });

  it("rejects an invalid payload instead of inventing zeros", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(new SupabaseDashboardAdapter().getSnapshot()).rejects.toMatchObject({ code: "UNKNOWN" });
  });
});

// Novo painel "Pagamentos a receber" da Home
// (20260906160000_dashboard_receivable_payments.sql): a RPC devolve estes
// campos em snake_case (mesmo padrão de `list_manual_payments`), diferente
// do resto do JSON desta função (já camelCase, consumido direto). O adapter
// precisa mapear explicitamente — e sobreviver a um backend antigo que ainda
// não os retorna.
describe("SupabaseDashboardAdapter — receivablePayments (painel Pagamentos a receber)", () => {
  beforeEach(() => rpc.mockReset());

  it("mapeia receivable_payments/receivable_total_cents/receivable_count (snake_case) para o contrato camelCase", async () => {
    rpc.mockResolvedValue({
      data: {
        ...snapshot,
        receivablePayments: undefined,
        receivableTotalCents: undefined,
        receivableCount: undefined,
        receivable_payments: [
          {
            id: "charge-1",
            client_name: "Maria Silva",
            origin: "Corte de cabelo",
            balance_cents: 25000,
            due_date: "2026-08-01",
            status: "overdue",
          },
          {
            id: "charge-2",
            client_name: null,
            origin: "Manicure",
            balance_cents: 8000,
            due_date: "2026-09-10",
            status: "pending",
          },
        ],
        receivable_total_cents: 33000,
        receivable_count: 2,
      },
      error: null,
    });

    const result = await new SupabaseDashboardAdapter().getSnapshot();

    expect(result.receivablePayments).toEqual([
      {
        id: "charge-1",
        clientName: "Maria Silva",
        origin: "Corte de cabelo",
        balanceCents: 25000,
        dueDate: "2026-08-01",
        status: "overdue",
      },
      {
        id: "charge-2",
        clientName: "Sem cliente",
        origin: "Manicure",
        balanceCents: 8000,
        dueDate: "2026-09-10",
        status: "pending",
      },
    ]);
    expect(result.receivableTotalCents).toBe(33000);
    expect(result.receivableCount).toBe(2);
  });

  it("cai para array vazio e zero quando o backend ainda não devolve estes campos (compatibilidade com deploy em duas etapas)", async () => {
    const legacySnapshot: Record<string, unknown> = { ...snapshot };
    delete legacySnapshot.receivablePayments;
    delete legacySnapshot.receivableTotalCents;
    delete legacySnapshot.receivableCount;

    rpc.mockResolvedValue({ data: legacySnapshot, error: null });

    const result = await new SupabaseDashboardAdapter().getSnapshot();

    expect(result.receivablePayments).toEqual([]);
    expect(result.receivableTotalCents).toBe(0);
    expect(result.receivableCount).toBe(0);
  });
});

// Cobre a mesma decisão de arquitetura de
// supabase/migrations/20260823130000_manual_payments_receipt_history.sql:
// a cobrança principal (`kind: "charge"`) nunca mais tem `value_cents`
// decrementado por pagamento parcial, então somar toda linha
// `status === "received"` sem filtrar `kind` voltaria a contar em dobro (a
// cobrança inteira MAIS os recibos que a quitaram). A fórmula de
// `serviceBalanceCents` do dashboard precisa ficar sincronizada com a de
// `list_manual_payments`/`get_provider_dashboard_snapshot`.
describe("SupabaseDashboardAdapter — serviceBalanceCents (kind-based, sem duplicar pai x recibos)", () => {
  const tz = "America/Sao_Paulo";

  function mockFromImplementation(tables: Record<string, { data: unknown; error: unknown }>) {
    from.mockImplementation((table: string) => {
      const result = tables[table] ?? { data: [], error: null };
      const chain: any = { data: result.data, error: result.error };
      chain.select = jest.fn(() => chain);
      chain.eq = jest.fn(() => chain);
      return { select: chain.select };
    });
  }

  function thisMonthDateString() {
    const monthPrefix = new Intl.DateTimeFormat("sv-SE", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
    }).format(new Date());
    return `${monthPrefix}-10`;
  }

  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it("soma recibos recebidos + cobranças quitadas SEM nenhum recibo filho — a cobrança-pai com recibo nunca contribui sozinha", async () => {
    rpc.mockResolvedValue({ data: { ...snapshot, timeZone: tz }, error: null });
    const thisMonth = thisMonthDateString();

    mockFromImplementation({
      clients: { data: [], error: null },
      provider_client_links: { data: [], error: null },
      appointments: { data: [], error: null },
      manual_payments: {
        data: [
          // Cobrança de R$ 1.000 ainda `pending`, mas já com um recibo de
          // R$ 300 recebido: NÃO deve contribuir para o total recebido por
          // si só (seu valor já está representado pelo recibo abaixo).
          {
            id: "charge-1",
            value_cents: 100000,
            status: "pending",
            received_at: null,
            due_date: thisMonth,
            created_at: thisMonth,
            kind: "charge",
            parent_payment_id: null,
          },
          {
            id: "receipt-1",
            value_cents: 30000,
            status: "received",
            received_at: thisMonth,
            due_date: thisMonth,
            created_at: thisMonth,
            kind: "receipt",
            parent_payment_id: "charge-1",
          },
          // Cobrança de R$ 500 quitada diretamente, sem nenhum recibo: deve
          // contribuir sozinha.
          {
            id: "charge-2",
            value_cents: 50000,
            status: "received",
            received_at: thisMonth,
            due_date: thisMonth,
            created_at: thisMonth,
            kind: "charge",
            parent_payment_id: null,
          },
        ],
        error: null,
      },
    });

    const result = await new SupabaseDashboardAdapter().getSnapshot();

    // 30000 (receipt-1) + 50000 (charge-2, standalone) = 80000.
    // charge-1 (100000, ainda pending e com recibo filho) nunca entra.
    expect(result.summary.serviceBalanceCents).toBe(80000);
  });

  it("uma cobrança quitada 100% por parciais soma exatamente o total via os recibos, nunca o dobro", async () => {
    rpc.mockResolvedValue({ data: { ...snapshot, timeZone: tz }, error: null });
    const thisMonth = thisMonthDateString();

    mockFromImplementation({
      clients: { data: [], error: null },
      provider_client_links: { data: [], error: null },
      appointments: { data: [], error: null },
      manual_payments: {
        data: [
          {
            id: "charge-1",
            value_cents: 100000,
            status: "received",
            received_at: thisMonth,
            due_date: thisMonth,
            created_at: thisMonth,
            kind: "charge",
            parent_payment_id: null,
          },
          {
            id: "receipt-1",
            value_cents: 60000,
            status: "received",
            received_at: thisMonth,
            due_date: thisMonth,
            created_at: thisMonth,
            kind: "receipt",
            parent_payment_id: "charge-1",
          },
          {
            id: "receipt-2",
            value_cents: 40000,
            status: "received",
            received_at: thisMonth,
            due_date: thisMonth,
            created_at: thisMonth,
            kind: "receipt",
            parent_payment_id: "charge-1",
          },
        ],
        error: null,
      },
    });

    const result = await new SupabaseDashboardAdapter().getSnapshot();

    // 60000 + 40000 = 100000 — nunca 200000 (que seria o bug de contar a
    // cobrança-pai received MAIS a soma dos recibos que a quitaram).
    expect(result.summary.serviceBalanceCents).toBe(100000);
  });
});
