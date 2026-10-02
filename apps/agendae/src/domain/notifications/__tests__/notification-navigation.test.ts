import type { AuthPort } from "@/src/domain/auth/auth-port";
import type { UserRole } from "@/src/domain/auth/types";
import { notificationDestinationRole, prepareNotificationNavigation } from "../notification-navigation";

const session = (activeRole: UserRole, roles: UserRole[] = ["provider", "client"]) => ({
  accessToken: "token",
  expiresAt: "2099-01-01T00:00:00Z",
  user: { id: "u1", email: "u@example.com", displayName: "Usuário", role: roles[0], roles: [...roles], activeRole },
});

describe("notification navigation", () => {
  it("mapeia somente destinos exclusivos de papel", () => {
    expect(notificationDestinationRole("/agenda")).toBe("provider");
    expect(notificationDestinationRole("/client-booking")).toBe("client");
    expect(notificationDestinationRole("/settings")).toBeNull();
  });

  it("alterna pelo serviço real antes de liberar destino do outro papel", async () => {
    const auth = {
      getSession: jest.fn(async () => session("provider")),
      switchRole: jest.fn(async () => session("client")),
    } as unknown as AuthPort;
    await expect(prepareNotificationNavigation(auth, "/client-providers")).resolves.toBe("client");
    expect(auth.switchRole).toHaveBeenCalledWith({ role: "client" });
  });

  it("bloqueia com mensagem segura quando o papel não existe", async () => {
    const auth = {
      getSession: jest.fn(async () => session("provider", ["provider"])),
      switchRole: jest.fn(),
    } as unknown as AuthPort;
    await expect(prepareNotificationNavigation(auth, "/client-booking")).rejects.toThrow("perfil necessário");
    expect(auth.switchRole).not.toHaveBeenCalled();
  });
});
