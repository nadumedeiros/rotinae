import type { PaymentPort } from "@/src/domain/payments/payment-port";
import {
  PaymentError,
  type CreatePaymentInput,
  type PaymentErrorCode,
  type FinancialHistoryResult,
  type PaymentHistoryResult,
  type PaymentListInput,
  type PaymentPage,
  type PaymentRecord,
  type PartialPaymentMutationResult,
  type RegisterPartialPaymentResult,
  type UpdatePartialPaymentInput,
  type UpdatePaymentInput,
} from "@/src/domain/payments/types";
import { supabase } from "@/src/infra/supabase/client";

// Migração/segurança de referência: BACKLOG.md (DEC-092/DEC-093) e
// apps/agendae/supabase/migrations/20260811120000_manual_payments.sql.
//
// Controle financeiro manual (DEC-017): esta porta nunca processa uma
// transação bancária real, só o registro/controle de valores pelo próprio
// prestador.

// --------------------------------------------------------------------------
// Mapeamento de erros Postgres/Supabase -> PaymentErrorCode
// --------------------------------------------------------------------------

export type PostgrestErrorLike = {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

// `register_manual_partial_payment` (20260811120000) sempre lança
// `raise exception 'CODIGO: descrição' using errcode = '...'`; o adaptador
// extrai o prefixo antes de ':' para recuperar o código público sem
// interpretar texto livre do fornecedor. Mesmo padrão de
// `supabase-client-portfolio-adapter.ts` (`extractPrefixCode`).
function extractPrefixCode(message: string): string | null {
  const match = /^([A-Z_]+):/.exec(message ?? "");
  return match ? match[1] : null;
}

const KNOWN_PREFIX_CODES: Record<string, PaymentErrorCode> = {
  PAYMENT_NOT_FOUND: "PAYMENT_NOT_FOUND",
  PAYMENT_VALUE_INVALID: "PAYMENT_VALUE_INVALID",
  PAYMENT_ALREADY_SETTLED: "PAYMENT_ALREADY_SETTLED",
  PAYMENT_EXCEEDS_BALANCE: "PAYMENT_EXCEEDS_BALANCE",
  // Achado Alto da auditoria do Leon (DEC-094): distinto de
  // `PAYMENT_ALREADY_SETTLED` porque "cancelada" e "quitada" são estados
  // terminais diferentes do domínio financeiro.
  PAYMENT_CANCELLED: "PAYMENT_CANCELLED",
  PAYMENT_HAS_RECEIPTS: "PAYMENT_HAS_RECEIPTS",
};

const HUMAN_MESSAGES: Record<PaymentErrorCode, string> = {
  CLIENT_NOT_FOUND: "Cliente não encontrado.",
  PAYMENT_NOT_FOUND: "Pagamento não encontrado.",
  DUPLICATE_PAYMENT: "Este pagamento já foi registrado.",
  VALUE_INVALID: "Informe um valor válido.",
  DUE_DATE_INVALID: "Informe uma data de vencimento válida.",
  PAYMENT_VALUE_INVALID: "Informe um valor maior que zero.",
  PAYMENT_EXCEEDS_BALANCE: "O valor informado é maior que o saldo pendente.",
  PAYMENT_ALREADY_SETTLED: "Este pagamento já foi quitado.",
  PAYMENT_CANCELLED: "Este pagamento foi cancelado e não pode receber pagamento parcial.",
  PAYMENT_HAS_RECEIPTS: "Não é possível excluir um pagamento que já possui recibo de quitação.",
  FORBIDDEN: "Você não tem permissão para esta ação.",
  SESSION_EXPIRED: "Sua sessão expirou. Entre novamente.",
  NETWORK_ERROR: "Falha de conexão. Verifique sua internet e tente novamente.",
  STORAGE_ERROR: "Não foi possível salvar os dados agora.",
  UNKNOWN: "Não foi possível sincronizar o financeiro.",
};

function paymentError(code: PaymentErrorCode): PaymentError {
  return new PaymentError(code, HUMAN_MESSAGES[code]);
}

// As constraints de check/FK da tabela `manual_payments`
// (20260811120000_manual_payments.sql) recebem nome explícito (mesmo padrão
// de `services`, DEC-071) para que este mapeamento não dependa do nome
// autogerado pelo Postgres.
export function mapPaymentError(error: PostgrestErrorLike): PaymentError {
  const message = error?.message ?? "";

  const prefixCode = extractPrefixCode(message);
  if (prefixCode && KNOWN_PREFIX_CODES[prefixCode]) {
    return paymentError(KNOWN_PREFIX_CODES[prefixCode]);
  }

  // foreign_key_violation: duas origens possíveis. `manual_payments_client_id_fkey`
  // é a única FK que a UI pode violar diretamente ao gravar (`client_id`
  // inexistente ou já excluído por outro caminho). `manual_payments_parent_payment_fk`
  // (revisão final de governança, achado Baixo do Leon) é a FK auto-referenciada
  // de `parent_payment_id` (`on delete restrict`): dispara quando `deletePayment`
  // tenta excluir uma `charge` que já tem um `receipt` filho de quitação
  // parcial — nome de constraint verificado antes de `client_id` porque uma
  // FK auto-referenciada em `manual_payments` não contém a substring
  // "client_id" na mensagem, mas a ordem explícita documenta a intenção.
  if (error?.code === "23503") {
    if (message.includes("manual_payments_parent_payment_fk")) {
      return paymentError("PAYMENT_HAS_RECEIPTS");
    }
    if (message.includes("client_id")) {
      return paymentError("CLIENT_NOT_FOUND");
    }
    return paymentError("UNKNOWN");
  }

  // check_violation: qual constraint específica falhou identifica o campo.
  if (error?.code === "23514") {
    if (message.includes("manual_payments_value_cents_non_negative_check")) {
      return paymentError("VALUE_INVALID");
    }
    if (message.includes("manual_payments_origin_length_check")) {
      return paymentError("UNKNOWN");
    }
    return paymentError("UNKNOWN");
  }

  // not_null_violation: due_date/value_cents ausentes num UPDATE parcial mal
  // formado (o schema exige os dois como NOT NULL desde a criação).
  if (error?.code === "23502") {
    if (message.includes("due_date")) {
      return paymentError("DUE_DATE_INVALID");
    }
    if (message.includes("value_cents")) {
      return paymentError("VALUE_INVALID");
    }
    return paymentError("UNKNOWN");
  }

  // insufficient_privilege: RLS (`manual_payments_owner_all`) barrou a
  // operação — id de outro tenant ou client_id que não pertence ao tenant do
  // chamador (violação do `with check`).
  if (error?.code === "42501") {
    return paymentError("FORBIDDEN");
  }

  if (
    message.toLowerCase().includes("failed to fetch") ||
    message.toLowerCase().includes("network")
  ) {
    return paymentError("NETWORK_ERROR");
  }

  if (message.toLowerCase().includes("jwt") || message.toLowerCase().includes("session")) {
    return paymentError("SESSION_EXPIRED");
  }

  return paymentError("UNKNOWN");
}

// --------------------------------------------------------------------------
// Mapeamento de linhas do banco <-> tipos de domínio
// --------------------------------------------------------------------------

type PaymentRow = {
  id: string;
  client_id: string;
  origin: string;
  value_cents: number;
  due_date: string;
  status: PaymentRecord["status"];
  notes: string | null;
  created_at: string;
  received_at: string | null;
  kind: PaymentRecord["kind"];
  parent_payment_id: string | null;
  client_name?: string;
  has_receipt?: boolean;
  // Só populado por `list_manual_payments` (20260906150000): saldo em aberto
  // já calculado no banco (total menos recibos recebidos). As demais RPCs/
  // tabelas mapeadas por `toPayment` (`createPayment`/`updatePayment`/
  // `registerPartialPayment`) não trazem esta coluna — `toPayment` cai no
  // fallback abaixo nesses casos.
  balance_cents?: number;
};

function toPayment(row: PaymentRow): PaymentRecord {
  // Fallback quando a linha não veio de `list_manual_payments` (que já
  // calcula `balance_cents` no banco, somando os `receipt` filhos
  // recebidos): sem acesso a esses recibos aqui, `received` vira saldo 0 e
  // qualquer outro status assume o total original ainda em aberto — mesma
  // aproximação usada por `get_manual_payment_history` para uma cobrança
  // `received` sem `receipt` filhos (20260906120000).
  const fallbackBalanceCents = row.status === "received" ? 0 : row.value_cents;

  return {
    id: row.id,
    clientId: row.client_id,
    origin: row.origin,
    valueCents: row.value_cents,
    dueDate: row.due_date,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    receivedAt: row.received_at,
    kind: row.kind,
    parentPaymentId: row.parent_payment_id,
    clientName: row.client_name,
    hasReceipt: row.has_receipt ?? false,
    balanceCents: row.balance_cents ?? fallbackBalanceCents,
  };
}

export class SupabasePaymentAdapter implements PaymentPort {
  // O servidor deriva o tenant a partir da sessão (RLS de `tenants`); como
  // este adaptador não tem uma camada própria de servidor (roda com a anon
  // key + RLS), a única forma de obter o tenant do chamador para operações
  // de escrita (que exigem a coluna `tenant_id` explícita no INSERT) é
  // perguntar à própria tabela `tenants`. Mesmo padrão de
  // `SupabaseClientPortfolioAdapter.currentTenantId`/
  // `SupabaseServiceCatalogAdapter.currentTenantId`.
  //
  // IMPORTANTE (corrigido após incidente de produção 2026-08-12, mesma causa
  // raiz de `SupabaseClientPortfolioAdapter.currentTenantId`): não basta
  // confiar no RLS para devolver uma única linha — desde
  // 20260811140000_multi_profile_roles.sql uma conta pode ser dona de um
  // tenant e cliente ativo de outro ao mesmo tempo, e as duas policies de
  // select (`tenants_select_owner` + `tenants_select_active_client`) juntas
  // fariam a tabela devolver 2 linhas, quebrando `.maybeSingle()`. Filtrar
  // explicitamente por `owner_user_id` restringe ao único tenant que essa
  // conta possui.
  private async currentTenantId(): Promise<string> {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      throw paymentError("SESSION_EXPIRED");
    }

    const { data, error } = await supabase
      .from("tenants")
      .select("id")
      .eq("owner_user_id", authData.user.id)
      .maybeSingle();
    if (error) throw mapPaymentError(error);
    if (!data) throw paymentError("FORBIDDEN");
    return (data as { id: string }).id;
  }

  // Corte real de paginação (DEC-098 fixou o contrato; revisão final de
  // governança implementa o corte no Postgres): mesma técnica de
  // `SupabaseClientPortfolioAdapter.listClients` — `select(..., { count:
  // "exact" })` + `.range(from, to)`, com `totalPages` derivado de
  // `totalItems`/`pageSize`. `pageSize` default 10 quando `input` não é
  // informado, mesma convenção das demais portas paginadas do projeto.
  async listPayments(input?: PaymentListInput): Promise<PaymentPage> {
    const pageSize = input?.pageSize ?? 10;
    const page = Math.max(1, input?.page ?? 1);
    const { data, error } = await supabase.rpc("list_manual_payments", {
      p_page: page,
      p_page_size: pageSize,
      p_period: input?.period ?? null,
      p_status: input?.status ?? null,
      p_query: input?.query?.trim() || null,
    });

    if (error) throw mapPaymentError(error);
    const payload = (data ?? {}) as {
      items?: PaymentRow[];
      totalItems?: number;
      totalPages?: number;
      summary?: {
        receivedTotalCents?: number;
        pendingTotalCents?: number;
        pendingCount?: number;
      };
    };
    const items = (payload.items ?? []).map(toPayment);
    const totalItems = payload.totalItems ?? 0;
    return {
      items,
      page,
      pageSize,
      totalItems,
      totalPages: payload.totalPages ?? Math.max(1, Math.ceil(totalItems / pageSize)),
      summary: {
        receivedTotalCents: payload.summary?.receivedTotalCents ?? 0,
        pendingTotalCents: payload.summary?.pendingTotalCents ?? 0,
        pendingCount: payload.summary?.pendingCount ?? 0,
      },
    };
  }

  async getFinancialHistory(): Promise<FinancialHistoryResult> {
    const { data, error } = await supabase.rpc("get_financial_monthly_history");

    if (error) throw mapPaymentError(error);

    const payload = (data ?? {}) as {
      months?: {
        month?: string;
        receivedTotalCents?: number;
        expectedTotalCents?: number;
        outstandingTotalCents?: number;
        chargeCount?: number;
        outstandingCount?: number;
      }[];
    };

    return {
      months: (payload.months ?? [])
        .filter((item): item is typeof item & { month: string } =>
          /^\d{4}-\d{2}$/.test(item.month ?? ""),
        )
        .map((item) => ({
          month: item.month,
          receivedTotalCents: Number(item.receivedTotalCents ?? 0),
          expectedTotalCents: Number(item.expectedTotalCents ?? 0),
          outstandingTotalCents: Number(item.outstandingTotalCents ?? 0),
          chargeCount: Number(item.chargeCount ?? 0),
          outstandingCount: Number(item.outstandingCount ?? 0),
        })),
    };
  }

  async createPayment(input: CreatePaymentInput): Promise<PaymentRecord> {
    const tenantId = await this.currentTenantId();

    const { data, error } = await supabase
      .from("manual_payments")
      .insert({
        tenant_id: tenantId,
        client_id: input.clientId,
        origin: input.origin,
        value_cents: input.valueCents,
        due_date: input.dueDate,
        status: input.status,
        notes: input.notes,
        kind: input.kind ?? "charge",
        parent_payment_id: input.parentPaymentId ?? null,
        received_at: input.status === "received" ? (input.receivedAt ?? new Date().toISOString()) : null,
      })
      .select("*")
      .single();

    if (error) throw mapPaymentError(error);
    return toPayment(data as PaymentRow);
  }

  async updatePayment(id: string, input: UpdatePaymentInput): Promise<PaymentRecord> {
    const patch: Record<string, unknown> = {};
    if (input.clientId !== undefined) patch.client_id = input.clientId;
    if (input.origin !== undefined) patch.origin = input.origin;
    if (input.valueCents !== undefined) patch.value_cents = input.valueCents;
    if (input.dueDate !== undefined) patch.due_date = input.dueDate;
    if (input.status !== undefined) {
      patch.status = input.status;
      patch.received_at = input.status === "received" ? (input.receivedAt ?? new Date().toISOString()) : null;
    }
    if (input.notes !== undefined) patch.notes = input.notes;

    const { data, error } = await supabase
      .from("manual_payments")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) throw mapPaymentError(error);
    // `.maybeSingle()` (em vez de `.single()`, usado antes desta revisão)
    // distingue "não encontrado" de um erro de rede/banco real: `.single()`
    // lançaria um erro genérico do PostgREST (PGRST116) mapeado sempre para
    // UNKNOWN, escondendo o caso de id inexistente ou de outro tenant.
    if (!data) throw paymentError("PAYMENT_NOT_FOUND");
    return toPayment(data as PaymentRow);
  }

  async registerPartialPayment(
    id: string,
    amountCents: number,
    receivedAt?: string,
  ): Promise<RegisterPartialPaymentResult> {
    const { data, error } = await supabase.rpc("register_manual_partial_payment", {
      p_id: id,
      p_amount_cents: amountCents,
      p_received_at: receivedAt ?? null,
    });

    if (error) throw mapPaymentError(error);

    const row = (Array.isArray(data) ? data[0] : data) as
      | { pending: PaymentRow; receipt: PaymentRow }
      | undefined;
    if (!row) throw paymentError("UNKNOWN");

    return {
      pending: toPayment(row.pending),
      receipt: toPayment(row.receipt),
    };
  }

  async deletePayment(id: string): Promise<void> {
    // `.select("id").maybeSingle()` (em vez de descartar o retorno, como
    // antes desta revisão): sem selecionar nenhuma coluna de volta, um
    // DELETE que não encontra nenhuma linha (id inexistente ou de outro
    // tenant, barrado pela RLS) retorna `error: null` e nenhuma indicação de
    // que nada foi removido — o caller receberia sucesso silencioso mesmo
    // sem excluir nada. Mesmo padrão de
    // `SupabaseClientPortfolioAdapter.deleteClientNote`.
    const { data, error } = await supabase
      .from("manual_payments")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) throw mapPaymentError(error);
    if (!data) throw paymentError("PAYMENT_NOT_FOUND");
  }

  // Contrato: supabase/migrations/20260823130000_manual_payments_receipt_history.sql
  // (`get_manual_payment_history`). A cobrança-pai não decrementa mais
  // `value_cents` por pagamento parcial (ver decisão de arquitetura na
  // própria migration) — `receivedCents`/`balanceCents` vêm sempre
  // derivados dos `receipt` filhos, nunca lidos direto de uma coluna.
  async getPaymentHistory(chargeId: string): Promise<PaymentHistoryResult> {
    const { data, error } = await supabase.rpc("get_manual_payment_history", {
      p_id: chargeId,
    });

    if (error) throw mapPaymentError(error);
    const payload = (Array.isArray(data) ? data[0] : data) as
      | {
          charge?: PaymentRow;
          receipts?: PaymentRow[];
          receivedCents?: number;
          balanceCents?: number;
        }
      | undefined;
    if (!payload?.charge) throw paymentError("PAYMENT_NOT_FOUND");

    return {
      charge: toPayment(payload.charge),
      receipts: (payload.receipts ?? []).map(toPayment),
      receivedCents: payload.receivedCents ?? 0,
      balanceCents: payload.balanceCents ?? 0,
    };
  }

  // Contrato: `update_manual_payment_receipt(p_id, p_amount_cents, p_due_date,
  // p_notes)`. `dueDate`/`notes` omitidos preservam o valor atual no banco;
  // para limpar `notes` explicitamente, envie string vazia (nunca omita com
  // essa intenção — omitir SEMPRE significa "não mexer").
  async updatePartialPayment(
    receiptId: string,
    input: UpdatePartialPaymentInput,
  ): Promise<PartialPaymentMutationResult> {
    const { data, error } = await supabase.rpc("update_manual_payment_receipt", {
      p_id: receiptId,
      p_amount_cents: input.amountCents,
      p_due_date: input.dueDate ?? null,
      p_notes: input.notes ?? null,
    });

    if (error) throw mapPaymentError(error);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { receipt: PaymentRow; parent: PaymentRow }
      | undefined;
    if (!row) throw paymentError("UNKNOWN");

    return { receipt: toPayment(row.receipt), parent: toPayment(row.parent) };
  }

  // Contrato: `delete_manual_payment_receipt(p_id)`. Devolve só a cobrança
  // principal recalculada (não há mais recibo para devolver).
  async deletePartialPayment(receiptId: string): Promise<PartialPaymentMutationResult> {
    const { data, error } = await supabase.rpc("delete_manual_payment_receipt", {
      p_id: receiptId,
    });

    if (error) throw mapPaymentError(error);
    const row = (Array.isArray(data) ? data[0] : data) as { parent: PaymentRow } | undefined;
    if (!row) throw paymentError("UNKNOWN");

    return { parent: toPayment(row.parent) };
  }
}

export const paymentService: PaymentPort = new SupabasePaymentAdapter();
