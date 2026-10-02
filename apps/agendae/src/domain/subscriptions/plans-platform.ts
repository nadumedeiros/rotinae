export type PlanId = "free" | "premium";

export function getPlansLayout(platform: string, wide: boolean) {
  const native = platform !== "web";
  return {
    native,
    sideBySide: !native && wide,
    order: (wide && !native
      ? ["free", "premium"]
      : ["premium", "free"]) as PlanId[],
  };
}
