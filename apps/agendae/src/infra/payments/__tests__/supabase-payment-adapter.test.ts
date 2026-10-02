import type { CreatePaymentInput } from "@/src/domain/payments/types";

// Mesmo padrão de apps/agendae/src/infra/clients|services/__tests__: mocka o
// cliente Supabase (que lançaria por falta de variáveis de ambiente fora
// deste teste) para exercitar só a lógica do adapter, sem depender de um
// projeto Supabase real ou da migration 20260811120000 aplicada.
jest.mock("@/src/infra/supabase/client", () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

import { supabase } from "@/src/infra/supabase/client";
import { SupabasePaymentAdapter } from "../supabase-payment-adapter";

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;
const mockGetUser = supabase.auth.getUser as jest.Mock;

// Builder fluente mínimo: cada método de filtro/transformação devolve o
// próprio builder (para encadear `.select().eq().order().range()` como o
// supabase-js real), e o builder também é "thenable" — `listPayments` faz
// `await builder` diretamente, sem terminar em `.single()`.
function createQueryBuilder(result: { data: unknown; error: unknown; count?: number | null }) {
  const builder: any = {};
  const chainableMethods = ["select", "eq", "order", "range", "insert", "update", "delete"];
  for (const method of chainableMethods) {
    builder[method] = jest.fn(() => builder);
  }
  builder.single = jest.fn(() => Promise.resolve(result));
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    client_id: "client-1",
    origin: "Consulta",
    value_cents: 15000,
    due_date: "2026-08-20",
    status: "pending",
    notes: null,
    created_at: "2026-08-11T00:00:00.000Z",
    received_at: null,
    kind: "charge",
    parent_payment_id: null,
    ...overrides,
  };
}

const validInput: CreatePaymentInput = {
  clientId: "client-1",
  origin: "Consulta",
  valueCents: 15000,
  dueDate: "2026-08-20",
  status: "pending",
  notes: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: chamador autenticado. Testes que precisam simular sessão
  // expirada sobrescrevem com `mockGetUser.mockResolvedValueOnce(...)`.
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

describe("SupabasePaymentAdapter.listPayments", () => {
  it("mapeia as linhas do banco para PaymentRecord, ordenadas por criação desc, com pageSize/página default", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        items: [paymentRow({ client_name: "Mariana", has_receipt: true, balance_cents: 25000 })],
        totalItems: 1,
        totalPages: 1,
        summary: { receivedTotalCents: 15000, pendingTotalCents: 0, pendingCount: 0 },
      },
      error: null,
    });

    const adapter = new SupabasePaymentAdapter();
    const payments = await adapter.listPayments();

    expect(mockRpc).toHaveBeenCalledWith("list_manual_payments", {
      p_page: 1,
      p_page_size: 10,
      p_period: null,
      p_status: null,
      p_query: null,
    });
    expect(payments.items).toEqual([
      expect.objectContaining({
        id: "payment-1",
        clientId: "client-1",
        clientName: "Mariana",
        hasReceipt: true,
        // `balance_cents` já vem calculado no banco (20260906150000) — o
        // adapter só repassa, sem recalcular a partir dos recibos.
        balanceCents: 25000,
      }),
    ]);
    expect(payments.page).toBe(1);
    expect(payments.pageSize).toBe(10);
    expect(payments.totalItems).toBe(1);
    expect(payments.totalPages).toBe(1);
    expect(payments.summary.receivedTotalCents).toBe(15000);
  });

  it("cai no fallback (saldo = valor total) quando a linha não traz balance_cents", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        items: [paymentRow({ status: "pending" })],
        totalItems: 1,
        totalPages: 1,
        summary: {},
      },
      error: null,
    });

    const adapter = new SupabasePaymentAdapter();
    const payments = await adapter.listPayments();

    expect(payments.items[0].balanceCents).toBe(payments.items[0].valueCents);
  });

  it("envia página, período, status e busca para o servidor", async () => {
    const rows = Array.from({ length: 10 }, (_, index) => paymentRow({ id: `payment-${index}` }));
    mockRpc.mockResolvedValueOnce({
      data: { items: rows, totalItems: 25, totalPages: 3, summary: {} },
      error: null,
    });

    const adapter = new SupabasePaymentAdapter();
    const payments = await adapter.listPayments({
      page: 2,
      pageSize: 10,
      period: "2026-08",
      status: "pending",
      query: "Mariana",
    });

    expect(mockRpc).toHaveBeenCalledWith("list_manual_payments", {
      p_page: 2,
      p_page_size: 10,
      p_period: "2026-08",
      p_status: "pending",
      p_query: "Mariana",
    });
    expect(payments.page).toBe(2);
    expect(payments.pageSize).toBe(10);
    expect(payments.totalItems).toBe(25);
    expect(payments.totalPages).toBe(3);
    expect(payments.items).toHaveLength(10);
  });

  it("devolve lista vazia quando não há nenhum pagamento", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const adapter = new SupabasePaymentAdapter();
    const payments = await adapter.listPayments();

    expect(payments.items).toEqual([]);
    expect(payments.totalItems).toBe(0);
    expect(payments.totalPages).toBe(1);
    expect(payments.summary.pendingCount).toBe(0);
  });

  it("mapeia falha de rede para NETWORK_ERROR em vez de devolver lista vazia silenciosamente", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "TypeError: Failed to fetch" },
    });

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.listPayments()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});

