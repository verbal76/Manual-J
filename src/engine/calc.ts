import type { Assembly, AssemblyKind, CalcResult, Component, HorizontalSurface, Issue, ModeResult, Project, Quality, Room, RoomResult } from './types';
import { cardinalFromHeading, horizontalArea, openingArea, roomFloorArea, roomVolume, wallGross, wallNet, wallOpeningArea } from './geometry';
import { validateProject, validateRoom } from './validate';
import { AIR_LATENT_FACTOR_PER_LB_LB, AIR_SENSIBLE_FACTOR, ENGINE_VERSION, MIN_PER_HR } from './provenance';
import { GRAINS_PER_LB } from './units';
import { usable } from './sourced';

const err = (code: string, message: string, where?: string): Issue => ({ severity: 'ERROR', code, message, where });
const warn = (code: string, message: string, where?: string): Issue => ({ severity: 'WARNING', code, message, where });
const info = (code: string, message: string, where?: string): Issue => ({ severity: 'INFO', code, message, where });

export const airSensible = (cfm: number, dT: number) => AIR_SENSIBLE_FACTOR * cfm * dT;
export const airLatent = (cfm: number, dGrains: number) => AIR_LATENT_FACTOR_PER_LB_LB * cfm * (dGrains / GRAINS_PER_LB);
export const achToCfm = (ach: number, volumeFt3: number) => ach * volumeFt3 / MIN_PER_HR;

type Mode = 'heat' | 'cool';
const NOT_INCLUDED = [
  'Duct gains/losses (no duct method implemented)',
  'Mechanical ventilation loads',
  'Opaque-surface solar and thermal-mass cooling effects (no sourced CLTD-type data)',
  'Slab-on-grade, below-grade and crawlspace floor losses (no sourced method)',
  'Altitude air-density correction',
  'Window solar gain unless the user supplied orientation factors',
];
// Blocking design/house errors. Mode-specific ones (design-heating, design-cooling, design-latent, infiltration-*) only stop that mode.
const GLOBAL_BLOCKERS = new Set(['design', 'infiltration', 'internal gains']);

/** Never throws: an unexpected failure becomes a clearly flagged "not calculated" result instead of crashing the app. */
export function calculate(p: Project): CalcResult {
  try { return calculateInner(p); }
  catch (ex) {
    const issue = err('INTERNAL', `Internal error while calculating: ${(ex as Error).message}`);
    return { engineVersion: ENGINE_VERSION, rooms: [], issues: [issue], notIncluded: NOT_INCLUDED, omitted: [], complete: { heating: false, coolingSensible: false, coolingLatent: false },
      qualityCounts: { KNOWN: 0, SELECTED: 0, ESTIMATED: 0, DEFAULTED: 0, UNKNOWN: 0 }, totals: { heating: null, coolingSensible: null, coolingLatent: null, coolingTotal: null } };
  }
}

