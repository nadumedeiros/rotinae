/**
 * Utilitários puros de formatação/validação do formulário de cliente
 * (nome, e-mail, telefone, datas e política de agendamento).
 *
 * Extraído de `app/clients.tsx` para ser reaproveitado também pelo formulário
 * de edição exibido no Perfil do Cliente (`app/clients/[id].tsx`) — evita que
 * as duas telas divirjam silenciosamente em qual e-mail/telefone/data é
 * considerado válido.
 */

export const formatDateInput = (input: string) => {
  const digits = input.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

export const formatPhoneInput = (input: string) => {
  const digits = input.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

export const isoToBrazilian = (input: string | null) =>
  input ? `${input.slice(8, 10)}/${input.slice(5, 7)}/${input.slice(0, 4)}` : "";

export const brazilianToIso = (input: string) => {
  const [day, month, year] = input.split("/");
  return `${year}-${month}-${day}`;
};

export const isValidBrazilianDate = (input: string) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  return (
    date.getUTCFullYear() === Number(match[3]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[1])
  );
};

// Espelha a constraint `email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'`
// de `clients` (20260806101500_clients_registry.sql). Validar só "contém @"
// no formulário deixava passar e-mails sem domínio/TLD (ex.: "cliente@teste"
// ou "@dominio.com"), que só falhavam depois, no INSERT, como um erro de
// checagem genérico (23514 -> "Limites ou período informados são
// inválidos.", sem relação nenhuma com o campo real que causou o problema).
export const isValidEmail = (input: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