describe("SupabasePaymentAdapter.getFinancialHistory", () => {
  it("mapeia o histórico mensal preservando valores em centavos", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        months: [
          {
            month: "2026-09",
            receivedTotalCents: 21000,
            expectedTotalCents: 30000,
            outstandingTotalCents: 9000,
            chargeCount: 3,
            outstandingCount: 1,
          },
        ],
      },
      error: null,
    });

    const adapter = new SupabasePaymentAdapter();
    const history = await adapter.getFinancialHistory();

    expect(mockRpc).toHaveBeenCalledWith("get_financial_monthly_history");
    expect(history.months).toEqual([
      {
        month: "2026-09",
        receivedTotalCents: 21000,
        expectedTotalCents: 30000,
        outstandingTotalCents: 9000,
        chargeCount: 3,
        outstandingCount: 1,
      },
    ]);
  });

  it("ignora competências inválidas e aplica zero aos campos ausentes", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { months: [{ month: "2026-08" }, { month: "inválido", receivedTotalCents: 999 }] },
      error: null,
    });

    const adapter = new SupabasePaymentAdapter();
    const history = await adapter.getFinancialHistory();

    expect(history.months).toEqual([
      {
        month: "2026-08",
        receivedTotalCents: 0,
        expectedTotalCents: 0,
        outstandingTotalCents: 0,
        chargeCount: 0,
        outstandingCount: 0,
      },
    ]);
  });

  it("propaga falha de rede com erro de domínio", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.getFinancialHistory()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});

