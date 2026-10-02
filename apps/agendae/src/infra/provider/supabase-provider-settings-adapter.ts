import type { ProviderSettingsPort } from "@/src/domain/provider/provider-settings-port";
import {
  ProviderError,
  type ProviderErrorCode,
  type ProviderSettings,
  type UpdateProviderSettingsInput,
} from "@/src/domain/provider/types";
import { supabase } from "@/src/infra/supabase/client";

// Migração/segurança de referência: docs/HANDOFF_PERFIL_NOTIFICACOES_CRIS.md
// (seção "Perfil do prestador") e
// apps/agendae/supabase/migrations/20260806101800_provider_settings.sql.
//
// `ProviderSettings` não tem tabela própria: é um DTO achatado que combina
// `profiles` (identidade: displayName, phone, emailNotifications,
// pushNotifications), `tenants` (operação: timezone, workdayStart,
// workdayEnd, minimumAdvanceHours, profession) e `auth.users.email` (nunca
// gravável por este adapter — ver `updateSettings`). O racional completo de
// onde cada campo mora está no cabeçalho da migration citada acima.
//
// `profession` (DEC-137, apps/agendae/supabase/migrations/
// 20260813120000_provider_profession.sql) mora em `tenants`, não em
// `profiles`, apesar de ser um dado de identidade — decisão de reuso de RLS
// e consistência com `tenants.display_name` ("nome público/profissional"),
// justificada por completo no cabeçalho daquela migration.

// --------------------------------------------------------------------------
// Mapeamento de erros Postgres/Supabase -> ProviderErrorCode
// (docs/HANDOFF_PERFIL_NOTIFICACOES_CRIS.md, seção "Perfil do prestador").
// --------------------------------------------------------------------------

