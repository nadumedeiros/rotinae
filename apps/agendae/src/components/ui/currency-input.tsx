import { useCallback } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { colors, control, radius, spacing, typography } from "@/src/theme/tokens";

/**
 * Extrai somente os dígitos de um texto, ignorando letras, símbolos e
 * separadores (pontuação de milhar/decimal) digitados ou colados. Único
 * filtro de entrada aceito pela máscara monetária (RF: aceitar somente
 * dígitos válidos).
 */
export function extractDigits(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

/**
 * Interpreta uma sequência de dígitos como centavos — os dois últimos
 * dígitos são sempre os centavos, à moda de caixa registradora (preenchimento
 * da direita para a esquerda). Dígitos vazios ou inválidos resultam em zero;
 * o domínio de pagamentos/serviços nunca representa valores negativos
 * (`PaymentRecord.valueCents`, `Service.referenceValueCents`).
 */
export function digitsToCents(digits: string): number {
  if (!digits) return 0;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Ponto único de conversão de texto digitado/colado (mascarado ou não) para
 * o formato interno em centavos — usado pelo `onChangeText` do componente.
 * Colar um valor já formatado (ex.: "R$ 1.234,56") funciona corretamente
 * porque a pontuação é descartada e os dígitos restantes reconstroem o
 * mesmo total em centavos.
 */
export function parseMaskedTextToCents(raw: string): number {
  return digitsToCents(extractDigits(raw));
}

/**
 * Formata um valor em centavos para o texto mascarado em Real (padrão
 * brasileiro): vírgula decimal fixa e separador de milhar automático
 * (ex.: 100000 -> "1.000,00").
 */
export function formatCentsToBRL(cents: number): string {
  const safeCents = Number.isFinite(cents) && cents > 0 ? Math.trunc(cents) : 0;
  const reais = Math.floor(safeCents / 100);
  const centavos = String(safeCents % 100).padStart(2, "0");
  return `${reais.toLocaleString("pt-BR")},${centavos}`;
}

export type CurrencyInputProps = {
  /** Valor em centavos — mesma convenção de `valueCents`/`referenceValueCents`/`serviceValueCents` do domínio. */
  valueCents: number;
  /** Chamado com o novo total em centavos a cada digitação, colagem ou apagamento. */
  onChangeValueCents: (cents: number) => void;
  accessibilityLabel: string;
  placeholder?: string;
  /** Estado visual de erro (borda vermelha), equivalente a `fieldInputError` já usado nas telas. */
  invalid?: boolean;
  editable?: boolean;
  autoFocus?: boolean;
  testID?: string;
  containerStyle?: StyleProp<ViewStyle>;
  prefixStyle?: StyleProp<TextStyle>;
  inputStyle?: StyleProp<TextStyle>;
};

/**
 * Campo de valor monetário com máscara em padrão brasileiro (R$), preenchido
 * da direita para a esquerda como uma caixa registradora: cada dígito
 * digitado entra como centavo mais à direita, empurrando os dígitos
 * anteriores. Único componente reutilizável para todos os campos de valor
 * monetário digitáveis do sistema — mantém o estado interno em centavos
 * (inteiro), a mesma convenção já usada por `domain/payments` e
 * `domain/services`.
 */
export function CurrencyInput({
  valueCents,
  onChangeValueCents,
  accessibilityLabel,
  placeholder = "0,00",
  invalid = false,
  editable = true,
  autoFocus = false,
  testID,
  containerStyle,
  prefixStyle,
  inputStyle,
}: CurrencyInputProps) {
  const displayValue = formatCentsToBRL(valueCents);

  const handleChangeText = useCallback(
    (text: string) => {
      onChangeValueCents(parseMaskedTextToCents(text));
    },
    [onChangeValueCents],
  );

  return (
    <View style={[styles.currencyField, invalid && styles.fieldInputError, containerStyle]}>
      <Text style={[styles.currencyPrefix, prefixStyle]}>R$</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        value={displayValue}
        onChangeText={handleChangeText}
        keyboardType="decimal-pad"
        placeholder={placeholder}
        placeholderTextColor={colors.mutedSoft}
        editable={editable}
        autoFocus={autoFocus}
        testID={testID}
        style={[styles.currencyInput, inputStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  currencyField: {
    minHeight: control.heightMd,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  fieldInputError: { borderColor: colors.danger },
  currencyPrefix: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  currencyInput: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
});
