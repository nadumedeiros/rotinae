import { formatBrazilianPhone, validateRegistration } from '../registration-validation';

const validInput = {
  name: '  Maria   Souza ',
  email: ' MARIA@EXEMPLO.COM ',
  phone: '(11) 99999-9999',
  password: 'senha-segura',
  passwordConfirmation: 'senha-segura',
  legalAccepted: true,
};

describe('validateRegistration', () => {
  it('normaliza um cadastro válido', () => {
    expect(validateRegistration(validInput)).toEqual({ valid: true, normalized: { name: 'Maria Souza', email: 'maria@exemplo.com', phone: '+5511999999999' } });
  });
  it.each([
    [{ ...validInput, name: 'A' }, 'Informe seu nome.'],
    [{ ...validInput, email: 'invalido' }, 'Informe um e-mail válido.'],
    [{ ...validInput, phone: '1199' }, 'Informe um telefone com DDD válido.'],
    [{ ...validInput, password: '123', passwordConfirmation: '123' }, 'Use uma senha com pelo menos 8 caracteres.'],
    [{ ...validInput, passwordConfirmation: 'outra-senha' }, 'As senhas não coincidem.'],
    [{ ...validInput, legalAccepted: false }, 'Aceite os Termos de Uso e a Política de Privacidade para continuar.'],
  ])('rejeita entrada inválida', (input, message) => {
    expect(validateRegistration(input)).toEqual({ valid: false, message });
  });
});

describe('formatBrazilianPhone', () => {
  it('formata celular e limita a 11 dígitos', () => expect(formatBrazilianPhone('11999999999123')).toBe('(11) 99999-9999'));
  it('formata telefone fixo', () => expect(formatBrazilianPhone('1133334444')).toBe('(11) 3333-4444'));
});
