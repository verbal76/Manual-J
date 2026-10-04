// Regression tests for the independent engine review (2026-10-04): every case below failed (or was silently wrong) before the fix.
import { describe, expect, it } from 'vitest';
import { calculate } from '../src/engine/calc';
import { renderReportHtml } from '../src/report/report';
import { migrate } from '../src/model/persistence';
import { unknown } from '../src/model/factory';
import { buildProject, EXPECTED } from './fixtures/analytic-box-room';
import type { Project } from '../src/engine/types';

const codes = (p: Project) => { const r = calculate(p); return new Set([...r.issues, ...r.rooms.flatMap(x => x.issues)].map(i => `${i.severity}:${i.code}`)); };

describe('totals are never presented as complete when a term is silently left out', () => {
  it('occupants entered without per-person gains -> ERROR, cooling not calculated (was: silently omitted)', () => {
    const p = buildProject(); p.house.rooms[0].occupants = 3; const r = calculate(p);
    expect(codes(p).has('ERROR:NO_PERSON_SENS')).toBe(true); expect(r.rooms[0].coolingSensible).toBeNull(); expect(r.totals.coolingTotal).toBeNull(); expect(r.rooms[0].heating).not.toBeNull();
  });
  it('occupant gains tagged UNKNOWN count as missing even if a number is stored', () => {
    const p = buildProject(); p.house.rooms[0].occupants = 2; p.internal = { sensiblePerPersonBtuh: { value: 230, quality: 'UNKNOWN' }, latentPerPersonBtuh: { value: 200, quality: 'UNKNOWN' } };
    expect(calculate(p).rooms[0].coolingSensible).toBeNull();
  });
  it('partial solar setup (some directions entered) lists each window left out; the report says so', () => {
    const p = buildProject(); p.design.solarGain = { S: 150 }; // the N windows have a factor missing and no SHGC
    const r = calculate(p); expect(r.omitted.some(x => /Solar gain/.test(x))).toBe(true); expect(r.totals.coolingSensible).toBeCloseTo(EXPECTED.coolingSensible, 6);
    const html = renderReportHtml(p, r); expect(html).toContain('These totals leave out'); expect(html).toContain('INCOMPLETE');
  });
  it('no solar factors at all is the documented global omission, not a per-window omission', () => { expect(calculate(buildProject()).omitted).toEqual([]); });
  it('ground-contact floors are listed as left out and the report is flagged', () => {
    const p = buildProject(); p.house.rooms[0].floor.condition = 'ground'; const r = calculate(p);
    expect(r.omitted.some(x => /on\/below grade/.test(x))).toBe(true); expect(r.totals.heating).toBeCloseTo(EXPECTED.heating, 6); expect(renderReportHtml(p, r)).toContain('These totals leave out');
  });
});

describe('UNKNOWN is never used as a number', () => {
  it('a construction value tagged UNKNOWN is refused', () => { const p = buildProject(); p.assemblies[0].u = { value: 0.06, quality: 'UNKNOWN' }; expect(codes(p).has('ERROR:U_UNKNOWN')).toBe(true); expect(calculate(p).rooms[0].heating).toBeNull(); });
  it('ACH tagged UNKNOWN is refused for that season only', () => {
    const p = buildProject(); p.infiltration.coolAch = { value: 0.3, quality: 'UNKNOWN' }; const r = calculate(p);
    expect(r.rooms[0].heating).not.toBeNull(); expect(r.rooms[0].coolingSensible).toBeNull(); expect(r.issues.some(i => i.code === 'NO_ACH_COOL' && i.severity === 'ERROR')).toBe(true);
  });
  it('SHGC tagged UNKNOWN gives no solar term and is listed as left out', () => {
    const p = buildProject(); p.design.solarGain = { N: 20 }; p.house.rooms[0].walls[0].openings[0].shgc = { value: 0.4, quality: 'UNKNOWN' };
    const r = calculate(p); expect(r.omitted.some(x => /Solar/.test(x))).toBe(true); expect(r.totals.coolingSensible).toBeCloseTo(EXPECTED.coolingSensible, 6);
  });
  it('loading stored data with a number tagged UNKNOWN downgrades it to ESTIMATED (never better)', () => {
    const raw = JSON.parse(JSON.stringify(buildProject())); raw.assemblies[0].u = { value: 0.05, quality: 'UNKNOWN' }; expect(migrate(raw).assemblies[0].u).toEqual({ value: 0.05, quality: 'ESTIMATED' });
  });
});

describe('construction kind must match its use', () => {
  it('a wall assigned a window construction (or the reverse) is an error, not a quiet wrong number', () => {
    const p = buildProject(); const win = p.assemblies.find(a => a.kind === 'window')!; p.house.rooms[0].walls[0].assemblyId = win.id;
    expect(codes(p).has('ERROR:ASSEMBLY_KIND')).toBe(true); expect(calculate(p).rooms[0].heating).toBeNull();
    const q = buildProject(); q.house.rooms[0].walls[0].openings[0].assemblyId = q.assemblies.find(a => a.kind === 'wall')!.id; expect(codes(q).has('ERROR:ASSEMBLY_KIND')).toBe(true);
    const f = buildProject(); f.house.rooms[0].ceiling.assemblyId = f.assemblies.find(a => a.kind === 'door')!.id; expect(codes(f).has('ERROR:ASSEMBLY_KIND')).toBe(true);
  });
});

