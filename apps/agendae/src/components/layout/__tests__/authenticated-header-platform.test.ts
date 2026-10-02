import {
  getAuthenticatedHeaderSurface,
  nativeOverlayPresentation,
} from "../authenticated-header-platform";

describe("AuthenticatedHeader platform boundaries", () => {
  it("keeps compact dropdowns exclusive to Web", () => {
    expect(getAuthenticatedHeaderSurface("web")).toBe("web-dropdown");
  });

  it.each(["android", "ios"])(
    "uses the dedicated native fullscreen surface on %s",
    (platform) => {
      expect(getAuthenticatedHeaderSurface(platform)).toBe(
        "native-fullscreen",
      );
      expect(nativeOverlayPresentation).toBe("fullScreen");
    },
  );

  it("defaults unknown native targets to the fullscreen contract", () => {
    expect(getAuthenticatedHeaderSurface("native-test")).toBe(
      "native-fullscreen",
    );
  });
});
