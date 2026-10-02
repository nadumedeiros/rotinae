import { supabase } from "@/src/infra/supabase/client";

export type UserPlan = "free" | "premium";

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  profile: "Cliente" | "Prestador" | "Cliente e prestador";
  plan: UserPlan;
  status: "Ativo" | "Inativo";
  createdAt: string;
  lastAccess: string;
  termsAccepted: boolean;
  termsAcceptedAt?: string;
  termsVersion?: string;
  privacyVersion?: string;
  consentSource?: "web" | "android" | "ios";
};

export class AdminError extends Error {
  constructor(
    public readonly code: "FORBIDDEN" | "UNAUTHORIZED" | "NETWORK_ERROR" | "UNKNOWN",
    message: string,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

export interface AdminUsersPort {
  listUsers(): Promise<ManagedUser[]>;
  updateUserPlan(userId: string, plan: UserPlan): Promise<void>;
}

export class SupabaseAdminAdapter implements AdminUsersPort {
  async listUsers(): Promise<ManagedUser[]> {
    const { data, error } = await supabase.rpc("get_admin_users");

    if (error) {
      if (error.code === "42501" || error.message?.includes("ADMIN_FORBIDDEN")) {
        throw new AdminError("FORBIDDEN", "Acesso restrito a administradores.");
      }
      if (error.code === "PGRST301" || error.message?.includes("JWT")) {
        throw new AdminError("UNAUTHORIZED", "Sessão expirada. Faça login novamente.");
      }
      throw new AdminError("UNKNOWN", error.message || "Erro ao carregar lista de usuários.");
    }

    if (!Array.isArray(data)) {
      return [];
    }

    return data as ManagedUser[];
  }

  async updateUserPlan(userId: string, plan: UserPlan): Promise<void> {
    const { error } = await supabase.rpc("admin_set_provider_plan", {
      target_user_id: userId,
      target_plan: plan,
    });

    if (error) {
      if (error.code === "42501" || error.message?.includes("ADMIN_FORBIDDEN")) {
        throw new AdminError("FORBIDDEN", "Acesso restrito a administradores.");
      }
      throw new AdminError("UNKNOWN", error.message || "Erro ao atualizar plano do usuário.");
    }
  }
}

export const adminUsersService = new SupabaseAdminAdapter();
