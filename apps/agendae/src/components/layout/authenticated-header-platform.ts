export type AuthenticatedHeaderSurface =
  | "web-dropdown"
  | "native-fullscreen";

export function getAuthenticatedHeaderSurface(
  platform: string,
): AuthenticatedHeaderSurface {
  return platform === "web" ? "web-dropdown" : "native-fullscreen";
}

export const nativeOverlayPresentation = "fullScreen" as const;
