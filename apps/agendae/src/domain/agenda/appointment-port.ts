import type { AppointmentHorizon, AppointmentListQuery, AppointmentPage, AppointmentRecord, AvailabilityBlock, CancelAppointmentInput, CreateAppointmentCommand, CreateAvailabilityBlockInput, UpdateAppointmentInput } from './types';

export interface AppointmentPort {
  listAppointments(query: AppointmentListQuery): Promise<AppointmentPage>;
  getAppointment(id: string): Promise<AppointmentRecord>;
  createAppointment(input: CreateAppointmentCommand): Promise<AppointmentRecord>;
  updateAppointment(id: string, input: UpdateAppointmentInput): Promise<AppointmentRecord>;
  cancelAppointment(id: string, input?: CancelAppointmentInput): Promise<AppointmentRecord>;
  deleteAppointment(id: string): Promise<void>;
  confirmManually(id: string): Promise<AppointmentRecord>;
  // Reversão de "Confirmado" -> "A confirmar" (bug report 2026-09-06): o
  // seletor de Situação do formulário de edição sempre permitiu escolher "A
  // confirmar" de volta, mas não havia nenhum caminho de rede que desfizesse
  // a confirmação. Só o PRESTADOR dono do tenant pode chamar (RPC
  // `unconfirm_appointment_manually`, 20260906130000); idempotente para "já
  // pendente" (nunca lança erro, devolve o registro como está), mesmo padrão
  // de `confirmManually` para "já confirmado". Erros possíveis:
  //   APPOINTMENT_NOT_FOUND — id inexistente.
  //   FORBIDDEN — chamador não é o prestador dono do tenant (inclui clientes).
  //   INVALID_STATE_TRANSITION — o agendamento não está `scheduled` (estado
  //     terminal — completed/cancelled/no_show).
  unconfirmManually(id: string): Promise<AppointmentRecord>;
  // Reversão de estado terminal (bug report 2026-08-23): hoje um agendamento
  // completed/cancelled/no_show não tinha NENHUM caminho de volta para
  // scheduled. Só o PRESTADOR dono do tenant pode chamar (RPC
  // `revert_appointment_to_scheduled`, 20260823120000) — o cliente nunca tem
  // esta opção. Erros possíveis, todos já mapeados por
  // `mapAppointmentError`/`AppointmentErrorCode`:
  //   APPOINTMENT_NOT_FOUND — id inexistente.
  //   FORBIDDEN — chamador não é o prestador dono do tenant (inclui clientes).
  //   INVALID_STATE_TRANSITION — o agendamento já está em `scheduled` (não é
  //     um estado terminal — completed/cancelled/no_show).
  //   SLOT_UNAVAILABLE — o horário original foi ocupado por outro
  //     agendamento depois que este virou terminal; a reversão é bloqueada
  //     em vez de criar sobreposição silenciosa.
  revertToScheduled(id: string): Promise<AppointmentRecord>;
  listAvailabilityBlocks(month: string): Promise<AvailabilityBlock[]>;
  createAvailabilityBlock(input: CreateAvailabilityBlockInput): Promise<AvailabilityBlock>;
  deleteAvailabilityBlock(id: string): Promise<void>;
  // RN-PLN-018/019/020: horizonte de agendamento do plano do prestador —
  // otimização de UX (seletor de datas), nunca a barreira de segurança.
  // `tenantId` omitido resolve para o TENANT DO CHAMADOR (uso pelo próprio
  // prestador); informado explicitamente, consulta o horizonte de QUALQUER
  // prestador ao qual o chamador tenha acesso de leitura (uso pelo cliente
  // vinculado em autoatendimento) — a RPC no servidor aplica as mesmas
  // checagens de posse/vínculo já usadas em `get_client_booking_context`.
  getAppointmentHorizon(tenantId?: string): Promise<AppointmentHorizon>;
}
