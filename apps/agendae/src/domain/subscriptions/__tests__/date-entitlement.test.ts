import {
  hasPremiumForAppointmentDate,
  type ProviderPlanState,
} from "../../../hooks/use-provider-plan";

const trial: ProviderPlanState = {
  plan: "premium",
  source: "trial",
  trialEndsAt: "01/09/2026 às 18:00",
  trialEndsAtIso: "2026-09-01T21:00:00.000Z",
};

describe("premium entitlement by appointment date", () => {
  it("mantém Premium durante o teste independentemente da data agendada", () => {
    expect(hasPremiumForAppointmentDate(trial, "01/09/2026")).toBe(true);
    expect(hasPremiumForAppointmentDate(trial, "2026-09-01")).toBe(true);
    expect(hasPremiumForAppointmentDate(trial, "02/09/2026")).toBe(true);
    expect(hasPremiumForAppointmentDate(trial, "31/12/2027")).toBe(true);
  });

  it("mantém Premium em qualquer data para assinatura ativa", () => {
    expect(
      hasPremiumForAppointmentDate(
        { plan: "premium", source: "subscription" },
        "31/12/2027",
      ),
    ).toBe(true);
  });

  it("mantém as regras do Gratuito quando não há Premium", () => {
    expect(
      hasPremiumForAppointmentDate(
        { plan: "free", source: "manual" },
        "01/08/2026",
      ),
    ).toBe(false);
  });
});
