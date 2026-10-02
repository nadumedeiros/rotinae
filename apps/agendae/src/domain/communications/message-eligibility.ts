import type { ClientCommunicationPreferences } from '@/src/domain/clients/types';
import type { WhatsAppAppointmentPurpose } from './client-messaging-port';

export type MessageEligibilityInput = {
  phone: string | null;
  phoneVerified: boolean;
  activeLink: boolean;
  preferences: ClientCommunicationPreferences;
  purpose: WhatsAppAppointmentPurpose;
};

export type MessageEligibility = { allowed: true } | { allowed: false; reason: 'PHONE_REQUIRED' | 'PHONE_NOT_VERIFIED' | 'CLIENT_LINK_INACTIVE' | 'CONSENT_REQUIRED' };

export function checkWhatsAppEligibility(input: MessageEligibilityInput): MessageEligibility {
  if (!input.phone) return { allowed: false, reason: 'PHONE_REQUIRED' };
  if (!/^\+[1-9]\d{7,14}$/.test(input.phone)) return { allowed: false, reason: 'PHONE_REQUIRED' };
  if (!input.phoneVerified) return { allowed: false, reason: 'PHONE_NOT_VERIFIED' };
  if (!input.activeLink) return { allowed: false, reason: 'CLIENT_LINK_INACTIVE' };
  const consent = input.purpose === 'appointment_confirmation'
    ? input.preferences.whatsappAppointmentConfirmation
    : input.preferences.whatsappAppointmentReminder;
  if (!consent) return { allowed: false, reason: 'CONSENT_REQUIRED' };
  return { allowed: true };
}
