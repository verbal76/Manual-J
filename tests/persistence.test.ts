import { describe, expect, it } from 'vitest';
import { ProjectLoadError, ProjectStore, migrate, type KV } from '../src/model/persistence';
import { calculate } from '../src/engine/calc';
import { buildProject, EXPECTED } from './fixtures/analytic-box-room';
import { newProject } from '../src/model/factory';

function memKV(opts: { failWrites?: () => boolean; corruptWrites?: boolean } = {}): KV & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, removeItem: k => void m.delete(k), keys: () => [...m.keys()],
    setItem: (k, v) => { if (opts.failWrites?.()) throw new DOMException('quota', 'QuotaExceededError'); m.set(k, opts.corruptWrites ? v + ' ' : v); } };
}

describe('project store', () => {
  it('fresh install: empty list, then first project saves and reloads with identical results', () => {
    const s = new ProjectStore(memKV()); expect(s.list()).toEqual([]);
    const p = buildProject(); s.save(p); expect(s.list().map(x => x.id)).toEqual([p.id]);
    expect(calculate(s.load(p.id)).totals.heating).toBeCloseTo(EXPECTED.heating, 6);
  });
  it('multiple projects: newest first, independent, deletable; deleting one leaves the others', () => {
    const s = new ProjectStore(memKV()); const a = newProject('A'), b = newProject('B'), c = buildProject(); s.save(a); s.save(b); s.save(c);
    expect(s.list()[0].id).toBe(c.id); b.name = 'B renamed'; s.save(b); expect(s.list()[0].name).toBe('B renamed');
    s.remove(a.id); expect(s.list().map(x => x.id).sort()).toEqual([b.id, c.id].sort()); expect(() => s.load(a.id)).toThrow(ProjectLoadError);
    expect(s.load(c.id).name).toBe('Analytic box room');
  });
  it('edit, save, reload, recalculate reflects the edit (no stale results)', () => {
    const s = new ProjectStore(memKV()); const p = buildProject(); s.save(p);
    const q = s.load(p.id); q.assemblies[0].u.value = 0.1; s.save(q);
    const r = calculate(s.load(p.id)).totals.heating!; expect(r).toBeCloseTo(EXPECTED.heating + (136 + 139) * 0.05 * 60, 6);
  });
  it('damaged project JSON: clear error, data untouched, project still listed', () => {
    const kv = memKV(); const s = new ProjectStore(kv); const p = buildProject(); s.save(p);
    kv.m.set(`manualj:project:${p.id}`, '{"id": "broken", '); const before = kv.m.get(`manualj:project:${p.id}`);
    expect(() => s.load(p.id)).toThrowError(/damaged/); expect(kv.m.get(`manualj:project:${p.id}`)).toBe(before); expect(s.list().some(x => x.id === p.id)).toBe(true);
  });
  it('damaged index is rebuilt from the project records (projects never vanish)', () => {
    const kv = memKV(); const s = new ProjectStore(kv); const a = newProject('Keep me'), b = buildProject(); s.save(a); s.save(b);
    kv.m.set('manualj:index', 'not json'); expect(s.list().map(x => x.name).sort()).toEqual(['Analytic box room', 'Keep me']);
    kv.m.set('manualj:index', '{"oops":true}'); expect(s.list().length).toBe(2);
  });
  it('index entries pointing at nothing are tolerated; load says "not found"', () => {
    const kv = memKV(); const s = new ProjectStore(kv); kv.m.set('manualj:index', JSON.stringify([{ id: 'ghost', name: 'Ghost', updatedAt: '' }]));
    expect(() => s.load('ghost')).toThrowError(/not found/);
  });
  it('quota/storage failure: save throws so the UI can tell the user, and previously saved data is intact', () => {
    let fail = false; const kv = memKV({ failWrites: () => fail }); const s = new ProjectStore(kv); const p = buildProject(); s.save(p);
    const saved = kv.m.get(`manualj:project:${p.id}`); fail = true; p.name = 'changed'; expect(() => s.save(p)).toThrow(); expect(kv.m.get(`manualj:project:${p.id}`)).toBe(saved);
  });
  it('storage that silently keeps different data is detected', () => {
    const s = new ProjectStore(memKV({ corruptWrites: true })); expect(() => s.save(buildProject())).toThrowError(/did not keep/);
  });
  it('project data newer than this app is refused and left untouched', () => {
    const kv = memKV(); const s = new ProjectStore(kv); const p = buildProject(); s.save(p);
    const raw = JSON.parse(kv.m.get(`manualj:project:${p.id}`)!); raw.schemaVersion = 99; const txt = JSON.stringify(raw); kv.m.set(`manualj:project:${p.id}`, txt);
    try { s.load(p.id); expect.unreachable(); } catch (e) { expect((e as ProjectLoadError).kind).toBe('too-new'); } expect(kv.m.get(`manualj:project:${p.id}`)).toBe(txt);
  });
});

