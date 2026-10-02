import type { PushNotificationData } from "@/src/domain/notifications/push-notification-data";

export type PushRegistrationStatus =
  | "registered"
  | "disabled"
  | "denied"
  | "unavailable";
export type PushRegistrationResult = {
  status: PushRegistrationStatus;
  message?: string;
};
export interface PushRegistrationService {
  sync(input: { requestPermission: boolean }): Promise<PushRegistrationResult>;
  unregisterCurrentDevice(): Promise<void>;
  subscribeToResponses(listener: (data: PushNotificationData) => void): () => void;
  subscribeToReceived(listener: () => void): () => void;
  consumeLastResponse(): Promise<PushNotificationData | null>;
}

export const pushRegistrationService: PushRegistrationService = {
  async sync() {
    return { status: "unavailable" };
  },
  async unregisterCurrentDevice() {},
  subscribeToResponses() {
    return () => undefined;
  },
  subscribeToReceived() {
    return () => undefined;
  },
  async consumeLastResponse() {
    return null;
  },
};
