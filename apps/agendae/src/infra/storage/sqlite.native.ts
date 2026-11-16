import * as SQLite from "expo-sqlite";

import type { AtendimentoSalvo } from "./sqlite";

// banco sqlite com os atendimentos salvos no celular.

// abre o banco uma vez só e cria a tabela se ela ainda não existir.
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
  `);
  return db;
})();

// salva tudo numa transação. o "insert or replace" atualiza quem já tem o mesmo id.
export async function salvarAtendimentos(atendimentos: AtendimentoSalvo[]): Promise<void> {
  if (atendimentos.length === 0) return;

  const db = await dbPromise;
  await db.withTransactionAsync(async () => {
    for (const atendimento of atendimentos) {
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

// apaga todos os atendimentos do aparelho (usado no logout).
export async function apagarAtendimentos(): Promise<void> {
  const db = await dbPromise;
  await db.runAsync("DELETE FROM atendimentos");
}