function calculateInner(p: Project): CalcResult {
  const issues: Issue[] = validateProject(p);
  const asm = new Map<string, Assembly>(p.assemblies.map(a => [a.id, a]));
  const q: Record<Quality, number> = { KNOWN: 0, SELECTED: 0, ESTIMATED: 0, DEFAULTED: 0, UNKNOWN: 0 };
  const seen = new Set<string>(); // each distinct input is counted once in the quality summary
  const tally = (key: string, qual: Quality) => { if (!seen.has(key)) { seen.add(key); q[qual]++; } };
  const rooms: RoomResult[] = [];
  const designBlocked = issues.some(x => x.severity === 'ERROR' && x.where !== undefined && GLOBAL_BLOCKERS.has(x.where));

  for (const r of p.house.rooms) {
    try { rooms.push(calcRoom(p, r, asm, tally, designBlocked)); }
    catch (ex) { // never let one malformed room crash the whole app
      rooms.push({ roomId: r.id, name: r.name, floorAreaFt2: 0, volumeFt3: 0, heating: null, coolingSensible: null, coolingLatent: null, walls: [], omitted: [], issues: [err('INTERNAL', `Internal error while calculating this room: ${(ex as Error).message}`, r.name)] });
    }
  }
  const sum = (sel: (r: RoomResult) => ModeResult | null) => rooms.every(r => sel(r)) && rooms.length > 0 ? rooms.reduce((s, r) => s + sel(r)!.btuh, 0) : null;
  const heating = sum(r => r.heating), cs = sum(r => r.coolingSensible), cl = sum(r => r.coolingLatent);
  const omitted = [...new Set(rooms.flatMap(r => r.omitted))];
  return {
    engineVersion: ENGINE_VERSION, rooms, issues, notIncluded: NOT_INCLUDED, omitted, qualityCounts: q,
    complete: { heating: heating !== null, coolingSensible: cs !== null, coolingLatent: cl !== null },
    totals: { heating, coolingSensible: cs, coolingLatent: cl, coolingTotal: cs !== null && cl !== null ? cs + cl : null },
  };
}

