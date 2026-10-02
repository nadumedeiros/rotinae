import {
  addMonths,
  buildCalendarMatrix,
  buildLoopedHourData,
  formatBrDate,
  formatBrTime,
  initialCalendarAnchor,
  initialLoopedHourIndex,
  isDateDisabled,
  isNearLoopEdge,
  isSameUtcDay,
  nextHourValue,
  nextMinuteValue,
  parseBrDate,
  parseBrTime,
  recenterLoopedHourIndex,
  roundDownToStep,
  roundUpToStep,
  startOfUtcDay,
  todayUtc,
} from "../datetime-picker-utils";

describe("datetime-picker-utils — data", () => {
  it("parseBrDate aceita uma data válida e devolve a Date normalizada em UTC", () => {
    const date = parseBrDate("20/08/2026");
    expect(date).not.toBeNull();
    expect(date && formatBrDate(date)).toBe("20/08/2026");
  });

  it("parseBrDate rejeita formato incorreto e data inexistente (31 de fevereiro)", () => {
    expect(parseBrDate("2026-08-20")).toBeNull();
    expect(parseBrDate("31/02/2026")).toBeNull();
    expect(parseBrDate("")).toBeNull();
  });

  it("formatBrDate produz DD/MM/AAAA com dois dígitos", () => {
    expect(formatBrDate(new Date(Date.UTC(2026, 0, 5)))).toBe("05/01/2026");
  });

  it("isSameUtcDay compara apenas o dia civil, ignorando hora", () => {
    const a = new Date(Date.UTC(2026, 7, 20, 3));
    const b = new Date(Date.UTC(2026, 7, 20, 23));
    const c = new Date(Date.UTC(2026, 7, 21, 0));
    expect(isSameUtcDay(a, b)).toBe(true);
    expect(isSameUtcDay(a, c)).toBe(false);
  });

  it("buildCalendarMatrix preenche início/fim do mês com null e começa em domingo (DEC-153)", () => {
    // Agosto de 2026 começa numa sábado (getUTCDay=6) — 6 células vazias antes do dia 1.
    const cells = buildCalendarMatrix(2026, 7);
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toBe(1);
    expect(cells.filter((day) => day !== null)).toHaveLength(31);
    expect(cells.length % 7).toBe(0);
  });

  it("isDateDisabled respeita minDate/maxDate quando informados", () => {
    const minDate = new Date(Date.UTC(2026, 7, 10));
    const maxDate = new Date(Date.UTC(2026, 7, 20));
    expect(isDateDisabled(new Date(Date.UTC(2026, 7, 9)), minDate, maxDate)).toBe(true);
    expect(isDateDisabled(new Date(Date.UTC(2026, 7, 21)), minDate, maxDate)).toBe(true);
    expect(isDateDisabled(new Date(Date.UTC(2026, 7, 15)), minDate, maxDate)).toBe(false);
    expect(isDateDisabled(new Date(Date.UTC(2026, 7, 15)))).toBe(false);
  });

  it("initialCalendarAnchor abre no mês de minDate/maxDate quando hoje fica fora do intervalo", () => {
    const future = startOfUtcDay(new Date(Date.UTC(2099, 0, 1)));
    const anchoredToMin = initialCalendarAnchor(future, undefined);
    expect(anchoredToMin.getTime()).toBe(future.getTime());

    const past = startOfUtcDay(new Date(Date.UTC(2000, 0, 1)));
    const anchoredToMax = initialCalendarAnchor(undefined, past);
    expect(anchoredToMax.getTime()).toBe(past.getTime());
  });
});

describe("datetime-picker-utils — meses com quantidade de dias diferente (edge cases)", () => {
  it("fevereiro de ano NÃO bissexto tem 28 dias (2026)", () => {
    const cells = buildCalendarMatrix(2026, 1); // mês 1 = fevereiro (0-indexado)
    expect(cells.filter((day) => day !== null)).toHaveLength(28);
    expect(cells.filter((day) => day !== null).pop()).toBe(28);
    // 29/02/2026 não existe — parseBrDate deve rejeitar.
    expect(parseBrDate("29/02/2026")).toBeNull();
  });

  it("fevereiro de ano bissexto tem 29 dias (2028)", () => {
    const cells = buildCalendarMatrix(2028, 1);
    expect(cells.filter((day) => day !== null)).toHaveLength(29);
    expect(cells.filter((day) => day !== null).pop()).toBe(29);
    // 29/02/2028 existe — parseBrDate deve aceitar e devolver a mesma data.
    const leapDay = parseBrDate("29/02/2028");
    expect(leapDay).not.toBeNull();
    expect(leapDay && formatBrDate(leapDay)).toBe("29/02/2028");
  });

  it("mês de 30 dias (abril) fecha em 30, sem 'dia 31' fantasma", () => {
    const cells = buildCalendarMatrix(2026, 3); // mês 3 = abril
    expect(cells.filter((day) => day !== null)).toHaveLength(30);
    expect(cells.filter((day) => day !== null).pop()).toBe(30);
    expect(parseBrDate("31/04/2026")).toBeNull();
  });

  it("mês de 31 dias (dezembro) fecha em 31 e vira o ano corretamente", () => {
    const cells = buildCalendarMatrix(2026, 11); // mês 11 = dezembro
    expect(cells.filter((day) => day !== null)).toHaveLength(31);
    expect(cells.filter((day) => day !== null).pop()).toBe(31);
  });

  it("addMonths avança de dezembro para janeiro do ano seguinte", () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  });

  it("addMonths recua de janeiro para dezembro do ano anterior", () => {
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });

  it("addMonths + buildCalendarMatrix mantêm a contagem de dias correta ao navegar de um mês de 31 dias para um de 30 (ex.: janeiro -> fevereiro)", () => {
    const { year, month } = addMonths(2026, 0, 1); // janeiro -> fevereiro
    const cells = buildCalendarMatrix(year, month);
    expect(cells.filter((day) => day !== null)).toHaveLength(28);
  });
});

