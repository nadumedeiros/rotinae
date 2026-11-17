import { ler, salvar } from "@/src/infra/storage/async-storage";

// Preferências do app (card #7): escolhas da pessoa que ficam salvas só
// neste aparelho, pelo AsyncStorage. Não vão para o servidor.

// ---------- Preferência 1: antecedência do lembrete ----------

export const opcoesAntecedenciaLembrete = [15, 30, 60, 1440] as const;
export type AntecedenciaLembrete = (typeof opcoesAntecedenciaLembrete)[number];
export const antecedenciaLembretePadrao: AntecedenciaLembrete = 30;

const chaveAntecedenciaLembrete = "rotinae:preferencias:antecedencia-lembrete";

function ehAntecedenciaValida(valor: number): valor is AntecedenciaLembrete {
  return (opcoesAntecedenciaLembrete as readonly number[]).includes(valor);
}

/** Minutos de antecedência do lembrete. Se não houver nada salvo, 30 min. */
export async function lerAntecedenciaLembrete(): Promise<AntecedenciaLembrete> {
  try {
    const salvo = await ler(chaveAntecedenciaLembrete);
    const minutos = Number(salvo);
    return salvo !== null && ehAntecedenciaValida(minutos) ? minutos : antecedenciaLembretePadrao;
  } catch {
    return antecedenciaLembretePadrao;
  }
}

export async function salvarAntecedenciaLembrete(minutos: AntecedenciaLembrete): Promise<void> {
  await salvar(chaveAntecedenciaLembrete, String(minutos));
}

// ---------- Preferência 2: visualização padrão da agenda ----------

export type VisualizacaoAgenda = "list" | "calendar";
export const visualizacaoAgendaPadrao: VisualizacaoAgenda = "list";

const chaveVisualizacaoAgenda = "rotinae:preferencias:visualizacao-agenda";

/** Como a agenda abre: "list" (Lista) ou "calendar" (Calendário). Padrão: Lista. */
export async function lerVisualizacaoAgenda(): Promise<VisualizacaoAgenda> {
  try {
    const salvo = await ler(chaveVisualizacaoAgenda);
    return salvo === "list" || salvo === "calendar" ? salvo : visualizacaoAgendaPadrao;
  } catch {
    return visualizacaoAgendaPadrao;
  }
}

export async function salvarVisualizacaoAgenda(visualizacao: VisualizacaoAgenda): Promise<void> {
  await salvar(chaveVisualizacaoAgenda, visualizacao);
}