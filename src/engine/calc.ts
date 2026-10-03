import type { Assembly, CalcResult, Component, HorizontalSurface, Issue, ModeResult, Project, Quality, Room, RoomResult, Sourced } from './types';
import { cardinalFromHeading, openingArea, roomFloorArea, roomVolume, wallGross, wallNet, wallOpeningArea } from './geometry';
import { validateProject, validateRoom } from './validate';
import { AIR_LATENT_FACTOR_PER_LB_LB, AIR_SENSIBLE_FACTOR, ENGINE_VERSION, MIN_PER_HR } from './provenance';
import { GRAINS_PER_LB } from './units';

const err = (code: string, message: string, where?: string): Issue => ({ severity: 'ERROR', code, message, where });
const warn = (code: string, message: string, where?: string): Issue => ({ severity: 'WARNING', code, message, where });
const info = (code: string, message: string, where?: string): Issue => ({ severity: 'INFO', code, message, where });

export const airSensible = (cfm: number, dT: number) => AIR_SENSIBLE_FACTOR * cfm * dT;
export const airLatent = (cfm: number, dGrains: number) => AIR_LATENT_FACTOR_PER_LB_LB * cfm * (dGrains / GRAINS_PER_LB);
export const achToCfm = (ach: number, volumeFt3: number) => ach * volumeFt3 / MIN_PER_HR;

type Mode = 'heat' | 'cool';

export function calculate(p: Project): CalcResult {
  const issues: Issue[] = validateProject(p);
  const asm = new Map<string, Assembly>(p.assemblies.map(a => [a.id, a]));
  const q: Record<Quality, number> = { KNOWN: 0, SELECTED: 0, ESTIMATED: 0, DEFAULTED: 0, UNKNOWN: 0 };
  const rooms: RoomResult[] = [];
  const designBlocked = issues.some(x => x.severity === 'ERROR' && x.where === 'design');

  for (const r of p.house.rooms) rooms.push(calcRoom(p, r, asm, q, designBlocked));
  const sum = (sel: (r: RoomResult) => ModeResult | null) => rooms.every(r => sel(r)) && rooms.length > 0 ? rooms.reduce((s, r) => s + sel(r)!.btuh, 0) : null;
  const heating = sum(r => r.heating), cs = sum(r => r.coolingSensible), cl = sum(r => r.coolingLatent);
  const notIncluded = [
    'Duct gains/losses (no duct method implemented)',
    'Mechanical ventilation loads',
    'Opaque-surface solar and thermal-mass cooling effects (no sourced CLTD-type data)',
    'Slab-on-grade, below-grade and crawlspace floor losses (no sourced method)',
    'Altitude air-density correction',
    'Window solar gain unless the user supplied orientation factors',
  ];
  const complete = { heating: heating !== null, coolingSensible: cs !== null, coolingLatent: cl !== null };
  return {
    engineVersion: ENGINE_VERSION, rooms, issues, notIncluded, complete, qualityCounts: q,
    totals: { heating, coolingSensible: cs, coolingLatent: cl, coolingTotal: cs !== null && cl !== null ? cs + cl : null },
  };
}

