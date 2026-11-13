import { sairDaConta } from "@/src/infra/auth/sair-da-conta";
import { supabaseAuthService } from "@/src/infra/auth/supabase-auth-adapter";
import { pushRegistrationService } from "@/src/infra/notifications/push-registration";
import { limparDadosLocais } from "@/src/infra/storage/limpar-dados-locais";

jest.mock("@/src/infra/auth/supabase-auth-adapter", () => ({
  supabaseAuthService: { signOut: jest.fn() },
}));
jest.mock("@/src/infra/notifications/push-registration", () => ({
  pushRegistrationService: { unregisterCurrentDevice: jest.fn() },
}));
jest.mock("@/src/infra/storage/limpar-dados-locais", () => ({
  limparDadosLocais: jest.fn(),
}));

const desligarPush = pushRegistrationService.unregisterCurrentDevice as jest.Mock;
const signOut = supabaseAuthService.signOut as jest.Mock;
const limpar = limparDadosLocais as jest.Mock;

describe("sairDaConta", () => {
  const ordem: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    ordem.length = 0;
    desligarPush.mockImplementation(async () => { ordem.push("push"); });
    signOut.mockImplementation(async () => { ordem.push("signOut"); });
    limpar.mockImplementation(async () => { ordem.push("limpar"); });
  });

  it("desliga o push, sai da conta e limpa o aparelho, nessa ordem", async () => {
    await sairDaConta();
    expect(ordem).toEqual(["push", "signOut", "limpar"]);
  });

  it("continua saindo mesmo se desligar o push falhar", async () => {
    desligarPush.mockRejectedValue(new Error("sem internet"));
    await sairDaConta();
    expect(signOut).toHaveBeenCalled();
    expect(limpar).toHaveBeenCalled();
  });

  it("limpa o aparelho mesmo se o signOut falhar", async () => {
    signOut.mockRejectedValue(new Error("sem internet"));
    await expect(sairDaConta()).rejects.toThrow("sem internet");
    expect(limpar).toHaveBeenCalled();
  });
});
