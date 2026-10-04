import type { Assembly, Opening, Project, Room, Sourced, Wall } from '../engine/types';
import { SCHEMA_VERSION, newDesign, unknown, uid } from './factory';

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; keys?(): string[] }
const INDEX = 'manualj:index'; const PREFIX = 'manualj:project:'; const BACKUP = 'manualj:backup:';
const KEY = (id: string) => PREFIX + id;

export class ProjectLoadError extends Error { constructor(msg: string, public readonly kind: 'missing' | 'damaged' | 'too-new') { super(msg); } }

// ---- defensive normalisation ------------------------------------------------------------------
// Fixes STRUCTURE only (missing fields, wrong container types). It never "repairs" a user's number into a plausible one:
// an invalid value is kept (or zeroed) so that validation reports it instead of the app silently calculating something else.
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numOr = (v: unknown, d: number): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const strOr = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
const QUALITIES = ['KNOWN', 'SELECTED', 'ESTIMATED', 'DEFAULTED', 'UNKNOWN'];
function sourcedNum(v: unknown): Sourced<number> {
  if (!isObj(v)) return unknown();
  const value = numOrNull(v.value);
  const quality = QUALITIES.includes(v.quality) ? v.quality : value === null ? 'UNKNOWN' : 'ESTIMATED';
  return { value, quality: value === null ? 'UNKNOWN' : quality, ...(typeof v.source === 'string' ? { source: v.source } : {}) };
}
function normOpening(o: unknown): Opening | null {
  if (!isObj(o)) return null;
  return { id: strOr(o.id, uid()), kind: o.kind === 'door' ? 'door' : 'window', quantity: numOr(o.quantity, 1), widthFt: numOr(o.widthFt, 0), heightFt: numOr(o.heightFt, 0),
    assemblyId: typeof o.assemblyId === 'string' ? o.assemblyId : null, shgc: sourcedNum(o.shgc), shading: ['none', 'interior', 'exterior', 'unknown'].includes(o.shading) ? o.shading : 'unknown' };
}
function normWall(w: unknown, i: number): Wall | null {
  if (!isObj(w)) return null;
  const hd = isObj(w.heading) ? w.heading : {}; const ex = isObj(w.exposure) ? w.exposure : {}; const ms = isObj(w.measurement) ? w.measurement : {};
  return {
    id: strOr(w.id, uid()), label: strOr(w.label, `Wall ${i + 1}`),
    heading: { deg: numOrNull(hd.deg), source: ['manual', 'compass', 'derived'].includes(hd.source) ? hd.source : 'manual', confidence: numOrNull(hd.confidence) },
    lengthFt: numOr(w.lengthFt, 0), heightFt: numOr(w.heightFt, 0),
    measurement: { method: ['manual', 'device', 'ar'].includes(ms.method) ? ms.method : 'manual', confirmed: ms.confirmed !== false },
    exposure: { type: ['exterior', 'interior-conditioned', 'unconditioned'].includes(ex.type) ? ex.type : 'exterior', ...(typeof ex.adjacentRoomId === 'string' ? { adjacentRoomId: ex.adjacentRoomId } : {}), ...(typeof ex.adjacentWallId === 'string' ? { adjacentWallId: ex.adjacentWallId } : {}), adjacentHeatTempF: numOrNull(ex.adjacentHeatTempF), adjacentCoolTempF: numOrNull(ex.adjacentCoolTempF) },
    assemblyId: typeof w.assemblyId === 'string' ? w.assemblyId : null,
    openings: (Array.isArray(w.openings) ? w.openings : []).map(normOpening).filter((x): x is Opening => !!x),
    ...(typeof w.photoRef === 'string' ? { photoRef: w.photoRef } : {}),
  };
}
function normHoriz(h: unknown, dflt: 'conditioned-adjacent' | 'unconditioned') {
  const o = isObj(h) ? h : {};
  return { condition: ['conditioned-adjacent', 'unconditioned', 'exterior', 'ground'].includes(o.condition) ? o.condition : dflt, assemblyId: typeof o.assemblyId === 'string' ? o.assemblyId : null,
    adjacentHeatTempF: numOrNull(o.adjacentHeatTempF), adjacentCoolTempF: numOrNull(o.adjacentCoolTempF), ...(numOrNull(o.areaFt2) !== null ? { areaFt2: numOrNull(o.areaFt2) } : {}) };
}
function normRoom(r: unknown, i: number): Room | null {
  if (!isObj(r)) return null;
  const pl = isObj(r.placement) ? r.placement : {};
  return {
    id: strOr(r.id, uid()), name: strOr(r.name, `Room ${i + 1}`), floorLevel: numOr(r.floorLevel, 1),
    lengthFt: numOr(r.lengthFt, 0), widthFt: numOr(r.widthFt, 0), ceilingHeightFt: numOr(r.ceilingHeightFt, 0),
    placement: { xFt: numOr(pl.xFt, 0), yFt: numOr(pl.yFt, 0), rotationDeg: numOr(pl.rotationDeg, 0) },
    walls: (Array.isArray(r.walls) ? r.walls : []).map(normWall).filter((x): x is Wall => !!x),
    ceiling: normHoriz(r.ceiling, 'unconditioned'), floor: normHoriz(r.floor, 'conditioned-adjacent'),
    occupants: numOr(r.occupants, 0), applianceSensibleBtuh: numOr(r.applianceSensibleBtuh, 0),
  };
}
function normAssembly(a: unknown): Assembly | null {
  if (!isObj(a)) return null;
  const kinds = ['wall', 'window', 'door', 'roof-ceiling', 'floor'];
  const desc: Record<string, string> = {}; if (isObj(a.descriptors)) for (const [k, v] of Object.entries(a.descriptors)) if (typeof v === 'string') desc[k] = v;
  return { id: strOr(a.id, uid()), kind: kinds.includes(a.kind) ? a.kind : 'wall', name: strOr(a.name, 'Construction'), descriptors: desc, u: sourcedNum(a.u) };
}

