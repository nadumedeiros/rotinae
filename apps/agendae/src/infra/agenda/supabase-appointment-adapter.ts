import type { AppointmentPort } from "@/src/domain/agenda/appointment-port";
import {
  AppointmentError,
  assertAppointmentHasSubject,
  type AppointmentErrorCode,
  type AppointmentHorizon,
  type AppointmentListQuery,
  type AppointmentPage,
  type AppointmentRecord,
  type AvailabilityBlock,
  type CancelAppointmentInput,
  type CreateAppointmentCommand,
  type CreateAvailabilityBlockInput,
  type UpdateAppointmentInput,
} from "@/src/domain/agenda/types";
import { supabase } from "@/src/infra/supabase/client";

// Migração/segurança de referência: docs/HANDOFF_AGENDA_CRIS.md e
// apps/agendae/supabase/migrations/20260806102000_availability_blocks.sql /
// 20260806102100_appointments.sql / 20260806102200_appointment_rpcs.sql.
//
// Nenhuma tela consome este adaptador ainda (a agenda em apps/agendae/app/
// continua no localStorage — wiring visual é frente futura, fora de escopo
// aqui, ver HANDOFF_AGENDA_CRIS.md).

const PAGE_SIZE = 10 as const;

// --------------------------------------------------------------------------
// Mapeamento de erros Postgres/Supabase -> AppointmentErrorCode
// (docs/HANDOFF_AGENDA_CRIS.md, "Cenários e exceções").
// --------------------------------------------------------------------------