describe("SupabasePaymentAdapter.createPayment", () => {
  it("cria o pagamento vinculado ao próprio tenant do prestador autenticado", async () => {
    const tenantBuilder = createQueryBuilder({ data: { id: "tenant-1" }, error: null });
    const paymentsBuilder = createQueryBuilder({ data: paymentRow(), error: null });

    mockFrom.mockImplementation((table: string) => (table === "tenants" ? tenantBuilder : paymentsBuilder));

    const adapter = new SupabasePaymentAdapter();
    await adapter.createPayment(validInput);

    expect(paymentsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: "tenant-1", client_id: "client-1", kind: "charge" }),
    );
  });

  it("calcula balanceCents como o valor total quando a cobrança criada não é received (fallback, sem balance_cents da RPC)", async () => {
    const tenantBuilder = createQueryBuilder({ data: { id: "tenant-1" }, error: null });
    const paymentsBuilder = createQueryBuilder({
      data: paymentRow({ status: "pending", value_cents: 15000 }),
      error: null,
    });
    mockFrom.mockImplementation((table: string) => (table === "tenants" ? tenantBuilder : paymentsBuilder));

    const adapter = new SupabasePaymentAdapter();
    const created = await adapter.createPayment(validInput);

    expect(created.balanceCents).toBe(15000);
  });

  it("calcula balanceCents zero quando a cobrança criada já nasce received (fallback, sem balance_cents da RPC)", async () => {
    const tenantBuilder = createQueryBuilder({ data: { id: "tenant-1" }, error: null });
    const paymentsBuilder = createQueryBuilder({
      data: paymentRow({ status: "received", value_cents: 15000 }),
      error: null,
    });
    mockFrom.mockImplementation((table: string) => (table === "tenants" ? tenantBuilder : paymentsBuilder));

    const adapter = new SupabasePaymentAdapter();
    const created = await adapter.createPayment({ ...validInput, status: "received" });

    expect(created.balanceCents).toBe(0);
  });

  it("lança FORBIDDEN quando o chamador não tem tenant próprio", async () => {
    const tenantBuilder = createQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(tenantBuilder);

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.createPayment(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("mapeia violação de RLS (insert em client_id de outro tenant) para FORBIDDEN", async () => {
    const tenantBuilder = createQueryBuilder({ data: { id: "tenant-1" }, error: null });
    const paymentsBuilder = createQueryBuilder({
      data: null,
      error: { message: "new row violates row-level security policy", code: "42501" },
    });
    mockFrom.mockImplementation((table: string) => (table === "tenants" ? tenantBuilder : paymentsBuilder));

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.createPayment(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("usa a data de recebimento escolhida pelo prestador, em vez do instante do servidor, quando informada", async () => {
    const tenantBuilder = createQueryBuilder({ data: { id: "tenant-1" }, error: null });
    const paymentsBuilder = createQueryBuilder({ data: paymentRow({ status: "received" }), error: null });
    mockFrom.mockImplementation((table: string) => (table === "tenants" ? tenantBuilder : paymentsBuilder));

    const adapter = new SupabasePaymentAdapter();
    await adapter.createPayment({ ...validInput, status: "received", receivedAt: "2026-08-01T12:00:00.000Z" });

    expect(paymentsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ received_at: "2026-08-01T12:00:00.000Z" }),
    );
  });

  it("mapeia client_id inexistente (violação de chave estrangeira) para CLIENT_NOT_FOUND", async () => {
    const tenantBuilder = createQueryBuilder({ data: { id: "tenant-1" }, error: null });
    const paymentsBuilder = createQueryBuilder({
      data: null,
      error: {
        message: 'insert or update on table "manual_payments" violates foreign key constraint "manual_payments_client_id_fkey"',
        code: "23503",
      },
    });
    mockFrom.mockImplementation((table: string) => (table === "tenants" ? tenantBuilder : paymentsBuilder));

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.createPayment(validInput)).rejects.toMatchObject({ code: "CLIENT_NOT_FOUND" });
  });
});

describe("SupabasePaymentAdapter.updatePayment", () => {
  it("envia apenas os campos informados no patch", async () => {
    const builder = createQueryBuilder({ data: paymentRow({ value_cents: 20000 }), error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabasePaymentAdapter();
    await adapter.updatePayment("payment-1", { valueCents: 20000 });

    expect(builder.update).toHaveBeenCalledWith({ value_cents: 20000 });
  });

  it("lança PAYMENT_NOT_FOUND quando o pagamento não existe ou não pertence ao tenant do chamador", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.updatePayment("payment-inexistente", { valueCents: 100 })).rejects.toMatchObject({
      code: "PAYMENT_NOT_FOUND",
    });
  });

  it("marca received_at ao mudar o status para received", async () => {
    const builder = createQueryBuilder({ data: paymentRow({ status: "received" }), error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabasePaymentAdapter();
    await adapter.updatePayment("payment-1", { status: "received" });

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "received", received_at: expect.any(String) }),
    );
  });

  it("usa a data de recebimento escolhida pelo prestador, em vez do instante do servidor, quando informada", async () => {
    const builder = createQueryBuilder({ data: paymentRow({ status: "received" }), error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabasePaymentAdapter();
    await adapter.updatePayment("payment-1", { status: "received", receivedAt: "2026-08-01T12:00:00.000Z" });

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "received", received_at: "2026-08-01T12:00:00.000Z" }),
    );
  });
});

describe("SupabasePaymentAdapter.deletePayment", () => {
  it("exclui o pagamento quando ele existe e pertence ao tenant do chamador", async () => {
    const builder = createQueryBuilder({ data: { id: "payment-1" }, error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabasePaymentAdapter();
    await adapter.deletePayment("payment-1");

    expect(builder.delete).toHaveBeenCalled();
  });

  it("lança PAYMENT_NOT_FOUND em vez de suceder silenciosamente quando nenhuma linha é excluída", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.deletePayment("payment-inexistente")).rejects.toMatchObject({
      code: "PAYMENT_NOT_FOUND",
    });
  });

  it("mapeia violação da FK auto-referenciada de parent_payment_id (charge com receipt filho) para PAYMENT_HAS_RECEIPTS", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: {
        message:
          'update or delete on table "manual_payments" violates foreign key constraint "manual_payments_parent_payment_fk" on table "manual_payments"',
        code: "23503",
      },
    });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.deletePayment("payment-1")).rejects.toMatchObject({
      code: "PAYMENT_HAS_RECEIPTS",
    });
  });
});

