import type { AppointmentState, ConfirmationStatus } from "@/src/domain/agenda/types";
import type { DashboardPort } from "@/src/domain/dashboard/dashboard-port";
import { DashboardError, type DashboardReceivablePayment, type DashboardSnapshot } from "@/src/domain/dashboard/types";
import { supabase } from "@/src/infra/supabase/client";

// `get_provider_dashboard_snapshot` (20260906160000_dashboard_receivable_payments.sql)
// devolve estes campos em snake_case (mesmo padrão de
// `list_manual_payments`/`get_manual_payment_history`), diferente do resto
// do JSON desta RPC (já camelCase, consumido direto sem mapeamento). Por
// isso o mapeamento explícito abaixo. Também cobre o backend antigo (antes
// desta migration), que responde sem estes campos — fallback para
// array vazio/zero, nunca `undefined`.
function mapReceivablePayments(raw: unknown): DashboardReceivablePayment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      id: String(item.id ?? ""),
      clientName: typeof item.client_name === "string" ? item.client_name : "Sem cliente",
      origin: typeof item.origin === "string" ? item.origin : "",
      balanceCents: typeof item.balance_cents === "number" ? item.balance_cents : 0,
      dueDate: typeof item.due_date === "string" ? item.due_date : "",
      status: item.status === "overdue" ? "overdue" : "pending",
    }));
}

function withReceivablePayments(snapshot: DashboardSnapshot): DashboardSnapshot {
  const raw = snapshot as unknown as {
    receivable_payments?: unknown;
    receivable_total_cents?: unknown;
    receivable_count?: unknown;
  };
  return {
    ...snapshot,
    receivablePayments: mapReceivablePayments(raw.receivable_payments),
    receivableTotalCents: typeof raw.receivable_total_cents === "number" ? raw.receivable_total_cents : 0,
    receivableCount: typeof raw.receivable_count === "number" ? raw.receivable_count : 0,
  };
}

export function mapDashboardError(error: { message?: string; code?: string }) {
  const message = error.message ?? "";
  if (error.code === "42501" || message.startsWith("FORBIDDEN:"))
    return new DashboardError("FORBIDDEN", "Você não tem acesso a este painel.");
  if (/jwt|session|auth/i.test(message))
    return new DashboardError("SESSION_EXPIRED", "Sua sessão expirou. Entre novamente.");
  if (/network|fetch|timeout/i.test(message))
    return new DashboardError("NETWORK_ERROR", "Não foi possível conectar. Tente novamente.");
  return new DashboardError("UNKNOWN", "Não foi possível carregar o resumo.");
}

