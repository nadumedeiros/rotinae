import {
  financialMonthKey,
  financialMonthState,
  formatFinancialMonth,
  summarizeFinancialHistory,
} from "../financial-history";

describe("histórico financeiro mensal", () => {
  it("gera a competência mensal sem depender de UTC", () => {
    expect(financialMonthKey(new Date(2026, 8, 3, 10, 0, 0))).toBe("2026-09");
  });

  it("classifica meses passados, atual e futuros", () => {
    expect(financialMonthState("2026-08", "2026-09")).toBe("past");
    expect(financialMonthState("2026-09", "2026-09")).toBe("current");
    expect(financialMonthState("2026-10", "2026-09")).toBe("future");
  });

  it("resume recebido atual, saldo aberto acumulado e previsto futuro", () => {
    expect(
      summarizeFinancialHistory(
        [
          { month: "2026-08", receivedTotalCents: 10000, expectedTotalCents: 15000, outstandingTotalCents: 5000, chargeCount: 2, outstandingCount: 1 },
          { month: "2026-09", receivedTotalCents: 7000, expectedTotalCents: 12000, outstandingTotalCents: 5000, chargeCount: 2, outstandingCount: 1 },
          { month: "2026-10", receivedTotalCents: 3000, expectedTotalCents: 12000, outstandingTotalCents: 9000, chargeCount: 1, outstandingCount: 1 },
        ],
        "2026-09",
      ),
    ).toEqual({
      receivedCurrentMonthCents: 7000,
      outstandingTotalCents: 5000,
      futureExpectedTotalCents: 9000,
    });
  });

  it("formata a competência para leitura humana", () => {
    expect(formatFinancialMonth("2026-09")).toBe("Setembro de 2026");
  });
});