/** Upgrade any stored shape to the current schema and normalise structure. Throws ProjectLoadError('too-new') for newer data. */
export function migrate(raw: any): Project {
  if (!isObj(raw)) throw new ProjectLoadError('Saved project is not readable (damaged data).', 'damaged');
  const v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (v > SCHEMA_VERSION) throw new ProjectLoadError(`This project was saved by a newer version of the app (data version ${v}; this app understands ${SCHEMA_VERSION}). Update the app to open it.`, 'too-new');
  let p: Record<string, any> = raw;
  if (v < 1) { // v0: rooms lived at top level, no house wrapper
    p = { ...raw, house: isObj(raw.house) ? raw.house : { name: 'House', rooms: raw.rooms ?? [] } }; delete p.rooms;
  }
  const dd = newDesign(); const d = isObj(p.design) ? p.design : {};
  const sg: Project['design']['solarGain'] = {}; if (isObj(d.solarGain)) for (const [k, val] of Object.entries(d.solarGain)) { const n = numOrNull(val); if (n !== null && ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].includes(k)) (sg as Record<string, number>)[k] = n; }
  const inf = isObj(p.infiltration) ? p.infiltration : {}; const intl = isObj(p.internal) ? p.internal : {}; const house = isObj(p.house) ? p.house : {};
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION, id: strOr(p.id, uid()), name: strOr(p.name, 'Untitled project'), client: strOr(p.client, ''), address: strOr(p.address, ''),
    createdAt: strOr(p.createdAt, now), updatedAt: strOr(p.updatedAt, now),
    design: { location: strOr(d.location, dd.location), source: strOr(d.source, dd.source), elevationFt: numOrNull(d.elevationFt), heatOutdoorF: numOrNull(d.heatOutdoorF), coolOutdoorF: numOrNull(d.coolOutdoorF),
      heatIndoorF: numOrNull(d.heatIndoorF), coolIndoorF: numOrNull(d.coolIndoorF), outdoorGrainsCool: numOrNull(d.outdoorGrainsCool), indoorGrainsCool: numOrNull(d.indoorGrainsCool), solarGain: sg },
    infiltration: { heatAch: sourcedNum(inf.heatAch), coolAch: sourcedNum(inf.coolAch) },
    internal: { sensiblePerPersonBtuh: sourcedNum(intl.sensiblePerPersonBtuh), latentPerPersonBtuh: sourcedNum(intl.latentPerPersonBtuh) },
    assemblies: (Array.isArray(p.assemblies) ? p.assemblies : []).map(normAssembly).filter((x): x is Assembly => !!x),
    house: { name: strOr(house.name, 'House'), rooms: (Array.isArray(house.rooms) ? house.rooms : []).map(normRoom).filter((x): x is Room => !!x) },
  };
}

export interface IndexEntry { id: string; name: string; updatedAt: string }

let backupSeq = 0; // keeps backup keys unique and ordered even within the same millisecond

export class ProjectStore {
  constructor(private kv: KV) {}

