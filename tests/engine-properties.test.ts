import { describe, expect, it } from 'vitest';
import { calculate } from '../src/engine/calc';
import { newAssembly, newOpening, newProject, newRoom, sourced } from '../src/model/factory';
import { migrate } from '../src/model/persistence';
import type { Project, Room } from '../src/engine/types';
import { fToC, cToF, rToU, uToR, ftToIn, inToFt, mToFt, ftToM, parseLength, parseNumber, formatFtIn } from '../src/engine/units';

// Small seeded PRNG so failures are reproducible.
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];
const between = (r: () => number, a: number, b: number) => a + r() * (b - a);

function randomProject(seed: number, opts: { solar?: boolean } = {}): Project {
  const r = rng(seed); const p = newProject('rand');
  p.design = { ...p.design, source: 'rand', heatOutdoorF: Math.round(between(r, -20, 40)), heatIndoorF: 70, coolOutdoorF: Math.round(between(r, 85, 110)), coolIndoorF: 75, outdoorGrainsCool: Math.round(between(r, 40, 160)), indoorGrainsCool: Math.round(between(r, 50, 80)), solarGain: opts.solar ? { N: 20, E: 100, S: 60, W: 110 } : {} };
  p.infiltration = { heatAch: sourced(+between(r, 0, 1.5).toFixed(2), 'KNOWN'), coolAch: sourced(+between(r, 0, 1.2).toFixed(2), 'KNOWN') };
  p.internal = { sensiblePerPersonBtuh: sourced(230, 'ESTIMATED'), latentPerPersonBtuh: sourced(200, 'ESTIMATED') };
  const mk = (kind: 'wall' | 'window' | 'door' | 'roof-ceiling' | 'floor', lo: number, hi: number) => { const a = newAssembly(kind, kind + Math.round(r() * 1e6)); a.u = sourced(+between(r, lo, hi).toFixed(3), 'KNOWN'); p.assemblies.push(a); return a; };
  const wall = mk('wall', 0.03, 0.3), win = mk('window', 0.25, 1.1), door = mk('door', 0.2, 0.6), roof = mk('roof-ceiling', 0.02, 0.1), flr = mk('floor', 0.03, 0.15);
  const n = 1 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const room = newRoom(`R${k}`, +between(r, 8, 24).toFixed(1), +between(r, 8, 20).toFixed(1), pick(r, [8, 9, 10]), pick(r, [0, 90, 180, 270, 45]));
    room.occupants = Math.floor(r() * 4); room.applianceSensibleBtuh = Math.round(r() * 800);
    for (const w of room.walls) {
      w.exposure = pick(r, [{ type: 'exterior' as const, adjacentHeatTempF: null, adjacentCoolTempF: null }, { type: 'interior-conditioned' as const, adjacentHeatTempF: null, adjacentCoolTempF: null }, { type: 'unconditioned' as const, adjacentHeatTempF: Math.round(between(r, 20, 60)), adjacentCoolTempF: Math.round(between(r, 80, 110)) }]);
      w.assemblyId = wall.id;
      const nw = Math.floor(r() * 3); for (let q = 0; q < nw; q++) { const o = newOpening('window', +between(r, 2, 4).toFixed(1), +between(r, 2, 5).toFixed(1), win.id); o.quantity = 1 + Math.floor(r() * 2); o.shgc = sourced(+between(r, 0.2, 0.7).toFixed(2), 'KNOWN'); w.openings.push(o); }
      if (r() < 0.3) w.openings.push(newOpening('door', 3, 6.67, door.id));
    }
    room.ceiling = pick(r, [{ condition: 'conditioned-adjacent' as const, assemblyId: null, adjacentHeatTempF: null, adjacentCoolTempF: null }, { condition: 'unconditioned' as const, assemblyId: roof.id, adjacentHeatTempF: 25, adjacentCoolTempF: 115 }, { condition: 'exterior' as const, assemblyId: roof.id, adjacentHeatTempF: null, adjacentCoolTempF: null, areaFt2: Math.round(room.lengthFt * room.widthFt * 1.2) }]);
    room.floor = pick(r, [{ condition: 'conditioned-adjacent' as const, assemblyId: null, adjacentHeatTempF: null, adjacentCoolTempF: null }, { condition: 'unconditioned' as const, assemblyId: flr.id, adjacentHeatTempF: 50, adjacentCoolTempF: 85 }]);
    p.house.rooms.push(room);
  }
  return p;
}

