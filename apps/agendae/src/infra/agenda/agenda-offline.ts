import type { Appointment } from "@/src/components/agenda/appointment-day-list";
import { AppointmentError } from "@/src/domain/agenda/types";
import {
  lerSincronizacao,
  listarAtendimentosDoMes,
  substituirAtendimentosDoMes,
  type AtendimentoSalvo,
} from "@/src/infra/storage/sqlite";

// agenda offline: junta o web service (api) com o sqlite.

export type AgendaCarregada = {
  atendimentos: Appointment[];
  avisoOffline: string | null;
};

// converte a data da tela (DD/MM/AAAA) para o formato do banco (AAAA-MM-DD).
function paraDataDoBanco(data: string): string {
  const [dia, mes, ano] = data.split("/");
  return `${ano}-${mes}-${dia}`;
}

function doisDigitos(valor: number): string {
  return String(valor).padStart(2, "0");
}

// diz se o erro aconteceu por falta de internet.
export function ehErroDeConexao(erro: unknown): boolean {
  if (erro instanceof AppointmentError) return erro.code === "NETWORK_ERROR";
  const mensagem = erro instanceof Error ? erro.message.toLowerCase() : "";
  return mensagem.includes("network request failed") || mensagem.includes("failed to fetch");
}

export function mensagemOffline(salvaEm: Date): string {
  const data = `${doisDigitos(salvaEm.getDate())}/${doisDigitos(salvaEm.getMonth() + 1)}`;
  const hora = `${doisDigitos(salvaEm.getHours())}:${doisDigitos(salvaEm.getMinutes())}`;
  return `Você está offline. Mostrando a agenda salva em ${data} às ${hora}`;
}

// guarda a agenda do mês (AAAA-MM) no aparelho.
export async function salvarAgendaOffline(mes: string, atendimentos: Appointment[]): Promise<void> {
  const linhas: AtendimentoSalvo[] = atendimentos.map((atendimento) => ({
    id: atendimento.id,
    data: paraDataDoBanco(atendimento.date),
    hora: atendimento.time,
    cliente: atendimento.client,
    servico: atendimento.service,
    status: atendimento.status,
    detalhes: JSON.stringify(atendimento),
  }));
  await substituirAtendimentosDoMes(mes, linhas, new Date().toISOString());
}

// lê a agenda salva do mês. devolve null se ela nunca foi salva.
export async function lerAgendaOffline(
  mes: string,
): Promise<{ atendimentos: Appointment[]; salvaEm: Date } | null> {
  const salvaEm = await lerSincronizacao(mes);
  if (!salvaEm) return null;

  const linhas = await listarAtendimentosDoMes(mes);
  return {
    atendimentos: linhas.map((linha) => JSON.parse(linha.detalhes) as Appointment),
    salvaEm: new Date(salvaEm),
  };
}

// busca na api e salva uma cópia. sem internet, devolve a cópia salva com o aviso.
export async function carregarAgendaComCopia(
  mes: string,
  buscarNaApi: () => Promise<Appointment[]>,
): Promise<AgendaCarregada> {
  try {
    const atendimentos = await buscarNaApi();
    // se der erro ao salvar a cópia, a agenda continua funcionando normalmente.
    await salvarAgendaOffline(mes, atendimentos).catch(() => undefined);
    return { atendimentos, avisoOffline: null };
  } catch (erro) {
    if (!ehErroDeConexao(erro)) throw erro;

    const salva = await lerAgendaOffline(mes).catch(() => null);
    if (!salva) throw erro;

    return { atendimentos: salva.atendimentos, avisoOffline: mensagemOffline(salva.salvaEm) };
  }
}