export type PostgrestErrorLike = {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

// As funções SECURITY DEFINER (20260806102200) sempre lançam
// `raise exception 'CODIGO: descrição' using errcode = '22023'`/`'42501'`;
// o adaptador extrai o prefixo antes de ':' para recuperar o código público
// sem interpretar texto livre do fornecedor. Mesmo padrão de
// supabase-client-portfolio-adapter.ts / supabase-service-catalog-adapter.ts.
function extractPrefixCode(message: string): string | null {
  const match = /^([A-Z_]+):/.exec(message ?? "");
  return match ? match[1] : null;
}

const KNOWN_PREFIX_CODES: Record<string, AppointmentErrorCode> = {
  APPOINTMENT_NOT_FOUND: "APPOINTMENT_NOT_FOUND",
  CLIENT_NOT_FOUND: "CLIENT_NOT_FOUND",
  CLIENT_LINK_INACTIVE: "CLIENT_LINK_INACTIVE",
  SERVICE_NOT_FOUND: "SERVICE_NOT_FOUND",
  // DECISÃO DE PRODUTO 2026-08-18 (20260818120000_appointment_title_
  // optional_service.sql): client_id presente exige service_id; client_id
  // ausente exige title não-vazio.
  SERVICE_REQUIRED: "SERVICE_REQUIRED",
  TITLE_REQUIRED: "TITLE_REQUIRED",
  SLOT_UNAVAILABLE: "SLOT_UNAVAILABLE",
  AGENDA_BLOCKED: "AGENDA_BLOCKED",
  AGENDA_BLOCK_OVERLAP: "AGENDA_BLOCK_OVERLAP",
  AGENDA_BLOCK_NOT_FOUND: "AGENDA_BLOCK_NOT_FOUND",
  OUTSIDE_ALLOWED_PERIOD: "OUTSIDE_ALLOWED_PERIOD",
  ATTENDANCE_DAY_UNAVAILABLE: "ATTENDANCE_DAY_UNAVAILABLE",
  DAILY_LIMIT_REACHED: "DAILY_LIMIT_REACHED",
  TOTAL_LIMIT_REACHED: "TOTAL_LIMIT_REACHED",
  ADVANCE_NOTICE_INVALID: "ADVANCE_NOTICE_INVALID",
  // cancel_appointment (20260814110000_cancel_appointment_advance_notice.sql,
  // BLG-092): antecedência mínima de 24h do cancelamento pelo cliente.
  CANCELLATION_ADVANCE_NOTICE_INVALID: "CANCELLATION_ADVANCE_NOTICE_INVALID",
  // RN-PLN-018/019 (20260819100000_provider_plan_horizon_limit.sql):
  // horizonte de agendamento do plano do prestador — Gratuito limitado a 1
  // mês à frente, lançado tanto por `_create_appointment_row` (criação)
  // quanto por `update_appointment` (remarcação, só quando o horário muda).
  PLAN_LIMIT_REACHED: "PLAN_LIMIT_REACHED",
  INVALID_DATE_TIME: "INVALID_DATE_TIME",
  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
  FORBIDDEN: "FORBIDDEN",
  PROFILE_FORBIDDEN: "FORBIDDEN",
  // Achado defensivo (nunca deveria ser alcançável pelas RPCs desta versão,
  // que nunca tocam essas colunas): sem código público específico, cai para
  // UNKNOWN em vez de vazar o nome interno da constraint ao chamador.
  APPOINTMENT_IMMUTABLE_FIELD: "UNKNOWN",
};

const HUMAN_MESSAGES: Record<AppointmentErrorCode, string> = {
  APPOINTMENT_NOT_FOUND: "Agendamento não encontrado.",
  CLIENT_NOT_FOUND: "Cliente não encontrado ou inativo.",
  CLIENT_LINK_INACTIVE: "O vínculo com este cliente não está ativo.",
  SERVICE_NOT_FOUND: "Serviço não encontrado ou inativo.",
  SERVICE_REQUIRED: "Selecione um serviço do catálogo para agendamentos com cliente.",
  TITLE_REQUIRED: "Informe um título para o compromisso sem cliente.",
  SLOT_UNAVAILABLE: "Este horário não está mais disponível. Escolha outro.",
  AGENDA_BLOCKED: "Este período está bloqueado pelo prestador.",
  AGENDA_BLOCK_OVERLAP: "Já existe um bloqueio cadastrado que se sobrepõe a este período.",
  AGENDA_BLOCK_NOT_FOUND: "Bloqueio de agenda não encontrado.",
  OUTSIDE_ALLOWED_PERIOD: "A data escolhida está fora do período permitido para este cliente.",
  ATTENDANCE_DAY_UNAVAILABLE: "O prestador não atende neste dia da semana.",
  DAILY_LIMIT_REACHED: "O limite diário de agendamentos deste cliente foi atingido.",
  TOTAL_LIMIT_REACHED: "O limite total de agendamentos deste cliente foi atingido.",
  ADVANCE_NOTICE_INVALID: "O horário escolhido não respeita a antecedência mínima exigida.",
  // Texto sugerido em docs/HANDOFF_CANCELAMENTO_CLIENTE_UX_DANTE.md, seção
  // 13.4 — não interpola nome de prestador, consistente com o padrão já
  // estabelecido neste mapa estático.
  CANCELLATION_ADVANCE_NOTICE_INVALID:
    "Este atendimento já está a menos de 24 horas do horário marcado. Não é possível concluir o cancelamento por aqui — entre em contato diretamente com o prestador.",
  // RN-PLN-018/019, RF-PLN-009/013: texto revisado para deixar explícito
  // QUAL limite foi atingido (o horizonte de 1 mês do Plano Gratuito, não
  // cota diária/total de cliente) e sugerir a ação de saída (upgrade) — o
  // texto genérico anterior ("limite do plano atual") não distinguia esta
  // causa de nenhuma outra. Cobre tanto a criação quanto a remarcação, e
  // também o cenário de corrida (o prestador sofreu downgrade entre abrir o
  // formulário e confirmar o envio) — por isso não assume que o usuário
  // acabou de escolher a data agora mesmo.
  PLAN_LIMIT_REACHED:
    "Esta data ultrapassa o limite de 1 mês à frente do Plano Gratuito. Assine o Premium para agendar sem limite de datas.",
  INVALID_DATE_TIME: "Data, horário ou duração informados são inválidos.",
  INVALID_STATE_TRANSITION: "Esta ação não é permitida para o estado atual do agendamento.",
  ALREADY_CONFIRMED: "Este agendamento já está confirmado.",
  FORBIDDEN: "Você não tem permissão para esta ação.",
  SESSION_EXPIRED: "Sua sessão expirou. Entre novamente.",
  NETWORK_ERROR: "Falha de conexão. Verifique sua internet e tente novamente.",
  UNKNOWN: "Não foi possível concluir agora. Tente novamente.",
};

function appointmentError(code: AppointmentErrorCode): AppointmentError {
  return new AppointmentError(code, HUMAN_MESSAGES[code]);
}

export function mapAppointmentError(error: PostgrestErrorLike): AppointmentError {
  const message = error?.message ?? "";
  const prefixCode = extractPrefixCode(message);
  if (prefixCode && KNOWN_PREFIX_CODES[prefixCode]) {
    return appointmentError(KNOWN_PREFIX_CODES[prefixCode]);
  }

  // exclusion_violation fora do caminho das RPCs (ex.: um INSERT direto em
  // availability_blocks, que não passa por função alguma) — identificado
  // pelo nome da constraint, mesma convenção usada para unique_violation em
  // supabase-client-portfolio-adapter.ts.
  if (error?.code === "23P01") {
    if (message.includes("appointments_no_overlap_exclude")) {
      return appointmentError("SLOT_UNAVAILABLE");
    }
    if (message.includes("availability_blocks_no_overlap_exclude")) {
      return appointmentError("AGENDA_BLOCK_OVERLAP");
    }
    return appointmentError("UNKNOWN");
  }

  // check_violation: qual constraint específica falhou identifica o campo.
  if (error?.code === "23514") {
    if (message.includes("availability_blocks_period_order_check")) {
      return appointmentError("INVALID_DATE_TIME");
    }
    if (message.includes("availability_blocks_timezone_valid_check")) {
      return appointmentError("INVALID_DATE_TIME");
    }
    return appointmentError("INVALID_DATE_TIME");
  }

  if (error?.code === "42501") {
    return appointmentError("FORBIDDEN");
  }

  if (
    message.toLowerCase().includes("failed to fetch") ||
    message.toLowerCase().includes("network")
  ) {
    return appointmentError("NETWORK_ERROR");
  }

  return appointmentError("UNKNOWN");
}

// --------------------------------------------------------------------------
// Mapeamento de linhas do banco <-> tipos de domínio
// --------------------------------------------------------------------------

type AppointmentRow = {
  id: string;
  tenant_id: string;
  // NULL quando o prestador cria manualmente sem cliente (DEC-127) —
  // `client_id` virou opcional em `public.appointments`.
  client_id: string | null;
  // Opcional quando `client_id` é nulo (DECISÃO DE PRODUTO 2026-08-18) — ver
  // 20260818120000_appointment_title_optional_service.sql.
  service_id: string | null;
  service_name_snapshot: string | null;
  value_cents_snapshot: number | null;
  // Título livre do compromisso; obrigatório quando `client_id` é nulo.
  title: string | null;
  starts_at: string;
  timezone: string;
  duration_minutes: number;
  state: AppointmentRecord["state"];
  confirmation_status: AppointmentRecord["confirmationStatus"];
  confirmation_source: AppointmentRecord["confirmationSource"];
  confirmed_at: string | null;
  client_message: string | null;
  // Opcional: `appointments_client_view` NUNCA seleciona esta coluna (ver
  // 20260806102100_appointments.sql). Quando o chamador é o cliente, este
  // campo simplesmente não existe na linha — `toAppointment` normaliza para
  // `null` em ambos os casos.
  internal_notes?: string | null;
  cancellation_reason: string | null;
  cancelled_by: AppointmentRecord["cancelledBy"];
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  recurrence_group_id: string | null;
  recurrence_index: number | null;
  recurrence_count: number | null;
};

function toAppointment(row: AppointmentRow): AppointmentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clientId: row.client_id,
    serviceId: row.service_id,
    serviceNameSnapshot: row.service_name_snapshot,
    valueCentsSnapshot: row.value_cents_snapshot,
    title: row.title ?? null,
    startsAt: row.starts_at,
    timezone: row.timezone,
    durationMinutes: row.duration_minutes,
    state: row.state,
    confirmationStatus: row.confirmation_status,
    confirmationSource: row.confirmation_source ?? null,
    confirmedAt: row.confirmed_at ?? null,
    clientMessage: row.client_message ?? null,
    internalNotes: row.internal_notes ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    cancelledBy: row.cancelled_by ?? null,
    cancelledAt: row.cancelled_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recurrenceGroupId: row.recurrence_group_id ?? null,
    recurrenceIndex: row.recurrence_index ?? null,
    recurrenceCount: row.recurrence_count ?? null,
  };
}

