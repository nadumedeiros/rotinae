import type { DashboardSnapshot } from './types';

/** Dados agregados da Home; usuário e tenant são derivados da sessão no servidor. */
export interface DashboardPort {
  getSnapshot(input?: { date?: string }): Promise<DashboardSnapshot>;
  markNotificationRead(notificationId: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
}