describe("SupabasePaymentAdapter.registerPartialPayment", () => {
  it("chama a RPC com os parâmetros corretos e mapeia pending/receipt", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        pending: paymentRow({ value_cents: 5000 }),
        receipt: paymentRow({ id: "payment-2", kind: "receipt", parent_payment_id: "payment-1", value_cents: 10000, status: "received" }),
      },
      error: null,
    });

    const adapter = new SupabasePaymentAdapter();
    const result = await adapter.registerPartialPayment("payment-1", 10000);

    expect(mockRpc).toHaveBeenCalledWith("register_manual_partial_payment", {
      p_id: "payment-1",
      p_amount_cents: 10000,
      p_received_at: null,
    });
    expect(result.pending.valueCents).toBe(5000);
    expect(result.receipt.kind).toBe("receipt");
    expect(result.receipt.parentPaymentId).toBe("payment-1");
  });

  it("encaminha a data de recebimento escolhida pelo prestador como p_received_at", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        pending: paymentRow({ value_cents: 5000 }),
        receipt: paymentRow({ id: "payment-2", kind: "receipt", parent_payment_id: "payment-1", value_cents: 10000, status: "received" }),
      },
      error: null,
    });

    const adapter = new SupabasePaymentAdapter();
    await adapter.registerPartialPayment("payment-1", 10000, "2026-08-01T12:00:00.000Z");

    expect(mockRpc).toHaveBeenCalledWith("register_manual_partial_payment", {
      p_id: "payment-1",
      p_amount_cents: 10000,
      p_received_at: "2026-08-01T12:00:00.000Z",
    });
  });

  it("mapeia PAYMENT_EXCEEDS_BALANCE quando o valor informado é maior que o saldo pendente", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PAYMENT_EXCEEDS_BALANCE: amount exceeds pending balance", code: "22023" },
    });

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.registerPartialPayment("payment-1", 999999)).rejects.toMatchObject({
      code: "PAYMENT_EXCEEDS_BALANCE",
    });
  });

  it("mapeia PAYMENT_ALREADY_SETTLED quando o pagamento já foi quitado", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PAYMENT_ALREADY_SETTLED: payment is already settled or not eligible for partial payment", code: "22023" },
    });

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.registerPartialPayment("payment-1", 100)).rejects.toMatchObject({
      code: "PAYMENT_ALREADY_SETTLED",
    });
  });

  it("mapeia PAYMENT_CANCELLED quando a cobrança foi cancelada, sem reabri-la (achado do Leon, DEC-094)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: "PAYMENT_CANCELLED: payment was cancelled and cannot receive a partial payment",
        code: "22023",
      },
    });

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.registerPartialPayment("payment-1", 100)).rejects.toMatchObject({
      code: "PAYMENT_CANCELLED",
    });
  });

  it("mapeia PAYMENT_NOT_FOUND quando o id não existe ou pertence a outro tenant", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PAYMENT_NOT_FOUND: payment not found", code: "P0002" },
    });

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.registerPartialPayment("payment-inexistente", 100)).rejects.toMatchObject({
      code: "PAYMENT_NOT_FOUND",
    });
  });

  it("mapeia PAYMENT_VALUE_INVALID quando o valor informado é zero ou negativo", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PAYMENT_VALUE_INVALID: amount must be greater than zero", code: "22023" },
    });

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.registerPartialPayment("payment-1", 0)).rejects.toMatchObject({
      code: "PAYMENT_VALUE_INVALID",
    });
  });
});

// Cobre a decisão de arquitetura de
// supabase/migrations/20260823130000_manual_payments_receipt_history.sql: a
// cobrança principal (`kind: "charge"`) nunca mais tem `value_cents`
// decrementado por pagamento parcial; "recebido"/"saldo" são sempre
// derivados dos `receipt` filhos.
describe("SupabasePaymentAdapter.getPaymentHistory", () => {
  it("mapeia cobrança + recibos + recebido/saldo derivados", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        charge: paymentRow({ value_cents: 100000, status: "pending" }),
        receipts: [
          paymentRow({ id: "receipt-1", kind: "receipt", parent_payment_id: "payment-1", value_cents: 30000, status: "received" }),
        ],
        receivedCents: 30000,
        balanceCents: 70000,
      },
      error: null,
    });

    const adapter = new SupabasePaymentAdapter();
    const history = await adapter.getPaymentHistory("payment-1");

    expect(mockRpc).toHaveBeenCalledWith("get_manual_payment_history", { p_id: "payment-1" });
    // O total exibido da cobrança principal permanece o valor original
    // (100000), mesmo já havendo um recibo de 30000 registrado — nunca o
    // saldo decrementado (achado que motivou esta migration).
    expect(history.charge.valueCents).toBe(100000);
    expect(history.receipts).toHaveLength(1);
    expect(history.receivedCents).toBe(30000);
    expect(history.balanceCents).toBe(70000);
  });

  it("lança PAYMENT_NOT_FOUND quando a cobrança não existe ou não pertence ao tenant do chamador", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PAYMENT_NOT_FOUND: payment not found", code: "P0002" },
    });

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.getPaymentHistory("payment-inexistente")).rejects.toMatchObject({
      code: "PAYMENT_NOT_FOUND",
    });
  });
});

