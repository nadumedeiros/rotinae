import { router } from "expo-router";
import { Platform } from "react-native";

export type LandingAppRoute = "/login" | "/select-profile";
type RuntimeLoader = () => Promise<unknown>;

const loadWebAppRuntime: RuntimeLoader = () => import("@/src/components/web-app-runtime");

export async function navigateFromLanding(
  route: LandingAppRoute,
  loadRuntime: RuntimeLoader = loadWebAppRuntime,
) {
  if (Platform.OS === "web") {
    await loadRuntime();
  }
  router.push(route);
}