async function enrichRealDashboardMetrics(snapshot: DashboardSnapshot): Promise<DashboardSnapshot> {
  if (typeof supabase?.from !== "function") {
    return snapshot;
  }
  try {
    const tz = snapshot.timeZone || "America/Sao_Paulo";
    const now = new Date();
    const todayStr = new Intl.DateTimeFormat("sv-SE", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const monthPrefix = todayStr.slice(0, 7);

    const [clientsRes, linksRes, appointmentsAllRes, paymentsRes] = await Promise.all([
      supabase.from("clients").select("id, name, status, created_at"),
      supabase.from("provider_client_links").select("id, client_user_id, status, requested_at").eq("status", "active"),
      supabase.from("appointments").select("id, starts_at, ends_at, state, confirmation_status, client_id, title, service_name_snapshot, value_cents_snapshot"),
      supabase.from("manual_payments").select("id, value_cents, status, received_at, due_date, created_at, kind, parent_payment_id"),
    ]);

    let activeClients = snapshot.summary.activeClients;
    let newClientsThisMonth = snapshot.summary.newClientsThisMonth;
    const clientNameMap = new Map<string, string>();
    if (!clientsRes.error && clientsRes.data) {
      const activeOnly = (clientsRes.data as { id: string; name?: string; status: string; created_at?: string }[])
        .filter((c) => c.status === "active");
      activeClients = activeOnly.length;

      newClientsThisMonth = activeOnly.filter(
        (c) => (c.created_at ?? "").startsWith(monthPrefix)
      ).length;

      for (const c of clientsRes.data as { id: string; name?: string }[]) {
        if (c.name) clientNameMap.set(c.id, c.name);
      }
    }

    let appointmentsToday = snapshot.summary.appointmentsToday;
    let completedToday = snapshot.summary.completedToday;
    let pendingConfirmationToday = snapshot.summary.pendingConfirmationToday;
    let todayAppointments = snapshot.todayAppointments;

    if (!appointmentsAllRes.error && appointmentsAllRes.data) {
      const allList = appointmentsAllRes.data as {
        id: string;
        starts_at: string;
        ends_at: string;
        state: string;
        confirmation_status: string;
        client_id?: string | null;
        title?: string | null;
        service_name_snapshot?: string | null;
        value_cents_snapshot?: number | null;
      }[];

      const todayList = allList.filter((a) => {
        try {
          const itemDateStr = new Intl.DateTimeFormat("sv-SE", {
            timeZone: tz,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(a.starts_at));
          return itemDateStr === todayStr && a.state !== "cancelled";
        } catch {
          return false;
        }
      });

      // Agenda representa o que ainda está agendado para hoje. Itens já
      // concluídos ficam exclusivamente no KPI de atendimentos, evitando
      // contagem duplicada entre os dois cartões.
      appointmentsToday = todayList.filter((a) => a.state === "scheduled").length;
      completedToday = todayList.filter(
        (a) => a.state === "completed"
      ).length;
      pendingConfirmationToday = todayList.filter(
        (a) => a.confirmation_status === "pending" && a.state === "scheduled"
      ).length;

      todayAppointments = todayList
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
        .map((a) => ({
          id: a.id,
          startsAt: a.starts_at,
          title: a.title?.trim() || null,
          clientId: a.client_id || null,
          clientName: (a.client_id && clientNameMap.get(a.client_id)) || "Sem cliente",
          serviceName: a.service_name_snapshot || "Atendimento",
          serviceValueCents: a.value_cents_snapshot ?? 0,
          // Estado bruto — o rótulo/cor exibidos em `app/dashboard.tsx` são
          // calculados por `getAppointmentStatusLabel`, nunca aqui (ver
          // comentário em `DashboardAppointment`). Antes, este mapeamento
          // recalculava um rótulo próprio e incompleto (sem ramo para
          // `cancelled`, e com uma comparação sempre falsa —
          // `confirmation_status === "no_show"`, quando "no_show" é um
          // valor de `state`, não de `confirmation_status` — então nenhum
          // agendamento chegava a ser marcado como "no_show" aqui).
          state: a.state as AppointmentState,
          confirmationStatus: a.confirmation_status as ConfirmationStatus,
        }));
    }

    let serviceBalanceCents = snapshot.summary.serviceBalanceCents;
    if (!paymentsRes.error && paymentsRes.data) {
      const allPayments = paymentsRes.data as {
        id: string;
        value_cents: number;
        status: string;
        received_at?: string | null;
        due_date?: string;
        created_at?: string;
        kind?: "charge" | "receipt";
        parent_payment_id?: string | null;
      }[];

      // Mesma regra de `list_manual_payments`/`get_provider_dashboard_snapshot`
      // (supabase/migrations/20260823130000_manual_payments_receipt_history.sql):
      // desde que a cobrança-pai (`kind: "charge"`) deixou de ter `value_cents`
      // decrementado por pagamento parcial, somar `value_cents` de toda linha
      // `status === "received"` sem filtrar `kind` voltaria a contar em dobro
      // (a cobrança inteira MAIS os recibos que a quitaram). "Recebido" passa
      // a ser: soma dos `receipt` recebidos + soma das `charge` recebidas que
      // NUNCA tiveram nenhum recibo filho (quitação direta, sem fluxo de
      // parcial). Nunca alterar esta fórmula aqui sem replicar exatamente a
      // mesma mudança nas duas RPCs citadas acima — são as três fontes que a
      // regra de negócio "valor efetivamente recebido" precisa manter
      // sincronizadas.
      const receiptParentIds = new Set(
        allPayments
          .filter((p) => p.kind === "receipt" && p.parent_payment_id)
          .map((p) => p.parent_payment_id as string),
      );

      const isThisMonth = (p: { received_at?: string | null; due_date?: string; created_at?: string }) => {
        const dateRef = p.received_at || p.due_date || p.created_at || "";
        return dateRef.startsWith(monthPrefix);
      };

      const receiptsReceivedThisMonth = allPayments
        .filter((p) => p.kind === "receipt" && p.status === "received" && isThisMonth(p))
        .reduce((sum, p) => sum + (p.value_cents || 0), 0);

      const standaloneChargesReceivedThisMonth = allPayments
        .filter(
          (p) =>
            p.kind !== "receipt" &&
            p.status === "received" &&
            !receiptParentIds.has(p.id) &&
            isThisMonth(p),
        )
        .reduce((sum, p) => sum + (p.value_cents || 0), 0);

      serviceBalanceCents = receiptsReceivedThisMonth + standaloneChargesReceivedThisMonth;
    }

    return {
      ...snapshot,
      summary: {
        ...snapshot.summary,
        activeClients,
        newClientsThisMonth,
        appointmentsToday,
        completedToday,
        pendingConfirmationToday,
        serviceBalanceCents,
      },
      todayAppointments,
    };
  } catch {
    return snapshot;
  }
}

async function buildDirectDashboardSnapshot(inputDate?: string): Promise<DashboardSnapshot> {
  let displayName = "Prestador";
  let timeZone = "America/Sao_Paulo";

  if (typeof supabase?.auth?.getUser === "function") {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      if (userId && typeof supabase.from === "function") {
        const [profileRes, tenantRes] = await Promise.all([
          supabase.from("profiles").select("display_name").eq("user_id", userId).maybeSingle(),
          supabase.from("tenants").select("display_name, timezone").eq("owner_user_id", userId).maybeSingle(),
        ]);
        if (tenantRes.data?.display_name) displayName = tenantRes.data.display_name;
        else if (profileRes.data?.display_name) displayName = profileRes.data.display_name;
        if (tenantRes.data?.timezone) timeZone = tenantRes.data.timezone;
      }
    } catch {
      // Falha silenciosa em ambientes de teste sem auth
    }
  }

  const baseSnapshot: DashboardSnapshot = {
    generatedAt: new Date().toISOString(),
    providerDisplayName: displayName,
    timeZone,
    summary: {
      activeClients: 0,
      newClientsThisMonth: 0,
      appointmentsToday: 0,
      completedToday: 0,
      pendingConfirmationToday: 0,
      serviceBalanceCents: 0,
      balanceReferenceMonth: new Intl.DateTimeFormat("pt-BR", { month: "2-digit", year: "numeric" }).format(new Date()),
    },
    todayAppointments: [],
    notifications: [],
    // Este caminho (fallback direto) não passa pela RPC — não há de onde
    // derivar "pagamentos a receber" aqui; mesmo fallback vazio/zero do
    // mapeamento normal, nunca `undefined`.
    receivablePayments: [],
    receivableTotalCents: 0,
    receivableCount: 0,
  };

  return enrichRealDashboardMetrics(baseSnapshot);
}

export class SupabaseDashboardAdapter implements DashboardPort {
  async getSnapshot(input?: { date?: string }): Promise<DashboardSnapshot> {
    const { data, error } = await supabase.rpc("get_provider_dashboard_snapshot", { p_date: input?.date ?? null });
    if (error) {
      if (error.code === "42501" || (error.message && error.message.startsWith("FORBIDDEN:"))) {
        throw mapDashboardError(error);
      }
      if (/jwt|session|auth/i.test(error.message ?? "")) {
        throw mapDashboardError(error);
      }
      // Se a RPC falhar por outro motivo (ex.: 400 bad request / função ausente), ativa cálculo direto
      return await buildDirectDashboardSnapshot(input?.date);
    }
    if (!data || typeof data !== "object") {
      throw new DashboardError("UNKNOWN", "O resumo retornado é inválido.");
    }
    return enrichRealDashboardMetrics(withReceivablePayments(data as DashboardSnapshot));
  }

  async markNotificationRead(): Promise<void> {
    throw new DashboardError("UNKNOWN", "Persistência de notificações ainda não disponível.");
  }

  async markAllNotificationsRead(): Promise<void> {
    throw new DashboardError("UNKNOWN", "Persistência de notificações ainda não disponível.");
  }
}

export const dashboardService: DashboardPort = new SupabaseDashboardAdapter();
