export type ClientStatus = "active" | "inactive";
export type LinkStatus = "pending" | "active" | "rejected" | "revoked";
export type LinkCodeStatus = "active" | "revoked" | "expired";

export type ClientBookingPolicy = {
  /** null representa quantidade total livre. */
  totalBookingLimit: number | null;
  /** null representa quantidade diária livre. */
  dailyBookingLimit: number | null;
  /** Ambos null representam período livre. Datas civis no fuso do prestador. */
  requestWindowStart: string | null;
  requestWindowEnd: string | null;
};

export type Client = {
  id: string;
  /** null enquanto for apenas um cadastro interno criado pelo prestador. */
  clientUserId: string | null;
  recordOrigin: "provider_created" | "client_created" | "reconciled";
  name: string;
  email: string;
  /** E.164, por exemplo +5511999999999. */
  phone: string | null;
  communicationPreferences: ClientCommunicationPreferences;
  status: ClientStatus;
  primaryService: string | null;
  /**
   * Referência opcional ao catálogo de serviços (`Service.id`, RF-CAD-004).
   * Campo aditivo (DEC-070): ausente/`undefined` em registros e adaptadores
   * anteriores a esta decisão continua satisfazendo o tipo, então nenhum
   * adaptador existente (`MockClientPortfolioAdapter`,
   * `SupabaseClientPortfolioAdapter`) precisa mudar para compilar.
   * Não substitui `primaryService` (rótulo livre, mantido para clientes sem
   * serviço equivalente no catálogo ou cadastrados antes do catálogo
   * existir) nem implica que `serviceValueCents` deva ser igual a
   * `Service.referenceValueCents`: o valor por cliente é um default próprio
   * do vínculo, que pode divergir do valor de tabela do catálogo — mesma
   * lógica de `AppointmentRecord.valueCentsSnapshot` divergindo de
   * `Service.referenceValueCents` após reajustes (RN-AGD-023).
   */
  primaryServiceId?: string | null;
  serviceValueCents: number;
  bookingPolicy: ClientBookingPolicy;
  lastServiceAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClientCommunicationPreferences = {
  whatsappAppointmentConfirmation: boolean;
  whatsappAppointmentReminder: boolean;
};

export type CommunicationConsentEvidence = {
  clientId: string;
  channel: "whatsapp";
  purpose: "appointment_confirmation" | "appointment_reminder";
  granted: boolean;
  capturedAt: string;
  capturedByUserId: string;
  source: "provider_client_form" | "client_preferences";
};

export type ClientOverview = {
  total: number;
  active: number;
  newThisMonth: number;
};

export type ClientListInput = {
  query?: string;
  status?: ClientStatus;
  page: number;
  pageSize: 10;
};

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type CreateClientInput = {
  name: string;
  email: string;
  /** Normalizado em E.164 ou null. */
  phone: string | null;
  communicationPreferences: ClientCommunicationPreferences;
  linkInvitationDelivery: "email" | "none";
  status: ClientStatus;
  primaryService?: string | null;
  /** Ver `Client.primaryServiceId`. Aditivo e opcional; ausência preserva o comportamento atual. */
  primaryServiceId?: string | null;
  serviceValueCents: number;
  bookingPolicy: ClientBookingPolicy;
};

export type UpdateClientInput = Partial<CreateClientInput> & { id: string };

export type SendClientLinkInvitationInput = {
  clientId: string;
  channel: "email";
  /** Chave idempotente criada para uma única intenção de envio. */
  idempotencyKey: string;
};

export type ClientLinkInvitationDelivery = {
  deliveryId: string;
  status: "queued" | "sent" | "failed";
  queuedAt: string;
};

export type ProviderLinkCodeSummary = {
  id: string;
  displayPrefix: string;
  status: LinkCodeStatus;
  expiresAt: string | null;
  createdAt: string;
};

export type RotatedLinkCode = ProviderLinkCodeSummary & {
  /** Segredo exibido uma única vez após geração/rotação. Nunca registrar em logs. */
  fullCode: string;
};

export type RedeemedProviderLink = {
  id: string;
  tenantId: string;
  status: "pending";
  requestedAt: string;
};

export type ClientProviderLink = {
  id: string;
  tenantId: string;
  providerName: string | null;
  /**
   * Profissão/especialidade do prestador (ex.: "Personal Trainer"), quando
   * informada. Campo aditivo (DEC-137) — fonte `tenants.profession`, mesma
   * consulta/tabela já usada para `providerName` neste tipo. `null` quando
   * o prestador não preencheu (RN-PRF-004: nunca bloqueia nada) ou quando o
   * vínculo ainda não está `active` (mesma regra de `providerName`, que
   * também só é resolvido para vínculos ativos).
   */
  profession: string | null;
  status: "pending" | "active";
  requestedAt: string;
};

/**
 * O vínculo só é válido entre perfis diferentes: a identidade que resgata o
 * código precisa ter perfil Cliente. Se a conta que informou o código for
 * Prestador, o servidor deve recusar com `LINK_ROLE_MISMATCH` — a mesma regra
 * vale no sentido inverso (Cliente não pode gerar/aprovar código de vínculo).
 */
export type LinkRequest = {
  id: string;
  clientUserId: string;
  clientName: string;
  clientEmail: string;
  status: "pending";
  requestedAt: string;
};

export type ClientReconciliationCandidate = {
  clientId: string;
  clientName: string;
  maskedEmail: string;
  maskedPhone: string | null;
  matchReason: "verified_email" | "phone_review";
  alreadyAttached: boolean;
};

export type LinkReconciliationPreview = {
  requestId: string;
  candidates: ClientReconciliationCandidate[];
  recommendedAction: "attach_existing" | "create_new" | "manual_review" | "reject_conflict";
};

export type DecideLinkInput = {
  requestId: string;
  decision: "approve" | "reject";
  /** Obrigatório ao aprovar quando um cadastro interno correspondente existir. */
  targetClientId?: string;
};
/**
 * Snapshot dos valores ANTIGOS de política de agendamento, arquivado no
 * momento em que o prestador renova o pacote de um cliente
 * (`renew_client_policy`, 20260823150000_client_policy_renewal.sql).
 * `appointmentsUsed` é quantos agendamentos do ciclo que estava sendo
 * encerrado foram efetivamente consumidos (mesmo critério de corte —
 * `created_at` do agendamento — usado por `_create_appointment_row` para
 * decidir se um novo agendamento pode ser criado).
 */
export type ClientPolicyRenewal = {
  id: string;
  clientId: string;
  totalBookingLimit: number | null;
  serviceValueCents: number;
  requestWindowStart: string | null;
  requestWindowEnd: string | null;
  appointmentsUsed: number;
  renewedByUserId: string;
  renewedAt: string;
};

export type RenewClientPolicyInput = {
  clientId: string;
  /** Novo valor. null = quantidade total livre. */
  totalBookingLimit: number | null;
  /** Novo valor. */
  serviceValueCents: number;
  /** Novo valor. Ambos null = período livre; caso contrário os dois são obrigatórios. */
  requestWindowStart: string | null;
  requestWindowEnd: string | null;
};

export type ClientNote = {
  id: string;
  clientId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  authorName: string;
};
export type CreateClientNoteInput = { clientId: string; content: string };

export type ClientDomainErrorCode =
  | "CLIENT_NOT_FOUND"
  | "CLIENT_EMAIL_CONFLICT"
  | "CLIENT_RECONCILIATION_AMBIGUOUS"
  | "CLIENT_IDENTITY_ALREADY_ATTACHED"
  | "CLIENT_DUPLICATE_RECORD"
  | "BOOKING_POLICY_INVALID"
  | "BOOKING_TOTAL_LIMIT_REACHED"
  | "BOOKING_DAILY_LIMIT_REACHED"
  | "BOOKING_REQUEST_WINDOW_CLOSED"
  | "CLIENT_NOTE_NOT_FOUND"
  | "CLIENT_NOTE_INVALID"
  | "LINK_CODE_NOT_FOUND"
  | "LINK_CODE_EXPIRED"
  | "LINK_ALREADY_EXISTS"
  | "LINK_REQUEST_NOT_FOUND"
  | "INVALID_LINK_TRANSITION"
  | "LINK_ROLE_MISMATCH"
  | "FORBIDDEN"
  | "SESSION_EXPIRED"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export class ClientDomainError extends Error {
  constructor(
    public readonly code: ClientDomainErrorCode,
    message: string,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "ClientDomainError";
  }
}
