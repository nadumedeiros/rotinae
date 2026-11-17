import * as SecureStore from "expo-secure-store";

import { apagarSeguro, lerSeguro, salvarSeguro } from "../secure-storage";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe("secure-storage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("salva o valor no SecureStore", async () => {
    await salvarSeguro("token", "abc123");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("token", "abc123");
  });

  it("lê o valor salvo", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("abc123");
    await expect(lerSeguro("token")).resolves.toBe("abc123");
  });

  it("retorna null quando não existe nada salvo", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    await expect(lerSeguro("token")).resolves.toBeNull();
  });

  it("apaga o valor", async () => {
    await apagarSeguro("token");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("token");
  });
});