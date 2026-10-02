import type { AppointmentRequester, AvailabilityBlock } from "./types";

type BlockEvaluationInput = {
  requestedBy: AppointmentRequester;
  startsAt: string;
  endsAt: string;
  blocks: AvailabilityBlock[];
};

export function isBlockedForRequester({
  requestedBy,
  startsAt,
  endsAt,
  blocks,
}: BlockEvaluationInput): boolean {
  if (requestedBy === "provider") return false;

  const appointmentStart = Date.parse(startsAt);
  const appointmentEnd = Date.parse(endsAt);
  if (!Number.isFinite(appointmentStart) || !Number.isFinite(appointmentEnd)) {
    return false;
  }

  return blocks.some((block) => {
    const blockStart = Date.parse(block.startsAt);
    const blockEnd = Date.parse(block.endsAt);
    return appointmentStart < blockEnd && appointmentEnd > blockStart;
  });
}
