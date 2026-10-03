/** Channel pointer / OTA manifest: parsing and the pure accept/reject decision. No I/O here. */
export interface OtaManifest {
  schema: 1; channel: string; id: string; name: string; seq: number; sourceSha: string; publishedAt: string;
  minRuntime: number; minVersionCode: number; projectSchema: number; url: string; sha256: string; size?: number;
}
export interface OtaContext {
  channel: string; runtime: number; versionCode: number | null; currentSeq: number; projectSchema: number; badSeqs: number[];
}
export type RejectReason = 'wrong-channel' | 'runtime-incompatible' | 'native-too-old' | 'schema-downgrade' | 'previously-failed';
export type Decision =
  | { action: 'none'; reason: 'current' | 'older' }
  | { action: 'reject'; reason: RejectReason }
  | { action: 'update'; manifest: OtaManifest };

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const str = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length < 2000;

export function parseManifest(raw: unknown): { ok: true; manifest: OtaManifest } | { ok: false; error: string } {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m !== 'object') return { ok: false, error: 'not an object' };
  if (m.schema !== 1) return { ok: false, error: 'unsupported manifest schema' };
  if (!str(m.channel) || !str(m.id) || !str(m.name) || !str(m.sourceSha) || !str(m.publishedAt)) return { ok: false, error: 'missing text field' };
  if (!isInt(m.seq) || m.seq < 1) return { ok: false, error: 'bad seq' };
  if (!isInt(m.minRuntime) || !isInt(m.minVersionCode) || !isInt(m.projectSchema)) return { ok: false, error: 'bad compatibility field' };
  if (!str(m.url) || !/^https:\/\//i.test(m.url)) return { ok: false, error: 'url must be https' };
  if (!str(m.sha256) || !/^[0-9a-f]{64}$/i.test(m.sha256)) return { ok: false, error: 'bad sha256' };
  if (m.size !== undefined && !isInt(m.size)) return { ok: false, error: 'bad size' };
  return { ok: true, manifest: m as unknown as OtaManifest };
}

/** Order matters: compatibility is checked before recency so an incompatible payload is never "newer enough". */
export function decide(m: OtaManifest, c: OtaContext): Decision {
  if (m.channel !== c.channel) return { action: 'reject', reason: 'wrong-channel' };
  if (m.minRuntime > c.runtime) return { action: 'reject', reason: 'runtime-incompatible' };
  if (c.versionCode !== null && m.minVersionCode > c.versionCode) return { action: 'reject', reason: 'native-too-old' };
  if (m.projectSchema < c.projectSchema) return { action: 'reject', reason: 'schema-downgrade' };
  if (m.seq <= c.currentSeq) return { action: 'none', reason: m.seq === c.currentSeq ? 'current' : 'older' };
  if (c.badSeqs.includes(m.seq)) return { action: 'reject', reason: 'previously-failed' };
  return { action: 'update', manifest: m };
}