function calcRoom(p: Project, r: Room, asm: Map<string, Assembly>, tally: (key: string, q: Quality) => void, designBlocked: boolean): RoomResult {
  const issues = validateRoom(p, r);
  const d = p.design;
  const omitted: string[] = [];
  const omit = (msg: string) => { if (!omitted.includes(msg)) omitted.push(msg); };
  const blocked = issues.some(x => x.severity === 'ERROR') || designBlocked;
  const walls = r.walls.map(w => ({
    wallId: w.id, label: w.label, cardinal: cardinalFromHeading(w.heading.deg),
    grossFt2: wallGross(w), openingFt2: wallOpeningArea(w), netFt2: wallNet(w),
  }));
  const res: RoomResult = { roomId: r.id, name: r.name, floorAreaFt2: roomFloorArea(r), volumeFt3: roomVolume(r), heating: null, coolingSensible: null, coolingLatent: null, walls, issues, omitted };
  if (blocked) { issues.push(err('ROOM_NOT_CALCULATED', 'Room has blocking errors or the design conditions are incomplete; no loads computed.', r.name)); return res; }

  /** U for a surface; refuses missing, UNKNOWN-tagged, implausible values and constructions of the wrong kind. */
  const getU = (id: string | null, what: string, mode: Mode, kind: AssemblyKind): { u: number; quality: Quality } | null => {
    const a = id ? asm.get(id) : undefined;
    if (!a) { issues.push(err('NO_ASSEMBLY', `${what}: no construction selected.`, r.name)); return null; }
    if (a.kind !== kind) { issues.push(err('ASSEMBLY_KIND', `${what}: "${a.name}" is a ${a.kind} construction but is used as a ${kind}.`, r.name)); return null; }
    if (!usable(a.u) || !(a.u.value > 0 && a.u.value <= 6)) { issues.push(err('U_UNKNOWN', `${what}: construction "${a.name}" has no usable thermal value (UNKNOWN). Enter a known or estimated value.`, r.name)); return null; }
    tally(`asm:${a.id}`, a.u.quality);
    if ((a.u.quality === 'ESTIMATED' || a.u.quality === 'DEFAULTED') && mode === 'heat') issues.push(info('U_ASSUMED', `${what}: "${a.name}" thermal value is ${a.u.quality}.`, r.name));
    return { u: a.u.value, quality: a.u.quality };
  };

  const run = (mode: Mode): ModeResult | null => {
    const tIn = mode === 'heat' ? d.heatIndoorF : d.coolIndoorF;
    const tOut = mode === 'heat' ? d.heatOutdoorF : d.coolOutdoorF;
    if (tIn === null || tOut === null) return null; // reported once at project level (design-heating / design-cooling)
    const ach = mode === 'heat' ? p.infiltration.heatAch : p.infiltration.coolAch;
    if (!usable(ach)) return null;                  // reported once at project level (infiltration-heating / -cooling)
    const comps: Component[] = []; let ok = true;
    const add = (label: string, kind: string, area: number, u: number, dT: number, quality: Quality, note?: string) =>
      comps.push({ label, kind, areaFt2: area, u, deltaT: dT, btuh: u * area * dT, quality, note });
    const adjDT = (adj: number | null, what: string): number | null => {
      if (adj === null) { issues.push(err('NO_ADJ_TEMP', `${what}: temperature of the adjoining unconditioned space is required (${mode === 'heat' ? 'winter' : 'summer'}).`, r.name)); ok = false; return null; }
      return mode === 'heat' ? tIn - adj : adj - tIn;
    };
    const anySolarFactor = Object.values(d.solarGain).some(v => typeof v === 'number');
    for (const w of r.walls) {
      const name = `${r.name} / ${w.label}`;
      if (w.exposure.type === 'interior-conditioned') {
        comps.push({ label: `${w.label} (interior partition)`, kind: 'partition', areaFt2: wallNet(w), btuh: 0, quality: 'KNOWN', note: 'Same conditioned zone: no load' });
        continue;
      }
      const dT = w.exposure.type === 'exterior' ? (mode === 'heat' ? tIn - tOut : tOut - tIn)
        : adjDT(mode === 'heat' ? w.exposure.adjacentHeatTempF : w.exposure.adjacentCoolTempF, name);
      if (dT === null) continue;
      const wu = getU(w.assemblyId, `${name} wall`, mode, 'wall');
      if (!wu) ok = false; else add(`${w.label} wall (net)`, 'wall', wallNet(w), wu.u, dT, wu.quality);
      for (const o of w.openings) {
        const ou = getU(o.assemblyId, `${name} ${o.kind}`, mode, o.kind);
        if (!ou) { ok = false; continue; }
        const area = openingArea(o);
        add(`${w.label} ${o.kind}${o.quantity > 1 ? ` x${o.quantity}` : ''}`, o.kind, area, ou.u, dT, ou.quality);
        if (mode === 'cool' && o.kind === 'window' && w.exposure.type === 'exterior' && anySolarFactor) {
          const card = cardinalFromHeading(w.heading.deg); const f = card ? d.solarGain[card] : undefined;
          if (f === undefined || !usable(o.shgc)) {
            issues.push(warn('NO_SOLAR', `${name}: window solar gain left out (needs an SHGC and a solar factor for this direction).`, r.name));
            omit(`Solar gain of ${r.name} / ${w.label} window (missing SHGC or orientation factor)`);
          } else { comps.push({ label: `${w.label} window solar`, kind: 'solar', areaFt2: area, btuh: area * o.shgc.value * f, quality: o.shgc.quality, note: `${card}, user-supplied factor ${f}` }); tally(`shgc:${o.id}`, o.shgc.quality); }
        }
      }
    }
    for (const [h, name, kind] of [[r.ceiling, 'ceiling', 'roof-ceiling'], [r.floor, 'floor', 'floor']] as [HorizontalSurface, string, AssemblyKind][]) {
      const area = horizontalArea(r, h);
      if (h.condition === 'conditioned-adjacent') { comps.push({ label: name, kind: name, areaFt2: area, btuh: 0, quality: 'KNOWN', note: 'Conditioned space on other side: no load' }); continue; }
      if (h.condition === 'exterior' && !(typeof h.areaFt2 === 'number' && h.areaFt2 > 0) && mode === 'heat') issues.push(warn('ROOF_AREA_ASSUMED', `${r.name} ${name} open to outdoors uses the floor area; a sloped or vaulted roof is larger. Enter the actual area for a correct load.`, r.name));
      if (h.condition === 'ground') {
        issues.push(warn('GROUND_NOT_CALC', `${r.name} ${name} on/below grade: not calculated (no sourced method). Load left out.`, r.name));
        omit(`${r.name} ${name} on/below grade (no sourced slab/below-grade method)`); continue;
      }
      const dT = h.condition === 'exterior' ? (mode === 'heat' ? tIn - tOut : tOut - tIn) : adjDT(mode === 'heat' ? h.adjacentHeatTempF : h.adjacentCoolTempF, `${r.name} ${name}`);
      if (dT === null) continue;
      const u = getU(h.assemblyId, `${r.name} ${name}`, mode, kind);
      if (!u) { ok = false; continue; }
      add(name, name, area, u.u, dT, u.quality);
    }
    const dTair = mode === 'heat' ? tIn - tOut : tOut - tIn;
    const cfm = achToCfm(ach.value, roomVolume(r)); tally(`ach:${mode}`, ach.quality);
    comps.push({ label: 'Infiltration (sensible)', kind: 'infiltration', btuh: airSensible(cfm, dTair), deltaT: dTair, quality: ach.quality, note: `${cfm.toFixed(1)} CFM from ${ach.value} ACH` });
    if (mode === 'cool') {
      if (r.occupants > 0) {
        const s = p.internal.sensiblePerPersonBtuh;
        if (!usable(s)) { issues.push(err('NO_PERSON_SENS', `${r.name}: ${r.occupants} occupant(s) entered but the sensible heat per person is missing in Setup (or set occupants to 0).`, r.name)); ok = false; }
        else { comps.push({ label: `Occupants x${r.occupants} (sensible)`, kind: 'internal', btuh: r.occupants * s.value, quality: s.quality }); tally('person:s', s.quality); }
      }
      if (r.applianceSensibleBtuh > 0) { comps.push({ label: 'Appliances/lighting (entered)', kind: 'internal', btuh: r.applianceSensibleBtuh, quality: 'ESTIMATED', note: 'user-entered, unsourced' }); tally(`appl:${r.id}`, 'ESTIMATED'); }
    }
    if (!ok) return null;
    return { btuh: comps.reduce((s, c) => s + c.btuh, 0), components: comps };
  };

  res.heating = run('heat');
  res.coolingSensible = run('cool');

  // Latent (cooling): infiltration + occupants. Only when sensible cooling exists (same inputs) and humidity is entered.
  if (res.coolingSensible && d.outdoorGrainsCool !== null && d.indoorGrainsCool !== null) {
    const comps: Component[] = []; let ok = true;
    const dG = d.outdoorGrainsCool - d.indoorGrainsCool;
    if (dG < 0) issues.push(warn('NEG_LATENT', 'Outdoor humidity ratio is below indoor; infiltration latent load is negative (dehumidifying credit).', 'design'));
    const ach = p.infiltration.coolAch; // usable: guaranteed by a non-null sensible result
    const cfm = achToCfm(ach.value!, roomVolume(r));
    comps.push({ label: 'Infiltration (latent)', kind: 'infiltration', btuh: airLatent(cfm, dG), quality: ach.quality, note: `${cfm.toFixed(1)} CFM, dW ${dG} gr/lb` });
    if (r.occupants > 0) {
      const l = p.internal.latentPerPersonBtuh;
      if (!usable(l)) { issues.push(err('NO_PERSON_LAT', `${r.name}: ${r.occupants} occupant(s) entered but the latent heat per person is missing in Setup (or set occupants to 0).`, r.name)); ok = false; }
      else { comps.push({ label: `Occupants x${r.occupants} (latent)`, kind: 'internal', btuh: r.occupants * l.value, quality: l.quality }); tally('person:l', l.quality); }
    }
    res.coolingLatent = ok ? { btuh: comps.reduce((s, c) => s + c.btuh, 0), components: comps } : null;
  }
  const dedupe = new Set<string>();
  res.issues = issues.filter(x => { const k = `${x.severity}|${x.code}|${x.where}|${x.message}`; if (dedupe.has(k)) return false; dedupe.add(k); return true; });
  return res;
}
