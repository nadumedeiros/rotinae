import type { ClientPortfolioPort } from "@/src/domain/clients/client-portfolio-port";
import {
  ClientDomainError,
  type Client,
  type ClientDomainErrorCode,
  type ClientListInput,
  type ClientNote,
  type ClientOverview,
  type ClientPolicyRenewal,
  type CreateClientInput,
  type CreateClientNoteInput,
  type ClientLinkInvitationDelivery,
  type DecideLinkInput,
  type LinkReconciliationPreview,
  type LinkRequest,
  type Page,
  type ProviderLinkCodeSummary,
  type RedeemedProviderLink,
  type ClientProviderLink,
  type RenewClientPolicyInput,
  type RotatedLinkCode,
  type UpdateClientInput,
  type SendClientLinkInvitationInput,
} from "@/src/domain/clients/types";
import { supabase } from "@/src/infra/supabase/client";

// Migração/segurança de referência: docs/HANDOFF_CLIENTES_VINCULO_CRIS.md e
// apps/agendae/supabase/migrations/20260806101500_clients_registry.sql /
// 20260806101600_client_reconciliation_rpcs.sql.
//
// `sendClientLinkInvitation` NÃO é implementado aqui de propósito: depende de
// outbox/fila de e-mail e geração de convite com token próprio, tratado como
// frente separada (ver seção "Telefone, WhatsApp e convite por e-mail" do
// handoff e BACKLOG.md, DEC-069). Chamar esse método lança um erro de domínio
// explícito em vez de simular sucesso.

const PAGE_SIZE = 10 as const;

// --------------------------------------------------------------------------
// Mapeamento de erros Postgres/Supabase -> ClientDomainErrorCode
// (docs/HANDOFF_CLIENTES_VINCULO_CRIS.md, seção 5).
// --------------------------------------------------------------------------

