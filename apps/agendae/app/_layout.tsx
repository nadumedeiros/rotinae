import {
  Urbanist_400Regular,
  Urbanist_500Medium,
  Urbanist_600SemiBold,
  Urbanist_700Bold,
  useFonts,
} from "@expo-google-fonts/urbanist";
import { Stack, usePathname } from "expo-router";
import { lazy, Suspense } from "react";

const WebAppRuntime = lazy(() => import("@/src/components/web-app-runtime"));

function AppStack() {
  return (
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
  );
}

export default function WebRootLayout() {
  const pathname = usePathname();
  useFonts({
    Urbanist_400Regular,
    Urbanist_500Medium,
    Urbanist_600SemiBold,
    Urbanist_700Bold,
  });

  if (pathname === "/") return <AppStack />;

  return (
    <Suspense fallback={null}>
      <WebAppRuntime>
        <AppStack />
      </WebAppRuntime>
    </Suspense>
  );
}
