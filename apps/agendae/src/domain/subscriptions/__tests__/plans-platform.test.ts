import { getPlansLayout } from "../plans-platform";

describe("plans platform layout", () => {
  it("preserves the wide Web comparison layout", () => {
    expect(getPlansLayout("web", true)).toEqual({
      native: false,
      sideBySide: true,
      order: ["free", "premium"],
    });
  });

  it("keeps narrow Web in its compact premium-first layout", () => {
    expect(getPlansLayout("web", false)).toEqual({
      native: false,
      sideBySide: false,
      order: ["premium", "free"],
    });
  });

  it.each(["android", "ios"])(
    "uses a stacked, premium-first app layout on %s regardless of width",
    (platform) => {
      expect(getPlansLayout(platform, true)).toEqual({
        native: true,
        sideBySide: false,
        order: ["premium", "free"],
      });
    },
  );
});
