export type NotificationDestination =
  | "/agenda"
  | "/clients"
  | "/client-booking"
  | "/client-providers"
  | "/payments"
  | "/settings"
  | "/switch-profile";
export type NotificationRecord = {
  id: string;
  type: "appointment" | "link" | "payment" | "account";
  title: string;
  description: string;
  destination: NotificationDestination;
  readAt: string | null;
  createdAt: string;
};
export type NotificationPage = {
  items: NotificationRecord[];
  page: number;
  pageSize: 10;
  totalItems: number;
  totalPages: number;
  unreadCount: number;
};
export type NotificationErrorCode =
  | "NOTIFICATION_NOT_FOUND"
  | "FORBIDDEN"
  | "SESSION_EXPIRED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export class NotificationError extends Error {
  constructor(
    public readonly code: NotificationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NotificationError";
  }
}
