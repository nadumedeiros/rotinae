import type { ServiceCatalogPort } from "@/src/domain/services/service-catalog-port";
import {
  ServiceError,
  type CreateServiceInput,
  type Service,
  type ServiceErrorCode,
  type ServiceListQuery,
  type ServiceStatus,
  type UpdateServiceInput,
} from "@/src/domain/services/types";
import { supabase } from "@/src/infra/supabase/client";

// Migração/segurança de referência: docs/HANDOFF_SERVICOS_CRIS.md e
// apps/agendae/supabase/migrations/20260806101700_services_catalog.sql.
//
// Não existe tela consumindo este adaptador ainda (ver handoff, seção 0):
// ele existe para desbloquear `AppointmentPort`/`Client.primaryServiceId`
// antes de a tela de gestão de serviços ser desenhada (Dante/Nero).

// --------------------------------------------------------------------------
// Mapeamento de erros Postgres/Supabase -> ServiceErrorCode
// (docs/HANDOFF_SERVICOS_CRIS.md, seção 4).
// --------------------------------------------------------------------------

export type PostgrestErrorLike = {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

const HUMAN_MESSAGES: Record<ServiceErrorCode, string> = {
  SERVICE_NOT_FOUND: "Serviço não encontrado.",
  SERVICE_NAME_INVALID: "Informe um nome válido para o serviço.",
  SERVICE_NAME_CONFLICT: "Já existe um serviço ativo com este nome.",
  DURATION_INVALID: "A duração deve ser um número inteiro de minutos maior que zero.",
  VALUE_INVALID: "O valor de referência deve ser um número inteiro de centavos maior ou igual a zero.",
  FORBIDDEN: "Você não tem permissão para esta ação.",
  SESSION_EXPIRED: "Sua sessão expirou. Entre novamente.",
  NETWORK_ERROR: "Falha de conexão. Verifique sua internet e tente novamente.",
  UNKNOWN: "Não foi possível concluir agora. Tente novamente.",
};

function serviceError(code: ServiceErrorCode): ServiceError {
  return new ServiceError(code, HUMAN_MESSAGES[code]);
}

// As constraints de check da tabela `services`
// (20260806101700_services_catalog.sql) recebem nome explícito para que este
// mapeamento não dependa do nome autogerado pelo Postgres.
export function mapServiceError(error: PostgrestErrorLike): ServiceError {
  const message = error?.message ?? "";

  // unique_violation: única constraint de unicidade da tabela é
  // `services_tenant_active_name_uk` (nome duplicado entre serviços ativos
  // do mesmo tenant), então qualquer 23505 aqui é sempre esse conflito.
  if (error?.code === "23505") {
    return serviceError("SERVICE_NAME_CONFLICT");
  }

  // check_violation: qual constraint específica falhou identifica o campo.
  if (error?.code === "23514") {
    if (message.includes("services_name_not_blank_check")) {
      return serviceError("SERVICE_NAME_INVALID");
    }
    if (message.includes("services_duration_positive_check")) {
      return serviceError("DURATION_INVALID");
    }
    if (message.includes("services_value_non_negative_check")) {
      return serviceError("VALUE_INVALID");
    }
    return serviceError("UNKNOWN");
  }

  if (error?.code === "42501") {
    return serviceError("FORBIDDEN");
  }

  if (
    message.toLowerCase().includes("failed to fetch") ||
    message.toLowerCase().includes("network")
  ) {
    return serviceError("NETWORK_ERROR");
  }

  return serviceError("UNKNOWN");
}

// --------------------------------------------------------------------------
// Mapeamento de linhas do banco <-> tipos de domínio
// --------------------------------------------------------------------------

type ServiceRow = {
  id: string;
  name: string;
  duration_minutes: number;
  reference_value_cents: number;
  status: ServiceStatus;
  // Coluna aditiva de 20260825130000_default_standard_service_provision.sql
  // (DEC-163); `?? false` cobre qualquer linha antiga de um schema local
  // ainda não migrado, mesmo padrão defensivo do resto do adaptador.
  is_default?: boolean | null;
  created_at: string;
  updated_at: string;
};

function toService(row: ServiceRow): Service {
  return {
    id: row.id,
    name: row.name,
    durationMinutes: row.duration_minutes,
    referenceValueCents: row.reference_value_cents,
    status: row.status,
    isDefault: row.is_default ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Validação client-side espelhando as constraints do banco (defesa em
// profundidade / feedback mais rápido); o banco continua sendo a autoridade
// final (20260806101700_services_catalog.sql). Mesmo padrão de
// `validateBookingPolicyShape` em supabase-client-portfolio-adapter.ts.
function validateName(name: string): void {
  if (name.trim().length === 0) {
    throw serviceError("SERVICE_NAME_INVALID");
  }
}

function validateDuration(durationMinutes: number): void {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw serviceError("DURATION_INVALID");
  }
}

function validateValue(referenceValueCents: number): void {
  if (!Number.isInteger(referenceValueCents) || referenceValueCents < 0) {
    throw serviceError("VALUE_INVALID");
  }
}

export class SupabaseServiceCatalogAdapter implements ServiceCatalogPort {
  // O servidor deriva o tenant a partir da sessão (RLS de `tenants`); como
  // este adaptador não tem uma camada própria de servidor (roda com a anon
  // key + RLS), a única forma de obter o tenant do chamador para operações
  // de escrita (que exigem a coluna tenant_id explícita no INSERT) é
  // perguntar à própria tabela `tenants`. Mesmo padrão de
  // `SupabaseClientPortfolioAdapter.currentTenantId`.
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
      throw serviceError("SESSION_EXPIRED");
    }

    const { data, error } = await supabase
      .from("tenants")
      .select("id")
      .eq("owner_user_id", authData.user.id)
      .maybeSingle();
    if (error) throw mapServiceError(error);
    if (!data) throw serviceError("FORBIDDEN");
    return (data as { id: string }).id;
  }

  async listServices(query?: ServiceListQuery): Promise<Service[]> {
    let builder = supabase.from("services").select("*");
    if (query?.status) {
      builder = builder.eq("status", query.status);
    }

    const { data, error } = await builder.order("name", { ascending: true });
    if (error) throw mapServiceError(error);
    return ((data ?? []) as ServiceRow[]).map(toService);
  }

  async getService(id: string): Promise<Service> {
    const { data, error } = await supabase.from("services").select("*").eq("id", id).maybeSingle();
    if (error) throw mapServiceError(error);
    if (!data) throw serviceError("SERVICE_NOT_FOUND");
    return toService(data as ServiceRow);
  }

  async createService(input: CreateServiceInput): Promise<Service> {
    validateName(input.name);
    validateDuration(input.durationMinutes);
    validateValue(input.referenceValueCents);

    const tenantId = await this.currentTenantId();

    const { data, error } = await supabase
      .from("services")
      .insert({
        tenant_id: tenantId,
        name: input.name.trim(),
        duration_minutes: input.durationMinutes,
        reference_value_cents: input.referenceValueCents,
      })
      .select("*")
      .single();

    if (error) throw mapServiceError(error);
    return toService(data as ServiceRow);
  }

  async updateService(input: UpdateServiceInput): Promise<Service> {
    const patch: Record<string, unknown> = {};

    if (input.name !== undefined) {
      validateName(input.name);
      patch.name = input.name.trim();
    }
    if (input.durationMinutes !== undefined) {
      validateDuration(input.durationMinutes);
      patch.duration_minutes = input.durationMinutes;
    }
    if (input.referenceValueCents !== undefined) {
      validateValue(input.referenceValueCents);
      patch.reference_value_cents = input.referenceValueCents;
    }

    const { data, error } = await supabase
      .from("services")
      .update(patch)
      .eq("id", input.id)
      .select("*")
      .maybeSingle();

    if (error) throw mapServiceError(error);
    if (!data) throw serviceError("SERVICE_NOT_FOUND");
    return toService(data as ServiceRow);
  }

  async activateService(id: string): Promise<Service> {
    return this.setStatus(id, "active");
  }

  async deactivateService(id: string): Promise<Service> {
    // Idempotente e nunca é exclusão física (handoff, regra 2): sempre
    // UPDATE de status, nunca DELETE — mesmo espírito de
    // `SupabaseClientPortfolioAdapter.archiveClient`.
    return this.setStatus(id, "inactive");
  }

  // `activateService`/`deactivateService` são idempotentes (handoff, regra
  // 5): reaplicar a operação sobre um serviço já no status alvo devolve o
  // registro atual sem erro — este UPDATE não filtra por status atual, então
  // reescrever o mesmo valor é um no-op bem-sucedido, nunca um erro de
  // "já está ativo/inativo".
  private async setStatus(id: string, status: ServiceStatus): Promise<Service> {
    const { data, error } = await supabase
      .from("services")
      .update({ status })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) throw mapServiceError(error);
    if (!data) throw serviceError("SERVICE_NOT_FOUND");
    return toService(data as ServiceRow);
  }
}

export const serviceCatalogService: ServiceCatalogPort = new SupabaseServiceCatalogAdapter();
