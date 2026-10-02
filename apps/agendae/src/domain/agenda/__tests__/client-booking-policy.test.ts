import {
  blockedSlotIds,
  hasAvailableTimeForDay,
  isDayAllowed,
  listTimesForDay,
  validatePlannedAppointment,
  type ClientBookingPolicy,
} from "../client-booking-policy";

const published: ClientBookingPolicy = {
  allowedWeekdays: [1, 2, 3, 4, 5],
  startTime: "08:00",
  endTime: "18:00",
  intervalMinutes: 60,
  publishedSlots: [{ id: "s1", dateKey: "2026-08-25", time: "09:00" }],
};
const open: ClientBookingPolicy = {
  allowedWeekdays: [1, 2, 3, 4, 5],
  startTime: "08:00",
  endTime: "10:00",
  intervalMinutes: 60,
  publishedSlots: [],
};

describe("client booking policy", () => {
  it("usa vagas específicas somente no dia publicado", () => {
    expect(isDayAllowed(published, "2026-08-25")).toBe(true);
    expect(listTimesForDay(published, "2026-08-25").map((item) => item.time)).toEqual(["09:00"]);
    expect(listTimesForDay(published, "2026-08-26")[0]?.time).toBe("08:00");
  });
  it("gera os horários definidos nas configurações do perfil", () =>
    expect(
      listTimesForDay(open, "2026-08-25").map((item) => item.time),
    ).toEqual(["08:00", "09:00"]));
  it("bloqueia dias fora da configuração do perfil", () =>
    expect(isDayAllowed(open, "2026-08-30")).toBe(false));
  it("bloqueia duplicidade sem impor limite total por cliente", () => {
    const candidate = { id: "s1", dateKey: "2026-08-25", time: "09:00" };
    expect(
      validatePlannedAppointment({
        policy: published,
        candidate,
        planned: [candidate],
      }),
    ).toBe("DUPLICATE_SLOT");
  });
  it("bloqueia vaga ocupada e horário não publicado", () => {
    expect(
      validatePlannedAppointment({
        policy: published,
        candidate: { id: "s1", dateKey: "2026-08-25", time: "09:00" },
        planned: [],
        unavailableIds: ["s1"],
      }),
    ).toBe("SLOT_UNAVAILABLE");
    expect(
      validatePlannedAppointment({
        policy: published,
        candidate: { id: "x", dateKey: "2026-08-25", time: "10:00" },
        planned: [],
      }),
    ).toBe("SLOT_NOT_PUBLISHED");
  });
});

describe("RN-AGD-030 — período, limite total e limite diário por cliente", () => {
  const base: ClientBookingPolicy = {
    allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
    startTime: "08:00",
    endTime: "10:00",
    intervalMinutes: 60,
    publishedSlots: [],
  };

  it("bloqueia dia fora do período liberado (requestWindowStart/End)", () => {
    const policy: ClientBookingPolicy = {
      ...base,
      requestWindowStart: "2026-09-01",
      requestWindowEnd: "2026-09-10",
    };
    expect(isDayAllowed(policy, "2026-08-31")).toBe(false);
    expect(isDayAllowed(policy, "2026-09-11")).toBe(false);
    expect(isDayAllowed(policy, "2026-09-05")).toBe(true);
  });

  it("período restrito também bloqueia dia com vaga publicada fora da janela", () => {
    const policy: ClientBookingPolicy = {
      ...base,
      publishedSlots: [{ id: "s1", dateKey: "2026-09-20", time: "09:00" }],
      requestWindowStart: "2026-09-01",
      requestWindowEnd: "2026-09-10",
    };
    expect(isDayAllowed(policy, "2026-09-20")).toBe(false);
  });

  it("limite total já atingido bloqueia QUALQUER dia, mesmo dentro dos dias de atendimento", () => {
    const policy: ClientBookingPolicy = {
      ...base,
      totalBookingLimit: 3,
      totalBookingCount: 3,
    };
    expect(isDayAllowed(policy, "2026-08-25")).toBe(false);
    expect(isDayAllowed(policy, "2026-08-26")).toBe(false);
  });

  it("limite total ainda não atingido não bloqueia nenhum dia por essa regra", () => {
    const policy: ClientBookingPolicy = {
      ...base,
      totalBookingLimit: 3,
      totalBookingCount: 2,
    };
    expect(isDayAllowed(policy, "2026-08-25")).toBe(true);
  });

  it("limite diário: bloqueia o dia quando a seleção atual já atingiu dailyBookingLimit para aquele dateKey", () => {
    const policy: ClientBookingPolicy = {
      ...base,
      dailyBookingLimit: 1,
      plannedCountsByDay: { "2026-08-25": 1 },
    };
    expect(isDayAllowed(policy, "2026-08-25")).toBe(false);
    // Outro dia, sem nada planejado ainda, continua liberado.
    expect(isDayAllowed(policy, "2026-08-26")).toBe(true);
  });

  it("limite diário: não bloqueia enquanto a contagem planejada for menor que o limite", () => {
    const policy: ClientBookingPolicy = {
      ...base,
      dailyBookingLimit: 2,
      plannedCountsByDay: { "2026-08-25": 1 },
    };
    expect(isDayAllowed(policy, "2026-08-25")).toBe(true);
  });

  it("sem os campos novos, comportamento é idêntico ao anterior (retrocompatível)", () => {
    expect(isDayAllowed(base, "2026-08-25")).toBe(true);
    expect(isDayAllowed(base, "2026-08-26")).toBe(true);
  });
});