describe("SupabasePaymentAdapter.updatePartialPayment", () => {
  it("edita o valor do recibo e recalcula o status da cobrança-pai", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        receipt: paymentRow({ id: "receipt-1", kind: "receipt", parent_payment_id: "payment-1", value_cents: 40000, status: "received" }),
        parent: paymentRow({ value_cents: 100000, status: "pending" }),
      },
      error: null,
    });

    const adapter = new SupabasePaymentAdapter();
    const result = await adapter.updatePartialPayment("receipt-1", { amountCents: 40000, notes: "corrigido" });

    expect(mockRpc).toHaveBeenCalledWith("update_manual_payment_receipt", {
      p_id: "receipt-1",
      p_amount_cents: 40000,
      p_due_date: null,
      p_notes: "corrigido",
    });
    expect(result.receipt?.valueCents).toBe(40000);
    // A cobrança-pai NUNCA muda de total (continua 100000) — só o status é
    // recalculado a partir da soma dos recibos.
    expect(result.parent.valueCents).toBe(100000);
    expect(result.parent.status).toBe("pending");
  });

  it("edita o recibo para quitar 100% do total e a cobrança-pai vira received", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        receipt: paymentRow({ id: "receipt-1", kind: "receipt", parent_payment_id: "payment-1", value_cents: 100000, status: "received" }),
        parent: paymentRow({ value_cents: 100000, status: "received" }),
      },
      error: null,
    });

    const adapter = new SupabasePaymentAdapter();
    const result = await adapter.updatePartialPayment("receipt-1", { amountCents: 100000 });

    expect(result.parent.status).toBe("received");
  });

  it("mapeia PAYMENT_EXCEEDS_BALANCE quando a edição faz a soma dos recibos ultrapassar o total da cobrança", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PAYMENT_EXCEEDS_BALANCE: amount exceeds pending balance", code: "22023" },
    });

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.updatePartialPayment("receipt-1", { amountCents: 999999 })).rejects.toMatchObject({
      code: "PAYMENT_EXCEEDS_BALANCE",
    });
  });

  it("mapeia PAYMENT_CANCELLED quando a cobrança-pai já foi cancelada", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PAYMENT_CANCELLED: parent payment was cancelled and its receipts can no longer be edited", code: "22023" },
    });

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.updatePartialPayment("receipt-1", { amountCents: 100 })).rejects.toMatchObject({
      code: "PAYMENT_CANCELLED",
    });
  });

  it("mapeia PAYMENT_NOT_FOUND quando o id não é um recibo válido", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PAYMENT_NOT_FOUND: receipt not found", code: "P0002" },
    });

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.updatePartialPayment("payment-1", { amountCents: 100 })).rejects.toMatchObject({
      code: "PAYMENT_NOT_FOUND",
    });
  });
});

describe("SupabasePaymentAdapter.deletePartialPayment", () => {
  it("exclui o recibo e devolve a cobrança-pai recalculada (pode voltar a pending)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { parent: paymentRow({ value_cents: 100000, status: "pending" }) },
      error: null,
    });

    const adapter = new SupabasePaymentAdapter();
    const result = await adapter.deletePartialPayment("receipt-1");

    expect(mockRpc).toHaveBeenCalledWith("delete_manual_payment_receipt", { p_id: "receipt-1" });
    expect(result.parent.status).toBe("pending");
    expect(result.parent.valueCents).toBe(100000);
  });

  it("mapeia PAYMENT_CANCELLED quando a cobrança-pai já foi cancelada", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PAYMENT_CANCELLED: parent payment was cancelled and its receipts can no longer be deleted", code: "22023" },
    });

    const adapter = new SupabasePaymentAdapter();

    await expect(adapter.deletePartialPayment("receipt-1")).rejects.toMatchObject({
      code: "PAYMENT_CANCELLED",
    });
  });
});
