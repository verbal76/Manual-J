import { describe, expect, it } from 'vitest';
import { decide, parseManifest, type OtaManifest } from '../src/ota/manifest';
import { OtaUpdater, type OtaAdapter, type KV } from '../src/ota/updater';
import { buildDiagnostics } from '../src/release/diagnostics';
import { PLAY_REQUIRED_TARGET_SDK, playCompliance } from '../src/release/play';
import { calculate } from '../src/engine/calc';
import { buildProject, EXPECTED } from './fixtures/analytic-box-room';

const SHA = 'a'.repeat(64);
const man = (o: Partial<OtaManifest> = {}): OtaManifest => ({ schema: 1, channel: 'internal', id: 'ota-5', name: 'Fix report', seq: 5, sourceSha: 'abc1234', publishedAt: '2026-10-03T00:00:00Z', minRuntime: 1, minVersionCode: 1, projectSchema: 1, url: 'https://x.test/ota-5.zip', sha256: SHA, ...o });
const ctx = { channel: 'internal', runtime: 1, versionCode: 10, currentSeq: 4, projectSchema: 1, runningId: 'ota-4' };
const mem = (): KV & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) }; };
function mk(adapter: Partial<OtaAdapter> = {}, over: Partial<typeof ctx> = {}, store = mem(), url = 'https://x.test/internal.json', t = { now: 1_000_000 }) {
  const calls: string[] = [];
  const a: OtaAdapter = {
    fetchManifest: async () => man(), download: async m => (calls.push('download'), { bundleId: 'b5', checksum: m.sha256 }),
    deleteBundle: async id => void calls.push('delete:' + id), activate: async id => void calls.push('activate:' + id), notifyReady: async () => void calls.push('ready'), ...adapter,
  };
  const u = new OtaUpdater(a, { ...ctx, ...over }, { manifestUrl: url, store, now: () => t.now, minIntervalMs: 60_000, activateTimeoutMs: 50 });
  return { u, calls, store, t };
}

describe('manifest validation', () => {
  it('accepts a good manifest', () => expect(parseManifest(man()).ok).toBe(true));
  it.each([[null], ['x'], [{}], [man({ url: 'http://x.test/a.zip' })], [man({ sha256: 'zz' })], [man({ seq: 0 })], [{ ...man(), schema: 2 }], [{ ...man(), minRuntime: 'a' }]])('rejects malformed %#', bad =>
    expect(parseManifest(bad).ok).toBe(false));
});

describe('update decision', () => {
  const d = (m: Partial<OtaManifest>, c: Partial<typeof ctx & { badSeqs: number[] }> = {}) => decide(man(m), { ...ctx, badSeqs: [], ...c });
  it('newer compatible -> update', () => expect(d({}).action).toBe('update'));
  it('same seq -> none/current; older -> none/older', () => { expect(d({ seq: 4 })).toEqual({ action: 'none', reason: 'current' }); expect(d({ seq: 3 })).toEqual({ action: 'none', reason: 'older' }); });
  it('wrong channel / runtime / native too old / schema downgrade are refused', () => {
    expect(d({ channel: 'production' })).toEqual({ action: 'reject', reason: 'wrong-channel' });
    expect(d({ minRuntime: 2 })).toEqual({ action: 'reject', reason: 'runtime-incompatible' });
    expect(d({ minVersionCode: 11 })).toEqual({ action: 'reject', reason: 'native-too-old' });
    expect(d({ projectSchema: 0 })).toEqual({ action: 'reject', reason: 'schema-downgrade' });
  });
  it('native-required change presented as OTA is refused even when newer', () => expect(d({ seq: 99, minRuntime: 2 }).action).toBe('reject'));
  it('previously failed OTA is not retried', () => expect(d({}, { badSeqs: [5] })).toEqual({ action: 'reject', reason: 'previously-failed' }));
});