describe("bloqueios de agenda (availability_blocks)", () => {
  const fullDay: ClientBookingPolicy = {
    allowedWeekdays: [1, 2, 3, 4, 5],
    startTime: "08:00",
    endTime: "18:00",
    intervalMinutes: 60,
    publishedSlots: [],
  };

  it("sem bloqueio, comportamento é idêntico ao atual", () => {
    expect(blockedSlotIds(fullDay, "2026-08-25")).toEqual([]);
    expect(hasAvailableTimeForDay(fullDay, "2026-08-25")).toBe(true);
  });

  it("bloqueio parcial remove só os horários cobertos; o dia continua disponível", () => {
    const policy: ClientBookingPolicy = {
      ...fullDay,
      // 14:00–16:00: cobre exatamente as vagas das 14:00 e 15:00.
      blockedIntervals: [{ dateKey: "2026-08-25", startMinutes: 14 * 60, endMinutes: 16 * 60 }],
    };
    const blocked = blockedSlotIds(policy, "2026-08-25");
    expect(blocked).toEqual([
      "open-2026-08-25-14:00",
      "open-2026-08-25-15:00",
    ]);
    // Vagas adjacentes ao bloqueio (13:00 e 16:00) não são afetadas.
    expect(blocked).not.toContain("open-2026-08-25-13:00");
    expect(blocked).not.toContain("open-2026-08-25-16:00");
    expect(hasAvailableTimeForDay(policy, "2026-08-25", blocked)).toBe(true);
  });

  it("bloqueio que cobre o expediente inteiro torna o dia indisponível", () => {
    const policy: ClientBookingPolicy = {
      ...fullDay,
      blockedIntervals: [{ dateKey: "2026-08-25", startMinutes: 8 * 60, endMinutes: 18 * 60 }],
    };
    const blocked = blockedSlotIds(policy, "2026-08-25");
    expect(blocked).toHaveLength(
      listTimesForDay(policy, "2026-08-25").length,
    );
    expect(hasAvailableTimeForDay(policy, "2026-08-25", blocked)).toBe(false);
  });

  it("bloqueio que se sobrepõe a um horário já ocupado não duplica nem quebra a validação", () => {
    const policy: ClientBookingPolicy = {
      ...fullDay,
      // 09:00–11:00 cobre as vagas das 09:00 e 10:00, sendo 09:00 também
      // ocupada por um agendamento existente (occupiedStartsAt).
      blockedIntervals: [{ dateKey: "2026-08-25", startMinutes: 9 * 60, endMinutes: 11 * 60 }],
    };
    const occupied = ["open-2026-08-25-09:00"];
    const blocked = blockedSlotIds(policy, "2026-08-25");
    expect(blocked).toEqual([
      "open-2026-08-25-09:00",
      "open-2026-08-25-10:00",
    ]);
    const combined = [...occupied, ...blocked];
    // Continua disponível: restam vagas fora do bloqueio e da ocupação.
    expect(hasAvailableTimeForDay(policy, "2026-08-25", combined)).toBe(true);
    expect(
      validatePlannedAppointment({
        policy,
        candidate: { id: "open-2026-08-25-09:00", dateKey: "2026-08-25", time: "09:00" },
        planned: [],
        unavailableIds: combined,
      }),
    ).toBe("SLOT_UNAVAILABLE");
    expect(
      validatePlannedAppointment({
        policy,
        candidate: { id: "open-2026-08-25-10:00", dateKey: "2026-08-25", time: "10:00" },
        planned: [],
        unavailableIds: combined,
      }),
    ).toBe("SLOT_UNAVAILABLE");
    expect(
      validatePlannedAppointment({
        policy,
        candidate: { id: "open-2026-08-25-11:00", dateKey: "2026-08-25", time: "11:00" },
        planned: [],
        unavailableIds: combined,
      }),
    ).toBeNull();
  });
});
