import type { FinancialHistoryMonth } from "./types";

export type FinancialMonthState = "past" | "current" | "future";

export function financialMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function financialMonthState(
  month: string,
  currentMonth = financialMonthKey(),
): FinancialMonthState {
  if (month === currentMonth) return "current";
  return month < currentMonth ? "past" : "future";
}

export function formatFinancialMonth(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return label.charAt(0).toLocaleUpperCase("pt-BR") + label.slice(1);
}

export function summarizeFinancialHistory(
  months: FinancialHistoryMonth[],
  currentMonth = financialMonthKey(),
) {
  return months.reduce(
    (summary, month) => {
      if (month.month === currentMonth) {
        summary.receivedCurrentMonthCents += month.receivedTotalCents;
        summary.outstandingTotalCents = month.outstandingTotalCents;
      }
      if (month.month > currentMonth) {
        summary.futureExpectedTotalCents += month.outstandingTotalCents;
      }
      return summary;
    },
    {
      receivedCurrentMonthCents: 0,
      outstandingTotalCents: 0,
      futureExpectedTotalCents: 0,
    },
  );
}