export type PostgrestErrorLike = {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

// As funções SECURITY DEFINER (20260806101300/101600) sempre lançam
// `raise exception 'CODIGO: descrição' using errcode = '22023'`; o adaptador
// extrai o prefixo antes de ':' para recuperar o código público sem
// interpretar texto livre do fornecedor.
function extractPrefixCode(message: string): string | null {
  const match = /^([A-Z_]+):/.exec(message ?? "");
  return match ? match[1] : null;
}

const KNOWN_PREFIX_CODES: Record<string, ClientDomainErrorCode> = {
  CLIENT_NOT_FOUND: "CLIENT_NOT_FOUND",
  CLIENT_EMAIL_CONFLICT: "CLIENT_EMAIL_CONFLICT",
  CLIENT_RECONCILIATION_AMBIGUOUS: "CLIENT_RECONCILIATION_AMBIGUOUS",
  CLIENT_IDENTITY_ALREADY_ATTACHED: "CLIENT_IDENTITY_ALREADY_ATTACHED",
  CLIENT_DUPLICATE_RECORD: "CLIENT_DUPLICATE_RECORD",
  BOOKING_POLICY_INVALID: "BOOKING_POLICY_INVALID",
  CLIENT_NOTE_NOT_FOUND: "CLIENT_NOTE_NOT_FOUND",
  CLIENT_NOTE_INVALID: "CLIENT_NOTE_INVALID",
  LINK_CODE_NOT_FOUND: "LINK_CODE_NOT_FOUND",
  LINK_CODE_EXPIRED: "LINK_CODE_EXPIRED",
  LINK_ALREADY_EXISTS: "LINK_ALREADY_EXISTS",
  LINK_REQUEST_NOT_FOUND: "LINK_REQUEST_NOT_FOUND",
  INVALID_LINK_TRANSITION: "INVALID_LINK_TRANSITION",
  LINK_ROLE_MISMATCH: "LINK_ROLE_MISMATCH",
  FORBIDDEN: "FORBIDDEN",
  PROFILE_FORBIDDEN: "FORBIDDEN",
};

const HUMAN_MESSAGES: Record<ClientDomainErrorCode, string> = {
  CLIENT_NOT_FOUND: "Cliente não encontrado.",
  CLIENT_EMAIL_CONFLICT: "Já existe um cliente com este e-mail.",
  CLIENT_RECONCILIATION_AMBIGUOUS: "Existe mais de um cadastro correspondente; revise manualmente.",
  CLIENT_IDENTITY_ALREADY_ATTACHED: "Este cadastro já está vinculado a outra conta.",
  CLIENT_DUPLICATE_RECORD: "Este registro já existe.",
  BOOKING_POLICY_INVALID: "Limites ou período informados são inválidos.",
  BOOKING_TOTAL_LIMIT_REACHED: "Limite total de agendamentos foi atingido.",
  BOOKING_DAILY_LIMIT_REACHED: "Limite diário de agendamentos foi atingido.",
  BOOKING_REQUEST_WINDOW_CLOSED: "Fora do período permitido para agendamento.",
  CLIENT_NOTE_NOT_FOUND: "Anotação não encontrada.",
  CLIENT_NOTE_INVALID: "A anotação não pode ficar vazia.",
  LINK_CODE_NOT_FOUND: "Código inválido ou expirado.",
  LINK_CODE_EXPIRED: "Código expirado.",
  LINK_ALREADY_EXISTS: "Já existe uma solicitação ou vínculo para este cliente.",
  LINK_REQUEST_NOT_FOUND: "Vínculo não encontrado ou já processado.",
  INVALID_LINK_TRANSITION: "Esta solicitação já foi decidida.",
  LINK_ROLE_MISMATCH: "Vínculo só é permitido entre um Prestador e uma conta Cliente.",
  FORBIDDEN: "Você não tem permissão para esta ação.",
  SESSION_EXPIRED: "Sua sessão expirou. Entre novamente.",
  RATE_LIMITED: "Muitas tentativas. Aguarde um instante e tente novamente.",
  NETWORK_ERROR: "Falha de conexão. Verifique sua internet e tente novamente.",
  UNKNOWN: "Não foi possível concluir agora. Tente novamente.",
};

export function mapClientDomainError(error: PostgrestErrorLike): ClientDomainError {
  // Instrumentação (BLG-073): loga o erro real do Supabase/PostgREST antes de
  // traduzi-lo para `ClientDomainError` (que só carrega uma mensagem humana
  // genérica e um código de domínio). Sem isto, qualquer `catch` nas telas
  // (ex.: `loadPortfolio()` em app/clients.tsx) nunca tem acesso a
  // `code`/`details`/`hint` originais, tornando impossível diagnosticar
  // falhas reais de RLS, rede ou sessão a partir de um relato de produção.
  console.error("[clients] Supabase/PostgREST error", {
    message: error?.message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
  });

  const message = error?.message ?? "";
  const prefixCode = extractPrefixCode(message);
  if (prefixCode && KNOWN_PREFIX_CODES[prefixCode]) {
    const code = KNOWN_PREFIX_CODES[prefixCode];
    return new ClientDomainError(code, HUMAN_MESSAGES[code]);
  }

  // Violação de unicidade que não passou por uma função SECURITY DEFINER
  // (ex.: insert/update direto na tabela pelo adapter) — identificada pelo
  // nome da constraint (20260806101500_clients_registry.sql).
  if (error?.code === "23505") {
    if (message.includes("clients_tenant_normalized_email_active_uk")) {
      return new ClientDomainError("CLIENT_EMAIL_CONFLICT", HUMAN_MESSAGES.CLIENT_EMAIL_CONFLICT);
    }
    if (message.includes("clients_tenant_client_user_uk")) {
      return new ClientDomainError(
        "CLIENT_IDENTITY_ALREADY_ATTACHED",
        HUMAN_MESSAGES.CLIENT_IDENTITY_ALREADY_ATTACHED,
      );
    }
    return new ClientDomainError("CLIENT_DUPLICATE_RECORD", HUMAN_MESSAGES.CLIENT_DUPLICATE_RECORD);
  }

  // check_violation: qualquer constraint de negócio da tabela clients
  // (e-mail/telefone mal formado, limite zero, janela incoerente).
  if (error?.code === "23514") {
    return new ClientDomainError("BOOKING_POLICY_INVALID", HUMAN_MESSAGES.BOOKING_POLICY_INVALID);
  }

  if (error?.code === "42501") {
    return new ClientDomainError("FORBIDDEN", HUMAN_MESSAGES.FORBIDDEN);
  }

  if (
    message.toLowerCase().includes("failed to fetch") ||
    message.toLowerCase().includes("network")
  ) {
    return new ClientDomainError("NETWORK_ERROR", HUMAN_MESSAGES.NETWORK_ERROR);
  }

  return new ClientDomainError("UNKNOWN", HUMAN_MESSAGES.UNKNOWN);
}

// --------------------------------------------------------------------------
// Mapeamento de linhas do banco <-> tipos de domínio
// --------------------------------------------------------------------------

type ClientRow = {
  id: string;
  client_user_id: string | null;
  record_origin: Client["recordOrigin"];
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp_confirmation_enabled: boolean;
  whatsapp_reminder_enabled: boolean;
  status: Client["status"];
  primary_service: string | null;
  primary_service_id: string | null;
  service_value_cents: number;
  total_booking_limit: number | null;
  daily_booking_limit: number | null;
  request_window_start: string | null;
  request_window_end: string | null;
  last_service_at: string | null;
  created_at: string;
  updated_at: string;
};

function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    clientUserId: row.client_user_id,
    recordOrigin: row.record_origin,
    name: row.name,
    email: row.email ?? "",
    phone: row.phone,
    communicationPreferences: {
      whatsappAppointmentConfirmation: row.whatsapp_confirmation_enabled,
      whatsappAppointmentReminder: row.whatsapp_reminder_enabled,
    },
    status: row.status,
    primaryService: row.primary_service,
    primaryServiceId: row.primary_service_id,
    serviceValueCents: row.service_value_cents,
    bookingPolicy: {
      totalBookingLimit: row.total_booking_limit,
      dailyBookingLimit: row.daily_booking_limit,
      requestWindowStart: row.request_window_start,
      requestWindowEnd: row.request_window_end,
    },
    lastServiceAt: row.last_service_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Linha retornada por `renew_client_policy` (chave `renewal`) e pela leitura
// direta de `client_policy_renewals` (item 4 de
// 20260823150000_client_policy_renewal.sql) — mesmas colunas nos dois casos.
type ClientPolicyRenewalRow = {
  id: string;
  client_id: string;
  total_booking_limit: number | null;
  service_value_cents: number;
  request_window_start: string | null;
  request_window_end: string | null;
  appointments_used: number;
  renewed_by_user_id: string;
  renewed_at: string;
};

function toClientPolicyRenewal(row: ClientPolicyRenewalRow): ClientPolicyRenewal {
  return {
    id: row.id,
    clientId: row.client_id,
    totalBookingLimit: row.total_booking_limit,
    serviceValueCents: row.service_value_cents,
    requestWindowStart: row.request_window_start,
    requestWindowEnd: row.request_window_end,
    appointmentsUsed: row.appointments_used,
    renewedByUserId: row.renewed_by_user_id,
    renewedAt: row.renewed_at,
  };
}

// Validação client-side espelhando as checagens de `renew_client_policy`
// (defesa em profundidade / feedback mais rápido); o banco continua sendo a
// autoridade final. Não inclui `dailyBookingLimit`: a renovação não altera
// esse campo (fora do contrato desta RPC).
function validateRenewClientPolicyInput(input: RenewClientPolicyInput): void {
  if (input.totalBookingLimit !== null && input.totalBookingLimit < 1) {
    throw new ClientDomainError("BOOKING_POLICY_INVALID", HUMAN_MESSAGES.BOOKING_POLICY_INVALID);
  }
  if (input.serviceValueCents < 0) {
    throw new ClientDomainError("BOOKING_POLICY_INVALID", HUMAN_MESSAGES.BOOKING_POLICY_INVALID);
  }
  const hasStart = input.requestWindowStart !== null;
  const hasEnd = input.requestWindowEnd !== null;
  if (hasStart !== hasEnd) {
    throw new ClientDomainError("BOOKING_POLICY_INVALID", HUMAN_MESSAGES.BOOKING_POLICY_INVALID);
  }
  if (hasStart && hasEnd && input.requestWindowStart! > input.requestWindowEnd!) {
    throw new ClientDomainError("BOOKING_POLICY_INVALID", HUMAN_MESSAGES.BOOKING_POLICY_INVALID);
  }
}

type ClientNoteRow = {
  id: string;
  client_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  author_user_id: string;
  profiles?: { display_name: string } | { display_name: string }[] | null;
};

function toClientNote(row: ClientNoteRow): ClientNote {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.id,
    clientId: row.client_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authorName: profile?.display_name ?? "Prestador",
  };
}

