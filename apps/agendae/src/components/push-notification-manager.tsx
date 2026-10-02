import { router } from "expo-router";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";

import type { PushNotificationData } from "@/src/domain/notifications/push-notification-data";
import { prepareNotificationNavigation } from "@/src/domain/notifications/notification-navigation";
import { supabaseAuthService } from "@/src/infra/auth/supabase-auth-adapter";
import { notificationService } from "@/src/infra/notifications/supabase-notification-adapter";
import { pushRegistrationService } from "@/src/infra/notifications/push-registration";
import { supabase } from "@/src/infra/supabase/client";

export function PushNotificationManager() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    let active = true;
    let pendingResponse: PushNotificationData | null = null;

    const openNotification = async (data: PushNotificationData) => {
      const { data: authData } = await supabase.auth.getSession();
      if (!active) return;
      if (!authData.session) {
        pendingResponse = data;
        return;
      }
      if (authData.session.user.id !== data.recipientUserId) {
        pendingResponse = null;
        return;
      }
      try {
        await prepareNotificationNavigation(supabaseAuthService, data.destination);
      } catch {
        // Papel ausente ou sessão inválida: não abre uma superfície incompatível.
        return;
      }
      try {
        await notificationService.markAsRead(data.notificationId);
      } catch {
        // A leitura pode já ter sido registrada; isso não invalida o destino.
      }
      if (active) router.push(data.destination);
      pendingResponse = null;
    };

    const sync = (requestPermission: boolean) => {
      void pushRegistrationService.sync({ requestPermission }).catch(() => undefined);
    };

    const removeResponseListener = pushRegistrationService.subscribeToResponses((data) => {
      void openNotification(data);
    });
    void pushRegistrationService
      .consumeLastResponse()
      .then((data) => {
        if (data) void openNotification(data);
      })
      .catch(() => undefined);

    sync(true);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") sync(false);
    });
    const { data: authSubscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        setTimeout(() => sync(true), 0);
        if (pendingResponse) setTimeout(() => void openNotification(pendingResponse!), 0);
      }
    });

    return () => {
      active = false;
      removeResponseListener();
      appStateSubscription.remove();
      authSubscription.subscription.unsubscribe();
    };
  }, []);

  return null;
}
