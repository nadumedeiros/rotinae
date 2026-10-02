import { checkWhatsAppEligibility } from '../message-eligibility';

const validInput = {
  phone: '+5511999999999', phoneVerified: true, activeLink: true,
  preferences: { whatsappAppointmentConfirmation: true, whatsappAppointmentReminder: true },
  purpose: 'appointment_confirmation' as const,
};

describe('checkWhatsAppEligibility', () => {
  it('permite confirmação autorizada', () => expect(checkWhatsAppEligibility(validInput)).toEqual({ allowed: true }));
  it('permite lembrete autorizado', () => expect(checkWhatsAppEligibility({ ...validInput, purpose: 'appointment_reminder' })).toEqual({ allowed: true }));
  it('exige telefone', () => expect(checkWhatsAppEligibility({ ...validInput, phone: null })).toEqual({ allowed: false, reason: 'PHONE_REQUIRED' }));
  it('exige número em E.164', () => expect(checkWhatsAppEligibility({ ...validInput, phone: '11999999999' })).toEqual({ allowed: false, reason: 'PHONE_REQUIRED' }));
  it('exige telefone verificado', () => expect(checkWhatsAppEligibility({ ...validInput, phoneVerified: false })).toEqual({ allowed: false, reason: 'PHONE_NOT_VERIFIED' }));
  it('exige vínculo ativo', () => expect(checkWhatsAppEligibility({ ...validInput, activeLink: false })).toEqual({ allowed: false, reason: 'CLIENT_LINK_INACTIVE' }));
  it('separa consentimento por finalidade', () => expect(checkWhatsAppEligibility({ ...validInput, purpose: 'appointment_reminder', preferences: { whatsappAppointmentConfirmation: true, whatsappAppointmentReminder: false } })).toEqual({ allowed: false, reason: 'CONSENT_REQUIRED' }));
});