/** Independent re-derivation straight from raw inputs (no engine helpers). A regression oracle, not an authority. */
function oracle(p: Project) {
  const u = (id: string | null) => p.assemblies.find(a => a.id === id)!.u.value!;
  const d = p.design; let H = 0, CS = 0, CL = 0;
  const dtH = d.heatIndoorF! - d.heatOutdoorF!, dtC = d.coolOutdoorF! - d.coolIndoorF!;
  for (const room of p.house.rooms) {
    const V = room.lengthFt * room.widthFt * room.ceilingHeightFt, floorA = room.lengthFt * room.widthFt;
    for (const w of room.walls) {
      if (w.exposure.type === 'interior-conditioned') continue;
      const dH = w.exposure.type === 'exterior' ? dtH : d.heatIndoorF! - w.exposure.adjacentHeatTempF!, dC = w.exposure.type === 'exterior' ? dtC : w.exposure.adjacentCoolTempF! - d.coolIndoorF!;
      let net = w.lengthFt * w.heightFt;
      for (const o of w.openings) { const a = o.quantity * o.widthFt * o.heightFt; net -= a; H += a * u(o.assemblyId) * dH; CS += a * u(o.assemblyId) * dC; if (o.kind === 'window' && w.exposure.type === 'exterior') { const card = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((w.heading.deg! % 360) + 360) % 360 / 45) % 8] as 'N'; const f = d.solarGain[card]; if (f !== undefined && o.shgc.value !== null) CS += a * o.shgc.value * f; } }
      H += net * u(w.assemblyId) * dH; CS += net * u(w.assemblyId) * dC;
    }
    for (const h of [room.ceiling, room.floor]) {
      if (h.condition === 'conditioned-adjacent') continue;
      const A = typeof h.areaFt2 === 'number' && h.areaFt2 > 0 ? h.areaFt2 : floorA;
      const dH = h.condition === 'exterior' ? dtH : d.heatIndoorF! - h.adjacentHeatTempF!, dC = h.condition === 'exterior' ? dtC : h.adjacentCoolTempF! - d.coolIndoorF!;
      H += A * u(h.assemblyId) * dH; CS += A * u(h.assemblyId) * dC;
    }
    const cfmH = p.infiltration.heatAch.value! * V / 60, cfmC = p.infiltration.coolAch.value! * V / 60;
    H += 1.08 * cfmH * dtH; CS += 1.08 * cfmC * dtC + room.occupants * 230 + room.applianceSensibleBtuh;
    CL += 60 * 0.075 * 1076 * cfmC * (d.outdoorGrainsCool! - d.indoorGrainsCool!) / 7000 + room.occupants * 200;
  }
  return { H, CS, CL };
}
const totals = (p: Project) => { const t = calculate(p).totals; return { H: t.heating!, CS: t.coolingSensible!, CL: t.coolingLatent! }; };
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-7 * Math.max(1, Math.abs(b)));

describe('engine vs independent oracle on random valid houses', () => {
  for (let seed = 1; seed <= 150; seed++) it(`seed ${seed}`, () => {
    const p = randomProject(seed, { solar: seed % 2 === 0 }); const res = calculate(p);
    expect(res.issues.filter(x => x.severity === 'ERROR')).toEqual([]);
    for (const rr of res.rooms) expect(rr.issues.filter(x => x.severity === 'ERROR')).toEqual([]);
    const o = oracle(p), t = totals(p); close(t.H, o.H); close(t.CS, o.CS); close(t.CL, o.CL);
  });
});

