import type { Project } from '../engine/types';
import { SCHEMA_VERSION, unknown } from './factory';

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
const INDEX = 'manualj:index'; const KEY = (id: string) => `manualj:project:${id}`;

/** Upgrade any stored shape to the current schema. Throws on data newer than this build understands. */
export function migrate(raw: any): Project {
  if (!raw || typeof raw !== 'object') throw new Error('Not a project');
  let p = raw;
  const v = typeof p.schemaVersion === 'number' ? p.schemaVersion : 0;
  if (v > SCHEMA_VERSION) throw new Error(`Project schema ${v} is newer than this app (${SCHEMA_VERSION}). Update the app.`);
  if (v < 1) { // v0: rooms lived at top level, no placement, no house wrapper, no infiltration split
    const rooms = (p.rooms ?? []).map((r: any) => ({ placement: { xFt: 0, yFt: 0, rotationDeg: 0 }, floorLevel: 1, occupants: 0, applianceSensibleBtuh: 0, ...r }));
    p = {
      ...p, schemaVersion: 1, house: p.house ?? { name: 'House', rooms },
      infiltration: p.infiltration ?? { heatAch: unknown(), coolAch: unknown() },
      internal: p.internal ?? { sensiblePerPersonBtuh: unknown(), latentPerPersonBtuh: unknown() },
      assemblies: p.assemblies ?? [],
    };
    delete p.rooms;
  }
  return p as Project;
}

export class ProjectStore {
  constructor(private kv: KV) {}
  list(): { id: string; name: string; updatedAt: string }[] {
    try { return JSON.parse(this.kv.getItem(INDEX) ?? '[]'); } catch { return []; }
  }
  save(p: Project): void {
    p.updatedAt = new Date().toISOString();
    this.kv.setItem(KEY(p.id), JSON.stringify(p));
    const idx = this.list().filter(x => x.id !== p.id);
    idx.unshift({ id: p.id, name: p.name, updatedAt: p.updatedAt });
    this.kv.setItem(INDEX, JSON.stringify(idx));
  }
  load(id: string): Project | null {
    const s = this.kv.getItem(KEY(id)); if (!s) return null;
    return migrate(JSON.parse(s));
  }
  remove(id: string): void {
    this.kv.removeItem(KEY(id));
    this.kv.setItem(INDEX, JSON.stringify(this.list().filter(x => x.id !== id)));
  }
}
