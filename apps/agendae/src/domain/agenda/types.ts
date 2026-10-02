export type AppointmentState =
  "scheduled" | "completed" | "cancelled" | "no_show";
export type ConfirmationStatus = "pending" | "confirmed";
export type ConfirmationSource = "client" | "provider_manual" | null;
export type AppointmentRequester = "client" | "provider";
export type RecurrenceFrequency = "weekly" | "biweekly" | "monthly";
export type RecurrenceInput =
  | { frequency: RecurrenceFrequency; occurrences: number }
  | { dates: string[] };

export type AppointmentRecord = {
  id: string;
  tenantId: string;
  // NULL quando o prestador cria manualmente sem selecionar/ter um cliente
  // cadastrado (DEC-127, BLG-051). Um chamador `role = 'client'` nunca cria
  // com `clientId` nulo (a RPC rejeita com FORBIDDEN) — o campo só é nulo em
  // agendamentos originados pelo prestador.
  clientId: string | null;
  // Obrigatório quando `clientId` não é nulo; opcional quando `clientId` é
  // nulo (DECISÃO DE PRODUTO 2026-08-18) — ver `assertAppointmentHasSubject`
  // e a constraint `appointments_client_requires_service_check`
  // (20260818120000_appointment_title_optional_service.sql).
  serviceId: string | null;
  // Sempre `null` junto com `serviceId` (nunca um "sem serviço" com
  // snapshot preenchido) — ver appointments_service_snapshot_consistency_check.
  serviceNameSnapshot: string | null;
  valueCentsSnapshot: number | null;
  // Título livre do compromisso (ex.: "Reunião", "Bloqueio pessoal").
  // Obrigatório quando `clientId` é nulo (appointments_client_or_title_check);
  // opcional quando há cliente. Imutável após a criação (mesma trigger de
  // client_id/service_id).
  title: string | null;
  startsAt: string;
  timezone: string;
  durationMinutes: number;
  state: AppointmentState;
  confirmationStatus: ConfirmationStatus;
  confirmationSource: ConfirmationSource;
  confirmedAt: string | null;
  clientMessage: string | null;
  internalNotes: string | null;
  cancellationReason: string | null;
  cancelledBy: AppointmentRequester | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  recurrenceGroupId: string | null;
  recurrenceIndex: number | null;
  recurrenceCount: number | null;
};

export type AppointmentListQuery = {
  month?: string;
  clientId?: string;
  state?: AppointmentState;
  confirmationStatus?: ConfirmationStatus;
  search?: string;
  page: number;
  pageSize: 10;
};

export type AppointmentPage = {
  items: AppointmentRecord[];
  page: number;
  pageSize: 10;
  totalItems: number;
  totalPages: number;
};

export type AvailabilityBlock = {
  id: string;
  tenantId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  reason: string | null;
  createdAt: string;
};

export type CreateAvailabilityBlockInput = Pick<AvailabilityBlock, "startsAt" | "endsAt" | "timezone" | "reason"> & {
  conflictPolicy: "keep_existing";
};

export type CreateAppointmentInput = Pick<
  AppointmentRecord,
  | "clientId"
  | "serviceId"
  | "title"
  | "startsAt"
  | "timezone"
  | "durationMinutes"
  | "clientMessage"
  | "internalNotes"
> & { recurrence?: RecurrenceInput };
// O servidor usa a origem autenticada para aplicar bloqueios somente às
// solicitações do cliente. O campo não deve substituir a identidade da sessão.
export type CreateAppointmentCommand = CreateAppointmentInput & {
  requestedBy: AppointmentRequester;
};
export type UpdateAppointmentInput = Partial<CreateAppointmentInput> & {
  state?: AppointmentState;
};

export type CancelAppointmentInput = {
  reason?: string | null;
};

