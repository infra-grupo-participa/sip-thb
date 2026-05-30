// Rate-limit em memória (janela deslizante) — porte de handlers/_shared.ts.
// Por processo: em escala horizontal seria preciso um store compartilhado, mas
// mantém paridade com o as-is (que também era in-process por edge instance).

const _adminRateMap = new Map<string, number[]>();
const ADMIN_RATE_WINDOW_MS = 60_000;
const ADMIN_RATE_MAX = 30;

const _studentWriteRateMap = new Map<string, number[]>();
const STUDENT_WRITE_RATE_WINDOW_MS = 60_000;
const STUDENT_WRITE_RATE_MAX = 60;

export function adminRateLimit(userId: string): boolean {
  const now = Date.now();
  const calls = (_adminRateMap.get(userId) ?? []).filter((t) => now - t < ADMIN_RATE_WINDOW_MS);
  if (calls.length >= ADMIN_RATE_MAX) return false;
  calls.push(now);
  _adminRateMap.set(userId, calls);
  return true;
}

export function studentWriteRateLimit(userId: string): boolean {
  const now = Date.now();
  const calls = (_studentWriteRateMap.get(userId) ?? []).filter((t) => now - t < STUDENT_WRITE_RATE_WINDOW_MS);
  if (calls.length >= STUDENT_WRITE_RATE_MAX) return false;
  calls.push(now);
  _studentWriteRateMap.set(userId, calls);
  return true;
}
