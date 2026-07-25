export function shouldInvalidateCredential(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; apiCode?: unknown; name?: unknown };
  const status = Number(candidate.status);
  const apiCode = Number(candidate.apiCode);
  return candidate.name === "AuthRequiredError" || status === 401 || status === 403 || apiCode === 401 || apiCode === 403;
}
