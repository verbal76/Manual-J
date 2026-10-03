import { describe, expect, it } from 'vitest';
import { calculate, achToCfm, airSensible } from '../src/engine/calc';
import { AIR_SENSIBLE_FACTOR } from '../src/engine/provenance';
import { cardinalFromHeading, wallNet } from '../src/engine/geometry';
import * as U from '../src/engine/units';
import { buildProject, EXPECTED, TOLERANCE_BTUH } from './fixtures/analytic-box-room';
import { newProject, newRoom, newAssembly, newOpening, sourced } from '../src/model/factory';
import { migrate, ProjectStore } from '../src/model/persistence';
import { renderReportHtml } from '../src/report/report';

describe('units', () => {
  it('converts and round-trips', () => {
    expect(U.fToC(212)).toBeCloseTo(100, 9); expect(U.cToF(-40)).toBeCloseTo(-40, 9);
    expect(U.uToR(U.rToU(13))).toBeCloseTo(13, 9);
    expect(U.btuhToTons(24000)).toBe(2);
    expect(U.mToFt(U.ftToM(10))).toBeCloseTo(10, 9);
  });
  it('parses feet-inches text', () => {
    expect(U.parseLength("10'6\"")).toBeCloseTo(10.5); expect(U.parseLength('10-6')).toBeCloseTo(10.5);
    expect(U.parseLength('36', 'in')).toBeCloseTo(3); expect(U.parseLength('12.5')).toBe(12.5);
    expect(U.parseLength("5'13\"")).toBeNull(); expect(U.parseLength('abc')).toBeNull(); expect(U.parseLength('')).toBeNull();
  });
});

describe('geometry', () => {
  it('derives 1.08 from air properties', () => expect(AIR_SENSIBLE_FACTOR).toBeCloseTo(1.08, 9));
  it('net wall area subtracts openings x quantity', () => {
    const r = newRoom('t', 10, 10, 8, 0); r.walls[0].openings = [{ ...newOpening('window', 3, 4), quantity: 2 }];
    expect(wallNet(r.walls[0])).toBe(80 - 24);
  });
  it('maps headings to cardinals incl. wraparound', () => {
    expect(cardinalFromHeading(0)).toBe('N'); expect(cardinalFromHeading(359)).toBe('N'); expect(cardinalFromHeading(100)).toBe('E');
    expect(cardinalFromHeading(-90)).toBe('W'); expect(cardinalFromHeading(null)).toBeNull();
  });
  it('room walls rotate clockwise from front heading', () => {
    const r = newRoom('t', 10, 12, 8, 270); expect(r.walls.map(w => cardinalFromHeading(w.heading.deg))).toEqual(['W', 'N', 'E', 'S']);
  });
});

describe('engine vs analytic fixture', () => {
  const res = calculate(buildProject());
  it('heating', () => expect(Math.abs(res.rooms[0].heating!.btuh - EXPECTED.heating)).toBeLessThan(TOLERANCE_BTUH));
  it('cooling sensible', () => expect(Math.abs(res.rooms[0].coolingSensible!.btuh - EXPECTED.coolingSensible)).toBeLessThan(TOLERANCE_BTUH));
  it('cooling latent', () => expect(Math.abs(res.rooms[0].coolingLatent!.btuh - EXPECTED.coolingLatent)).toBeLessThan(TOLERANCE_BTUH));
  it('whole house equals sum of rooms across two identical rooms', () => {
    const p = buildProject(); const r2 = structuredClone(p.house.rooms[0]); r2.id = 'r2'; r2.walls.forEach((w, i) => (w.id = 'x' + i)); p.house.rooms.push(r2);
    const t = calculate(p).totals; expect(t.heating).toBeCloseTo(2 * EXPECTED.heating, 6); expect(t.coolingTotal).toBeCloseTo(2 * (EXPECTED.coolingSensible + EXPECTED.coolingLatent), 6);
  });
  it('interior partition contributes zero; exterior wall flip adds load', () => {
    const p = buildProject(); p.house.rooms[0].walls[1].exposure.type = 'exterior'; p.house.rooms[0].walls[1].assemblyId = p.assemblies[0].id;
    expect(calculate(p).rooms[0].heating!.btuh).toBeCloseTo(EXPECTED.heating + 120 * 0.05 * 60, 6);
  });
  it('sensible infiltration helper', () => expect(airSensible(achToCfm(0.5, 2400), 60)).toBeCloseTo(1296, 6));
  it('solar gain only with user factor and SHGC', () => {
    const p = buildProject(); p.design.solarGain = { N: 10 };
    const noShgc = calculate(p).rooms[0].coolingSensible!.btuh; expect(noShgc).toBeCloseTo(EXPECTED.coolingSensible, 6);
    p.house.rooms[0].walls[0].openings[0].shgc = sourced(0.5, 'ESTIMATED');
    expect(calculate(p).rooms[0].coolingSensible!.btuh).toBeCloseTo(EXPECTED.coolingSensible + 24 * 0.5 * 10, 6);
  });
});

