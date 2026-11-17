import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  lerAntecedenciaLembrete,
  lerVisualizacaoAgenda,
  salvarAntecedenciaLembrete,
  salvarVisualizacaoAgenda,
} from "../preferences";

// Usa o mock oficial do AsyncStorage (jest.setup.js), que guarda na memória.
describe("preferences", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  describe("antecedência do lembrete", () => {
    it("usa 30 min quando nada foi salvo", async () => {
      await expect(lerAntecedenciaLembrete()).resolves.toBe(30);
    });

    it("lê o valor que foi salvo", async () => {
      await salvarAntecedenciaLembrete(1440);
      await expect(lerAntecedenciaLembrete()).resolves.toBe(1440);
    });

    it("volta para 30 min se o valor salvo for inválido", async () => {
      await AsyncStorage.setItem("rotinae:preferencias:antecedencia-lembrete", "7");
      await expect(lerAntecedenciaLembrete()).resolves.toBe(30);
    });
  });

  describe("visualização da agenda", () => {
    it("usa Lista quando nada foi salvo", async () => {
      await expect(lerVisualizacaoAgenda()).resolves.toBe("list");
    });

    it("lê o valor que foi salvo", async () => {
      await salvarVisualizacaoAgenda("calendar");
      await expect(lerVisualizacaoAgenda()).resolves.toBe("calendar");
    });

    it("volta para Lista se o valor salvo for inválido", async () => {
      await AsyncStorage.setItem("rotinae:preferencias:visualizacao-agenda", "grade");
      await expect(lerVisualizacaoAgenda()).resolves.toBe("list");
    });
  });
});