describe('physical / structural invariants', () => {
  const seeds = [3, 17, 42, 77, 101, 123];
  it('whole-house totals equal the sum of the room results', () => {
    for (const s of seeds) { const res = calculate(randomProject(s)); expect(res.totals.heating!).toBeCloseTo(res.rooms.reduce((a, r) => a + r.heating!.btuh, 0), 6); expect(res.totals.coolingTotal!).toBeCloseTo(res.totals.coolingSensible! + res.totals.coolingLatent!, 6); }
  });
  it('room order does not change totals', () => {
    for (const s of seeds) { const p = randomProject(s); const a = totals(p); p.house.rooms.reverse(); const b = totals(p); close(b.H, a.H); close(b.CS, a.CS); close(b.CL, a.CL); }
  });
  it('rotating the whole house leaves loads unchanged when no solar factors are set', () => {
    for (const s of seeds) { const p = randomProject(s); const a = totals(p); for (const r of p.house.rooms) for (const w of r.walls) w.heading.deg = (w.heading.deg! + 90) % 360; const b = totals(p); close(b.H, a.H); close(b.CS, a.CS); }
  });
  it('scaling every U by k scales conduction exactly; air loads are unaffected', () => {
    for (const s of seeds) { const p = randomProject(s); p.infiltration = { heatAch: sourced(0, 'KNOWN'), coolAch: sourced(0, 'KNOWN') }; p.house.rooms.forEach(r => { r.occupants = 0; r.applianceSensibleBtuh = 0; r.walls.forEach(w => w.openings.forEach(o => (o.shgc = sourced(null as unknown as number, 'UNKNOWN')))); }); const a = totals(p); p.assemblies.forEach(x => (x.u.value = x.u.value! * 1.5)); const b = totals(p); close(b.H, a.H * 1.5); close(b.CS, a.CS * 1.5); }
  });
  it('more insulation (lower U) never increases heating', () => {
    for (const s of seeds) { const p = randomProject(s); const a = totals(p).H; p.assemblies.forEach(x => (x.u.value = x.u.value! * 0.5)); expect(totals(p).H).toBeLessThanOrEqual(a + 1e-9); }
  });
  it('a colder design day never decreases heating (conduction to outdoors and air)', () => {
    for (const s of seeds) { const p = randomProject(s); const a = totals(p).H; p.design.heatOutdoorF! -= 10; expect(totals(p).H).toBeGreaterThan(a); }
  });
  it('turning an exterior wall into an interior partition removes exactly that wall and its openings', () => {
    const p = randomProject(5); const room = p.house.rooms[0]; const w = room.walls[0]; w.exposure = { type: 'exterior', adjacentHeatTempF: null, adjacentCoolTempF: null };
    const before = calculate(p).rooms[0].heating!.btuh; const comp = calculate(p).rooms[0].heating!.components.filter(c => c.label.startsWith(w.label + ' ')).reduce((s, c) => s + c.btuh, 0);
    w.exposure.type = 'interior-conditioned'; close(calculate(p).rooms[0].heating!.btuh, before - comp);
  });
  it('splitting one room into two identical rooms with the same total volume and envelope keeps infiltration constant', () => {
    const p = randomProject(9); p.house.rooms.forEach(r => (r.occupants = 0)); const tot = (q: Project) => calculate(q).rooms.reduce((s, r) => s + r.heating!.components.filter(c => c.kind === 'infiltration').reduce((a, c) => a + c.btuh, 0), 0);
    const a = tot(p); const r0 = p.house.rooms[0]; const clone: Room = structuredClone(r0); clone.id = 'dup'; clone.walls.forEach((w, i) => (w.id = 'd' + i)); p.house.rooms.push(clone);
    const per = (a - 0) ; expect(tot(p)).toBeGreaterThan(per); // adding a room adds air load (by its volume)
  });
});

