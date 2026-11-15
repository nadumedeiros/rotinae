import * as SQLite from "expo-sqlite";

import type { AtendimentoSalvo } from "./sqlite";

// banco sqlite com os atendimentos salvos no celular.

// abre o banco uma vez só e cria as tabelas se elas ainda não existirem.
const dbPromise = (async () => {
  const db = await SQLite.openDatabaseAsync("rotinae.db");
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS atendimentos (
      id TEXT PRIMARY KEY NOT NULL,
      data TEXT NOT NULL,
      hora TEXT NOT NULL,
      cliente TEXT NOT NULL,
      servico TEXT NOT NULL,
      status TEXT NOT NULL,
      detalhes TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sincronizacoes (
      mes TEXT PRIMARY KEY NOT NULL,
      salva_em TEXT NOT NULL
    );
  `);
  return db;
})();

// evita erro solto se o banco não abrir. quem usar o banco recebe o erro normalmente.
dbPromise.catch(() => undefined);

async function inserirAtendimento(db: SQLite.SQLiteDatabase, atendimento: AtendimentoSalvo): Promise<void> {
  await db.runAsync(
    "INSERT OR REPLACE INTO atendimentos (id, data, hora, cliente, servico, status, detalhes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    atendimento.id,
    atendimento.data,
    atendimento.hora,
    atendimento.cliente,
    atendimento.servico,
    atendimento.status,
    atendimento.detalhes,
  );
}

// salva tudo numa transação. o "insert or replace" atualiza quem já tem o mesmo id.
export async function salvarAtendimentos(atendimentos: AtendimentoSalvo[]): Promise<void> {
  if (atendimentos.length === 0) return;

  const db = await dbPromise;
  await db.withTransactionAsync(async () => {
    for (const atendimento of atendimentos) {
      await inserirAtendimento(db, atendimento);
    }
  });
}

// troca os atendimentos de um mês (AAAA-MM) pela lista nova e guarda quando isso aconteceu.
export async function substituirAtendimentosDoMes(
  mes: string,
  atendimentos: AtendimentoSalvo[],
  salvaEm: string,
): Promise<void> {
  const db = await dbPromise;
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM atendimentos WHERE data LIKE ?", `${mes}-%`);
    for (const atendimento of atendimentos) {
      await inserirAtendimento(db, atendimento);
    }
    await db.runAsync("INSERT OR REPLACE INTO sincronizacoes (mes, salva_em) VALUES (?, ?)", mes, salvaEm);
  });
}

// lista os atendimentos de um dia (AAAA-MM-DD), em ordem de horário.
export async function listarAtendimentosDoDia(data: string): Promise<AtendimentoSalvo[]> {
  const db = await dbPromise;
  return db.getAllAsync<AtendimentoSalvo>(
    "SELECT id, data, hora, cliente, servico, status, detalhes FROM atendimentos WHERE data = ? ORDER BY hora",
    data,
  );
}

// lista os atendimentos de um mês (AAAA-MM), em ordem de data e horário.
export async function listarAtendimentosDoMes(mes: string): Promise<AtendimentoSalvo[]> {
  const db = await dbPromise;
  return db.getAllAsync<AtendimentoSalvo>(
    "SELECT id, data, hora, cliente, servico, status, detalhes FROM atendimentos WHERE data LIKE ? ORDER BY data, hora",
    `${mes}-%`,
  );
}

// devolve quando a agenda do mês foi salva pela última vez, ou null se nunca foi.
export async function lerSincronizacao(mes: string): Promise<string | null> {
  const db = await dbPromise;
  const linha = await db.getFirstAsync<{ salva_em: string }>(
    "SELECT salva_em FROM sincronizacoes WHERE mes = ?",
    mes,
  );
  return linha?.salva_em ?? null;
}

// apaga todos os atendimentos do aparelho (usado no logout).
export async function apagarAtendimentos(): Promise<void> {
  const db = await dbPromise;
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM atendimentos");
    await db.runAsync("DELETE FROM sincronizacoes");
  });
}