function calcRoom(p: Project, r: Room, asm: Map<string, Assembly>, q: Record<Quality, number>, designBlocked: boolean): RoomResult {
  const issues = validateRoom(p, r);
  const d = p.design;
  const blocked = issues.some(x => x.severity === 'ERROR') || designBlocked;
  const walls = r.walls.map(w => ({
    wallId: w.id, label: w.label, cardinal: cardinalFromHeading(w.heading.deg),
    grossFt2: wallGross(w), openingFt2: wallOpeningArea(w), netFt2: wallNet(w),
  }));
  const res: RoomResult = { roomId: r.id, name: r.name, floorAreaFt2: roomFloorArea(r), volumeFt3: roomVolume(r), heating: null, coolingSensible: null, coolingLatent: null, walls, issues };
  if (blocked) { issues.push(err('ROOM_NOT_CALCULATED', 'Room has blocking errors or the design conditions are incomplete; no loads computed.', r.name)); return res; }

  const tally = (qual: Quality) => { q[qual]++; };
  const getU = (id: string | null, what: string, mode: Mode, comps: Component[]): { u: number; quality: Quality } | null => {
    const a = id ? asm.get(id) : undefined;
    if (!a) { issues.push(err('NO_ASSEMBLY', `${what}: no construction selected.`, r.name)); return null; }
    if (a.u.value === null || !(a.u.value > 0)) { issues.push(err('U_UNKNOWN', `${what}: construction "${a.name}" has no thermal value (UNKNOWN). Enter a known or estimated value.`, r.name)); return null; }
    if (mode === 'heat') tally(a.u.quality);
    if (a.u.quality === 'ESTIMATED' || a.u.quality === 'DEFAULTED') { if (mode === 'heat') issues.push(info('U_ASSUMED', `${what}: "${a.name}" thermal value is ${a.u.quality}.`, r.name)); }
    void comps; return { u: a.u.value, quality: a.u.quality };
  };

  const run = (mode: Mode): ModeResult | null => {
    const tIn = mode === 'heat' ? d.heatIndoorF! : d.coolIndoorF!;
    const tOut = mode === 'heat' ? d.heatOutdoorF : d.coolOutdoorF;
    if (tIn === null || tOut === null) { issues.push(err('NO_DESIGN_TEMPS', `Missing ${mode === 'heat' ? 'heating' : 'cooling'} design temperatures.`, 'design')); return null; }
    const comps: Component[] = []; let ok = true;
    const add = (label: string, kind: string, area: number, u: number, dT: number, quality: Quality, note?: string) =>
      comps.push({ label, kind, areaFt2: area, u, deltaT: dT, btuh: u * area * dT, quality, note });
    const adjDT = (adj: number | null, what: string): number | null => {
      if (adj === null) { issues.push(err('NO_ADJ_TEMP', `${what}: temperature of the adjoining unconditioned space is required (${mode === 'heat' ? 'winter' : 'summer'}).`, r.name)); ok = false; return null; }
      return mode === 'heat' ? tIn - adj : adj - tIn;
    };
    for (const w of r.walls) {
      const name = `${r.name} / ${w.label}`;
      let dT: number | null;
      if (w.exposure.type === 'interior-conditioned') {
        comps.push({ label: `${w.label} (interior partition)`, kind: 'partition', areaFt2: wallNet(w), btuh: 0, quality: 'KNOWN', note: 'Same conditioned zone: no load' });
        continue;
      }
      dT = w.exposure.type === 'exterior' ? (mode === 'heat' ? tIn - tOut : tOut - tIn)
        : adjDT(mode === 'heat' ? w.exposure.adjacentHeatTempF : w.exposure.adjacentCoolTempF, name);
      if (dT === null) continue;
      const wu = getU(w.assemblyId, `${name} wall`, mode, comps);
      if (!wu) { ok = false; } else add(`${w.label} wall (net)`, 'wall', wallNet(w), wu.u, dT, wu.quality);
      for (const o of w.openings) {
        const ou = getU(o.assemblyId, `${name} ${o.kind}`, mode, comps);
        if (!ou) { ok = false; continue; }
        const area = openingArea(o);
        add(`${w.label} ${o.kind}${o.quantity > 1 ? ` x${o.quantity}` : ''}`, o.kind, area, ou.u, dT, ou.quality);
        if (mode === 'cool' && o.kind === 'window' && w.exposure.type === 'exterior') {
          const card = cardinalFromHeading(w.heading.deg); const f = card ? d.solarGain[card] : undefined;
          if (f === undefined || o.shgc.value === null) issues.push(warn('NO_SOLAR', `${name}: window solar gain omitted (needs SHGC and a user-supplied orientation factor).`, r.name));
          else { comps.push({ label: `${w.label} window solar`, kind: 'solar', areaFt2: area, btuh: area * o.shgc.value * f, quality: o.shgc.quality, note: `${card}, user-supplied factor ${f}` }); tally(o.shgc.quality); }
        }
      }
    }
    for (const [h, name] of [[r.ceiling, 'ceiling'], [r.floor, 'floor']] as [HorizontalSurface, string][]) {
      const area = roomFloorArea(r);
      if (h.condition === 'conditioned-adjacent') { comps.push({ label: name, kind: name, areaFt2: area, btuh: 0, quality: 'KNOWN', note: 'Conditioned space on other side: no load' }); continue; }
      if (h.condition === 'ground') { issues.push(warn('GROUND_NOT_CALC', `${r.name} ${name} on/below grade: not calculated (no sourced method). Load omitted.`, r.name)); continue; }
      const dT = h.condition === 'exterior' ? (mode === 'heat' ? tIn - tOut : tOut - tIn) : adjDT(mode === 'heat' ? h.adjacentHeatTempF : h.adjacentCoolTempF, `${r.name} ${name}`);
      if (dT === null) continue;
      const u = getU(h.assemblyId, `${r.name} ${name}`, mode, comps);
      if (!u) { ok = false; continue; }
      add(name, name, area, u.u, dT, u.quality);
    }
    // Infiltration
    const ach: Sourced<number> = mode === 'heat' ? p.infiltration.heatAch : p.infiltration.coolAch;
    if (ach.value === null || ach.value < 0) { issues.push(err('NO_ACH', `${mode === 'heat' ? 'Heating' : 'Cooling'} air-change rate not entered.`, 'infiltration')); ok = false; }
    else {
      const cfm = achToCfm(ach.value, roomVolume(r)); tally(ach.quality);
      comps.push({ label: 'Infiltration (sensible)', kind: 'infiltration', btuh: airSensible(cfm, mode === 'heat' ? tIn - tOut : tOut - tIn), deltaT: mode === 'heat' ? tIn - tOut : tOut - tIn, quality: ach.quality, note: `${cfm.toFixed(1)} CFM from ${ach.value} ACH` });
    }
    if (mode === 'cool') {
      if (r.occupants > 0) {
        const s = p.internal.sensiblePerPersonBtuh;
        if (s.value === null) issues.push(warn('NO_PERSON_SENS', `${r.name}: occupant sensible gain omitted (per-person value not entered).`, r.name));
        else { comps.push({ label: `Occupants x${r.occupants} (sensible)`, kind: 'internal', btuh: r.occupants * s.value, quality: s.quality }); tally(s.quality); }
      }
      if (r.applianceSensibleBtuh > 0) comps.push({ label: 'Appliances/lighting (entered)', kind: 'internal', btuh: r.applianceSensibleBtuh, quality: 'KNOWN' });
    }
    if (!ok) return null;
    return { btuh: comps.reduce((s, c) => s + c.btuh, 0), components: comps };
  };

  res.heating = run('heat');
  res.coolingSensible = run('cool');

  // Latent (cooling): infiltration + occupants
  if (res.coolingSensible) {
    const comps: Component[] = []; let ok = true;
    const dG = d.outdoorGrainsCool !== null && d.indoorGrainsCool !== null ? d.outdoorGrainsCool - d.indoorGrainsCool : null;
    if (dG === null) { issues.push(err('NO_HUMIDITY', 'Cooling humidity ratios (outdoor/indoor, grains/lb) not entered; latent load not computed.', 'design')); ok = false; }
    else {
      if (dG < 0) issues.push(warn('NEG_LATENT', 'Outdoor humidity ratio is below indoor; infiltration latent load is negative (dehumidifying credit).', 'design'));
      const cfm = achToCfm(p.infiltration.coolAch.value!, roomVolume(r));
      comps.push({ label: 'Infiltration (latent)', kind: 'infiltration', btuh: airLatent(cfm, dG), quality: p.infiltration.coolAch.quality, note: `${cfm.toFixed(1)} CFM, dW ${dG} gr/lb` });
    }
    if (r.occupants > 0) {
      const l = p.internal.latentPerPersonBtuh;
      if (l.value === null) issues.push(warn('NO_PERSON_LAT', `${r.name}: occupant latent gain omitted (per-person value not entered).`, r.name));
      else { comps.push({ label: `Occupants x${r.occupants} (latent)`, kind: 'internal', btuh: r.occupants * l.value, quality: l.quality }); tally(l.quality); }
    }
    res.coolingLatent = ok ? { btuh: comps.reduce((s, c) => s + c.btuh, 0), components: comps } : null;
  }
  const seen = new Set<string>();
  res.issues = issues.filter(x => { const k = `${x.severity}|${x.code}|${x.where}|${x.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return res;
}