describe("datetime-picker-utils — fuso horário (UTC-3, o clássico 'dia -1')", () => {
  it("parseBrDate/formatBrDate não deslocam o dia mesmo com o relógio do dispositivo em UTC-3", () => {
    // O ambiente de teste roda em America/Sao_Paulo (UTC-3); se a lógica
    // misturasse `new Date(dateString)` (interpretado como UTC) com getters
    // locais (`getDate`), o dia exibido cairia um dia antes do esperado.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Sao_Paulo");
    const date = parseBrDate("01/03/2026");
    expect(date).not.toBeNull();
    expect(date && formatBrDate(date)).toBe("01/03/2026");
  });

  it("demonstra o bug clássico que a normalização em UTC evita: parsear string ISO sem hora com `new Date()` e ler com getters locais desloca o dia em fusos negativos", () => {
    // Construção "ingênua" (o antipadrão que este módulo evita): uma string
    // de data sem hora é interpretada como meia-noite UTC por `new Date()`;
    // lida de volta com getters LOCAIS num fuso negativo (UTC-3), o dia
    // civil exibido fica um dia atrasado.
    const naive = new Date("2026-03-01");
    expect(naive.getDate()).toBe(28); // 28/02, o bug: um dia antes do esperado.

    // A mesma data civil, construída e lida com os utilitários deste módulo
    // (sempre UTC ponta a ponta), preserva o dia correto.
    const safe = parseBrDate("01/03/2026");
    expect(safe && formatBrDate(safe)).toBe("01/03/2026");
  });

  it("todayUtc() reflete o dia civil local do dispositivo (não o dia UTC) de forma estável", () => {
    const today = todayUtc();
    // Meia-noite UTC do mesmo dia civil — hora sempre zerada.
    expect(today.getUTCHours()).toBe(0);
    expect(today.getUTCMinutes()).toBe(0);
    expect(today.getUTCSeconds()).toBe(0);
  });
});

describe("datetime-picker-utils — hora", () => {
  it("parseBrTime aceita HH:MM válido e rejeita limites fora de 23/59", () => {
    expect(parseBrTime("14:30")).toEqual({ hour: 14, minute: 30 });
    expect(parseBrTime("24:00")).toBeNull();
    expect(parseBrTime("10:60")).toBeNull();
    expect(parseBrTime("abc")).toBeNull();
  });

  it("formatBrTime produz HH:MM com dois dígitos", () => {
    expect(formatBrTime(8, 5)).toBe("08:05");
  });

  it("roundDownToStep arredonda o minuto para baixo sem alterar a hora", () => {
    expect(roundDownToStep(14, 37, 15)).toEqual({ hour: 14, minute: 30 });
    expect(roundDownToStep(14, 44, 15)).toEqual({ hour: 14, minute: 30 });
  });

  it("roundUpToStep arredonda o minuto para cima, virando a hora quando ultrapassa 59", () => {
    expect(roundUpToStep(14, 31, 15)).toEqual({ hour: 14, minute: 45 });
    expect(roundUpToStep(14, 50, 15)).toEqual({ hour: 15, minute: 0 });
    // Virada de dia, circular (23h50 -> 00h00 do dia seguinte).
    expect(roundUpToStep(23, 50, 15)).toEqual({ hour: 0, minute: 0 });
  });

  it("nextHourValue GIRA nas bordas (23 -> 00 -> ... -> 23), seção 6.5.1", () => {
    expect(nextHourValue(23, 1)).toBe(0);
    expect(nextHourValue(0, -1)).toBe(23);
    expect(nextHourValue(10, 1)).toBe(11);
    expect(nextHourValue(10, -1)).toBe(9);
  });

  it("nextMinuteValue TRAVA em 00/55, nunca gira, seção 6.5.1", () => {
    expect(nextMinuteValue(55, 1)).toBe(55);
    expect(nextMinuteValue(0, -1)).toBe(0);
    expect(nextMinuteValue(15, 1)).toBe(20);
    expect(nextMinuteValue(30, -1)).toBe(25);
  });

  it("buildLoopedHourData repete as 24 horas HOUR_LOOP_REPEAT vezes", () => {
    const data = buildLoopedHourData();
    expect(data.length).toBe(24 * 9);
    expect(data.slice(0, 24)).toEqual(Array.from({ length: 24 }, (_, index) => index));
  });

  it("initialLoopedHourIndex aponta para o bloco central com o valor correto", () => {
    const index = initialLoopedHourIndex(8);
    const data = buildLoopedHourData();
    expect(data[index]).toBe(8);
    // Bloco central: nem no início nem no fim do array repetido.
    expect(isNearLoopEdge(index)).toBe(false);
  });

  it("isNearLoopEdge detecta proximidade real das bordas do array repetido", () => {
    expect(isNearLoopEdge(0)).toBe(true);
    expect(isNearLoopEdge(24 * 9 - 1)).toBe(true);
    expect(isNearLoopEdge(initialLoopedHourIndex(12))).toBe(false);
  });

  it("recenterLoopedHourIndex preserva o valor exibido ao recentralizar", () => {
    const data = buildLoopedHourData();
    const recentered = recenterLoopedHourIndex(1);
    expect(data[recentered]).toBe(data[1]);
    expect(isNearLoopEdge(recentered)).toBe(false);
  });
});