describe('geometry consistency and adjoining-space sanity warnings', () => {
  it('wall height far from the ceiling height, and a wall length matching neither room side, warn', () => {
    const p = buildProject(); p.house.rooms[0].walls[0].heightFt = 30; p.house.rooms[0].walls[1].lengthFt = 40; const c = codes(p);
    expect(c.has('WARNING:WALL_HEIGHT_ODD')).toBe(true); expect(c.has('WARNING:WALL_LENGTH_ODD')).toBe(true);
  });
  it('the reference house itself raises neither warning', () => { const c = codes(buildProject()); expect(c.has('WARNING:WALL_HEIGHT_ODD')).toBe(false); expect(c.has('WARNING:WALL_LENGTH_ODD')).toBe(false); });
  it('an "unconditioned" space warmer than the winter setpoint, or cooler than the summer setpoint, warns about a credit', () => {
    const p = buildProject(); p.house.rooms[0].ceiling.adjacentHeatTempF = 90; p.house.rooms[0].ceiling.adjacentCoolTempF = 60; const c = codes(p);
    expect(c.has('WARNING:ADJ_WINTER_WARM')).toBe(true); expect(c.has('WARNING:ADJ_SUMMER_COOL')).toBe(true);
  });
});

describe('project-level reporting of missing inputs, and mode isolation', () => {
  it('missing design temperatures are reported once at project level and stop only their own mode', () => {
    const p = buildProject(); p.design.heatOutdoorF = null; const r = calculate(p);
    expect(r.issues.some(i => i.code === 'NO_DESIGN_TEMPS_HEAT' && i.severity === 'ERROR' && i.where === 'design-heating')).toBe(true); expect(r.rooms[0].heating).toBeNull(); expect(r.rooms[0].coolingSensible).not.toBeNull();
  });
  it('missing humidity affects only the latent load and is a project-level error', () => {
    const p = buildProject(); p.design.outdoorGrainsCool = null; const r = calculate(p);
    expect(r.issues.some(i => i.code === 'NO_HUMIDITY')).toBe(true); expect(r.rooms[0].coolingLatent).toBeNull(); expect(r.rooms[0].coolingSensible).not.toBeNull(); expect(r.rooms[0].heating).not.toBeNull();
  });
  it('missing ACH is a project-level error per season', () => { const p = buildProject(); p.infiltration.heatAch = unknown(); const r = calculate(p); expect(r.issues.some(i => i.code === 'NO_ACH_HEAT')).toBe(true); expect(r.rooms[0].heating).toBeNull(); expect(r.rooms[0].coolingSensible).not.toBeNull(); });
});

describe('quality summary counts distinct inputs once', () => {
  it('two rooms sharing one wall construction count it once, not once per surface or mode', () => {
    const p = buildProject(); const r2 = structuredClone(p.house.rooms[0]); r2.id = 'r2'; r2.walls.forEach((w, i) => (w.id = 'x' + i)); r2.walls.forEach(w => w.openings.forEach((o, i) => (o.id = 'ox' + i + w.id))); p.house.rooms.push(r2);
    const one = calculate(buildProject()).qualityCounts, two = calculate(p).qualityCounts;
    expect(two.KNOWN).toBe(one.KNOWN); // same distinct inputs; nothing new was entered
  });
  it('the user-typed appliance gain is not claimed to be KNOWN', () => {
    const p = buildProject(); p.house.rooms[0].applianceSensibleBtuh = 500; const c = calculate(p).rooms[0].coolingSensible!.components.find(x => x.label.startsWith('Appliances'))!; expect(c.quality).toBe('ESTIMATED');
  });
});

describe('report robustness and honesty', () => {
  it('a room that fails with an internal error does not crash report generation', () => {
    const p = buildProject(); (p.house.rooms[0] as unknown as { ceiling: unknown }).ceiling = null; let html = ''; expect(() => (html = renderReportHtml(p, calculate(p)))).not.toThrow(); expect(html).toMatch(/Internal error|could not be shown/);
  });
  it('fractional delta-T is shown with its decimal and negative zero never prints', () => {
    const p = buildProject(); p.design.heatOutdoorF = 7.5; const html = renderReportHtml(p, calculate(p)); expect(html).toContain('62.5'); expect(html).not.toContain('-0<');
  });
});

describe('persistence does not invent plausible values', () => {
  it('a missing opening quantity becomes invalid (0), not 1', () => { const raw = JSON.parse(JSON.stringify(buildProject())); delete raw.house.rooms[0].walls[0].openings[0].quantity; const m = migrate(raw); expect(m.house.rooms[0].walls[0].openings[0].quantity).toBe(0); expect(codes(m).has('ERROR:OPENING_DIMS')).toBe(true); });
  it('a device/AR measurement with no confirmation flag is treated as unconfirmed', () => { const raw = JSON.parse(JSON.stringify(buildProject())); raw.house.rooms[0].walls[0].measurement = { method: 'ar' }; const m = migrate(raw); expect(m.house.rooms[0].walls[0].measurement.confirmed).toBe(false); expect(codes(m).has('ERROR:UNCONFIRMED_MEASURE')).toBe(true); });
  it('manual measurements default to confirmed', () => { const raw = JSON.parse(JSON.stringify(buildProject())); delete raw.house.rooms[0].walls[0].measurement; expect(migrate(raw).house.rooms[0].walls[0].measurement).toEqual({ method: 'manual', confirmed: true }); });
});
