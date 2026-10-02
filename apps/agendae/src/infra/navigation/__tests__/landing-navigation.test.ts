import { router } from "expo-router";
import { Platform } from "react-native";

import { navigateFromLanding } from "../landing-navigation";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

describe("landing navigation", () => {
  const originalPlatform = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: originalPlatform });
    jest.clearAllMocks();
  });

  it("preloads the web runtime and completes the first navigation", async () => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "web" });
    const loadRuntime = jest.fn().mockResolvedValue(undefined);

    await navigateFromLanding("/login", loadRuntime);

    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/login");
    expect(loadRuntime.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(router.push).mock.invocationCallOrder[0],
    );
  });
});
