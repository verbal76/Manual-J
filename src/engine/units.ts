// All unit conversion lives here. UI code must not define its own constants.
export const IN_PER_FT = 12;
export const FT_PER_M = 1 / 0.3048;
export const BTUH_PER_W = 3.412141633; // 1 W = 3.412141633 Btu/h (exact definition of IT Btu)
export const BTUH_PER_TON = 12000;     // 1 ton of refrigeration = 12,000 Btu/h by definition
export const GRAINS_PER_LB = 7000;     // by definition of the grain

export const inToFt = (i: number) => i / IN_PER_FT;
export const ftToIn = (f: number) => f * IN_PER_FT;
export const mToFt = (m: number) => m * FT_PER_M;
export const ftToM = (f: number) => f / FT_PER_M;
export const f2ToM2 = (a: number) => a * 0.3048 * 0.3048;
export const fToC = (f: number) => (f - 32) * 5 / 9;
export const cToF = (c: number) => c * 9 / 5 + 32;
export const wToBtuh = (w: number) => w * BTUH_PER_W;
export const btuhToW = (b: number) => b / BTUH_PER_W;
export const btuhToTons = (b: number) => b / BTUH_PER_TON;
export const rToU = (r: number) => 1 / r;
export const uToR = (u: number) => 1 / u;

/** Parse "10'6\"", "10ft 6in", "10-6", "126" (inches if unit='in'), "10.5". Returns feet or null. */
export function parseLength(text: string, bareUnit: 'ft' | 'in' = 'ft'): number | null {
  const s = text.trim().toLowerCase().replace(/feet|foot|ft/g, "'").replace(/inches|inch|in/g, '"');
  if (!s) return null;
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|-|\s)\s*(\d+(?:\.\d+)?)?\s*"?$/);
  if (m && (s.includes("'") || s.includes('-') || /\s/.test(s))) {
    const ft = parseFloat(m[1]); const inch = m[2] ? parseFloat(m[2]) : 0;
    if (inch >= 12) return null;
    return ft + inToFt(inch);
  }
  const bare = s.match(/^(-?\d+(?:\.\d+)?)\s*(["']?)$/);
  if (!bare) return null;
  const n = parseFloat(bare[1]);
  const unit = bare[2] === '"' ? 'in' : bare[2] === "'" ? 'ft' : bareUnit;
  return unit === 'in' ? inToFt(n) : n;
}
export function formatFtIn(ft: number): string {
  const total = Math.round(ft * 12); const f = Math.trunc(total / 12); const i = Math.abs(total % 12);
  return `${f}'${i}"`;
}

/** Strict decimal parser for typed numbers: accepts "12", "12.5", "12,5", "-3", ".5"; rejects "1e3", "0x10", "Infinity", "12abc". */
export function parseNumber(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
