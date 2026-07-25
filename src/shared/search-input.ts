export function parseRequestedPages(value: string): number {
  if (!value.trim()) throw new Error("拉取页数不能为空");
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("拉取页数必须是 1–100 的整数");
  }
  return parsed;
}

export function normalizeRequestedPagesOnBlur(value: string): string {
  if (!value.trim()) return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return String(Math.min(100, Math.max(1, Math.trunc(parsed))));
}
