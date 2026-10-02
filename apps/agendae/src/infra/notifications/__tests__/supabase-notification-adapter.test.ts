jest.mock("@/src/infra/supabase/client", () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import { supabase } from "@/src/infra/supabase/client";
import { SupabaseNotificationAdapter } from "../supabase-notification-adapter";

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

function builder(result: { data: unknown; error: unknown; count?: number | null }) {
  const value: any = {};
  for (const method of ["select", "order", "range", "is", "update", "eq", "gt"]) value[method] = jest.fn(() => value);
  value.maybeSingle = jest.fn(() => Promise.resolve(result));
  value.then = (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return value;
}

// Toda chamada de `listNotifications` lê primeiro o cursor persistido em
// `notification_clears` (migration 20260818090000) antes de consultar
// `notifications` — por isso os testes que exercitam essa rotina precisam
// encadear esse builder como a primeira resposta de `from`.
function clearedAtBuilder(clearedAt: string | null) {
  return builder({ data: clearedAt ? { cleared_at: clearedAt } : null, error: null });
}

beforeEach(() => jest.clearAllMocks());

describe("SupabaseNotificationAdapter", () => {
  it("lista somente dados retornados pelo Supabase e calcula não lidas", async () => {
    const clearedAtQuery = clearedAtBuilder(null);
    const page = builder({ data: [{ id: "n1", type: "link", title: "Vínculo", description: "Nova solicitação", destination: "/clients", read_at: null, created_at: "2026-08-11T10:00:00Z" }], error: null, count: 1 });
    const unread = builder({ data: null, error: null, count: 1 });
    mockFrom.mockReturnValueOnce(clearedAtQuery).mockReturnValueOnce(page).mockReturnValueOnce(unread);

    const result = await new SupabaseNotificationAdapter().listNotifications({ page: 1, pageSize: 10 });

    expect(result.items[0]).toEqual(expect.objectContaining({ id: "n1", destination: "/clients", readAt: null }));
    expect(result.unreadCount).toBe(1);
  });

  it("filtra pelo cursor persistido de notificações limpas (não reaparecem após novo login)", async () => {
    const clearedAtQuery = clearedAtBuilder("2026-08-15T12:00:00Z");
    const page = builder({ data: [], error: null, count: 0 });
    const unread = builder({ data: null, error: null, count: 0 });
    mockFrom.mockReturnValueOnce(clearedAtQuery).mockReturnValueOnce(page).mockReturnValueOnce(unread);

    await new SupabaseNotificationAdapter().listNotifications({ page: 1, pageSize: 10 });

    expect(page.gt).toHaveBeenCalledWith("created_at", "2026-08-15T12:00:00Z");
    expect(unread.gt).toHaveBeenCalledWith("created_at", "2026-08-15T12:00:00Z");
  });

  it("não informa sucesso quando a notificação não pertence ao usuário", async () => {
    mockFrom.mockReturnValue(builder({ data: null, error: null }));
    await expect(new SupabaseNotificationAdapter().markAsRead("inexistente")).rejects.toMatchObject({ code: "NOTIFICATION_NOT_FOUND" });
  });

  it("limpar notificações chama a RPC que persiste o cursor no backend", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await new SupabaseNotificationAdapter().clearNotifications();

    expect(mockRpc).toHaveBeenCalledWith("clear_notifications");
  });

  it("propaga erro quando a RPC de limpar notificações falha", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "jwt expired" } });

    await expect(new SupabaseNotificationAdapter().clearNotifications()).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });
});