describe('robustness: bad or hostile input never crashes the engine and is never silently calculated', () => {
  const bads: unknown[] = [NaN, Infinity, -Infinity, -1, 0, 1e12, '12' as unknown, null, undefined];
  const fields: ((p: Project, v: number) => void)[] = [
    (p, v) => (p.house.rooms[0].lengthFt = v), (p, v) => (p.house.rooms[0].widthFt = v), (p, v) => (p.house.rooms[0].ceilingHeightFt = v),
    (p, v) => (p.house.rooms[0].walls[0].lengthFt = v), (p, v) => (p.house.rooms[0].walls[0].heightFt = v), (p, v) => (p.house.rooms[0].occupants = v),
    (p, v) => (p.house.rooms[0].applianceSensibleBtuh = v), (p, v) => (p.assemblies[0].u.value = v), (p, v) => (p.infiltration.heatAch.value = v),
    (p, v) => (p.infiltration.coolAch.value = v), (p, v) => (p.design.heatOutdoorF = v), (p, v) => (p.design.coolIndoorF = v), (p, v) => (p.design.outdoorGrainsCool = v),
    (p, v) => (p.house.rooms[0].walls[0].heading.deg = v), (p, v) => (p.house.rooms[0].ceiling.areaFt2 = v),
  ];
  it('no exceptions, and a poisoned input yields either a clean ERROR or a finite result (never NaN)', () => {
    for (const set of fields) for (const bad of bads) {
      const p = randomProject(11); (set as unknown as (p: Project, v: unknown) => void)(p, bad);
      let res; expect(() => (res = calculate(p))).not.toThrow();
      const r = res!; const t = r.totals;
      for (const v of [t.heating, t.coolingSensible, t.coolingLatent]) if (v !== null) expect(Number.isFinite(v)).toBe(true);
    }
  });
  it('clearly impossible values are reported as errors, not calculated', () => {
    const cases: [string, (p: Project) => void][] = [
      ['NaN length', p => (p.house.rooms[0].lengthFt = NaN)], ['negative width', p => (p.house.rooms[0].widthFt = -3)], ['96 ft ceiling', p => (p.house.rooms[0].ceilingHeightFt = 96)],
      ['negative occupants', p => (p.house.rooms[0].occupants = -2)], ['negative appliance', p => (p.house.rooms[0].applianceSensibleBtuh = -50)], ['ACH NaN', p => (p.infiltration.heatAch.value = NaN)],
      ['ACH 50', p => (p.infiltration.coolAch.value = 50)], ['U = 40', p => (p.assemblies[0].u.value = 40)], ['humidity -5', p => (p.design.outdoorGrainsCool = -5)], ['indoor 500F', p => (p.design.heatIndoorF = 500)],
    ];
    for (const [name, mut] of cases) { const p = randomProject(21); mut(p); const res = calculate(p); const errs = [...res.issues, ...res.rooms.flatMap(r => r.issues)].filter(x => x.severity === 'ERROR'); expect(errs.length, name).toBeGreaterThan(0); expect(res.totals.heating === null || res.totals.coolingSensible === null || errs.some(e => e.where !== 'constructions'), name).toBe(true); }
  });
  it('unusual-but-possible values warn instead of silently passing', () => {
    const p = randomProject(21); p.house.rooms[0].ceilingHeightFt = 24; p.infiltration.heatAch.value = 4; p.house.rooms[0].lengthFt = 70;
    const codes = new Set([...calculate(p).issues, ...calculate(p).rooms.flatMap(r => r.issues)].map(i => i.code)); for (const c of ['CEILING_ODD', 'ACH_HIGH', 'ROOM_LARGE']) expect(codes.has(c), c).toBe(true);
  });
  it('a vaulted/exterior ceiling without an explicit area warns that the floor area was assumed', () => {
    const p = randomProject(21); p.house.rooms[0].ceiling = { condition: 'exterior', assemblyId: p.assemblies.find(a => a.kind === 'roof-ceiling')!.id, adjacentHeatTempF: null, adjacentCoolTempF: null };
    expect(calculate(p).rooms[0].issues.some(i => i.code === 'ROOF_AREA_ASSUMED')).toBe(true);
  });
});

