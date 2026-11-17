import type { Appointment } from "@/src/components/agenda/appointment-day-list";
import { AppointmentError } from "@/src/domain/agenda/types";
import {
  lerSincronizacao,
  listarAtendimentosDoMes,
  substituirAtendimentosDoMes,
} from "@/src/infra/storage/sqlite";

import {
  carregarAgendaComCopia,
  ehErroDeConexao,
  mensagemOffline,
} from "../agenda-offline";

jest.mock("@/src/infra/storage/sqlite", () => ({
  substituirAtendimentosDoMes: jest.fn(),
  listarAtendimentosDoMes: jest.fn(),
  lerSincronizacao: jest.fn(),
}));

const atendimento: Appointment = {
  id: "a1",
  clientId: "c1",
  serviceId: "s1",
  title: null,
  client: "Maria",
  service: "Adestramento básico",
  date: "17/11/2026",
  time: "09:00",
  value: 150,
  status: "Confirmado",
  state: "scheduled",
  confirmationStatus: "confirmed",
  durationMinutes: 60,
  timezone: "America/Sao_Paulo",
};

const erroDeConexao = new AppointmentError("NETWORK_ERROR", "Falha de conexão.");

describe("agenda offline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (substituirAtendimentosDoMes as jest.Mock).mockResolvedValue(undefined);
  });

  it("com internet, devolve a agenda da api e salva uma cópia do mês", async () => {
    const agenda = await carregarAgendaComCopia("2026-11", async () => [atendimento]);

    expect(agenda).toEqual({ atendimentos: [atendimento], avisoOffline: null });
    expect(substituirAtendimentosDoMes).toHaveBeenCalledWith(
      "2026-11",
      [
        {
          id: "a1",
          data: "2026-11-17",
          hora: "09:00",
          cliente: "Maria",
          servico: "Adestramento básico",
          status: "Confirmado",
          detalhes: JSON.stringify(atendimento),
        },
      ],
      expect.any(String),
    );
  });

  it("continua mostrando a agenda mesmo se der erro ao salvar a cópia", async () => {
    (substituirAtendimentosDoMes as jest.Mock).mockRejectedValue(new Error("disco cheio"));

    const agenda = await carregarAgendaComCopia("2026-11", async () => [atendimento]);

    expect(agenda.atendimentos).toEqual([atendimento]);
  });

  it("sem internet, mostra a cópia salva com o aviso de offline", async () => {
    const salvaEm = new Date(2026, 10, 15, 18, 5);
    (lerSincronizacao as jest.Mock).mockResolvedValue(salvaEm.toISOString());
    (listarAtendimentosDoMes as jest.Mock).mockResolvedValue([
      { id: "a1", data: "2026-11-17", hora: "09:00", cliente: "Maria", servico: "Adestramento básico", status: "Confirmado", detalhes: JSON.stringify(atendimento) },
    ]);

    const agenda = await carregarAgendaComCopia("2026-11", async () => {
      throw erroDeConexao;
    });

    expect(listarAtendimentosDoMes).toHaveBeenCalledWith("2026-11");
    expect(agenda).toEqual({
      atendimentos: [atendimento],
      avisoOffline: "Você está offline. Mostrando a agenda salva em 15/11 às 18:05",
    });
  });

  it("sem internet e sem cópia salva, mantém o erro original", async () => {
    (lerSincronizacao as jest.Mock).mockResolvedValue(null);

    await expect(
      carregarAgendaComCopia("2026-11", async () => {
        throw erroDeConexao;
      }),
    ).rejects.toBe(erroDeConexao);
  });

  it("com outro tipo de erro, não usa a cópia salva", async () => {
    const erroDePermissao = new AppointmentError("FORBIDDEN", "Sem permissão.");

    await expect(
      carregarAgendaComCopia("2026-11", async () => {
        throw erroDePermissao;
      }),
    ).rejects.toBe(erroDePermissao);
    expect(lerSincronizacao).not.toHaveBeenCalled();
  });

  it("reconhece os erros de falta de internet", () => {
    expect(ehErroDeConexao(erroDeConexao)).toBe(true);
    expect(ehErroDeConexao(new TypeError("Network request failed"))).toBe(true);
    expect(ehErroDeConexao(new TypeError("Failed to fetch"))).toBe(true);
    expect(ehErroDeConexao(new AppointmentError("UNKNOWN", "Erro."))).toBe(false);
    expect(ehErroDeConexao("qualquer coisa")).toBe(false);
  });

  it("monta o aviso com dia, mês, hora e minuto", () => {
    expect(mensagemOffline(new Date(2026, 0, 3, 7, 9))).toBe(
      "Você está offline. Mostrando a agenda salva em 03/01 às 07:09",
    );
  });
});