describe('updater state machine', () => {
  it('disabled when no server configured: never touches the network', async () => {
    let hit = false; const { u } = mk({ fetchManifest: async () => { hit = true; return man(); } }, {}, mem(), '');
    await u.check(); expect(u.state.kind).toBe('disabled'); expect(hit).toBe(false);
  });
  it('offline / server error -> failed state, no throw, app unaffected', async () => {
    const { u } = mk({ fetchManifest: async () => { throw new Error('offline'); } }); await u.check();
    expect(u.state.kind).toBe('failed'); expect(u.lastResult).toContain('unreachable');
  });
  it('malformed manifest -> failed, nothing downloaded', async () => {
    const { u, calls } = mk({ fetchManifest: async () => ({ junk: 1 }) }); await u.check(); expect(u.state.kind).toBe('failed'); expect(calls).toEqual([]);
  });
  it('no update -> current', async () => { const { u } = mk({ fetchManifest: async () => man({ seq: 4 }) }); await u.check(); expect(u.state.kind).toBe('current'); });
  it('compatible update -> downloaded, verified, staged (not applied)', async () => {
    const { u, calls } = mk(); await u.check(); expect(u.state.kind).toBe('staged'); expect(calls).toEqual(['download']);
  });
  it('incompatible runtime -> rejected, no download', async () => {
    const { u, calls } = mk({ fetchManifest: async () => man({ minRuntime: 2 }) }); await u.check(); expect(u.state).toEqual({ kind: 'rejected', reason: 'runtime-incompatible' }); expect(calls).toEqual([]);
  });
  it('hash mismatch / corrupt / empty checksum -> payload deleted, never staged, never retried', async () => {
    for (const checksum of ['b'.repeat(64), '']) {
      const { u, calls, store } = mk({ download: async () => ({ bundleId: 'b5', checksum }) }); await u.check();
      expect(u.state.kind).toBe('failed'); expect(calls).toContain('delete:b5'); expect(await u.activateIfStaged()).toBe(false); expect(JSON.parse(store.m.get('manualj:ota:v1')!).badSeqs).toContain(5);
    }
  });
  it('interrupted / partial download -> failed, nothing staged', async () => {
    const { u } = mk({ download: async () => { throw new Error('connection reset'); } }); await u.check(); expect(u.state.kind).toBe('failed'); expect(await u.activateIfStaged()).toBe(false);
  });
  it('activation is gated: nothing applies unless activateIfStaged is called; then exactly once', async () => {
    const { u, calls } = mk(); await u.check(); expect(calls).not.toContain('activate:b5');
    const seen: string[] = []; u.onChange(s => seen.push(s.kind));
    const first = u.activateIfStaged(); const second = await u.activateIfStaged(); await first;
    expect(second).toBe(false); expect(calls.filter(c => c.startsWith('activate'))).toHaveLength(1); expect(seen).toContain('applying');
  });
  it('failed activation (throws) -> back to known-good, bundle deleted, not retried, no stuck applying state', async () => {
    const { u, calls } = mk({ activate: async () => { throw new Error('boom'); } }); await u.check();
    expect(await u.activateIfStaged()).toBe(false); expect(u.state.kind).toBe('failed'); expect(calls).toContain('delete:b5');
  });
  it('activation that never reloads is timed out instead of hanging forever', async () => {
    const { u } = mk({ activate: () => new Promise<void>(() => undefined) }); await u.check();
    expect(await u.activateIfStaged()).toBe(false); expect(u.state.kind).toBe('failed');
  });
  it('rollback detected on next start: pending seq != running seq -> marked bad, reported', async () => {
    const store = mem(); const a = mk({}, {}, store); await a.u.check(); void a.u.activateIfStaged(); await new Promise(r => setTimeout(r, 0));
    const restarted = mk({}, { currentSeq: 4 }, store); // old bundle still running = platform rolled back
    expect(restarted.u.lastResult).toContain('ROLLED BACK'); await restarted.u.check({ force: true });
    expect(restarted.u.state).toEqual({ kind: 'rejected', reason: 'previously-failed' });
  });
  it('successful activation detected on next start; repeat startup is quiet', async () => {
    const store = mem(); const a = mk({}, {}, store); await a.u.check(); void a.u.activateIfStaged(); await new Promise(r => setTimeout(r, 0));
    const ok = mk({ fetchManifest: async () => man() }, { currentSeq: 5 }, store); expect(ok.u.lastResult).toBe('applied OK');
    await ok.u.check({ force: true }); expect(ok.u.state.kind).toBe('current'); // duplicate OTA ignored
    const again = mk({}, { currentSeq: 5 }, store); expect(again.u.lastApplied?.id).toBe('ota-5');
  });
  it('older OTA cannot replace a newer one', async () => { const { u } = mk({ fetchManifest: async () => man({ seq: 2 }) }, { currentSeq: 4 }); await u.check(); expect(u.state.kind).toBe('current'); });
  it('startup checks are throttled', async () => {
    let n = 0; const t = { now: 1_000_000 }; const { u } = mk({ fetchManifest: async () => (n++, man({ seq: 4 })) }, {}, mem(), 'https://x.test/i.json', t);
    await u.check(); await u.check(); expect(n).toBe(1); t.now += 61_000; await u.check(); expect(n).toBe(2);
  });
  it('OTA swap does not change engineering results', () => {
    const r = calculate(buildProject()).rooms[0]; expect(r.heating!.btuh).toBeCloseTo(EXPECTED.heating, 6); // engine is part of the bundle; same code => same numbers
  });
});

describe('diagnostics', () => {
  const input = { capturedAt: 'T', native: { platform: 'android', appId: 'com.x', versionName: '0.1.0', versionCode: '7', osVersion: '15', apiLevel: 35, model: 'Pixel', locale: 'en-US' },
    build: { appName: 'Manual J Survey', appVersion: '0.1.0', sourceSha: 'abc', buildType: 'debug', signing: 'DEBUG', minSdk: 23, targetSdk: 35, compileSdk: 35, runtime: 1 },
    ota: { enabled: false, why: 'no server', channel: 'internal', runningFrom: 'EMBEDDED' as const, id: '', name: '', seq: 0, sourceSha: '', published: '', status: 'disabled', lastCheck: 'never', lastResult: 'n/a' }, engine: { version: 'e', projectSchema: 1 } };
  it('answers the identity questions and states Play compliance', () => {
    const t = buildDiagnostics(input);
    for (const s of ['Package ID: com.x', 'Native versionCode: 7', 'Runtime compatibility: 1', 'Channel: internal', 'EMBEDDED', 'targetSdk: 35', 'Play API compliant: NO', 'API 35']) expect(t).toContain(s);
  });
  it('never includes project/personal data fields', () => expect(buildDiagnostics(input)).not.toMatch(/client|address|token|password|secret/i));
  it('play compliance flips at the required API', () => { expect(playCompliance(PLAY_REQUIRED_TARGET_SDK - 1)).toBe('NO'); expect(playCompliance(PLAY_REQUIRED_TARGET_SDK)).toBe('YES'); });
});
