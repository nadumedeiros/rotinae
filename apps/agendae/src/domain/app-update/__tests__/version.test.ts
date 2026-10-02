import { compareVersions } from "../version";

describe("compareVersions", () => {
  it.each([
    ["1.0.1", "1.0.0", 1],
    ["1.1.0", "1.0.9", 1],
    ["2.0.0", "10.0.0", -1],
    ["v1.0.0", "1.0", 0],
  ])("compara %s com %s", (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected);
  });
});
