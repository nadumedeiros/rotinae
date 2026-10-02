export type RegistrationInput = {
  name: string;
  email: string;
  phone: string;
  password: string;
  passwordConfirmation: string;
  legalAccepted: boolean;
};

export type RegistrationValidation =
  | { valid: true; normalized: { name: string; email: string; phone: string } }
  | { valid: false; message: string };

export type RegistrationFieldErrors = {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  passwordConfirmation?: string;
  legalAccepted?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_DIGITS_PATTERN = /^\d{10,11}$/;
const MIN_PASSWORD_LENGTH = 8;

export function formatBrazilianPhone(input: string) {
  const digits = input.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

/** Checa cada campo de forma independente, para sinalizar todos os problemas de uma vez (não só o primeiro). */
export function getRegistrationFieldErrors(input: RegistrationInput): RegistrationFieldErrors {
  const errors: RegistrationFieldErrors = {};
  const name = input.name.trim().replace(/\s+/g, ' ');
  const email = input.email.trim().toLocaleLowerCase('pt-BR');
  const phoneDigits = input.phone.replace(/\D/g, '');
  if (name.length < 3) errors.name = 'Informe seu nome.';
  if (!EMAIL_PATTERN.test(email)) errors.email = 'Informe um e-mail válido.';
  if (!PHONE_DIGITS_PATTERN.test(phoneDigits)) errors.phone = 'Informe um telefone com DDD válido.';
  if (input.password.length < MIN_PASSWORD_LENGTH) errors.password = `Use uma senha com pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (!input.passwordConfirmation || input.password !== input.passwordConfirmation) errors.passwordConfirmation = 'As senhas não coincidem.';
  if (!input.legalAccepted) errors.legalAccepted = 'Aceite os Termos de Uso e a Política de Privacidade para continuar.';
  return errors;
}

export function validateRegistration(input: RegistrationInput): RegistrationValidation {
  const fieldErrors = getRegistrationFieldErrors(input);
  const firstError = fieldErrors.name ?? fieldErrors.email ?? fieldErrors.phone ?? fieldErrors.password ?? fieldErrors.passwordConfirmation ?? fieldErrors.legalAccepted;
  if (firstError) return { valid: false, message: firstError };
  const name = input.name.trim().replace(/\s+/g, ' ');
  const email = input.email.trim().toLocaleLowerCase('pt-BR');
  const phoneDigits = input.phone.replace(/\D/g, '');
  return { valid: true, normalized: { name, email, phone: `+55${phoneDigits}` } };
}
