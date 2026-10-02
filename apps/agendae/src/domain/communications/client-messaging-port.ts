export type WhatsAppAppointmentPurpose =
  | "appointment_confirmation"
  | "appointment_reminder";

export type QueueWhatsAppAppointmentMessageInput = {
  tenantId: string;
  clientId: string;
  appointmentId: string;
  purpose: WhatsAppAppointmentPurpose;
  templateId: string;
  locale: "pt_BR";
  idempotencyKey: string;
};

export type QueuedMessage = {
  messageId: string;
  status: "queued" | "sent" | "delivered" | "failed";
  queuedAt: string;
};

/**
 * Porta do servidor para mensagens transacionais de agenda.
 * A implementação deve validar consentimento atual, vínculo, tenant e telefone
 * verificado antes de chamar um provedor. A UI nunca envia texto livre.
 */
export interface ClientMessagingPort {
  queueWhatsAppAppointmentMessage(
    input: QueueWhatsAppAppointmentMessageInput,
  ): Promise<QueuedMessage>;
}

export type ClientMessagingErrorCode =
  | "CONSENT_REQUIRED"
  | "PHONE_REQUIRED"
  | "PHONE_NOT_VERIFIED"
  | "CLIENT_LINK_INACTIVE"
  | "TEMPLATE_NOT_APPROVED"
  | "MESSAGE_ALREADY_QUEUED"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED";