const NOTE_SELECT_COLUMNS =
  "id, client_id, content, created_at, updated_at, author_user_id, profiles:author_user_id(display_name)";

// `.or()` do PostgREST usa vírgula/parênteses como sintaxe estrutural; um
// termo de busca livre com esses caracteres quebraria o filtro. Removê-los é
// suficiente para o caso de uso (nome/e-mail nunca legitimamente os contêm).
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%]/g, " ").trim();
}

function validateBookingPolicyShape(policy: {
  totalBookingLimit: number | null;
  dailyBookingLimit: number | null;
  requestWindowStart: string | null;
  requestWindowEnd: string | null;
}): void {
  // Validação client-side espelhando as constraints do banco (defesa em
  // profundidade / feedback mais rápido); o banco continua sendo a
  // autoridade final (20260806101500_clients_registry.sql).
  if (policy.totalBookingLimit !== null && policy.totalBookingLimit < 1) {
    throw new ClientDomainError("BOOKING_POLICY_INVALID", HUMAN_MESSAGES.BOOKING_POLICY_INVALID);
  }
  if (policy.dailyBookingLimit !== null && policy.dailyBookingLimit < 1) {
    throw new ClientDomainError("BOOKING_POLICY_INVALID", HUMAN_MESSAGES.BOOKING_POLICY_INVALID);
  }
  const hasStart = policy.requestWindowStart !== null;
  const hasEnd = policy.requestWindowEnd !== null;
  if (hasStart !== hasEnd) {
    throw new ClientDomainError("BOOKING_POLICY_INVALID", HUMAN_MESSAGES.BOOKING_POLICY_INVALID);
  }
  if (hasStart && hasEnd && policy.requestWindowStart! > policy.requestWindowEnd!) {
    throw new ClientDomainError("BOOKING_POLICY_INVALID", HUMAN_MESSAGES.BOOKING_POLICY_INVALID);
  }
}

