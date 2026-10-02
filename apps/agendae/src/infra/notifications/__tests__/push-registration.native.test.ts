/* eslint-disable import/first */
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { eas: { projectId: "project-id" } } },
    easConfig: null,
  },
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "11111111-1111-4111-8111-111111111111" }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  unregisterForNotificationsAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(),
}));
jest.mock("@/src/infra/supabase/client", () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/src/infra/supabase/client";
import { pushRegistrationService } from "../push-registration.native";

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;
const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
const mockGetPermissionsAsync = Notifications.getPermissionsAsync as jest.Mock;
const mockRequestPermissionsAsync = Notifications.requestPermissionsAsync as jest.Mock;
const mockGetExpoPushTokenAsync = Notifications.getExpoPushTokenAsync as jest.Mock;
const mockUnregisterForNotificationsAsync = Notifications.unregisterForNotificationsAsync as jest.Mock;
const mockSetNotificationChannelAsync = Notifications.setNotificationChannelAsync as jest.Mock;
const mockMaybeSingle = jest.fn();

describe("pushRegistrationService nativo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ maybeSingle: mockMaybeSingle })),
      })),
    });
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    mockMaybeSingle.mockResolvedValue({ data: { push_notifications: true }, error: null });
    mockGetItemAsync.mockResolvedValue(null);
    mockSetItemAsync.mockResolvedValue(undefined);
    mockGetPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockRequestPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: "ExpoPushToken[token-1]" });
    mockUnregisterForNotificationsAsync.mockResolvedValue(undefined);
    mockSetNotificationChannelAsync.mockResolvedValue(null);
    mockRpc.mockResolvedValue({ error: null });
  });

  it("registra token e instalação para a sessão atual", async () => {
    await expect(
      pushRegistrationService.sync({ requestPermission: true }),
    ).resolves.toEqual({ status: "registered" });

    expect(mockRpc).toHaveBeenCalledWith("register_push_device", {
      p_installation_id: "11111111-1111-4111-8111-111111111111",
      p_expo_push_token: "ExpoPushToken[token-1]",
      p_platform: expect.stringMatching(/^(android|ios)$/),
      p_project_id: "project-id",
    });
  });

  it("não solicita token quando a permissão foi negada", async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: "denied" });

    await expect(
      pushRegistrationService.sync({ requestPermission: true }),
    ).resolves.toMatchObject({ status: "denied" });
    expect(mockGetExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("desativa a instalação quando a preferência foi desligada", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { push_notifications: false }, error: null });
    mockGetItemAsync.mockResolvedValue("11111111-1111-4111-8111-111111111111");

    await expect(
      pushRegistrationService.sync({ requestPermission: false }),
    ).resolves.toEqual({ status: "disabled" });
    expect(mockRpc).toHaveBeenCalledWith("unregister_push_device", {
      p_installation_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(mockUnregisterForNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  it("revoga o registro nativo mesmo sem sessão ativa", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    await expect(pushRegistrationService.unregisterCurrentDevice()).resolves.toBeUndefined();

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockUnregisterForNotificationsAsync).toHaveBeenCalledTimes(1);
  });
});
