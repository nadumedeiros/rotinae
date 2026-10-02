import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import {
  parsePushNotificationData,
} from "@/src/domain/notifications/push-notification-data";
import { supabase } from "@/src/infra/supabase/client";
import type {
  PushRegistrationResult,
  PushRegistrationService,
} from "./push-registration";

const INSTALLATION_ID_KEY = "rotinae.push.installation-id";
const CHANNEL_ID = "rotinae-events";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function getInstallationId(): Promise<string> {
  const stored = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
  if (stored) return stored;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(INSTALLATION_ID_KEY, created);
  return created;
}

async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

async function readPushPreference(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("push_notifications")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.push_notifications === true;
}

async function unregisterCurrentDevice(): Promise<void> {
  const userId = await getCurrentUserId();
  const installationId = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
  let unregisterError: unknown = null;

  if (userId && installationId) {
    const { error } = await supabase.rpc("unregister_push_device", {
      p_installation_id: installationId,
    });
    unregisterError = error;
  }

  try {
    await Notifications.unregisterForNotificationsAsync();
  } catch (error) {
    unregisterError ??= error;
  }

  if (unregisterError) throw unregisterError;
}

async function sync(input: { requestPermission: boolean }): Promise<PushRegistrationResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { status: "disabled" };

  const enabled = await readPushPreference(userId);
  if (!enabled) {
    await unregisterCurrentDevice();
    return { status: "disabled" };
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Atualizações do Rotinaê",
      description: "Agendamentos, vínculos, pagamentos e segurança da conta.",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 180, 250],
      lightColor: "#5416FF",
      sound: "default",
    });
  }

  const currentPermission = await Notifications.getPermissionsAsync();
  const permission =
    currentPermission.status === "undetermined" && input.requestPermission
      ? await Notifications.requestPermissionsAsync()
      : currentPermission;
  if (permission.status !== "granted") {
    return {
      status: "denied",
      message:
        permission.status === "denied"
          ? "O celular bloqueou as notificações. Libere o Rotinaê nas configurações do sistema."
          : "A permissão para notificações ainda não foi concedida.",
    };
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    return {
      status: "unavailable",
      message: "O identificador do projeto Expo não está disponível neste aplicativo.",
    };
  }

  try {
    const installationId = await getInstallationId();
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const { error } = await supabase.rpc("register_push_device", {
      p_installation_id: installationId,
      p_expo_push_token: token,
      p_platform: Platform.OS,
      p_project_id: projectId,
    });
    if (error) throw error;
    return { status: "registered" };
  } catch {
    return {
      status: "unavailable",
      message: "Não foi possível registrar este aparelho para receber notificações.",
    };
  }
}

export const pushRegistrationService: PushRegistrationService = {
  sync,
  unregisterCurrentDevice,
  subscribeToResponses(listener) {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = parsePushNotificationData(response.notification.request.content.data);
      if (data) listener(data);
    });
    return () => subscription.remove();
  },
  subscribeToReceived(listener) {
    const subscription = Notifications.addNotificationReceivedListener(() => listener());
    return () => subscription.remove();
  },
  async consumeLastResponse() {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;
    const data = parsePushNotificationData(response.notification.request.content.data);
    await Notifications.clearLastNotificationResponseAsync();
    return data;
  },
};
