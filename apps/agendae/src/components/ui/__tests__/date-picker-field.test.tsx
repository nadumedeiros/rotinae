import { fireEvent, render } from "@testing-library/react-native";
import React, { useState } from "react";

import { DatePickerField } from "../date-picker-field";

function Harness({
  initialValue = "",
  minDate,
  maxDate,
}: {
  initialValue?: string;
  minDate?: Date;
  maxDate?: Date;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <DatePickerField
      label="Vencimento"
      value={value}
      onChangeText={setValue}
      placeholder="DD/MM/AAAA"
      keyboardType="number-pad"
      maxLength={10}
      minDate={minDate}
      maxDate={maxDate}
    />
  );
}

describe("DatePickerField", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 13, 12, 0, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("preserva a digitação manual — TextInput chama onChangeText com o texto bruto digitado", async () => {
    const view = await render(<Harness />);
    const input = view.getByPlaceholderText("DD/MM/AAAA");
    await fireEvent.changeText(input, "20/08/2026");
    expect(input.props.value).toBe("20/08/2026");
  });

  it("o ícone abre o modal do calendário com o título padrão", async () => {
    const view = await render(<Harness />);
    expect(view.queryByText("Selecionar data")).toBeNull();
    await fireEvent.press(view.getByLabelText("Abrir seletor de data para o campo Vencimento"));
    expect(view.getByText("Selecionar data")).toBeTruthy();
  });

  it("tocar num dia válido grava a data formatada no campo e fecha o modal imediatamente", async () => {
    const view = await render(<Harness />);
    await fireEvent.press(view.getByLabelText("Abrir seletor de data para o campo Vencimento"));
    // Agosto de 2026, mês aberto por padrão (campo vazio, "hoje" = 13/08/2026).
    await fireEvent.press(view.getByText("20"));
    const input = view.getByPlaceholderText("DD/MM/AAAA");
    expect(input.props.value).toBe("20/08/2026");
    expect(view.queryByText("Selecionar data")).toBeNull();
  });

  it("dias fora de minDate/maxDate ficam desabilitados e não selecionáveis", async () => {
    const minDate = new Date(Date.UTC(2026, 7, 15));
    const maxDate = new Date(Date.UTC(2026, 7, 20));
    const view = await render(<Harness minDate={minDate} maxDate={maxDate} />);
    await fireEvent.press(view.getByLabelText("Abrir seletor de data para o campo Vencimento"));

    const disabledDay = view.getByText("10");
    await fireEvent.press(disabledDay);
    // Nenhuma alteração: o campo continua vazio e o modal continua aberto.
    const input = view.getByPlaceholderText("DD/MM/AAAA");
    expect(input.props.value).toBe("");
    expect(view.getByText("Selecionar data")).toBeTruthy();

    await fireEvent.press(view.getByText("18"));
    expect(input.props.value).toBe("18/08/2026");
  });

  it("fechar pelo botão X não altera o campo", async () => {
    const view = await render(<Harness initialValue="05/01/2026" />);
    await fireEvent.press(view.getByLabelText("Abrir seletor de data para o campo Vencimento"));
    await fireEvent.press(view.getByLabelText("Fechar seletor de data"));
    const input = view.getByPlaceholderText("DD/MM/AAAA");
    expect(input.props.value).toBe("05/01/2026");
    expect(view.queryByText("Selecionar data")).toBeNull();
  });
});
