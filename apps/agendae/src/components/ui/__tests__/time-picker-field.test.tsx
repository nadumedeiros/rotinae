import { fireEvent, render } from "@testing-library/react-native";
import React, { useState } from "react";

import { TimePickerField } from "../time-picker-field";

function Harness({ initialValue = "" }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <TimePickerField
      label="Início do expediente"
      value={value}
      onChangeText={setValue}
      placeholder="HH:MM"
      keyboardType="number-pad"
      maxLength={5}
    />
  );
}

describe("TimePickerField", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // 10:07 -> arredondado para cima até o próximo múltiplo de 15 = 10:15
    // (Dante, seção 6.7), usado como valor inicial quando o campo está vazio.
    jest.setSystemTime(new Date(2026, 7, 13, 10, 7, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("preserva a digitação manual — TextInput chama onChangeText com o texto bruto digitado", async () => {
    const view = await render(<Harness />);
    const input = view.getByPlaceholderText("HH:MM");
    await fireEvent.changeText(input, "14:30");
    expect(input.props.value).toBe("14:30");
  });

  it("o ícone abre o modal do seletor de horário com o título padrão", async () => {
    const view = await render(<Harness />);
    expect(view.queryByText("Selecionar horário")).toBeNull();
    await fireEvent.press(view.getByLabelText("Abrir seletor de horário para o campo Início do expediente"));
    expect(view.getByText("Selecionar horário")).toBeTruthy();
  });

  it("tocar diretamente num valor de hora e de minuto e confirmar grava HH:MM no campo", async () => {
    const view = await render(<Harness />);
    await fireEvent.press(view.getByLabelText("Abrir seletor de horário para o campo Início do expediente"));

    await fireEvent.press(view.getAllByText("08")[0]);
    await fireEvent.press(view.getByText("30"));
    await fireEvent.press(view.getByText("Confirmar"));

    const input = view.getByPlaceholderText("HH:MM");
    expect(input.props.value).toBe("08:30");
    expect(view.queryByText("Selecionar horário")).toBeNull();
  });

  it("Cancelar fecha o modal sem alterar o campo", async () => {
    const view = await render(<Harness initialValue="09:00" />);
    await fireEvent.press(view.getByLabelText("Abrir seletor de horário para o campo Início do expediente"));
    await fireEvent.press(view.getAllByText("14")[0]);
    await fireEvent.press(view.getByText("Cancelar"));

    const input = view.getByPlaceholderText("HH:MM");
    expect(input.props.value).toBe("09:00");
    expect(view.queryByText("Selecionar horário")).toBeNull();
  });

  it("coluna de HORA gira nas bordas: de 00h, seta superior vai para 23h (seção 6.5.1)", async () => {
    const view = await render(<Harness initialValue="00:45" />);
    await fireEvent.press(view.getByLabelText("Abrir seletor de horário para o campo Início do expediente"));

    await fireEvent.press(view.getByLabelText("Aumentar hora"));
    await fireEvent.press(view.getByText("Confirmar"));

    const input = view.getByPlaceholderText("HH:MM");
    expect(input.props.value).toBe("23:45");
  });

  it("coluna de MINUTO trava em 00: seta superior não recua além do limite (seção 6.5.1)", async () => {
    const view = await render(<Harness initialValue="10:00" />);
    await fireEvent.press(view.getByLabelText("Abrir seletor de horário para o campo Início do expediente"));

    await fireEvent.press(view.getByLabelText("Aumentar minuto"));
    await fireEvent.press(view.getByText("Confirmar"));

    const input = view.getByPlaceholderText("HH:MM");
    expect(input.props.value).toBe("10:00");
  });

  it("coluna de MINUTO trava em 55: seta inferior não avança além do limite", async () => {
    const view = await render(<Harness initialValue="10:55" />);
    await fireEvent.press(view.getByLabelText("Abrir seletor de horário para o campo Início do expediente"));

    await fireEvent.press(view.getByLabelText("Diminuir minuto"));
    await fireEvent.press(view.getByText("Confirmar"));

    const input = view.getByPlaceholderText("HH:MM");
    expect(input.props.value).toBe("10:55");
  });

  it("campo vazio abre com o horário atual arredondado para cima (10:07 -> 10:10)", async () => {
    const view = await render(<Harness />);
    await fireEvent.press(view.getByLabelText("Abrir seletor de horário para o campo Início do expediente"));
    await fireEvent.press(view.getByText("Confirmar"));

    const input = view.getByPlaceholderText("HH:MM");
    expect(input.props.value).toBe("10:10");
  });
});