export class SupabaseClientPortfolioAdapter implements ClientPortfolioPort {
  // O servidor deriva o tenant a partir da sessão (RLS de `tenants`, seção 1
  // do handoff: "a UI nunca escolhe provider_id ou tenant_id"). Como este
  // adaptador não tem uma camada própria de servidor (roda com a anon key +
  // RLS), a única forma de obter o tenant do chamador para operações de
  // escrita (que exigem a coluna tenant_id explícita no INSERT) é perguntar
  // à própria tabela `tenants`.
  //
  // IMPORTANTE (corrigido após incidente de produção 2026-08-12): a query
  // NÃO pode depender só do RLS para devolver uma única linha. Desde
  // 20260811140000_multi_profile_roles.sql uma mesma conta pode ser
  // simultaneamente dona de um tenant (`tenants_select_owner`) e cliente
  // ativo de outro tenant (`tenants_select_active_client`,
  // 20260806100300_provider_client_links.sql) — nesse caso as duas policies
  // de select somadas fazem a tabela devolver 2 linhas visíveis para o
  // mesmo `auth.uid()`, e `.maybeSingle()` lança erro (`PGRST116`),
  // quebrando `createClient()`. Filtrar explicitamente por
  // `owner_user_id = auth.uid()` restringe o resultado a, no máximo, o
  // único tenant que essa conta possui (unique constraint em
  // `tenants.owner_user_id`), independentemente de quantos outros tenants
  // ela possa enxergar como cliente.
  private async currentTenantId(): Promise<string> {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      throw new ClientDomainError("SESSION_EXPIRED", HUMAN_MESSAGES.SESSION_EXPIRED);
    }

