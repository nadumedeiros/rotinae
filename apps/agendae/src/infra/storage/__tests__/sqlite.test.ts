import * as SQLite from "expo-sqlite";

import type { AtendimentoSalvo } from "../sqlite";

const bancoFalso = {
  execAsync: jest.fn(),
  runAsync: jest.fn(),
  getAllAsync: jest.fn(),
  getFirstAsync: jest.fn(),
  withTransactionAsync: jest.fn(async (tarefa: () => Promise<void>) => tarefa()),
};

jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: jest.fn(),
}));

const atendimento: AtendimentoSalvo = {
  id: "a1",
  data: "2026-11-17",
  hora: "09:00",
  cliente: "Maria",
  servico: "Adestramento básico",
  status: "Confirmado",
  detalhes: "{}",
};

function carregarModulo(): typeof import("../sqlite.native") {
  let modulo!: typeof import("../sqlite.native");
  jest.isolateModules(() => {
    modulo = jest.requireActual<typeof import("../sqlite.native")>("../sqlite.native");
  });
  return modulo;
}

describe("sqlite dos atendimentos (celular)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValue(bancoFalso);
  });

  it("cria a tabela atendimentos ao abrir o banco", async () => {
    const { listarAtendimentosDoDia } = carregarModulo();
    bancoFalso.getAllAsync.mockResolvedValue([]);

    await listarAtendimentosDoDia("2026-11-17");

    expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith("rotinae.db");
    expect(bancoFalso.execAsync).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS atendimentos"),
    );
  });

  it("abre o banco só uma vez, mesmo com várias chamadas", async () => {
    const { listarAtendimentosDoDia, apagarAtendimentos } = carregarModulo();
    bancoFalso.getAllAsync.mockResolvedValue([]);

    await listarAtendimentosDoDia("2026-11-17");
    await apagarAtendimentos();

    expect(SQLite.openDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it("salva cada atendimento com insert or replace dentro de uma transação", async () => {
    const { salvarAtendimentos } = carregarModulo();

    await salvarAtendimentos([atendimento, { ...atendimento, id: "a2", hora: "10:00" }]);

    expect(bancoFalso.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(bancoFalso.runAsync).toHaveBeenCalledTimes(2);
    expect(bancoFalso.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR REPLACE INTO atendimentos"),
      "a1",
      "2026-11-17",
      "09:00",
      "Maria",
      "Adestramento básico",
      "Confirmado",
      "{}",
    );
  });

  it("não grava nada quando a lista está vazia", async () => {
    const { salvarAtendimentos } = carregarModulo();

    await salvarAtendimentos([]);

    expect(bancoFalso.withTransactionAsync).not.toHaveBeenCalled();
    expect(bancoFalso.runAsync).not.toHaveBeenCalled();
  });

  it("lista os atendimentos do dia filtrando pela data e ordenando pela hora", async () => {
    const { listarAtendimentosDoDia } = carregarModulo();
    bancoFalso.getAllAsync.mockResolvedValue([atendimento]);

    const resultado = await listarAtendimentosDoDia("2026-11-17");

    expect(resultado).toEqual([atendimento]);
    expect(bancoFalso.getAllAsync).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE data = \? ORDER BY hora/),
      "2026-11-17",
    );
  });

  it("apaga todos os atendimentos e as datas de sincronização", async () => {
    const { apagarAtendimentos } = carregarModulo();

    await apagarAtendimentos();

    expect(bancoFalso.runAsync).toHaveBeenCalledWith("DELETE FROM atendimentos");
    expect(bancoFalso.runAsync).toHaveBeenCalledWith("DELETE FROM sincronizacoes");
  });

  it("cria a tabela de sincronizações ao abrir o banco", async () => {
    const { lerSincronizacao } = carregarModulo();
    bancoFalso.getFirstAsync.mockResolvedValue(null);

    await lerSincronizacao("2026-11");

    expect(bancoFalso.execAsync).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS sincronizacoes"),
    );
  });

  it("troca os atendimentos do mês e guarda quando foram salvos, numa transação", async () => {
    const { substituirAtendimentosDoMes } = carregarModulo();

    await substituirAtendimentosDoMes("2026-11", [atendimento], "2026-11-15T21:05:00.000Z");

    expect(bancoFalso.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(bancoFalso.runAsync).toHaveBeenNthCalledWith(1, "DELETE FROM atendimentos WHERE data LIKE ?", "2026-11-%");
    expect(bancoFalso.runAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT OR REPLACE INTO atendimentos"),
      "a1",
      "2026-11-17",
      "09:00",
      "Maria",
      "Adestramento básico",
      "Confirmado",
      "{}",
    );
    expect(bancoFalso.runAsync).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT OR REPLACE INTO sincronizacoes"),
      "2026-11",
      "2026-11-15T21:05:00.000Z",
    );
  });

  it("lista os atendimentos do mês em ordem de data e horário", async () => {
    const { listarAtendimentosDoMes } = carregarModulo();
    bancoFalso.getAllAsync.mockResolvedValue([atendimento]);

    const resultado = await listarAtendimentosDoMes("2026-11");

    expect(resultado).toEqual([atendimento]);
    expect(bancoFalso.getAllAsync).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE data LIKE \? ORDER BY data, hora/),
      "2026-11-%",
    );
  });

  it("lê quando o mês foi salvo, ou null se nunca foi", async () => {
    const { lerSincronizacao } = carregarModulo();
    bancoFalso.getFirstAsync.mockResolvedValueOnce({ salva_em: "2026-11-15T21:05:00.000Z" });
    bancoFalso.getFirstAsync.mockResolvedValueOnce(null);

    await expect(lerSincronizacao("2026-11")).resolves.toBe("2026-11-15T21:05:00.000Z");
    await expect(lerSincronizacao("2026-10")).resolves.toBeNull();
  });
});

describe("sqlite dos atendimentos (web)", () => {
  it("não guarda nada e sempre devolve lista vazia", async () => {
    const web = jest.requireActual<typeof import("../sqlite")>("../sqlite.ts");

    await web.salvarAtendimentos([atendimento]);
    await web.substituirAtendimentosDoMes("2026-11", [atendimento], "2026-11-15T21:05:00.000Z");
    await web.apagarAtendimentos();

    await expect(web.listarAtendimentosDoDia("2026-11-17")).resolves.toEqual([]);
    await expect(web.listarAtendimentosDoMes("2026-11")).resolves.toEqual([]);
    await expect(web.lerSincronizacao("2026-11")).resolves.toBeNull();
  });
});
