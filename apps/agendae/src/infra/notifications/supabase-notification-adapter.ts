import type { NotificationPort } from "@/src/domain/notifications/notification-port";
import { NotificationError, type NotificationPage, type NotificationRecord } from "@/src/domain/notifications/types";
import { supabase } from "@/src/infra/supabase/client";

// Cursor "notificações limpas" (RN: sobreviver a logout/login e troca de
// dispositivo — migration 20260818090000_notifications_persisted_clear_state.sql).
// Antes vivia em SecureStore/localStorage por aparelho; por isso itens
// limpos reapareciam ao entrar novamente ou em outro aparelho/instalação.
// Agora é lido da tabela `notification_clears`, com RLS restringindo cada
// usuário à própria linha — não é preciso filtrar por user_id aqui.
async function getClearedAt(): Promise<string | null> {
  const { data, error } = await supabase
    .from("notification_clears")
    .select("cleared_at")
    .maybeSingle();
  // Falha ao ler o cursor é tratada como "nunca limpou": preferimos exibir
  // notificações antigas de novo a escondê-las por engano numa falha
  // transitória de rede/sessão.
  if (error) return null;
  return (data as { cleared_at: string } | null)?.cleared_at ?? null;
}

type NotificationRow = {
  id: string;
  type: NotificationRecord["type"];
  title: string;
  description: string;
  destination: NotificationRecord["destination"];
  read_at: string | null;
  created_at: string;
};

const toRecord = (row: NotificationRow): NotificationRecord => ({
  id: row.id,
  type: row.type,
  title: row.title,
  description: row.description,
  destination: row.destination,
  readAt: row.read_at,
  createdAt: row.created_at,
});

function mapError(error: { message?: string; code?: string }): NotificationError {
  const message = error.message?.toLowerCase() ?? "";
  if (error.code === "42501") return new NotificationError("FORBIDDEN", "Você não tem permissão para esta ação.");
  if (message.includes("jwt") || message.includes("session")) return new NotificationError("SESSION_EXPIRED", "Sua sessão expirou. Entre novamente.");
  if (message.includes("fetch") || message.includes("network")) return new NotificationError("NETWORK_ERROR", "Falha de conexão. Verifique sua internet.");
  return new NotificationError("UNKNOWN", "Não foi possível sincronizar as notificações.");
}

export class SupabaseNotificationAdapter implements NotificationPort {
  async listNotifications(input: { page: number; pageSize: 10 }): Promise<NotificationPage> {
    const clearedAt = await getClearedAt();
    const page = Math.max(1, input.page);
    const from = (page - 1) * input.pageSize;

    let query = supabase
      .from("notifications")
      .select("id, type, title, description, destination, read_at, created_at", { count: "exact" })
      .order("created_at", { ascending: false });

    let unreadQuery = supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);

    if (clearedAt) {
      query = query.gt("created_at", clearedAt);
      unreadQuery = unreadQuery.gt("created_at", clearedAt);
    }

    const [pageResult, unreadResult] = await Promise.all([
      query.range(from, from + input.pageSize - 1),
      unreadQuery,
    ]);

    if (pageResult.error) throw mapError(pageResult.error);
    if (unreadResult.error) throw mapError(unreadResult.error);
    const totalItems = pageResult.count ?? 0;
    return {
      items: ((pageResult.data ?? []) as NotificationRow[]).map(toRecord),
      page,
      pageSize: 10,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / 10)),
      unreadCount: unreadResult.count ?? 0,
    };
  }

  async markAsRead(id: string): Promise<void> {
    const { data, error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).select("id").maybeSingle();
    if (error) throw mapError(error);
    if (!data) throw new NotificationError("NOTIFICATION_NOT_FOUND", "Notificação não encontrada.");
  }

  async markAllAsRead(): Promise<void> {
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    if (error) throw mapError(error);
  }

  async clearNotifications(): Promise<void> {
    // RPC `clear_notifications` marca as pendentes como lidas e grava o novo
    // cursor `cleared_at` na mesma transação no backend (ver migration
    // 20260818090000_notifications_persisted_clear_state.sql), então não há
    // mais uma etapa local separada e sujeita a falhar sem persistir nada.
    const { error } = await supabase.rpc("clear_notifications");
    if (error) throw mapError(error);
  }
}

export const notificationService: NotificationPort = new SupabaseNotificationAdapter();