describe('migration and normalisation', () => {
  it('v0 shape (rooms at top level) migrates to the current schema', () => {
    const v0 = { id: 'a', name: 'old', design: buildProject().design, rooms: JSON.parse(JSON.stringify(buildProject().house.rooms)) };
    const m = migrate(v0); expect(m.schemaVersion).toBe(1); expect(m.house.rooms.length).toBe(1); expect((m as unknown as { rooms?: unknown }).rooms).toBeUndefined();
  });
  it('missing/foreign fields are filled structurally; invalid numbers are kept visible as errors, never "fixed" silently', () => {
    const m = migrate({ id: 'x', name: 5, design: null, house: { rooms: [{ name: 'R', lengthFt: '12', widthFt: null, ceilingHeightFt: 'abc', walls: [{ lengthFt: 10 }, 7, null], ceiling: 'x' }, 'garbage'] }, assemblies: [{ u: { value: '0.05', quality: 'WEIRD' } }, 3] });
    expect(m.name).toBe('Untitled project'); expect(m.house.rooms.length).toBe(1); const r = m.house.rooms[0];
    expect(r.lengthFt).toBe(12); expect(r.widthFt).toBe(0); expect(r.ceilingHeightFt).toBe(0); expect(r.walls.length).toBe(1); expect(r.walls[0].openings).toEqual([]);
    expect(m.assemblies.length).toBe(1); expect(m.assemblies[0].u).toMatchObject({ value: 0.05, quality: 'ESTIMATED' });
    const res = calculate(m); expect(res.rooms[0].issues.some(i => i.code === 'ROOM_DIMS' && i.severity === 'ERROR')).toBe(true); expect(res.totals.heating).toBeNull();
  });
  it('non-object input is rejected as damaged; arrays and primitives too', () => { for (const bad of [null, 5, 'x', [], undefined]) expect(() => migrate(bad as never)).toThrow(ProjectLoadError); });
  it('backs up the original before a structural repair; keeps only the 3 newest backups; no backup for clean loads', () => {
    const kv = memKV(); const s = new ProjectStore(kv); const p = buildProject(); s.save(p); s.load(p.id); expect(s.backups(p.id)).toEqual([]);
    const key = `manualj:project:${p.id}`;
    for (let i = 0; i < 5; i++) { const raw = JSON.parse(kv.m.get(key)!); delete raw.house.rooms[0].floorLevel; kv.m.set(key, JSON.stringify(raw)); s.load(p.id); s.save(s.load(p.id)); }
    expect(s.backups(p.id).length).toBe(3);
    const oldest = kv.m.get(s.backups(p.id)[0])!; expect(JSON.parse(oldest).house.rooms[0].floorLevel).toBeUndefined(); // the pre-repair original
  });
  it('fresh normalisation of a clean project is lossless (round trip equals input except timestamps)', () => {
    const p = buildProject(); const m = migrate(JSON.parse(JSON.stringify(p))); expect({ ...m, updatedAt: 0, createdAt: 0 }).toEqual({ ...p, updatedAt: 0, createdAt: 0 });
  });
});

describe('duplicate project', () => {
  it('copy is fully independent (new ids, remapped constructions) and calculates identically', () => {
    const kv = memKV(); const s = new ProjectStore(kv); const p = buildProject(); s.save(p); const c = s.duplicate(p.id);
    expect(c.id).not.toBe(p.id); expect(c.name).toBe('Analytic box room copy');
    const ids = (x: typeof p) => [...x.assemblies.map(a => a.id), ...x.house.rooms.flatMap(r => [r.id, ...r.walls.flatMap(w => [w.id, ...w.openings.map(o => o.id)])])];
    expect(ids(c).filter(i => ids(p).includes(i))).toEqual([]);
    expect(calculate(c).totals).toEqual(calculate(p).totals);
    c.assemblies[0].u.value = 0.5; s.save(c); expect(calculate(s.load(p.id)).totals.heating).toBeCloseTo(EXPECTED.heating, 6); // original unchanged
  });
});

describe('persistence edge cases found in review', () => {
  it('index write failing on a NEW project leaves no orphan record', () => {
    let n = 0; const kv = memKV({ failWrites: () => false }); const real = kv.setItem; kv.setItem = (k, v) => { if (k === 'manualj:index' && ++n >= 1) throw new DOMException('quota', 'QuotaExceededError'); real(k, v); };
    const s = new ProjectStore(kv); const p = newProject('X'); expect(() => s.save(p)).toThrow(); expect([...kv.m.keys()].filter(k => k.startsWith('manualj:project:'))).toEqual([]);
  });
  it('a record missing from a valid index (half-failed save) is recovered by list()', () => {
    const kv = memKV(); const s = new ProjectStore(kv); const a = newProject('A'), b = newProject('B'); s.save(a); s.save(b);
    kv.m.set('manualj:index', JSON.stringify([{ id: a.id, name: 'A', updatedAt: '' }])); expect(s.list().map(x => x.id).sort()).toEqual([a.id, b.id].sort());
    kv.m.delete(`manualj:project:${a.id}`); expect(s.list().map(x => x.id)).toEqual([b.id]); // ghost entry dropped
  });
  it('deleting a project also deletes its backups', () => {
    const kv = memKV(); const s = new ProjectStore(kv); const p = buildProject(); s.save(p); const key = `manualj:project:${p.id}`;
    const raw = JSON.parse(kv.m.get(key)!); delete raw.house.rooms[0].floorLevel; kv.m.set(key, JSON.stringify(raw)); s.load(p.id); expect(s.backups(p.id).length).toBe(1);
    s.remove(p.id); expect([...kv.m.keys()].filter(k => k.includes(p.id))).toEqual([]);
  });
  it('a structural repair is written back once, so repeated opens do not keep creating backups', () => {
    const kv = memKV(); const s = new ProjectStore(kv); const p = buildProject(); s.save(p); const key = `manualj:project:${p.id}`;
    const raw = JSON.parse(kv.m.get(key)!); delete raw.house.rooms[0].floorLevel; kv.m.set(key, JSON.stringify(raw));
    for (let i = 0; i < 5; i++) s.load(p.id); expect(s.backups(p.id).length).toBe(1); expect(JSON.parse(kv.m.get(key)!).house.rooms[0].floorLevel).toBe(1);
  });
});
