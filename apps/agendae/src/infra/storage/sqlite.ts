// versão web: o sqlite não roda no navegador, então nada é salvo. no celular, o app usa `sqlite.native.ts`.

export type AtendimentoSalvo = {
  id: string;
  data: string;
  hora: string;
  cliente: string;
  servico: string;
  status: string;
  detalhes: string;
};

export async function salvarAtendimentos(_atendimentos: AtendimentoSalvo[]): Promise<void> {}

export async function listarAtendimentosDoDia(_data: string): Promise<AtendimentoSalvo[]> {
  return [];
}

export async function apagarAtendimentos(): Promise<void> {}
