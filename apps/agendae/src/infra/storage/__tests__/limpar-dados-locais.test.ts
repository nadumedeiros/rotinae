import * as Notifications from "expo-notifications";

import { limparDadosLocais } from "../limpar-dados-locais.native";
import { apagarAtendimentos } from "../sqlite";

jest.mock("expo-notifications", () => ({
  dismissAllNotificationsAsync: jest.fn(),
}));

jest.mock("../sqlite", () => ({
  apagarAtendimentos: jest.fn(),
}));

describe("limparDadosLocais (celular)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Notifications.dismissAllNotificationsAsync as jest.Mock).mockResolvedValue(undefined);
    (apagarAtendimentos as jest.Mock).mockResolvedValue(undefined);
  });

  it("apaga a agenda salva no aparelho", async () => {
    await limparDadosLocais();

    expect(apagarAtendimentos).toHaveBeenCalledTimes(1);
  });

  it("termina a limpeza mesmo se der erro ao apagar a agenda", async () => {
    (apagarAtendimentos as jest.Mock).mockRejectedValue(new Error("falhou"));

    await expect(limparDadosLocais()).resolves.toBeUndefined();
    expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalled();
  });
});
