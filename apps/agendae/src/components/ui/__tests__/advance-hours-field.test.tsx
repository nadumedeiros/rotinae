import { fireEvent, render } from "@testing-library/react-native";
import React, { useState } from "react";

import { AdvanceHoursField } from "../advance-hours-field";

function Harness({ initialValue = "0" }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <AdvanceHoursField
      label="Antecedência mínima"
      value={value}
      onChangeText={setValue}
      placeholder="Ex.: 0 ou 24"
    />
  );
}

describe("AdvanceHoursField", () => {
  it("permite digitação manual de número no input", async () => {
    const view = await render(<Harness />);
    const input = view.getByPlaceholderText("Ex.: 0 ou 24");
    await fireEvent.changeText(input, "48");
    expect(input.props.value).toBe("48");
  });

  it("o ícone de relógio abre o modal de seleção de antecedência", async () => {
    const view = await render(<Harness />);
    expect(view.queryByText("Selecionar antecedência mínima")).toBeNull();
    await fireEvent.press(
      view.getByLabelText("Abrir seletor para o campo Antecedência mínima"),
    );
    expect(view.getByText("Selecionar antecedência mínima")).toBeTruthy();
  });

  it("selecionar um preset e confirmar atualiza o valor", async () => {
    const view = await render(<Harness initialValue="24" />);
    await fireEvent.press(
      view.getByLabelText("Abrir seletor para o campo Antecedência mínima"),
    );

    // Clica em "Livre (0h)"
    await fireEvent.press(view.getByText("Livre (0h)"));
    await fireEvent.press(view.getByText("Confirmar"));

    const input = view.getByPlaceholderText("Ex.: 0 ou 24");
    expect(input.props.value).toBe("0");
    expect(view.queryByText("Selecionar antecedência mínima")).toBeNull();
  });

  it("usar os botões de stepper incrementa e decrementa horas", async () => {
    const view = await render(<Harness initialValue="2" />);
    await fireEvent.press(
      view.getByLabelText("Abrir seletor para o campo Antecedência mínima"),
    );

    await fireEvent.press(view.getByLabelText("Aumentar 1 hora"));
    await fireEvent.press(view.getByText("Confirmar"));

    const input = view.getByPlaceholderText("Ex.: 0 ou 24");
    expect(input.props.value).toBe("3");
  });

  it("Cancelar fecha o modal sem alterar o valor", async () => {
    const view = await render(<Harness initialValue="24" />);
    await fireEvent.press(
      view.getByLabelText("Abrir seletor para o campo Antecedência mínima"),
    );

    await fireEvent.press(view.getByText("12 horas"));
    await fireEvent.press(view.getByText("Cancelar"));

    const input = view.getByPlaceholderText("Ex.: 0 ou 24");
    expect(input.props.value).toBe("24");
  });
});
