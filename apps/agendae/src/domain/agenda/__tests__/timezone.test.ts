import { zonedDateTimeToUtcIso } from "../timezone";

describe("zonedDateTimeToUtcIso", () => {
  it("converte America/Sao_Paulo (UTC-03, sem DST) corretamente", () => {
    expect(zonedDateTimeToUtcIso("2026-08-20", "14:30", "America/Sao_Paulo")).toBe(
      "2026-08-20T17:30:00.000Z",
    );
  });

  it("converte meia-noite sem alterar o dia civil pedido", () => {
    expect(zonedDateTimeToUtcIso("2026-08-20", "00:00", "America/Sao_Paulo")).toBe(
      "2026-08-20T03:00:00.000Z",
    );
  });

  it("empurra a virada de dia para o UTC quando o horário local é tarde da noite", () => {
    expect(zonedDateTimeToUtcIso("2026-08-20", "23:30", "America/Sao_Paulo")).toBe(
      "2026-08-21T02:30:00.000Z",
    );
  });

  it("usa UTC como se fosse o fuso do dispositivo quando o fuso pedido é UTC (caso trivial)", () => {
    expect(zonedDateTimeToUtcIso("2026-08-20", "14:30", "UTC")).toBe(
      "2026-08-20T14:30:00.000Z",
    );
  });

  it("diverge corretamente entre fusos com offsets opostos ao redor do globo", () => {
    // Mesma data/hora de parede, três fusos diferentes: o instante UTC resultante
    // deve refletir a direção correta do offset em cada um (não apenas a magnitude).
    const saoPaulo = zonedDateTimeToUtcIso("2026-08-20", "14:30", "America/Sao_Paulo"); // UTC-03
    const lisboaVerao = zonedDateTimeToUtcIso("2026-08-20", "14:30", "Europe/Lisbon"); // UTC+01 (WEST em agosto)
    const novaYorkVerao = zonedDateTimeToUtcIso("2026-08-20", "14:30", "America/New_York"); // UTC-04 (EDT em agosto)

    expect(saoPaulo).toBe("2026-08-20T17:30:00.000Z");
    expect(lisboaVerao).toBe("2026-08-20T13:30:00.000Z");
    expect(novaYorkVerao).toBe("2026-08-20T18:30:00.000Z");

    // Nova York (UTC-04) fica atrás de São Paulo (UTC-03), que fica atrás de
    // Lisboa no verão europeu (UTC+01): o instante UTC cresce nessa ordem.
    expect(Date.parse(lisboaVerao)).toBeLessThan(Date.parse(saoPaulo));
    expect(Date.parse(saoPaulo)).toBeLessThan(Date.parse(novaYorkVerao));
  });

  it("aplica o offset de inverno (WET, UTC+00) em Europe/Lisbon", () => {
    expect(zonedDateTimeToUtcIso("2026-01-20", "14:30", "Europe/Lisbon")).toBe(
      "2026-01-20T14:30:00.000Z",
    );
  });

  it("aplica o offset de verão (WEST, UTC+01) em Europe/Lisbon", () => {
    expect(zonedDateTimeToUtcIso("2026-08-20", "14:30", "Europe/Lisbon")).toBe(
      "2026-08-20T13:30:00.000Z",
    );
  });

  it("aplica o offset de inverno (EST, UTC-05) em America/New_York fora do horário de verão", () => {
    expect(zonedDateTimeToUtcIso("2026-01-20", "14:30", "America/New_York")).toBe(
      "2026-01-20T19:30:00.000Z",
    );
  });

  it("aplica o offset de verão (EDT, UTC-04) em America/New_York durante o horário de verão", () => {
    expect(zonedDateTimeToUtcIso("2026-08-20", "14:30", "America/New_York")).toBe(
      "2026-08-20T18:30:00.000Z",
    );
  });

  describe("transição de horário de verão em America/New_York (2026)", () => {
    // DST começa em 2026-03-08 (relógio avança de 02:00 para 03:00, EST -05 -> EDT -04).
    it("usa EST (UTC-05) no dia imediatamente anterior ao início do DST", () => {
      expect(zonedDateTimeToUtcIso("2026-03-07", "12:00", "America/New_York")).toBe(
        "2026-03-07T17:00:00.000Z",
      );
    });

    it("usa EDT (UTC-04) no dia em que o DST começa", () => {
      expect(zonedDateTimeToUtcIso("2026-03-08", "12:00", "America/New_York")).toBe(
        "2026-03-08T16:00:00.000Z",
      );
    });

    // DST termina em 2026-11-01 (relógio recua de 02:00 para 01:00, EDT -04 -> EST -05).
    it("usa EDT (UTC-04) no dia imediatamente anterior ao fim do DST", () => {
      expect(zonedDateTimeToUtcIso("2026-10-31", "12:00", "America/New_York")).toBe(
        "2026-10-31T16:00:00.000Z",
      );
    });

    it("usa EST (UTC-05) no dia em que o DST termina", () => {
      expect(zonedDateTimeToUtcIso("2026-11-01", "12:00", "America/New_York")).toBe(
        "2026-11-01T17:00:00.000Z",
      );
    });
  });

  it("mantém o resultado que new Date(...).toISOString() já dava quando o fuso pedido coincide com o do dispositivo (America/Sao_Paulo)", () => {
    // Este teste fixa o fuso do processo em America/Sao_Paulo (mesmo fuso padrão do
    // projeto) para reproduzir o comportamento ANTERIOR (bugado, mas correto neste
    // caso específico porque fuso do dispositivo == fuso do tenant) e comprovar que
    // a nova função não regride esse caso trivial.
    const originalTz = process.env.TZ;
    process.env.TZ = "America/Sao_Paulo";
    try {
      const legacyResult = new Date("2026-08-20T14:30:00").toISOString();
      const newResult = zonedDateTimeToUtcIso("2026-08-20", "14:30", "America/Sao_Paulo");
      expect(newResult).toBe(legacyResult);
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it("lança erro para dateKey fora do formato YYYY-MM-DD", () => {
    expect(() => zonedDateTimeToUtcIso("20/08/2026", "14:30", "America/Sao_Paulo")).toThrow();
  });

  it("lança erro para time fora do formato HH:MM", () => {
    expect(() => zonedDateTimeToUtcIso("2026-08-20", "2:30pm", "America/Sao_Paulo")).toThrow();
  });
});