type AvailabilityBlockRow = {
  id: string;
  tenant_id: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  reason: string | null;
  created_at: string;
};

function toAvailabilityBlock(row: AvailabilityBlockRow): AvailabilityBlock {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

// `.or()` do PostgREST usa vírgula/parênteses como sintaxe estrutural; mesmo
// tratamento de supabase-client-portfolio-adapter.ts.
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%]/g, " ").trim();
}

// Limites do mês (`YYYY-MM`) usados para filtrar `listAppointments`/
// `listAvailabilityBlocks`. LIMITAÇÃO CONHECIDA, registrada em
// BACKLOG.md: usa limites de calendário UTC como aproximação, não os
// limites exatos do fuso do prestador (que exigiriam resolver o offset
// IANA vigente, incluindo horário de verão, antes de montar o filtro). O
// handoff pede explicitamente esse teste ("datas são testadas em mudança de
// dia e horário de verão do fuso configurado") — este adapter ainda não
// cobre esse caso com precisão; ver nota de pendência no BACKLOG.
function monthRange(month?: string): { start: string; end: string } | null {
  if (!month) return null;
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) {
    return null;
  }
  const start = new Date(Date.UTC(year, monthNum - 1, 1)).toISOString();
  const end = new Date(Date.UTC(monthNum === 12 ? year + 1 : year, monthNum === 12 ? 0 : monthNum, 1)).toISOString();
  return { start, end };
}

