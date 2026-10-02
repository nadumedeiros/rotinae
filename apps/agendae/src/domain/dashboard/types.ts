import type { AppointmentState, ConfirmationStatus } from "@/src/domain/agenda/types";

export type DashboardSummary = {
  activeClients: number;
  newClientsThisMonth: number;
  appointmentsToday: number;
  completedToday: number;
  pendingConfirmationToday: number;
  serviceBalanceCents: number;
  balanceReferenceMonth: string;
};

export type DashboardAppointment = {
  id: string;
  startsAt: string;
  title?: string | null;
  // NULL quando o agendamento foi criado manualmente pelo prestador sem
  // cliente vinculado (DEC-127). `clientName` permanece sempre uma string
  // (o servidor devolve "Sem cliente" nesse caso — ver
  // `get_provider_dashboard_snapshot`), preservando o contrato de exibição
  // direta em `app/dashboard.tsx`.
  clientId: string | null;
  clientName: string;
  serviceName: string;
  serviceValueCents: number;
  // Estado bruto (não um rótulo já traduzido) — o rótulo/cor exibidos são
  // computados por `getAppointmentStatusLabel`
  // (`src/domain/agenda/appointment-status-label.ts`), a mesma função usada
  // pelo Perfil do Cliente, para nunca divergir entre as duas telas (BLG:
  // agendamento cancelado aparecendo como "Confirmado" na Home por um
  // mapeamento paralelo e incompleto que existia só aqui).
  state: AppointmentState;
  confirmationStatus: ConfirmationStatus;
};

// Cobrança em aberto (`kind: "charge"`, `status` pending/overdue) exibida no
// novo painel "Pagamentos a receber" da Home, ao lado de "Agenda de hoje".
// `balanceCents` é sempre o saldo AINDA em aberto daquela cobrança — mesmo
// cálculo (total - recibos filhos já `received`, nunca negativo) usado em
// `list_manual_payments`/`get_manual_payment_history`
// (supabase/migrations/20260906150000_payment_balance_cents.sql), para os
// números baterem entre a Home e a tela de Pagamentos.
export type DashboardReceivablePayment = {
  id: string;
  clientName: string;
  origin: string;
  balanceCents: number;
  dueDate: string;
  status: 'pending' | 'overdue';
};

export type DashboardNotification = {
  id: string;
  kind: 'appointment' | 'client_link' | 'client' | 'financial';
  title: string;
  description: string;
  resourceId: string;
  destination: '/agenda' | '/clients';
  createdAt: string;
  readAt: string | null;
};

export type DashboardSnapshot = {
  generatedAt: string;
  timeZone: string;
  providerDisplayName: string;
  summary: DashboardSummary;
  todayAppointments: DashboardAppointment[];
  notifications: DashboardNotification[];
  // Opcionais: adicionados por `get_provider_dashboard_snapshot`
  // (20260906160000_dashboard_receivable_payments.sql) para o painel
  // "Pagamentos a receber" da Home. Ficam opcionais (em vez de obrigatórios)
  // de propósito — telas/testes existentes que já montam um `DashboardSnapshot`
  // sem esses campos (ex.: `app/dashboard.tsx`, `defaultSnapshot`) continuam
  // compilando sem alteração; o adapter sempre preenche com fallback
  // (`[]`/`0`) quando o backend ainda não os retorna.
  receivablePayments?: DashboardReceivablePayment[];
  // Soma de `balanceCents` de TODAS as cobranças pendentes/atrasadas do
  // tenant (não só as exibidas em `receivablePayments`, que traz no máximo 5).
  receivableTotalCents?: number;
  // Contagem total dessas mesmas cobranças (não só as exibidas).
  receivableCount?: number;
};

export type DashboardErrorCode = 'FORBIDDEN' | 'SESSION_EXPIRED' | 'NETWORK_ERROR' | 'UNKNOWN';

export class DashboardError extends Error {
  constructor(public readonly code: DashboardErrorCode, message: string, public readonly correlationId?: string) {
    super(message);
    this.name = 'DashboardError';
  }
}