    const { data, error } = await supabase
      .from("tenants")
      .select("id")
      .eq("owner_user_id", authData.user.id)
      .maybeSingle();
    if (error) throw mapClientDomainError(error);
    if (!data) throw new ClientDomainError("FORBIDDEN", HUMAN_MESSAGES.FORBIDDEN);
    return (data as { id: string }).id;
  }

  async getOverview(): Promise<ClientOverview> {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const [totalRes, activeRes, newRes] = await Promise.all([
      supabase.from("clients").select("id", { count: "exact", head: true }),
      supabase.from("clients").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startOfMonth.toISOString()),
    ]);

    if (totalRes.error) throw mapClientDomainError(totalRes.error);
    if (activeRes.error) throw mapClientDomainError(activeRes.error);
    if (newRes.error) throw mapClientDomainError(newRes.error);

    return {
      total: totalRes.count ?? 0,
      active: activeRes.count ?? 0,
      newThisMonth: newRes.count ?? 0,
    };
  }

  async getClient(clientId: string): Promise<Client> {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .maybeSingle();
    if (error) throw mapClientDomainError(error);
    if (!data) throw new ClientDomainError("CLIENT_NOT_FOUND", HUMAN_MESSAGES.CLIENT_NOT_FOUND);
    return toClient(data as ClientRow);
  }

  async listClients(input: ClientListInput): Promise<Page<Client>> {
    const page = Math.max(1, input.page);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase.from("clients").select("*", { count: "exact" });

    if (input.status) {
      query = query.eq("status", input.status);
    }

    const term = input.query ? sanitizeSearchTerm(input.query) : "";
    if (term.length > 0) {
      query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%`);
    }

    const { data, error, count } = await query.order("name", { ascending: true }).range(from, to);
    if (error) throw mapClientDomainError(error);

    const items = ((data ?? []) as ClientRow[]).map(toClient);
    const totalItems = count ?? 0;
    return {
      items,
      page,
      pageSize: PAGE_SIZE,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / PAGE_SIZE)),
    };
  }

  async createClient(input: CreateClientInput): Promise<Client> {
    validateBookingPolicyShape(input.bookingPolicy);
    const tenantId = await this.currentTenantId();

    // `linkInvitationDelivery` é aceito pelo contrato, mas o envio do
    // convite (`sendClientLinkInvitation`) não está implementado nesta
    // etapa — o cadastro é criado independentemente do valor informado, sem
    // disparar nenhuma tentativa de envio.
    const { data, error } = await supabase
      .from("clients")
      .insert({
        tenant_id: tenantId,
        record_origin: "provider_created",
        name: input.name.trim(),
        email: input.email?.trim() ? input.email.trim().toLowerCase() : null,
        phone: input.phone,
        whatsapp_confirmation_enabled: input.communicationPreferences.whatsappAppointmentConfirmation,
        whatsapp_reminder_enabled: input.communicationPreferences.whatsappAppointmentReminder,
        status: input.status,
        primary_service: input.primaryService ?? null,
        primary_service_id: input.primaryServiceId ?? null,
        service_value_cents: input.serviceValueCents,
        total_booking_limit: input.bookingPolicy.totalBookingLimit,
        daily_booking_limit: input.bookingPolicy.dailyBookingLimit,
        request_window_start: input.bookingPolicy.requestWindowStart,
        request_window_end: input.bookingPolicy.requestWindowEnd,
      })
      .select("*")
      .single();

    if (error) throw mapClientDomainError(error);
    return toClient(data as ClientRow);
  }

  async updateClient(input: UpdateClientInput): Promise<Client> {
    if (input.bookingPolicy !== undefined) {
      validateBookingPolicyShape(input.bookingPolicy);
    }

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.email !== undefined) patch.email = input.email.trim() ? input.email.trim().toLowerCase() : null;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.communicationPreferences !== undefined) {
      patch.whatsapp_confirmation_enabled = input.communicationPreferences.whatsappAppointmentConfirmation;
      patch.whatsapp_reminder_enabled = input.communicationPreferences.whatsappAppointmentReminder;
    }
    if (input.status !== undefined) patch.status = input.status;
    if (input.primaryService !== undefined) patch.primary_service = input.primaryService;
    if (input.primaryServiceId !== undefined) patch.primary_service_id = input.primaryServiceId;
    if (input.serviceValueCents !== undefined) patch.service_value_cents = input.serviceValueCents;
    if (input.bookingPolicy !== undefined) {
      patch.total_booking_limit = input.bookingPolicy.totalBookingLimit;
      patch.daily_booking_limit = input.bookingPolicy.dailyBookingLimit;
      patch.request_window_start = input.bookingPolicy.requestWindowStart;
      patch.request_window_end = input.bookingPolicy.requestWindowEnd;
    }

    const { data, error } = await supabase
      .from("clients")
      .update(patch)
      .eq("id", input.id)
      .select("*")
      .maybeSingle();

    if (error) throw mapClientDomainError(error);
    if (!data) throw new ClientDomainError("CLIENT_NOT_FOUND", HUMAN_MESSAGES.CLIENT_NOT_FOUND);
    return toClient(data as ClientRow);
  }

  async renewClientPolicy(input: RenewClientPolicyInput): Promise<Client> {
    validateRenewClientPolicyInput(input);

    const { data, error } = await supabase.rpc("renew_client_policy", {
      p_client_id: input.clientId,
      p_total_booking_limit: input.totalBookingLimit,
      p_service_value_cents: input.serviceValueCents,
      p_request_window_start: input.requestWindowStart,
      p_request_window_end: input.requestWindowEnd,
    });
    if (error) throw mapClientDomainError(error);

    const payload = data as { client: ClientRow; renewal: ClientPolicyRenewalRow } | null;
    if (!payload?.client) throw new ClientDomainError("UNKNOWN", HUMAN_MESSAGES.UNKNOWN);
    return toClient(payload.client);
  }

  async listClientPolicyRenewals(clientId: string): Promise<ClientPolicyRenewal[]> {
    const { data, error } = await supabase
      .from("client_policy_renewals")
      .select(
        "id, client_id, total_booking_limit, service_value_cents, request_window_start, request_window_end, appointments_used, renewed_by_user_id, renewed_at",
      )
      .eq("client_id", clientId)
      .order("renewed_at", { ascending: false });

    if (error) throw mapClientDomainError(error);
    return ((data ?? []) as ClientPolicyRenewalRow[]).map(toClientPolicyRenewal);
  }

  async sendClientLinkInvitation(
    _input: SendClientLinkInvitationInput,
  ): Promise<ClientLinkInvitationDelivery> {
    // Fora de escopo nesta entrega (ver cabeçalho do arquivo e BACKLOG.md,
    // DEC-069): depende de outbox/fila de e-mail e token de convite próprio.
    throw new ClientDomainError(
      "UNKNOWN",
      "O envio de convite por e-mail ainda não está disponível nesta versão.",
    );
  }

  async archiveClient(clientId: string): Promise<void> {
    // Arquivamento lógico (seção 3 do handoff: "nunca delete físico direto
    // pela tela") — sempre UPDATE de status, nunca DELETE.
    const { data, error } = await supabase
      .from("clients")
      .update({ status: "inactive" })
      .eq("id", clientId)
      .select("id")
      .maybeSingle();

    if (error) throw mapClientDomainError(error);
    if (!data) throw new ClientDomainError("CLIENT_NOT_FOUND", HUMAN_MESSAGES.CLIENT_NOT_FOUND);
  }

  async getLinkCodeSummary(): Promise<ProviderLinkCodeSummary | null> {
    const { data, error } = await supabase
      .from("provider_link_codes")
      .select("id, display_prefix, status, expires_at, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw mapClientDomainError(error);
    if (!data) return null;

    const row = data as {
      id: string;
      display_prefix: string;
      status: ProviderLinkCodeSummary["status"];
      expires_at: string | null;
      created_at: string;
    };
    return {
      id: row.id,
      displayPrefix: row.display_prefix,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  async rotateLinkCode(): Promise<RotatedLinkCode> {
    const { data, error } = await supabase.rpc("rotate_provider_link_code");
    if (error) throw mapClientDomainError(error);

    const row = (Array.isArray(data) ? data[0] : data) as
      | {
          id: string;
          display_prefix: string;
          status: RotatedLinkCode["status"];
          expires_at: string | null;
          created_at: string;
          full_code: string;
        }
      | undefined;

    if (!row) throw new ClientDomainError("UNKNOWN", HUMAN_MESSAGES.UNKNOWN);

    return {
      id: row.id,
      displayPrefix: row.display_prefix,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      fullCode: row.full_code,
    };
  }

  async redeemProviderLinkCode(code: string): Promise<RedeemedProviderLink> {
    const { data, error } = await supabase.rpc("redeem_provider_link_code", {
      code: code.trim(),
    });
    if (error) throw mapClientDomainError(error);

    const row = (Array.isArray(data) ? data[0] : data) as
      | { id: string; tenant_id: string; status: "pending"; requested_at: string }
      | undefined;
    if (!row) throw new ClientDomainError("UNKNOWN", HUMAN_MESSAGES.UNKNOWN);
    return {
      id: row.id,
      tenantId: row.tenant_id,
      status: row.status,
      requestedAt: row.requested_at,
    };
  }

  async listClientProviderLinks(): Promise<ClientProviderLink[]> {
    const { data, error } = await supabase
      .from("provider_client_links")
      .select("id, tenant_id, status, requested_at")
      .in("status", ["pending", "active"])
      .order("requested_at", { ascending: false });
    if (error) throw mapClientDomainError(error);

    const rows = (data ?? []) as {
      id: string;
      tenant_id: string;
      status: "pending" | "active";
      requested_at: string;
    }[];
    const activeTenantIds = rows
      .filter((row) => row.status === "active")
      .map((row) => row.tenant_id);
    // `profession` (DEC-137) vem da mesma linha/consulta de `tenants` já
    // usada para `display_name` — nenhuma consulta adicional, mesma
    // superfície de RLS (`tenants_select_active_client`) já cobre a coluna
    // nova (RLS é por linha, não por coluna).
    let tenantData = new Map<string, { displayName: string; profession: string | null }>();
    if (activeTenantIds.length > 0) {
      const { data: tenantRows, error: tenantError } = await supabase
        .from("tenants")
        .select("id, display_name, profession")
        .in("id", activeTenantIds);
      if (tenantError) throw mapClientDomainError(tenantError);
      tenantData = new Map(
        ((tenantRows ?? []) as { id: string; display_name: string; profession: string | null }[]).map(
          (tenant) => [tenant.id, { displayName: tenant.display_name, profession: tenant.profession }],
        ),
      );
    }

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      providerName: tenantData.get(row.tenant_id)?.displayName ?? null,
      profession: tenantData.get(row.tenant_id)?.profession ?? null,
      status: row.status,
      requestedAt: row.requested_at,
    }));
  }

  async listPendingLinkRequests(input: { page: number; pageSize: 10 }): Promise<Page<LinkRequest>> {
    const page = Math.max(1, input.page);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    // `provider_pending_link_requests` (20260806101600) é a única forma de
    // ler nome/e-mail do cliente numa consulta direta: PostgREST nunca
    // expõe auth.users, então a view resolve esse join com o privilégio do
    // seu owner e filtra por tenant no próprio corpo (`auth.uid()`).
    const { data, error, count } = await supabase
      .from("provider_pending_link_requests")
      .select("*", { count: "exact" })
      .order("requested_at", { ascending: true })
      .range(from, to);

    if (error) throw mapClientDomainError(error);

    const rows = (data ?? []) as {
      id: string;
      client_user_id: string;
      client_name: string;
      client_email: string;
      requested_at: string;
    }[];

    const items: LinkRequest[] = rows.map((row) => ({
      id: row.id,
      clientUserId: row.client_user_id,
      clientName: row.client_name,
      clientEmail: row.client_email,
      status: "pending",
      requestedAt: row.requested_at,
    }));

    const totalItems = count ?? 0;
    return {
      items,
      page,
      pageSize: PAGE_SIZE,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / PAGE_SIZE)),
    };
  }

  async previewLinkReconciliation(requestId: string): Promise<LinkReconciliationPreview> {
    const { data, error } = await supabase.rpc("preview_link_reconciliation", { link_id: requestId });
    if (error) throw mapClientDomainError(error);

    const payload = data as {
      candidates: {
        clientId: string;
        clientName: string;
        maskedEmail: string;
        maskedPhone: string | null;
        matchReason: "verified_email" | "phone_review";
        alreadyAttached: boolean;
      }[];
      recommendedAction: LinkReconciliationPreview["recommendedAction"];
    } | null;

    if (!payload) throw new ClientDomainError("UNKNOWN", HUMAN_MESSAGES.UNKNOWN);

    return {
      requestId,
      candidates: payload.candidates.map((candidate) => ({
        clientId: candidate.clientId,
        clientName: candidate.clientName,
        maskedEmail: candidate.maskedEmail,
        maskedPhone: candidate.maskedPhone,
        matchReason: candidate.matchReason,
        alreadyAttached: candidate.alreadyAttached,
      })),
      recommendedAction: payload.recommendedAction,
    };
  }

  async decideLinkRequest(input: DecideLinkInput): Promise<void> {
    const { error } = await supabase.rpc("decide_provider_link_request", {
      link_id: input.requestId,
      decision: input.decision,
      target_client_id: input.targetClientId ?? null,
    });
    if (error) throw mapClientDomainError(error);
  }

  async revokeClientLink(clientId: string): Promise<void> {
    const { data: clientRow, error: clientError } = await supabase
      .from("clients")
      .select("client_user_id")
      .eq("id", clientId)
      .maybeSingle();

    if (clientError) throw mapClientDomainError(clientError);
    const clientUserId = (clientRow as { client_user_id: string | null } | null)?.client_user_id ?? null;
    if (!clientUserId) {
      throw new ClientDomainError("LINK_REQUEST_NOT_FOUND", HUMAN_MESSAGES.LINK_REQUEST_NOT_FOUND);
    }

    const { data: linkRow, error: linkError } = await supabase
      .from("provider_client_links")
      .select("id")
      .eq("client_user_id", clientUserId)
      .eq("status", "active")
      .maybeSingle();

    if (linkError) throw mapClientDomainError(linkError);
    const linkId = (linkRow as { id: string } | null)?.id;
    if (!linkId) {
      throw new ClientDomainError("LINK_REQUEST_NOT_FOUND", HUMAN_MESSAGES.LINK_REQUEST_NOT_FOUND);
    }

    const { error } = await supabase.rpc("revoke_provider_client_link", { link_id: linkId });
    if (error) throw mapClientDomainError(error);
  }

  async listClientNotes(clientId: string): Promise<ClientNote[]> {
    const { data, error } = await supabase
      .from("client_notes")
      .select(NOTE_SELECT_COLUMNS)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (error) throw mapClientDomainError(error);
    return ((data ?? []) as unknown as ClientNoteRow[]).map(toClientNote);
  }

  async createClientNote(input: CreateClientNoteInput): Promise<ClientNote> {
    const content = input.content.trim();
    if (content.length === 0) {
      throw new ClientDomainError("CLIENT_NOTE_INVALID", HUMAN_MESSAGES.CLIENT_NOTE_INVALID);
    }

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      throw new ClientDomainError("SESSION_EXPIRED", HUMAN_MESSAGES.SESSION_EXPIRED);
    }

    const { data, error } = await supabase
      .from("client_notes")
      .insert({ client_id: input.clientId, content, author_user_id: authData.user.id })
      .select(NOTE_SELECT_COLUMNS)
      .single();

    if (error) throw mapClientDomainError(error);
    return toClientNote(data as unknown as ClientNoteRow);
  }

  async updateClientNote(noteId: string, content: string): Promise<ClientNote> {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      throw new ClientDomainError("CLIENT_NOTE_INVALID", HUMAN_MESSAGES.CLIENT_NOTE_INVALID);
    }

    const { data, error } = await supabase
      .from("client_notes")
      .update({ content: trimmed })
      .eq("id", noteId)
      .select(NOTE_SELECT_COLUMNS)
      .maybeSingle();

    if (error) throw mapClientDomainError(error);
    if (!data) throw new ClientDomainError("CLIENT_NOTE_NOT_FOUND", HUMAN_MESSAGES.CLIENT_NOTE_NOT_FOUND);
    return toClientNote(data as unknown as ClientNoteRow);
  }

  async deleteClientNote(noteId: string): Promise<void> {
    const { data, error } = await supabase.from("client_notes").delete().eq("id", noteId).select("id").maybeSingle();

    if (error) throw mapClientDomainError(error);
    if (!data) throw new ClientDomainError("CLIENT_NOTE_NOT_FOUND", HUMAN_MESSAGES.CLIENT_NOTE_NOT_FOUND);
  }
}

export const clientPortfolioService: ClientPortfolioPort = new SupabaseClientPortfolioAdapter();
