import { fireEvent, render } from "@testing-library/react-native";
import React, { useState } from "react";

import {
  CurrencyInput,
  digitsToCents,
  extractDigits,
  formatCentsToBRL,
  parseMaskedTextToCents,
} from "../currency-input";

const LABEL = "Valor do teste";

function Harness({ initialCents = 0 }: { initialCents?: number }) {
  const [cents, setCents] = useState(initialCents);
  return (
    <CurrencyInput
      accessibilityLabel={LABEL}
      valueCents={cents}
      onChangeValueCents={setCents}
    />
  );
}

describe("funções puras da máscara monetária", () => {
  it.each([
    ["1", "0,01"],
    ["100", "1,00"],
    ["1000", "10,00"],
    ["10000", "100,00"],
    ["100000", "1.000,00"],
  ])(
    "digitar \"%s\" preenchendo da direita para a esquerda produz R$ %s",
    (typed, expected) => {
      expect(formatCentsToBRL(parseMaskedTextToCents(typed))).toBe(expected);
    },
  );

  it("ignora letras e símbolos, mantendo apenas os dígitos", () => {
    expect(extractDigits("R$ 1.234,56abc!")).toBe("123456");
  });

  it("trata texto sem dígitos como zero", () => {
    expect(digitsToCents("")).toBe(0);
    expect(digitsToCents("abc")).toBe(0);
  });

  it("nunca formata valores negativos ou inválidos como negativos", () => {
    expect(formatCentsToBRL(-500)).toBe("0,00");
    expect(formatCentsToBRL(Number.NaN)).toBe("0,00");
  });

  it("colar um valor já formatado reconstrói o mesmo total em centavos", () => {
    expect(parseMaskedTextToCents("R$ 1.234,56")).toBe(123456);
  });
});

describe("<CurrencyInput />", () => {
  it("exibe R$ 0,00 quando o valor inicial é zero", async () => {
    const view = await render(<Harness />);
    expect(view.getByLabelText(LABEL).props.value).toBe("0,00");
  });

  it(
    "digitação sequencial, dígito a dígito (padrão caixa registradora), cobre os 5 exemplos do enunciado",
    async () => {
      const view = await render(<Harness />);

      const typeNextDigit = async (digit: string) => {
        const input = view.getByLabelText(LABEL);
        await fireEvent.changeText(input, input.props.value + digit);
        return view.getByLabelText(LABEL).props.value;
      };

      expect(await typeNextDigit("1")).toBe("0,01"); // "1" -> R$ 0,01
      await typeNextDigit("0");
      expect(await typeNextDigit("0")).toBe("1,00"); // "100" -> R$ 1,00
      expect(await typeNextDigit("0")).toBe("10,00"); // "1000" -> R$ 10,00
      expect(await typeNextDigit("0")).toBe("100,00"); // "10000" -> R$ 100,00
      expect(await typeNextDigit("0")).toBe("1.000,00"); // "100000" -> R$ 1.000,00
    },
  );

  it("ignora letras e símbolos digitados, mantendo o valor anterior", async () => {
    const view = await render(<Harness initialCents={150} />);
    const input = view.getByLabelText(LABEL);
    expect(input.props.value).toBe("1,50");

    await fireEvent.changeText(input, input.props.value + "abc$");
    expect(view.getByLabelText(LABEL).props.value).toBe("1,50");
  });

  it("colar um valor formatado substitui o conteúdo preservando o total em centavos", async () => {
    const view = await render(<Harness />);
    const input = view.getByLabelText(LABEL);

    await fireEvent.changeText(input, "R$ 1.234,56");
    expect(view.getByLabelText(LABEL).props.value).toBe("1.234,56");
  });

  it("colar apenas dígitos crus interpreta o total como centavos", async () => {
    const view = await render(<Harness />);
    const input = view.getByLabelText(LABEL);

    await fireEvent.changeText(input, "50000");
    expect(view.getByLabelText(LABEL).props.value).toBe("500,00");
  });

  it("apagar (backspace) remove o centavo mais à direita a cada apagamento", async () => {
    const view = await render(<Harness initialCents={100} />); // R$ 1,00
    const input = view.getByLabelText(LABEL);
    expect(input.props.value).toBe("1,00");

    const backspaceOnce = async () => {
      const current = view.getByLabelText(LABEL);
      await fireEvent.changeText(current, current.props.value.slice(0, -1));
      return view.getByLabelText(LABEL).props.value;
    };

    expect(await backspaceOnce()).toBe("0,10");
    expect(await backspaceOnce()).toBe("0,01");
    expect(await backspaceOnce()).toBe("0,00");
  });

  it("apagar todo o conteúdo do campo volta para R$ 0,00", async () => {
    const view = await render(<Harness initialCents={999} />);
    const input = view.getByLabelText(LABEL);
    await fireEvent.changeText(input, "");
    expect(view.getByLabelText(LABEL).props.value).toBe("0,00");
  });

  it("aplica o estado visual de erro quando invalid=true", async () => {
    const view = await render(
      <CurrencyInput
        accessibilityLabel={LABEL}
        valueCents={0}
        onChangeValueCents={() => {}}
        invalid
      />,
    );
    const input = view.getByLabelText(LABEL);
    expect(input).toBeTruthy();
  });

  it("chama onChangeValueCents com o novo total em centavos", async () => {
    const onChangeValueCents = jest.fn();
    const view = await render(
      <CurrencyInput
        accessibilityLabel={LABEL}
        valueCents={0}
        onChangeValueCents={onChangeValueCents}
      />,
    );
    await fireEvent.changeText(view.getByLabelText(LABEL), "1500");
    expect(onChangeValueCents).toHaveBeenCalledWith(1500);
  });
});
