import type { NotificationPage } from "./types";
export interface NotificationPort {
  listNotifications(input: {
    page: number;
    pageSize: 10;
  }): Promise<NotificationPage>;
  markAsRead(id: string): Promise<void>;
  markAllAsRead(): Promise<void>;
  clearNotifications(): Promise<void>;
}