  list(): IndexEntry[] {
    try {
      const v = JSON.parse(this.kv.getItem(INDEX) ?? '[]');
      if (Array.isArray(v) && v.every(x => isObj(x) && typeof x.id === 'string')) return v as IndexEntry[];
    } catch { /* fall through to rebuild */ }
    return this.rebuildIndex();
  }
  /** If the index is damaged but project records exist, rebuild it from the records so projects never "disappear". */
  rebuildIndex(): IndexEntry[] {
    const out: IndexEntry[] = [];
    for (const k of this.kv.keys?.() ?? []) {
      if (!k.startsWith(PREFIX)) continue;
      try { const o = JSON.parse(this.kv.getItem(k) ?? 'null'); if (isObj(o) && typeof o.id === 'string') out.push({ id: o.id, name: strOr(o.name, 'Recovered project'), updatedAt: strOr(o.updatedAt, '') }); } catch { out.push({ id: k.slice(PREFIX.length), name: 'Damaged project (data kept)', updatedAt: '' }); }
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    try { this.kv.setItem(INDEX, JSON.stringify(out)); } catch { /* best effort */ }
    return out;
  }
  /** Throws on storage failure (quota, disabled storage): callers must surface it. */
  save(p: Project): void {
    p.updatedAt = new Date().toISOString();
    const json = JSON.stringify(p);
    this.kv.setItem(KEY(p.id), json);
    if (this.kv.getItem(KEY(p.id)) !== json) throw new Error('Storage did not keep the saved data (read-back mismatch).');
    const idx = this.list().filter(x => x.id !== p.id); idx.unshift({ id: p.id, name: p.name, updatedAt: p.updatedAt });
    this.kv.setItem(INDEX, JSON.stringify(idx));
  }
  load(id: string): Project {
    const s = this.kv.getItem(KEY(id));
    if (!s) throw new ProjectLoadError('That project was not found on this device.', 'missing');
    let raw: unknown; try { raw = JSON.parse(s); } catch { throw new ProjectLoadError('The saved data for this project is damaged and could not be read. The data was left untouched.', 'damaged'); }
    const p = migrate(raw); // too-new / damaged throw without modifying anything
    if (JSON.stringify(p) !== JSON.stringify(raw) && (!isObj(raw) || raw.schemaVersion !== SCHEMA_VERSION || this.structureDiffers(raw as Record<string, any>, p))) this.backup(id, s);
    return p;
  }
  private structureDiffers(raw: Record<string, any>, p: Project): boolean {
    // Back up whenever normalisation changed anything other than timestamps (so a repair can always be undone by hand).
    const a = { ...raw, updatedAt: 0, createdAt: 0 }, b = { ...p, updatedAt: 0, createdAt: 0 } as Record<string, any>;
    return JSON.stringify(a) !== JSON.stringify(b);
  }
  private backup(id: string, raw: string): void {
    try {
      const key = `${BACKUP}${id}:${String(Date.now()).padStart(15, '0')}-${String(++backupSeq).padStart(6, '0')}`; this.kv.setItem(key, raw);
      const mine = (this.kv.keys?.() ?? []).filter(k => k.startsWith(`${BACKUP}${id}:`)).sort();
      for (const old of mine.slice(0, Math.max(0, mine.length - 3))) this.kv.removeItem(old); // keep the 3 newest
    } catch { /* backup is best-effort */ }
  }
  backups(id: string): string[] { return (this.kv.keys?.() ?? []).filter(k => k.startsWith(`${BACKUP}${id}:`)).sort(); }
  duplicate(id: string): Project {
    const p = this.load(id); const c = structuredClone(p); c.id = uid(); c.name = `${p.name} copy`; c.createdAt = new Date().toISOString();
    const remap = new Map<string, string>(); // fresh ids for rooms/walls/openings/assemblies so the copy is fully independent
    const re = (old: string) => { const n = uid(); remap.set(old, n); return n; };
    for (const a of c.assemblies) a.id = re(a.id);
    for (const r of c.house.rooms) { r.id = re(r.id); for (const w of r.walls) { w.id = re(w.id); w.openings.forEach(o => (o.id = uid())); } }
    const fix = (x: string | null | undefined) => (x ? remap.get(x) ?? x : x ?? null);
    for (const r of c.house.rooms) { r.ceiling.assemblyId = fix(r.ceiling.assemblyId); r.floor.assemblyId = fix(r.floor.assemblyId); for (const w of r.walls) { w.assemblyId = fix(w.assemblyId); w.openings.forEach(o => (o.assemblyId = fix(o.assemblyId))); if (w.exposure.adjacentRoomId) w.exposure.adjacentRoomId = fix(w.exposure.adjacentRoomId) ?? undefined; if (w.exposure.adjacentWallId) w.exposure.adjacentWallId = fix(w.exposure.adjacentWallId) ?? undefined; } }
    this.save(c); return c;
  }
  remove(id: string): void {
    this.kv.removeItem(KEY(id));
    this.kv.setItem(INDEX, JSON.stringify(this.list().filter(x => x.id !== id)));
  }
}

/** localStorage adapter with key enumeration (needed for index recovery and backups). */
export const browserKV = (ls: Storage): KV => ({
  getItem: k => ls.getItem(k), setItem: (k, v) => ls.setItem(k, v), removeItem: k => ls.removeItem(k),
  keys: () => { const out: string[] = []; for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k) out.push(k); } return out; },
});