export type PostgrestErrorLike = {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

const HUMAN_MESSAGES: Record<ProviderErrorCode, string> = {
  PROFILE_NOT_FOUND: "Perfil não encontrado.",
  NAME_INVALID: "Informe um nome de exibição válido.",
  PHONE_INVALID: "Informe um telefone válido.",
  PROFESSION_INVALID: "A profissão/especialidade deve ter até 60 caracteres.",
  ATTENDANCE_DAYS_INVALID: "Selecione pelo menos um dia de atendimento.",
  TIMEZONE_INVALID: "Informe um fuso horário válido.",
  WORKING_HOURS_INVALID: "O horário inicial deve ser anterior ao horário final.",
  ADVANCE_NOTICE_INVALID: "A antecedência mínima deve ficar entre 0 e 720 horas.",
  FORBIDDEN: "Você não tem permissão para esta ação.",
  SESSION_EXPIRED: "Sua sessão expirou. Entre novamente.",
  NETWORK_ERROR: "Falha de conexão. Verifique sua internet e tente novamente.",
  UNKNOWN: "Não foi possível concluir agora. Tente novamente.",
};

function providerError(code: ProviderErrorCode): ProviderError {
  return new ProviderError(code, HUMAN_MESSAGES[code]);
}

// `update_provider_settings` (20260806101800) sempre lança
// `raise exception 'CODIGO: descrição' using errcode = '...'`; o adaptador
// extrai o prefixo antes de ':' para recuperar o código público sem
// interpretar texto livre do fornecedor. Mesmo padrão de
// `extractPrefixCode`/`mapClientDomainError` em
// supabase-client-portfolio-adapter.ts.
function extractPrefixCode(message: string): string | null {
  const match = /^([A-Z_]+):/.exec(message ?? "");
  return match ? match[1] : null;
}

const KNOWN_PREFIX_CODES: Record<string, ProviderErrorCode> = {
  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
};

// As constraints de check adicionadas em 20260806101800 recebem nome
// explícito para este mapeamento não depender do nome autogerado pelo
// Postgres (mesma convenção de `mapServiceError`).
export function mapProviderError(error: PostgrestErrorLike): ProviderError {
  const message = error?.message ?? "";

  const prefixCode = extractPrefixCode(message);
  if (prefixCode && KNOWN_PREFIX_CODES[prefixCode]) {
    return providerError(KNOWN_PREFIX_CODES[prefixCode]);
  }

  // check_violation: qual constraint específica falhou identifica o campo.
  if (error?.code === "23514") {
    if (message.includes("tenants_workday_order_check")) {
      return providerError("WORKING_HOURS_INVALID");
    }
    if (message.includes("tenants_minimum_advance_hours_range_check")) {
      return providerError("ADVANCE_NOTICE_INVALID");
    }
    if (message.includes("tenants_timezone_valid_check")) {
      return providerError("TIMEZONE_INVALID");
    }
    if (message.includes("profiles_phone_format_check")) {
      return providerError("PHONE_INVALID");
    }
    if (message.includes("profiles_display_name_check")) {
      return providerError("NAME_INVALID");
    }
    if (message.includes("tenants_profession_length_check")) {
      return providerError("PROFESSION_INVALID");
    }
    if (message.includes("tenants_attendance_days_check")) {
      return providerError("ATTENDANCE_DAYS_INVALID");
    }
    return providerError("UNKNOWN");
  }

  if (error?.code === "42501") {
    return providerError("FORBIDDEN");
  }

  if (
    message.toLowerCase().includes("failed to fetch") ||
    message.toLowerCase().includes("network")
  ) {
    return providerError("NETWORK_ERROR");
  }

  return providerError("UNKNOWN");
}

// --------------------------------------------------------------------------
// Validação client-side espelhando as constraints do banco (defesa em
// profundidade / feedback mais rápido); o banco continua sendo a autoridade
// final (20260806101800). Mesmo padrão de `validateName`/`validateDuration`
// em supabase-service-catalog-adapter.ts.
// --------------------------------------------------------------------------

const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;
// Mesmo padrão E.164 de `clients.phone` (20260806101500) e do que o cadastro
// já grava em `profiles.phone` (`registration-validation.ts`, `+55...`).
const PHONE_FORMAT = /^\+[1-9]\d{6,14}$/;

function validateDisplayName(displayName: string): void {
  if (displayName.trim().length === 0) {
    throw providerError("NAME_INVALID");
  }
}

function validatePhone(phone: string | null): void {
  if (phone !== null && !PHONE_FORMAT.test(phone)) {
    throw providerError("PHONE_INVALID");
  }
}

// RN-PRF-003 (docs/HANDOFF_UX_SERVICOS_DANTE.md, seção 12.2): limite de 60
// caracteres é reforçado pelo `maxLength` do `TextInput` da ADA — esta
// checagem é defesa em profundidade, espelhando
// `tenants_profession_length_check` (20260813120000), mesmo padrão das
// demais validações desta função.
const PROFESSION_MAX_LENGTH = 60;

function validateProfession(profession: string | null | undefined): void {
  if (profession != null && profession.length > PROFESSION_MAX_LENGTH) {
    throw providerError("PROFESSION_INVALID");
  }
}

// RN-PRF-003: normalização de capitalização (Title Case) e `trim()` no
// momento do salvamento, sem nunca rejeitar o texto digitado — só reformata.
// Implementada aqui (não na tela) para ser a única fonte de verdade do
// "momento de salvar" citado pelo handoff, independente de qual tela chama
// `updateSettings` no futuro (mobile/web compartilham este mesmo adapter).
// String vazia/ausente após `trim()` é tratada como "não informado" (`null`),
// mesma semântica de ausência já usada por `tenants.profession` (coluna
// nullable, nunca string vazia). `undefined` (tela ainda não envia o campo,
// já que é chave opcional) é tratado exatamente como `null`.
function normalizeProfession(profession: string | null | undefined): string | null {
  const trimmed = profession?.trim() ?? "";
  if (trimmed.length === 0) return null;
  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// RN-AGD-025 (docs/HANDOFF_UX_DIAS_ATENDIMENTO_DANTE.md, seção 2.4/7.1):
// convenção JS `Date.getDay()` — 0=domingo, ..., 6=sábado —, mesma usada por
// `ClientBookingPolicy.allowedWeekdays`. `undefined` significa "campo não
// enviado" (mesmo racional de `profession` sem valor) e é sempre aceito sem
// checagem — a RPC preserva o valor já configurado no banco nesse caso
// (`coalesce`, 20260813130000). Diferente de `profession`, não existe um
// valor "vazio" válido para este campo: array vazio é sempre rejeitado,
// tanto aqui (feedback imediato) quanto pelo banco (defesa em profundidade,
// `tenants_attendance_days_check`).
const VALID_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function validateAttendanceDays(attendanceDays: number[] | undefined): void {
  if (attendanceDays === undefined) return;
  if (
    attendanceDays.length === 0 ||
    attendanceDays.some((day) => !VALID_WEEKDAYS.includes(day))
  ) {
    throw providerError("ATTENDANCE_DAYS_INVALID");
  }
}

function validateTimezone(timezone: string): void {
  if (timezone.trim().length === 0) {
    throw providerError("TIMEZONE_INVALID");
  }
  try {
    // Construir o formatador é a forma padrão (e portátil entre motores JS,
    // incluindo Hermes) de validar um identificador IANA: lança `RangeError`
    // quando o fuso não existe, sem precisar de uma tabela de zonas própria
    // no cliente.
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw providerError("TIMEZONE_INVALID");
  }
}

function validateWorkingHours(workdayStart: string, workdayEnd: string): void {
  if (!TIME_FORMAT.test(workdayStart) || !TIME_FORMAT.test(workdayEnd)) {
    throw providerError("WORKING_HOURS_INVALID");
  }
  // Comparação lexicográfica é segura aqui: "HH:MM" tem largura fixa e
  // zero-padded, então a ordem de string coincide com a ordem cronológica —
  // mesma checagem já usada pelo protótipo local (`app/settings.tsx`).
  if (workdayStart >= workdayEnd) {
    throw providerError("WORKING_HOURS_INVALID");
  }
}

function validateAdvanceHours(minimumAdvanceHours: number): void {
  if (
    !Number.isInteger(minimumAdvanceHours) ||
    minimumAdvanceHours < 0 ||
    minimumAdvanceHours > 720
  ) {
    throw providerError("ADVANCE_NOTICE_INVALID");
  }
}

function validateSettingsInput(input: UpdateProviderSettingsInput): void {
  validateDisplayName(input.displayName);
  validatePhone(input.phone);
  validateProfession(input.profession);
  validateAttendanceDays(input.attendanceDays);
  validateTimezone(input.timezone);
  validateWorkingHours(input.workdayStart, input.workdayEnd);
  validateAdvanceHours(input.minimumAdvanceHours);
}

// --------------------------------------------------------------------------
// Mapeamento de linhas do banco <-> tipos de domínio
// --------------------------------------------------------------------------

type ProfileRow = {
  display_name: string;
  phone: string | null;
  email_notifications: boolean;
  push_notifications: boolean;
  updated_at: string;
};

type TenantRow = {
  timezone: string;
  workday_start: string;
  workday_end: string;
  minimum_advance_hours: number;
  profession: string | null;
  attendance_days: number[];
  updated_at: string;
};

// Postgres/PostgREST devolve `time` como "HH:MM:SS"; o contrato usa "HH:MM"
// (mesmo formato do protótipo local em `app/settings.tsx`).
function toHHMM(time: string): string {
  return time.slice(0, 5);
}

// `updatedAt` não tem uma única fonte: é o maior valor entre
// `profiles.updated_at` e `tenants.updated_at` (decisão registrada no
// cabeçalho da migration) — qualquer mudança num dos dois já altera "as
// configurações" do ponto de vista do contrato.
function latestTimestamp(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function toProviderSettings(
  userId: string,
  email: string,
  profile: ProfileRow,
  tenant: TenantRow,
): ProviderSettings {
  return {
    id: userId,
    displayName: profile.display_name,
    email,
    phone: profile.phone,
    profession: tenant.profession,
    attendanceDays: tenant.attendance_days,
    timezone: tenant.timezone,
    workdayStart: toHHMM(tenant.workday_start),
    workdayEnd: toHHMM(tenant.workday_end),
    minimumAdvanceHours: tenant.minimum_advance_hours,
    emailNotifications: profile.email_notifications,
    pushNotifications: profile.push_notifications,
    updatedAt: latestTimestamp(profile.updated_at, tenant.updated_at),
  };
}

type UpdateProviderSettingsRow = {
  user_id: string;
  display_name: string;
  phone: string | null;
  email_notifications: boolean;
  push_notifications: boolean;
  profile_updated_at: string;
  timezone: string;
  workday_start: string;
  workday_end: string;
  minimum_advance_hours: number;
  profession: string | null;
  attendance_days: number[];
  tenant_updated_at: string;
};

export class SupabaseProviderSettingsAdapter implements ProviderSettingsPort {
  // `email` nunca vem de uma tabela própria da aplicação: é sempre o e-mail
  // da PRÓPRIA sessão autenticada (nunca de terceiros), então
  // `supabase.auth.getUser()` já resolve sem precisar de RPC/view dedicada —
  // diferente de `provider_pending_link_requests`, que precisa ler o e-mail
  // de OUTRA identidade. Mesmo padrão de `SESSION_EXPIRED` de
  // `SupabaseClientPortfolioAdapter.createClientNote`.
  private async currentUser(): Promise<{ id: string; email: string }> {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      throw providerError("SESSION_EXPIRED");
    }
    return { id: data.user.id, email: data.user.email ?? "" };
  }

  async getSettings(): Promise<ProviderSettings> {
    const user = await this.currentUser();

    let { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("display_name, phone, email_notifications, push_notifications, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) throw mapProviderError(profileError);
    if (!profileRow) throw providerError("PROFILE_NOT_FOUND");

    const { data: tenantRow, error: tenantError } = await supabase
      .from("tenants")
      .select(
        "timezone, workday_start, workday_end, minimum_advance_hours, profession, attendance_days, updated_at",
      )
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (tenantError) throw mapProviderError(tenantError);
    if (!tenantRow) throw providerError("FORBIDDEN");

    return toProviderSettings(
      user.id,
      user.email,
      profileRow as ProfileRow,
      tenantRow as TenantRow,
    );
  }

  async updateSettings(input: UpdateProviderSettingsInput): Promise<ProviderSettings> {
    // `email` nunca é aceito no payload de update: `UpdateProviderSettingsInput`
    // já é `Omit<ProviderSettings, "id" | "email" | "updatedAt">` em nível de
    // tipo, então não há nem uma propriedade `email` para vazar aqui — a
    // única forma de alterar e-mail é um fluxo próprio de confirmação, fora
    // deste adaptador (handoff, seção "Perfil do prestador").
    validateSettingsInput(input);

    const user = await this.currentUser();

    // `update_provider_settings` (20260806101800) grava `profiles` e
    // `tenants` numa única transação implícita — duas chamadas REST
    // sequenciais (uma por tabela) poderiam persistir uma e falhar na outra,
    // quebrando "salvar configurações" como operação única. Mesma razão de
    // ser de `decide_provider_link_request` (RPC para escrita atômica em
    // mais de uma tabela).
    const { data, error } = await supabase.rpc("update_provider_settings", {
      new_display_name: input.displayName.trim(),
      new_phone: input.phone,
      new_profession: normalizeProfession(input.profession),
      // `undefined` -> `null`: a RPC trata `null` como "campo não enviado"
      // (`coalesce(new_attendance_days, tenants.attendance_days)`,
      // 20260813130000), preservando o valor já configurado no banco.
      // Nunca omitido do payload de propósito — explícito aqui evita
      // depender da forma como cada camada serializa `undefined`.
      new_attendance_days: input.attendanceDays ?? null,
      new_timezone: input.timezone,
      new_workday_start: input.workdayStart,
      new_workday_end: input.workdayEnd,
      new_minimum_advance_hours: input.minimumAdvanceHours,
      new_email_notifications: input.emailNotifications,
      new_push_notifications: input.pushNotifications,
    });

    if (error) throw mapProviderError(error);

    // `returns table (...)` chega como array via supabase-js, mesmo padrão de
    // `rotateLinkCode` em supabase-client-portfolio-adapter.ts.
    const row = (Array.isArray(data) ? data[0] : data) as UpdateProviderSettingsRow | undefined;
    if (!row) throw providerError("UNKNOWN");

    return toProviderSettings(
      user.id,
      user.email,
      {
        display_name: row.display_name,
        phone: row.phone,
        email_notifications: row.email_notifications,
        push_notifications: row.push_notifications,
        updated_at: row.profile_updated_at,
      },
      {
        timezone: row.timezone,
        workday_start: row.workday_start,
        workday_end: row.workday_end,
        minimum_advance_hours: row.minimum_advance_hours,
        profession: row.profession,
        attendance_days: row.attendance_days,
        updated_at: row.tenant_updated_at,
      },
    );
  }
}

export const providerSettingsService: ProviderSettingsPort = new SupabaseProviderSettingsAdapter();
