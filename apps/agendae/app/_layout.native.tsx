import { Stack } from "expo-router";
import {
  Urbanist_400Regular,
  Urbanist_500Medium,
  Urbanist_600SemiBold,
  Urbanist_700Bold,
  useFonts,
} from "@expo-google-fonts/urbanist";
import * as SplashScreen from "expo-splash-screen";
import "react-native-reanimated";

import { DesktopTooltips } from "@/src/components/ui/desktop-tooltips";
import { AppUpdateChecker } from "@/src/components/app-update-checker";
import { PushNotificationManager } from "@/src/components/push-notification-manager";
import { InactivityLogoutGuard } from "@/src/components/inactivity-logout-guard";
import { RouteAccessGuard } from "@/src/components/route-access-guard";

SplashScreen.preventAutoHideAsync();

export default function NativeRootLayout() {
  const [loaded] = useFonts({
    Urbanist_400Regular,
    Urbanist_500Medium,
    Urbanist_600SemiBold,
    Urbanist_700Bold,
  });

  if (!loaded) return null;
  SplashScreen.hideAsync();

  return (
    <InactivityLogoutGuard>
      <AppUpdateChecker />
      <PushNotificationManager />
      <DesktopTooltips />
      <RouteAccessGuard>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="select-profile" />
          <Stack.Screen name="create-account" />
          <Stack.Screen name="confirm-email" />
          <Stack.Screen name="auth/callback" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="change-password" />
          <Stack.Screen name="feedback" />
          <Stack.Screen name="dashboard" />
          <Stack.Screen name="clients" />
          <Stack.Screen name="services" />
          <Stack.Screen name="agenda" />
          <Stack.Screen name="payments" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="manual" />
          <Stack.Screen name="switch-profile" />
          <Stack.Screen name="client-home" />
          <Stack.Screen name="client-providers" />
          <Stack.Screen name="client-booking" />
          <Stack.Screen name="clients/[id]" />
          <Stack.Screen name="payments/[id]" />
          <Stack.Screen name="payments/history" />
        </Stack>
      </RouteAccessGuard>
    </InactivityLogoutGuard>
  );
}
