import AsyncStorage from "@react-native-async-storage/async-storage";

import { deletar, ler, salvar } from "../async-storage";

jest.mock("@react-native-async-storage/async-storage", () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

describe("async-storage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("salva o valor no AsyncStorage", async () => {
    await salvar("tema", "escuro");
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("tema", "escuro");
  });

  it("lê o valor salvo", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("escuro");
    await expect(ler("tema")).resolves.toBe("escuro");
  });

  it("retorna null quando não existe nada salvo", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    await expect(ler("tema")).resolves.toBeNull();
  });

  it("deleta o valor", async () => {
    await deletar("tema");
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("tema");
  });
});