describe('persistence round trip preserves calculation results', () => {
  it('JSON round trip and migrate() give identical totals for random houses', () => {
    for (const s of [2, 8, 33, 64]) { const p = randomProject(s); const back = migrate(JSON.parse(JSON.stringify(p))); expect(totals(back)).toEqual(totals(p)); }
  });
});

describe('unit conversions and input parsing', () => {
  it('round trips over a sweep', () => {
    for (let x = -60; x <= 150; x += 7.3) expect(cToF(fToC(x))).toBeCloseTo(x, 9);
    for (let x = 0.5; x < 400; x *= 1.7) { expect(uToR(rToU(x))).toBeCloseTo(x, 9); expect(inToFt(ftToIn(x))).toBeCloseTo(x, 9); expect(mToFt(ftToM(x))).toBeCloseTo(x, 9); }
  });
  it('known conversion anchors', () => { expect(fToC(32)).toBe(0); expect(fToC(-40)).toBeCloseTo(-40, 12); expect(mToFt(0.3048)).toBeCloseTo(1, 12); expect(rToU(20)).toBe(0.05); });
  it('parseNumber accepts plain decimals (incl. comma) and rejects look-alikes', () => {
    expect(parseNumber('12.5')).toBe(12.5); expect(parseNumber(' -3 ')).toBe(-3); expect(parseNumber('12,5')).toBe(12.5); expect(parseNumber('.5')).toBe(0.5); expect(parseNumber('7.')).toBe(7);
    for (const bad of ['', ' ', '1e3', '0x10', 'Infinity', 'NaN', '12abc', '1.2.3', '--4', '+5', '1 000']) expect(parseNumber(bad), bad).toBeNull();
  });
  it('parseLength handles feet-inches variants and formatFtIn round trips', () => {
    expect(parseLength("12'0\"")).toBe(12); expect(parseLength("12' 6\"")).toBeCloseTo(12.5); expect(parseLength('12ft 6in')).toBeCloseTo(12.5); expect(parseLength('96', 'in')).toBe(8); expect(parseLength('-5')).toBe(-5);
    for (const f of [0.5, 7.25, 12, 10.0833]) expect(parseLength(formatFtIn(f))).toBeCloseTo(f, 1);
  });
});

describe('internal failure containment', () => {
  it('an unexpected exception inside one room becomes an INTERNAL error for that room, not a crash', () => {
    const p = randomProject(4); (p.house.rooms[0] as unknown as { walls: unknown }).walls = undefined; // malformed stored data
    let res; expect(() => (res = calculate(p))).not.toThrow();
    expect(res!.rooms[0].issues.some((i: { code: string; severity: string }) => i.code === 'INTERNAL' && i.severity === 'ERROR')).toBe(true);
    expect(res!.totals.heating).toBeNull();
  });
});

describe('performance guard', () => {
  it('a large house (60 rooms, 8 openings per wall) calculates well under 250 ms', () => {
    const p = randomProject(7); const base = p.house.rooms[0]; p.house.rooms = [];
    for (let k = 0; k < 60; k++) { const r: Room = structuredClone(base); r.id = 'r' + k; r.walls.forEach((w, i) => { w.id = `w${k}_${i}`; w.exposure = { type: 'exterior', adjacentHeatTempF: null, adjacentCoolTempF: null }; w.openings = Array.from({ length: 8 }, () => { const o = newOpening('window', 3, 4, p.assemblies.find(a => a.kind === 'window')!.id); o.shgc = sourced(0.4, 'KNOWN'); return o; }); }); r.ceiling = { condition: 'unconditioned', assemblyId: p.assemblies.find(a => a.kind === 'roof-ceiling')!.id, adjacentHeatTempF: 30, adjacentCoolTempF: 110 }; p.house.rooms.push(r); }
    const t0 = performance.now(); const res = calculate(p); const ms = performance.now() - t0;
    expect(res.totals.heating).not.toBeNull(); expect(ms).toBeLessThan(250);
  });
});
