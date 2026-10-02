export function compareVersions(left: string, right: string): number {
  const normalize = (value: string) =>
    value.trim().replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = normalize(left);
  const b = normalize(right);
  const size = Math.max(a.length, b.length);

  for (let index = 0; index < size; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}