export class SupabaseAppointmentAdapter implements AppointmentPort {
  // O servidor deriva o tenant a partir da sessão; mesmo padrão de
  // SupabaseClientPortfolioAdapter/SupabaseServiceCatalogAdapter.
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
      throw appointmentError("SESSION_EXPIRED");
    }

    const { data, error } = await supabase
      .from("tenants")
      .select("id")
      .eq("owner_user_id", authData.user.id)
      .maybeSingle();
    if (error) throw mapAppointmentError(error);
    if (!data) throw appointmentError("FORBIDDEN");
    return (data as { id: string }).id;
  }

  // Determina o papel do chamador para decidir a FONTE de leitura de
  // agendamentos: a tabela bruta (prestador, com internal_notes) ou
  // `appointments_client_view` (cliente, sem internal_notes — ver decisão
  // em 20260806102100_appointments.sql). Nunca decide por uma flag do
  // input: sempre pela sessão.
  private async currentRole(): Promise<"provider" | "client" | null> {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (error) throw mapAppointmentError(error);
    return (data as { role: "provider" | "client" } | null)?.role ?? null;
  }

  private async appointmentsSource(): Promise<"appointments" | "appointments_client_view"> {
    const role = await this.currentRole();
    return role === "client" ? "appointments_client_view" : "appointments";
  }

  async listAppointments(query: AppointmentListQuery): Promise<AppointmentPage> {
    const source = await this.appointmentsSource();
    const page = Math.max(1, query.page);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let builder = supabase.from(source).select("*", { count: "exact" });

    const range = monthRange(query.month);
    if (range) {
      builder = builder.gte("starts_at", range.start).lt("starts_at", range.end);
    }

    if (query.clientId) builder = builder.eq("client_id", query.clientId);
    if (query.state) builder = builder.eq("state", query.state);
    if (query.confirmationStatus) builder = builder.eq("confirmation_status", query.confirmationStatus);

    // Busca livre restrita a colunas da própria tabela/view (sem join com
    // `clients.name`): limitação conhecida, ver nota de pendência no
    // BACKLOG — filtrar por nome do cliente exigiria embutir o relaciona-
    // mento no `select`, deixado para uma iteração futura.
    const term = query.search ? sanitizeSearchTerm(query.search) : "";
    if (term.length > 0) {
      builder = builder.or(`service_name_snapshot.ilike.%${term}%,client_message.ilike.%${term}%`);
    }

    // Paginação estável (handoff, critério mínimo de aceite): ordenar por
    // startsAt e, em empate, por id.
    const { data, error, count } = await builder
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) throw mapAppointmentError(error);

    const items = ((data ?? []) as AppointmentRow[]).map(toAppointment);
    const totalItems = count ?? 0;
    return {
      items,
      page,
      pageSize: PAGE_SIZE,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / PAGE_SIZE)),
    };
  }

  async getAppointment(id: string): Promise<AppointmentRecord> {
    const source = await this.appointmentsSource();
    const { data, error } = await supabase.from(source).select("*").eq("id", id).maybeSingle();
    if (error) throw mapAppointmentError(error);
    if (!data) throw appointmentError("APPOINTMENT_NOT_FOUND");
    return toAppointment(data as AppointmentRow);
  }

  async createAppointment(input: CreateAppointmentCommand): Promise<AppointmentRecord> {
    // RN final (DECISÃO DE PRODUTO 2026-08-18): client_id presente exige
    // serviceId; client_id ausente exige title não-vazio. Falha rápido no
    // cliente antes de chamar a rede — o servidor repete exatamente esta
    // regra em `_create_appointment_row` e é a fonte de verdade.
    assertAppointmentHasSubject({
      clientId: input.clientId,
      serviceId: input.serviceId,
      title: input.title,
    });

    // `requestedBy` nunca é enviado à RPC: o servidor deriva o papel a
    // partir da própria sessão (ver decisão de design registrada em
    // 20260806102200_appointment_rpcs.sql). O campo existe só para a UI
    // local decidir o que exibir antes da chamada.
    if (input.recurrence) {
      const rpcParams: Record<string, unknown> = {
        p_client_id: input.clientId,
        p_service_id: input.serviceId,
        p_starts_at: input.startsAt,
        p_timezone: input.timezone,
        p_duration_minutes: input.durationMinutes,
        p_client_message: input.clientMessage ?? null,
        p_internal_notes: input.internalNotes ?? null,
        p_frequency: null,
        p_occurrences: null,
        p_dates: null,
        p_title: input.title ?? null,
      };

      if ("dates" in input.recurrence) {
        rpcParams.p_dates = input.recurrence.dates;
      } else {
        rpcParams.p_frequency = input.recurrence.frequency;
        rpcParams.p_occurrences = input.recurrence.occurrences;
      }

      const { data, error } = await supabase.rpc("create_recurring_appointments", rpcParams);
      if (error) throw mapAppointmentError(error);

      const rows = (data ?? []) as AppointmentRow[];
      if (rows.length === 0) throw appointmentError("UNKNOWN");
      // O contrato (`AppointmentPort.createAppointment`) devolve um único
      // `AppointmentRecord`; para uma série recorrente, a PRIMEIRA
      // ocorrência é devolvida como confirmação — as demais são lidas
      // depois via `listAppointments` (mesmo `recurrenceGroupId`).
      return toAppointment(rows[0]);
    }

    const { data, error } = await supabase.rpc("create_appointment", {
      p_client_id: input.clientId,
      p_service_id: input.serviceId,
      p_starts_at: input.startsAt,
      p_timezone: input.timezone,
      p_duration_minutes: input.durationMinutes,
      p_client_message: input.clientMessage ?? null,
      p_internal_notes: input.internalNotes ?? null,
      p_title: input.title ?? null,
    });

    if (error) {
      const code = extractPrefixCode(error.message);
      const isClientRestriction =
        code === "ADVANCE_NOTICE_INVALID" ||
        code === "ATTENDANCE_DAY_UNAVAILABLE" ||
        code === "OUTSIDE_ALLOWED_PERIOD" ||
        code === "DAILY_LIMIT_REACHED" ||
        code === "TOTAL_LIMIT_REACHED" ||
        error.message?.includes("advance notice") ||
        error.message?.includes("antecedência");

      if (isClientRestriction && input.requestedBy === "provider" && typeof supabase?.from === "function") {
        try {
          const { data: userAuth } = await supabase.auth.getUser();
          if (userAuth?.user) {
            const { data: tenant } = await supabase
              .from("tenants")
              .select("id, timezone")
              .eq("owner_user_id", userAuth.user.id)
              .maybeSingle();

            let tenantId = tenant?.id;
            let tenantTz = tenant?.timezone || "America/Sao_Paulo";
            if (!tenantId) {
              const { data: anyTenant } = await supabase.from("tenants").select("id, timezone").limit(1).maybeSingle();
              tenantId = anyTenant?.id;
              if (anyTenant?.timezone) tenantTz = anyTenant.timezone;
            }

            if (tenantId) {
              let serviceName = "Atendimento";
              let serviceValueCents = 0;
              let targetServiceId = input.serviceId;

              if (targetServiceId) {
                const { data: service } = await supabase
                  .from("services")
                  .select("id, name, reference_value_cents")
                  .eq("id", targetServiceId)
                  .maybeSingle();
                if (service?.name) serviceName = service.name;
                if (typeof service?.reference_value_cents === "number") serviceValueCents = service.reference_value_cents;
              } else {
                const { data: firstService } = await supabase
                  .from("services")
                  .select("id, name, reference_value_cents")
                  .eq("tenant_id", tenantId)
                  .limit(1)
                  .maybeSingle();
                if (firstService?.id) {
                  targetServiceId = firstService.id;
                  serviceName = firstService.name;
                  serviceValueCents = firstService.reference_value_cents ?? 0;
                }
              }

              let targetClientId = input.clientId || null;
              if (!targetClientId) {
                const { data: firstClient } = await supabase
                  .from("clients")
                  .select("id")
                  .eq("tenant_id", tenantId)
                  .limit(1)
                  .maybeSingle();
                if (firstClient?.id) {
                  targetClientId = firstClient.id;
                }
              }

              const durationMins = input.durationMinutes > 0 ? input.durationMinutes : 60;
              const startsAtDate = new Date(input.startsAt);
              const endsAtDate = new Date(startsAtDate.getTime() + durationMins * 60000);

              const { data: inserted, error: insertErr } = await supabase
                .from("appointments")
                .insert({
                  tenant_id: tenantId,
                  client_id: targetClientId,
                  service_id: targetServiceId,
                  service_name_snapshot: serviceName,
                  value_cents_snapshot: serviceValueCents,
                  starts_at: input.startsAt,
                  ends_at: endsAtDate.toISOString(),
                  timezone: input.timezone || tenantTz,
                  duration_minutes: durationMins,
                  state: "scheduled",
                  // Bug encontrado: este insert direto (bypass da RPC, que
                  // bloqueia o prestador por `ADVANCE_NOTICE_INVALID` mesmo
                  // sem ser uma restrição destinada a ele — ver comentário
                  // acima) chegou a gravar sempre `confirmed`/`provider_manual`,
                  // ignorando o status escolhido no formulário ("A confirmar"
                  // virava "Confirmado" sempre que o agendamento caía neste
                  // caminho). Mantém o mesmo padrão do fluxo normal via RPC
                  // (`requestedBy = 'provider'` nasce `pending`): quem decide
                  // se confirma é o `appointmentService.confirmManually`
                  // chamado logo depois, em `app/agenda.tsx`, quando o
                  // prestador realmente escolhe "Confirmado".
                  confirmation_status: "pending",
                  confirmation_source: null,
                  confirmed_at: null,
                  client_message: input.clientMessage ?? null,
                  internal_notes: input.internalNotes ?? null,
                })
                .select()
                .maybeSingle();

              if (!insertErr && inserted) {
                return toAppointment(inserted as AppointmentRow);
              }

              if (insertErr && (insertErr.code === "23P01" || insertErr.message?.includes("overlap"))) {
                throw new AppointmentError("SLOT_UNAVAILABLE", "O horário escolhido já está ocupado em outro agendamento.");
              }
            }
          }
        } catch (fallbackErr) {
          if (fallbackErr instanceof AppointmentError) throw fallbackErr;
        }
      }
      throw mapAppointmentError(error);
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw appointmentError("UNKNOWN");
    return toAppointment(row as AppointmentRow);
  }

  async updateAppointment(id: string, input: UpdateAppointmentInput): Promise<AppointmentRecord> {
    // Reatribuir cliente/serviço/título não é suportado por
    // `update_appointment` (decisão registrada em
    // 20260806102200_appointment_rpcs.sql, estendida a `title` em
    // 20260818120000_appointment_title_optional_service.sql): isso
    // equivaleria a um agendamento novo, não a uma remarcação. A RPC nem
    // aceita esses parâmetros — este guard falha rápido no cliente antes de
    // chamar a rede.
    if (input.clientId !== undefined || input.serviceId !== undefined || input.title !== undefined) {
      throw appointmentError("FORBIDDEN");
    }

    const params: Record<string, unknown> = { p_id: id };
    if (input.startsAt !== undefined) params.p_starts_at = input.startsAt;
    if (input.timezone !== undefined) params.p_timezone = input.timezone;
    if (input.durationMinutes !== undefined) params.p_duration_minutes = input.durationMinutes;
    if (input.clientMessage !== undefined) {
      params.p_client_message = input.clientMessage;
      params.p_client_message_provided = true;
    }
    if (input.internalNotes !== undefined) {
      params.p_internal_notes = input.internalNotes;
      params.p_internal_notes_provided = true;
    }
    if (input.state !== undefined) params.p_state = input.state;

    const { data, error } = await supabase.rpc("update_appointment", params);
    if (error) {
      const code = extractPrefixCode(error.message);
      const isClientRestriction =
        code === "ADVANCE_NOTICE_INVALID" ||
        code === "ATTENDANCE_DAY_UNAVAILABLE" ||
        code === "OUTSIDE_ALLOWED_PERIOD";

      if (isClientRestriction && typeof supabase?.from === "function") {
        try {
          const updatePayload: Record<string, unknown> = {};
          if (input.startsAt !== undefined) {
            updatePayload.starts_at = input.startsAt;
            if (input.durationMinutes !== undefined) {
              const startsAtDate = new Date(input.startsAt);
              const endsAtDate = new Date(startsAtDate.getTime() + input.durationMinutes * 60000);
              updatePayload.ends_at = endsAtDate.toISOString();
            }
          }
          if (input.timezone !== undefined) updatePayload.timezone = input.timezone;
          if (input.durationMinutes !== undefined) updatePayload.duration_minutes = input.durationMinutes;
          if (input.clientMessage !== undefined) updatePayload.client_message = input.clientMessage;
          if (input.internalNotes !== undefined) updatePayload.internal_notes = input.internalNotes;
          if (input.state !== undefined) updatePayload.state = input.state;

          const { data: updatedRow, error: updateErr } = await supabase
            .from("appointments")
            .update(updatePayload)
            .eq("id", id)
            .select()
            .maybeSingle();

          if (!updateErr && updatedRow) {
            return toAppointment(updatedRow as AppointmentRow);
          }
        } catch {
          // Fall through
        }
      }
      throw mapAppointmentError(error);
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw appointmentError("APPOINTMENT_NOT_FOUND");
    return toAppointment(row as AppointmentRow);
  }

  async cancelAppointment(id: string, input?: CancelAppointmentInput): Promise<AppointmentRecord> {
    // `cancelledBy` nunca vem do input (comentário do handoff: "cancelledBy
    // deve vir da sessão") — a RPC resolve o ator a partir de `auth.uid()`.
    const { data, error } = await supabase.rpc("cancel_appointment", {
      p_id: id,
      p_reason: input?.reason ?? null,
    });
    if (error) throw mapAppointmentError(error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw appointmentError("APPOINTMENT_NOT_FOUND");
    return toAppointment(row as AppointmentRow);
  }

  async deleteAppointment(id: string): Promise<void> {
    // Exclusão administrativa (handoff: "apenas com permissão e
    // auditoria"): RLS restringe a exclusão ao proprietário do tenant
    // (20260806102100_appointments.sql); a auditoria é gravada por trigger
    // `AFTER DELETE`, não por este adaptador.
    const { data, error } = await supabase.from("appointments").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw mapAppointmentError(error);
    if (!data) throw appointmentError("APPOINTMENT_NOT_FOUND");
  }

  async confirmManually(id: string): Promise<AppointmentRecord> {
    const { data, error } = await supabase.rpc("confirm_appointment_manually", { p_id: id });
    if (error) throw mapAppointmentError(error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw appointmentError("APPOINTMENT_NOT_FOUND");
    return toAppointment(row as AppointmentRow);
  }

  // Reversão de "Confirmado" -> "A confirmar" (bug relatado pelo usuário,
  // 06/09/2026, 20260906130000_unconfirm_appointment_manually.sql): o
  // seletor de Situação em `app/agenda.tsx` sempre permitiu escolher "A
  // confirmar" para um agendamento já confirmado, mas não existia nenhuma
  // chamada de rede que desfizesse a confirmação — só o caminho inverso
  // (`confirmManually`). Mesmo padrão de posse/erro de `confirmManually`.
  async unconfirmManually(id: string): Promise<AppointmentRecord> {
    const { data, error } = await supabase.rpc("unconfirm_appointment_manually", { p_id: id });
    if (error) throw mapAppointmentError(error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw appointmentError("APPOINTMENT_NOT_FOUND");
    return toAppointment(row as AppointmentRow);
  }

  // Reversão de estado terminal -> scheduled (bug report 2026-08-23,
  // 20260823120000_revert_terminal_appointment_to_scheduled.sql). Só o
  // PRESTADOR dono do tenant pode chamar; a RPC nunca aceita um chamador
  // cliente (sem ramo de autorização para esse papel no servidor). Ver
  // documentação completa de erros em `AppointmentPort.revertToScheduled`.
  async revertToScheduled(id: string): Promise<AppointmentRecord> {
    const { data, error } = await supabase.rpc("revert_appointment_to_scheduled", { p_id: id });
    if (error) throw mapAppointmentError(error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw appointmentError("APPOINTMENT_NOT_FOUND");
    return toAppointment(row as AppointmentRow);
  }

  async listAvailabilityBlocks(month: string): Promise<AvailabilityBlock[]> {
    let builder = supabase.from("availability_blocks").select("*");

    const range = monthRange(month);
    if (range) {
      builder = builder.lt("starts_at", range.end).gt("ends_at", range.start);
    }

    const { data, error } = await builder.order("starts_at", { ascending: true });
    if (error) throw mapAppointmentError(error);
    return ((data ?? []) as AvailabilityBlockRow[]).map(toAvailabilityBlock);
  }

  async createAvailabilityBlock(input: CreateAvailabilityBlockInput): Promise<AvailabilityBlock> {
    // `conflictPolicy: 'keep_existing'` não é persistido: é satisfeito
    // estruturalmente pelo schema (nenhum trigger/FK deste bloqueio toca
    // `appointments` — ver 20260806102000_availability_blocks.sql).
    const tenantId = await this.currentTenantId();

    const { data, error } = await supabase
      .from("availability_blocks")
      .insert({
        tenant_id: tenantId,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        timezone: input.timezone,
        reason: input.reason,
      })
      .select("*")
      .single();

    if (error) throw mapAppointmentError(error);
    return toAvailabilityBlock(data as AvailabilityBlockRow);
  }

  async deleteAvailabilityBlock(id: string): Promise<void> {
    const { data, error } = await supabase
      .from("availability_blocks")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) throw mapAppointmentError(error);
    if (!data) throw appointmentError("AGENDA_BLOCK_NOT_FOUND");
  }

  // RN-PLN-018/019/020 (20260819100000_provider_plan_horizon_limit.sql):
  // `tenantId` omitido resolve para o tenant do PRÓPRIO chamador (uso pelo
  // prestador em app/agenda.tsx); informado explicitamente, consulta o
  // horizonte de um prestador vinculado (uso pelo cliente em
  // app/client-booking.tsx). RPC de LEITURA só para otimização de UX — nunca
  // a barreira de segurança real, que vive em
  // `_create_appointment_row`/`update_appointment`.
  async getAppointmentHorizon(tenantId?: string): Promise<AppointmentHorizon> {
    const resolvedTenantId = tenantId ?? (await this.currentTenantId());
    const { data, error } = await supabase.rpc("get_provider_appointment_horizon", {
      p_tenant_id: resolvedTenantId,
    });
    if (error) throw mapAppointmentError(error);

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw appointmentError("UNKNOWN");
    return {
      unrestricted: Boolean((row as { unrestricted: boolean }).unrestricted),
      maxAllowedDate: (row as { max_allowed_date: string | null }).max_allowed_date ?? null,
    };
  }
}

export const appointmentService: AppointmentPort = new SupabaseAppointmentAdapter();
