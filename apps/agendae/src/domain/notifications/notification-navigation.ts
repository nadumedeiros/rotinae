import type { AuthPort } from "@/src/domain/auth/auth-port";
import type { UserRole } from "@/src/domain/auth/types";
import type { NotificationDestination } from "./types";

const destinationRoles: Partial<Record<NotificationDestination, UserRole>> = {
  "/agenda": "provider",
  "/clients": "provider",
  "/payments": "provider",
  "/client-booking": "client",
  "/client-providers": "client",
};

export function notificationDestinationRole(
  destination: NotificationDestination,
): UserRole | null {
  return destinationRoles[destination] ?? null;
}

/** Garante o contexto de papel antes de abrir uma rota vinda da inbox/push. */
export async function prepareNotificationNavigation(
  auth: Pick<AuthPort, "getSession" | "switchRole">,
  destination: NotificationDestination,
): Promise<UserRole | null> {
  const session = await auth.getSession();
  if (!session) throw new Error("Sua sessão expirou. Entre novamente.");

  const requiredRole = notificationDestinationRole(destination);
  if (!requiredRole || session.user.activeRole === requiredRole) {
    return session.user.activeRole;
  }
  if (!session.user.roles.includes(requiredRole)) {
    throw new Error("O perfil necessário para abrir esta notificação não está disponível.");
  }
  const switched = await auth.switchRole({ role: requiredRole });
  return switched.user.activeRole;
}
