import { isBlockedForRequester } from "../availability-rules";
import type { AvailabilityBlock } from "../types";

const block: AvailabilityBlock = {
  id: "block-1",
  tenantId: "provider-1",
  startsAt: "2026-08-10T12:00:00.000Z",
  endsAt: "2026-08-10T15:00:00.000Z",
  timezone: "America/Sao_Paulo",
  reason: "Compromisso pessoal",
  createdAt: "2026-08-04T12:00:00.000Z",
};

describe("availability block rules", () => {
  it("blocks a new client request that overlaps the period", () => {
    expect(isBlockedForRequester({ requestedBy: "client", startsAt: "2026-08-10T13:00:00.000Z", endsAt: "2026-08-10T14:00:00.000Z", blocks: [block] })).toBe(true);
  });

  it("allows the provider to add an appointment inside the blocked period", () => {
    expect(isBlockedForRequester({ requestedBy: "provider", startsAt: "2026-08-10T13:00:00.000Z", endsAt: "2026-08-10T14:00:00.000Z", blocks: [block] })).toBe(false);
  });

  it("does not affect appointments outside the blocked period", () => {
    expect(isBlockedForRequester({ requestedBy: "client", startsAt: "2026-08-10T16:00:00.000Z", endsAt: "2026-08-10T17:00:00.000Z", blocks: [block] })).toBe(false);
  });
});