// RN-PLN-018/019/020 (20260819100000_provider_plan_horizon_limit.sql):
// horizonte de agendamento do PLANO DO PRESTADOR (Premium = sem teto;
// Gratuito = até `maxAllowedDate`, ~1 mês à frente, já resolvido no fuso do
// prestador pelo servidor). Devolvido por `get_provider_appointment_horizon`
// — RPC de LEITURA usada só para otimização de UX (desabilitar datas no
// seletor); a validação real de segurança acontece sempre dentro de
// `_create_appointment_row`/`update_appointment`, nunca aqui.
export type AppointmentHorizon = {
  unrestricted: boolean;
  // Formato `YYYY-MM-DD` (coluna `date` do Postgres); `null` quando
  // `unrestricted` é `true`.
  maxAllowedDate: string | null;
};

export type AppointmentErrorCode =
  | "APPOINTMENT_NOT_FOUND"
  | "CLIENT_NOT_FOUND"
  | "CLIENT_LINK_INACTIVE"
  | "SERVICE_NOT_FOUND"
  // client_id presente exige service_id (DECISÃO DE PRODUTO 2026-08-18,
  // 20260818120000_appointment_title_optional_service.sql) — distinto de
  // SERVICE_NOT_FOUND (que é sobre um id inválido/inativo já informado).
  | "SERVICE_REQUIRED"
  // client_id ausente exige title não-vazio (mesma decisão/migration acima).
  | "TITLE_REQUIRED"
  | "SLOT_UNAVAILABLE"
  | "AGENDA_BLOCKED"
  | "AGENDA_BLOCK_OVERLAP"
  | "AGENDA_BLOCK_NOT_FOUND"
  | "OUTSIDE_ALLOWED_PERIOD"
  | "ATTENDANCE_DAY_UNAVAILABLE"
  | "DAILY_LIMIT_REACHED"
  | "TOTAL_LIMIT_REACHED"
  | "ADVANCE_NOTICE_INVALID"
  // Cancelamento pelo cliente dentro da janela mínima de 24h corridas
  // (RN-CAN-009 revisada por DEC-150, RN-CAN-015/016, RF-CAN-007/008,
  // BLG-092). Distinto de ADVANCE_NOTICE_INVALID, que se refere à
  // antecedência mínima de CRIAÇÃO/remarcação (RN-AGD-004/008/009,
  // minimum_bookable_instant, dia útil no fuso do prestador) — nunca ao
  // cancelamento. Nunca lançado para cancelamento pelo prestador
  // (RN-CAN-010, sem restrição de antecedência).
  | "CANCELLATION_ADVANCE_NOTICE_INVALID"
  | "PLAN_LIMIT_REACHED"
  | "INVALID_DATE_TIME"
  | "INVALID_STATE_TRANSITION"
  | "ALREADY_CONFIRMED"
  | "FORBIDDEN"
  | "SESSION_EXPIRED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export class AppointmentError extends Error {
  constructor(
    public readonly code: AppointmentErrorCode,
    message: string,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "AppointmentError";
  }
}

// RN final (DECISÃO DE PRODUTO 2026-08-18), espelhada aqui para falhar
// rápido no cliente antes de chamar a rede — a mesma regra é a fonte de
// verdade dentro de `_create_appointment_row`
// (20260818120000_appointment_title_optional_service.sql) e nunca deve ser
// confiada só neste lado; o servidor sempre revalida.
//   clientId presente -> serviceId obrigatório (SERVICE_REQUIRED).
//   clientId ausente  -> title obrigatório, não-vazio (TITLE_REQUIRED).
export function assertAppointmentHasSubject(input: {
  clientId: string | null;
  serviceId: string | null;
  title: string | null;
}): void {
  if (input.clientId != null && input.serviceId == null) {
    throw new AppointmentError(
      "SERVICE_REQUIRED",
      "Selecione um serviço do catálogo para agendamentos com cliente.",
    );
  }
  if (input.clientId == null && (input.title == null || input.title.trim().length === 0)) {
    throw new AppointmentError(
      "TITLE_REQUIRED",
      "Informe um título para o compromisso sem cliente.",
    );
  }
}