describe('failure modes', () => {
  it('UNKNOWN construction blocks the room and is reported, not guessed', () => {
    const p = buildProject(); p.assemblies[0].u = { value: null, quality: 'UNKNOWN' };
    const r = calculate(p); expect(r.rooms[0].heating).toBeNull(); expect(r.totals.heating).toBeNull();
    expect(r.rooms[0].issues.some(i => i.code === 'U_UNKNOWN' && i.severity === 'ERROR')).toBe(true);
  });
  it('rejects impossible input', () => {
    const p = buildProject(); p.house.rooms[0].lengthFt = -5;
    expect(calculate(p).rooms[0].issues.some(i => i.code === 'ROOM_DIMS')).toBe(true);
    const q = buildProject(); q.house.rooms[0].walls[0].openings[0].widthFt = 20; q.house.rooms[0].walls[0].openings[0].heightFt = 20;
    expect(calculate(q).rooms[0].issues.some(i => i.code === 'OPENING_TOO_BIG')).toBe(true);
    const t = buildProject(); t.design.heatOutdoorF = 80;
    expect(calculate(t).issues.some(i => i.code === 'HEAT_DT')).toBe(true);
    const h = buildProject(); h.house.rooms[0].walls[0].heading.deg = 400;
    expect(calculate(h).rooms[0].issues.some(i => i.code === 'BAD_HEADING')).toBe(true);
  });
  it('unconfirmed device measurement is blocked', () => {
    const p = buildProject(); p.house.rooms[0].walls[0].measurement = { method: 'ar', confirmed: false };
    expect(calculate(p).rooms[0].heating).toBeNull();
  });
  it('missing humidity omits latent but keeps sensible; missing ACH blocks that mode only', () => {
    const p = buildProject(); p.design.indoorGrainsCool = null;
    const r = calculate(p).rooms[0]; expect(r.coolingLatent).toBeNull(); expect(r.coolingSensible).not.toBeNull();
    const q = buildProject(); q.infiltration.coolAch = { value: null, quality: 'UNKNOWN' };
    const r2 = calculate(q).rooms[0]; expect(r2.heating).not.toBeNull(); expect(r2.coolingSensible).toBeNull();
  });
  it('ground floor is flagged not-calculated, not silently zero', () => {
    const p = buildProject(); p.house.rooms[0].floor.condition = 'ground';
    expect(calculate(p).rooms[0].issues.some(i => i.code === 'GROUND_NOT_CALC')).toBe(true);
  });
  it('empty project errors', () => expect(calculate(newProject('x')).issues.some(i => i.code === 'NO_ROOMS')).toBe(true));
  it('new assembly is UNKNOWN by default', () => expect(newAssembly('wall', 'w').u.quality).toBe('UNKNOWN'));
});

describe('persistence', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
  it('round-trips and results are identical after reload', () => {
    const s = new ProjectStore(mem()); const p = buildProject(); s.save(p);
    const back = s.load(p.id)!; expect(calculate(back).totals).toEqual(calculate(p).totals); expect(s.list()[0].id).toBe(p.id);
  });
  it('migrates v0 shape', () => {
    const v0 = { id: 'a', name: 'old', design: buildProject().design, rooms: [{ id: 'r', name: 'R', lengthFt: 1, widthFt: 1, ceilingHeightFt: 8, walls: [], ceiling: {}, floor: {} }] };
    const m = migrate(v0); expect(m.schemaVersion).toBe(1); expect(m.house.rooms[0].placement).toBeDefined(); expect((m as any).rooms).toBeUndefined();
  });
  it('refuses newer schema', () => expect(() => migrate({ schemaVersion: 99 })).toThrow());
});

describe('report', () => {
  it('states assumptions, incompleteness and no ACCA claim; escapes HTML', () => {
    const p = buildProject(); p.name = '<script>x</script>'; p.assemblies[0].u = { value: null, quality: 'UNKNOWN' };
    const html = renderReportHtml(p, calculate(p));
    expect(html).not.toContain('<script>x'); expect(html).toContain('Not an ACCA'); expect(html).toContain('INCOMPLETE');
  });
});
