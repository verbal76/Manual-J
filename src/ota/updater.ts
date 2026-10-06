import { decide, parseManifest, type OtaContext, type OtaManifest, type RejectReason } from './manifest';

export interface OtaAdapter {
  fetchManifest(url: string): Promise<unknown>;
  /** Download + stage a payload. Returns the id and the SHA-256 the platform computed over the downloaded zip. */
  download(m: OtaManifest): Promise<{ bundleId: string; checksum: string }>;
  deleteBundle(bundleId: string): Promise<void>;
  /** Switch to the bundle; on success the page reloads and this promise never settles. */
  activate(bundleId: string): Promise<void>;
  notifyReady(): Promise<void>;
}
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export type OtaState =
  | { kind: 'disabled'; why: string } | { kind: 'idle' } | { kind: 'checking' } | { kind: 'current' }
  | { kind: 'downloading'; id: string } | { kind: 'staged'; manifest: OtaManifest; bundleId: string }
  | { kind: 'applying'; id: string } | { kind: 'failed'; error: string } | { kind: 'rejected'; reason: RejectReason };

interface Persisted { lastCheckAt: number; lastResult: string; badSeqs: number[]; pending: { seq: number; id: string; at: number } | null; lastApplied: { id: string; name: string; at: number } | null }
const KEY = 'manualj:ota:v1';

export class OtaUpdater {
  state: OtaState;
  private p: Persisted;
  private listeners: ((s: OtaState) => void)[] = [];
  private busy = false;
  constructor(
    private adapter: OtaAdapter,
    private ctx: Omit<OtaContext, 'badSeqs'> & { runningId: string },
    private opts: { manifestUrl: string; store: KV; now: () => number; minIntervalMs: number; activateTimeoutMs: number },
  ) {
    this.p = this.load();
    this.state = opts.manifestUrl ? { kind: 'idle' } : { kind: 'disabled', why: 'no update server configured in this build' };
    this.reconcilePendingActivation();
  }
  get lastResult() { return this.p.lastResult; }
  get lastCheckAt() { return this.p.lastCheckAt; }
  get lastApplied() { return this.p.lastApplied; }
  onChange(fn: (s: OtaState) => void) { this.listeners.push(fn); }
  private set(s: OtaState) { this.state = s; this.listeners.forEach(f => f(s)); }
  private load(): Persisted {
    try { const v = JSON.parse(this.opts.store.getItem(KEY) ?? 'null'); if (v && typeof v === 'object') return { lastCheckAt: 0, lastResult: 'never checked', badSeqs: [], pending: null, lastApplied: null, ...v }; } catch { /* corrupt: start clean */ }
    return { lastCheckAt: 0, lastResult: 'never checked', badSeqs: [], pending: null, lastApplied: null };
  }
  private save() { try { this.opts.store.setItem(KEY, JSON.stringify(this.p)); } catch { /* storage unavailable: updater still works for this session */ } }

  /** On startup: did the last activation survive? If the running bundle isn't the one we switched to, the platform rolled back. */
  private reconcilePendingActivation() {
    const pend = this.p.pending; if (!pend) return;
    if (this.ctx.currentSeq === pend.seq) { this.p.lastApplied = { id: pend.id, name: pend.id, at: pend.at }; this.p.lastResult = 'applied OK'; }
    else { if (!this.p.badSeqs.includes(pend.seq)) this.p.badSeqs.push(pend.seq); this.p.lastResult = `ROLLED BACK: OTA #${pend.seq} did not start; staying on previous version`; }
    this.p.pending = null; this.save();
  }

  /** Check, and download/stage if a compatible newer OTA exists. Never throws; never needed for the app to work. */
  async check(opts: { force?: boolean } = {}): Promise<void> {
    if (this.state.kind === 'disabled' || this.busy) return;
    if (this.state.kind === 'staged' || this.state.kind === 'applying') return;
    const now = this.opts.now();
    if (!opts.force && now - this.p.lastCheckAt < this.opts.minIntervalMs) return;
    this.busy = true; this.set({ kind: 'checking' });
    this.p.lastCheckAt = now;
    try {
      let raw: unknown;
      try { raw = await this.adapter.fetchManifest(this.opts.manifestUrl); }
      catch (e) { return this.fail('update server unreachable', e); }
      const parsed = parseManifest(raw);
      if (!parsed.ok) return this.fail(`bad manifest (${parsed.error})`);
      const d = decide(parsed.manifest, { ...this.ctx, badSeqs: this.p.badSeqs });
      if (d.action === 'none') { this.p.lastResult = d.reason === 'current' ? 'up to date' : 'server offers an older OTA; ignored'; this.save(); return this.set({ kind: 'current' }); }
      if (d.action === 'reject') { this.p.lastResult = `OTA refused: ${d.reason}`; this.save(); return this.set({ kind: 'rejected', reason: d.reason }); }
      const m = d.manifest; this.set({ kind: 'downloading', id: m.id });
      let got: { bundleId: string; checksum: string };
      try { got = await this.adapter.download(m); } catch (e) { return this.fail('download failed', e); }
      if (!got.checksum || got.checksum.toLowerCase() !== m.sha256.toLowerCase()) {
        await this.adapter.deleteBundle(got.bundleId).catch(() => undefined);
        if (!this.p.badSeqs.includes(m.seq)) this.p.badSeqs.push(m.seq);
        return this.fail('integrity check failed; payload discarded');
      }
      this.p.lastResult = `OTA #${m.seq} "${m.name}" downloaded and verified; waiting for a safe moment`; this.save();
      this.set({ kind: 'staged', manifest: m, bundleId: got.bundleId });
    } finally { this.busy = false; }
  }
  private fail(msg: string, e?: unknown) {
    this.p.lastResult = `check failed: ${msg}${e instanceof Error ? ` (${e.message})` : ''}`; this.save();
    this.set({ kind: 'failed', error: msg });
  }

  /** Call only at a moment where reloading cannot lose work. Returns true if activation was started. */
  async activateIfStaged(): Promise<boolean> {
    const s = this.state; if (s.kind !== 'staged') return false;
    this.set({ kind: 'applying', id: s.manifest.id });
    this.p.pending = { seq: s.manifest.seq, id: s.manifest.id, at: this.opts.now() };
    this.p.lastResult = `applying OTA #${s.manifest.seq}`; this.save();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watchdog = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('activation timed out')), this.opts.activateTimeoutMs); });
    const giveUp = async (e: unknown) => {
      // Activation failed without reloading: stay on the known-good bundle and don't retry this payload.
      if (!this.p.badSeqs.includes(s.manifest.seq)) this.p.badSeqs.push(s.manifest.seq);
      this.p.pending = null; await this.adapter.deleteBundle(s.bundleId).catch(() => undefined);
      this.fail('could not apply update; previous version kept', e);
    };
    try { await Promise.race([this.adapter.activate(s.bundleId), watchdog]); }
    catch (e) { await giveUp(e); return false; }
    finally { clearTimeout(timer); }
    // If activate() resolved but the page is still alive after the timeout, the reload never happened: don't stay stuck on the overlay.
    setTimeout(() => { if (this.state.kind === 'applying') void giveUp(new Error('page did not reload after activation')); }, this.opts.activateTimeoutMs);
    return true;
  }

  /** The running bundle calls this once its UI is up; the platform rolls back if it never does. */
  async confirmStarted(): Promise<void> { try { await this.adapter.notifyReady(); } catch { /* web / no plugin */ } }
}
