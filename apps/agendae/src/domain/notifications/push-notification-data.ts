import type { NotificationDestination } from "./types";

const destinations: readonly NotificationDestination[] = [
  "/agenda",
  "/clients",
  "/client-booking",
  "/client-providers",
  "/payments",
  "/settings",
  "/switch-profile",
];

export type PushNotificationData = {
  notificationId: string;
  recipientUserId: string;
  destination: NotificationDestination;
};

export function isNotificationDestination(value: unknown): value is NotificationDestination {
  return typeof value === "string" && destinations.includes(value as NotificationDestination);
}

export function parsePushNotificationData(value: unknown): PushNotificationData | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.notificationId !== "string" ||
    candidate.notificationId.length === 0 ||
    typeof candidate.recipientUserId !== "string" ||
    candidate.recipientUserId.length === 0 ||
    !isNotificationDestination(candidate.destination)
  ) {
    return null;
  }
  return {
    notificationId: candidate.notificationId,
    recipientUserId: candidate.recipientUserId,
    destination: candidate.destination,
  };
}
