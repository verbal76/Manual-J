// Small in-memory + localStorage ring buffer of recent runtime errors, shown in About / Copy diagnostics (no stacks, no data).
const KEY = 'manualj:errors:v1'; const MAX = 8;
export interface LoggedError { at: string; where: string; message: string }
const safe = <T>(f: () => T, d: T): T => { try { return f(); } catch { return d; } };
export function recentErrors(): LoggedError[] { return safe(() => { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.slice(-MAX) : []; }, []); }
export function logError(where: string, err: unknown): LoggedError {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
  const e = { at: new Date().toISOString(), where, message };
  safe(() => localStorage.setItem(KEY, JSON.stringify([...recentErrors(), e].slice(-MAX))), undefined);
  return e;
}
export const clearErrors = () => safe(() => localStorage.removeItem(KEY), undefined);
export function formatErrors(xs: LoggedError[]): string[] { return xs.map(x => `${x.at} [${x.where}] ${x.message}`); }
