import type { Assembly, Issue, Project, Room } from './types';
import { openingArea, roomFloorArea, wallGross, wallOpeningArea } from './geometry';

const e = (code: string, message: string, where?: string): Issue => ({ severity: 'ERROR', code, message, where });
const w = (code: string, message: string, where?: string): Issue => ({ severity: 'WARNING', code, message, where });
const i = (code: string, message: string, where?: string): Issue => ({ severity: 'INFO', code, message, where });
const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const pos = (n: unknown): n is number => fin(n) && n > 0;
const okTemp = (t: number | null) => t === null || (fin(t) && t > -80 && t < 150);
const okAdj = (t: number | null) => t === null || (fin(t) && t > -80 && t < 170);

// Plausibility limits. These are sanity bounds to catch typos (e.g. 96 ft ceiling from "96" meant as inches),
// not engineering data: errors mean "cannot be physical", warnings mean "check this".
export const LIMITS = {
  roomDimErrFt: 250, roomDimWarnFt: 60, ceilingMinWarnFt: 6, ceilingMaxWarnFt: 20, ceilingMaxErrFt: 60,
  achErr: 20, achWarn: 3, grainsMax: 500, elevMin: -500, elevMax: 20000,
  uMaxErr: 6, uOpaqueWarn: 1.5, uMinWarn: 0.005, perPersonMax: 2000, occupantsMax: 200, applianceMaxBtuh: 200000, solarMax: 1000,
};

export function validateAssembly(a: Assembly): Issue[] {
  const out: Issue[] = []; const where = `Construction "${a.name}"`;
  if (a.u.value === null) return out; // UNKNOWN is handled where it is used
  if (!pos(a.u.value)) out.push(e('U_INVALID', 'Thermal value must be a positive number.', where));
  else if (a.u.value > LIMITS.uMaxErr) out.push(e('U_IMPLAUSIBLE', `U ${a.u.value.toFixed(2)} is higher than any real assembly (check R vs U entry).`, where));
  else if (a.u.value < LIMITS.uMinWarn) out.push(w('U_VERY_LOW', `U ${a.u.value} means R-${(1 / a.u.value).toFixed(0)}; check you did not enter U as R.`, where));
  else if ((a.kind === 'wall' || a.kind === 'roof-ceiling' || a.kind === 'floor') && a.u.value > LIMITS.uOpaqueWarn) out.push(w('U_OPAQUE_HIGH', `U ${a.u.value.toFixed(2)} (R-${(1 / a.u.value).toFixed(1)}) is very poor for a wall/ceiling/floor; check the entry.`, where));
  return out;
}

export function validateDesign(p: Project): Issue[] {
  const d = p.design; const out: Issue[] = [];
  for (const [k, v] of [['heatOutdoorF', d.heatOutdoorF], ['coolOutdoorF', d.coolOutdoorF], ['heatIndoorF', d.heatIndoorF], ['coolIndoorF', d.coolIndoorF]] as const)
    if (!okTemp(v)) out.push(e('TEMP_RANGE', `Temperature ${k} is outside a plausible range (-80..150 F).`, 'design'));
  if (d.heatOutdoorF !== null && d.heatIndoorF !== null && d.heatOutdoorF >= d.heatIndoorF)
    out.push(e('HEAT_DT', 'Outdoor heating design temperature must be below the indoor heating target.', 'design'));
  if (d.coolOutdoorF !== null && d.coolIndoorF !== null && d.coolOutdoorF <= d.coolIndoorF)
    out.push(e('COOL_DT', 'Outdoor cooling design temperature must be above the indoor cooling target.', 'design'));
  if (d.heatIndoorF !== null && (d.heatIndoorF < 55 || d.heatIndoorF > 80)) out.push(w('HEAT_INDOOR_ODD', 'Indoor heating target is outside the usual 55–80 °F range.', 'design'));
  if (d.coolIndoorF !== null && (d.coolIndoorF < 68 || d.coolIndoorF > 82)) out.push(w('COOL_INDOOR_ODD', 'Indoor cooling target is outside the usual 68–82 °F range.', 'design'));
  for (const [k, v] of [['outdoorGrainsCool', d.outdoorGrainsCool], ['indoorGrainsCool', d.indoorGrainsCool]] as const)
    if (v !== null && (!fin(v) || v < 0 || v > LIMITS.grainsMax)) out.push(e('GRAINS_RANGE', `Humidity ratio ${k} must be 0–${LIMITS.grainsMax} grains/lb.`, 'design'));
  if (d.elevationFt !== null && (!fin(d.elevationFt) || d.elevationFt < LIMITS.elevMin || d.elevationFt > LIMITS.elevMax)) out.push(e('ELEV_RANGE', 'Elevation is outside a plausible range.', 'design'));
  for (const [c, v] of Object.entries(d.solarGain)) if (v !== undefined && (!fin(v) || v < 0 || v > LIMITS.solarMax)) out.push(e('SOLAR_RANGE', `Solar gain factor for ${c} must be 0–${LIMITS.solarMax}.`, 'design'));
  if (!d.source.trim()) out.push(w('NO_DESIGN_SOURCE', 'Design conditions have no stated source.', 'design'));
  if (d.elevationFt !== null && d.elevationFt > 2000) out.push(w('ELEVATION', 'Elevation is above 2000 ft; no air-density correction is applied, so air-side loads are overstated.', 'design'));
  if (d.elevationFt === null) out.push(i('NO_ELEVATION', 'Elevation not entered (no altitude correction is applied in any case).', 'design'));
  // house-level inputs
  for (const [k, s] of [['Heating air changes', p.infiltration.heatAch], ['Cooling air changes', p.infiltration.coolAch]] as const) {
    if (s.value === null) continue;
    if (!fin(s.value) || s.value < 0 || s.value > LIMITS.achErr) out.push(e('ACH_RANGE', `${k} must be between 0 and ${LIMITS.achErr} per hour.`, 'infiltration'));
    else if (s.value > LIMITS.achWarn) out.push(w('ACH_HIGH', `${k} of ${s.value}/h is very leaky; check the entry.`, 'infiltration'));
  }
  for (const [k, s] of [['Occupant sensible', p.internal.sensiblePerPersonBtuh], ['Occupant latent', p.internal.latentPerPersonBtuh]] as const)
    if (s.value !== null && (!fin(s.value) || s.value < 0 || s.value > LIMITS.perPersonMax)) out.push(e('PERSON_RANGE', `${k} per person must be 0–${LIMITS.perPersonMax} Btu/h.`, 'internal gains'));
  return out;
}

export function validateRoom(p: Project, r: Room): Issue[] {
  const out: Issue[] = []; const at = (s: string) => `${r.name} > ${s}`;
  if (!pos(r.lengthFt) || !pos(r.widthFt) || !pos(r.ceilingHeightFt))
    out.push(e('ROOM_DIMS', 'Room length, width and ceiling height must be greater than zero.', r.name));
  else {
    if (r.lengthFt > LIMITS.roomDimErrFt || r.widthFt > LIMITS.roomDimErrFt || r.ceilingHeightFt > LIMITS.ceilingMaxErrFt) out.push(e('ROOM_IMPLAUSIBLE', 'A room dimension is larger than any real room (check feet vs inches).', r.name));
    else if (r.lengthFt > LIMITS.roomDimWarnFt || r.widthFt > LIMITS.roomDimWarnFt) out.push(w('ROOM_LARGE', 'Room is over 60 ft in one direction; check the entry.', r.name));
    if (r.ceilingHeightFt < LIMITS.ceilingMinWarnFt || (r.ceilingHeightFt > LIMITS.ceilingMaxWarnFt && r.ceilingHeightFt <= LIMITS.ceilingMaxErrFt)) out.push(w('CEILING_ODD', `Ceiling height ${r.ceilingHeightFt.toFixed(1)} ft is unusual; check the entry.`, r.name));
  }
  if (!Number.isInteger(r.occupants) || r.occupants < 0 || r.occupants > LIMITS.occupantsMax) out.push(e('OCCUPANTS', 'Occupants must be a whole number from 0 to 200.', r.name));
  if (!fin(r.applianceSensibleBtuh) || r.applianceSensibleBtuh < 0 || r.applianceSensibleBtuh > LIMITS.applianceMaxBtuh) out.push(e('APPLIANCE', 'Appliance/lighting gain must be 0 or more (Btu/h).', r.name));
  const ids = new Set<string>();
  for (const wall of r.walls) {
    if (ids.has(wall.id)) out.push(e('DUP_WALL', 'Duplicate wall id.', at(wall.label)));
    ids.add(wall.id);
    if (!pos(wall.lengthFt) || !pos(wall.heightFt)) out.push(e('WALL_DIMS', 'Wall length and height must be greater than zero.', at(wall.label)));
    else if (wall.lengthFt > LIMITS.roomDimErrFt || wall.heightFt > LIMITS.ceilingMaxErrFt) out.push(e('WALL_IMPLAUSIBLE', 'Wall dimension is larger than any real wall (check feet vs inches).', at(wall.label)));
    if (wall.heading.deg === null || !fin(wall.heading.deg)) out.push(wall.exposure.type === 'exterior' ? e('NO_HEADING', 'Exterior wall has no orientation.', at(wall.label)) : i('NO_HEADING', 'Wall orientation not set.', at(wall.label)));
    else if (wall.heading.deg < 0 || wall.heading.deg >= 360) out.push(e('BAD_HEADING', 'Orientation must be 0 to <360 degrees.', at(wall.label)));
    if (wall.heading.source === 'compass' && (wall.heading.confidence ?? 0) < 0.5) out.push(w('LOW_COMPASS', 'Compass reading has low/unknown confidence; confirm orientation manually.', at(wall.label)));
    if (wall.measurement.method !== 'manual' && !wall.measurement.confirmed) out.push(e('UNCONFIRMED_MEASURE', 'Device/camera measurement is not confirmed by the user.', at(wall.label)));
    if (!okAdj(wall.exposure.adjacentHeatTempF) || !okAdj(wall.exposure.adjacentCoolTempF)) out.push(e('ADJ_TEMP_RANGE', 'Adjoining-space temperature is outside a plausible range.', at(wall.label)));
    if (wallOpeningArea(wall) > wallGross(wall) + 1e-9) out.push(e('OPENING_TOO_BIG', 'Openings are larger than the wall.', at(wall.label)));
    for (const o of wall.openings) {
      if (!pos(o.widthFt) || !pos(o.heightFt) || !Number.isInteger(o.quantity) || o.quantity < 1)
        out.push(e('OPENING_DIMS', 'Opening needs a positive size and a whole quantity.', at(wall.label)));
      else if (o.widthFt > 30 || o.heightFt > 30) out.push(e('OPENING_IMPLAUSIBLE', 'Opening dimension over 30 ft; check inches vs feet.', at(wall.label)));
      if (o.widthFt > wall.lengthFt + 1e-9 || o.heightFt > wall.heightFt + 1e-9) out.push(w('OPENING_EXCEEDS_WALL', 'An opening is larger than the wall in one dimension.', at(wall.label)));
      if (openingArea(o) > 0 && o.kind === 'window' && o.shgc.value !== null && (!fin(o.shgc.value) || o.shgc.value <= 0 || o.shgc.value > 1)) out.push(e('SHGC_RANGE', 'SHGC must be between 0 and 1.', at(wall.label)));
    }
  }
  for (const [h, name] of [[r.ceiling, 'Ceiling'], [r.floor, 'Floor']] as const) {
    if (!okAdj(h.adjacentHeatTempF) || !okAdj(h.adjacentCoolTempF)) out.push(e('ADJ_TEMP_RANGE', 'Adjoining-space temperature is outside a plausible range.', at(name)));
    if (h.areaFt2 !== undefined && h.areaFt2 !== null) {
      const fa = roomFloorArea(r);
      if (!pos(h.areaFt2) || h.areaFt2 > 100000) out.push(e('AREA_RANGE', `${name} area must be a positive number.`, at(name)));
      else if (pos(fa) && (h.areaFt2 < 0.5 * fa || h.areaFt2 > 3 * fa)) out.push(w('AREA_ODD', `${name} area ${h.areaFt2.toFixed(0)} ft² is far from the floor area ${fa.toFixed(0)} ft²; check the entry.`, at(name)));
    }
  }
  if (r.walls.filter(x => x.exposure.type === 'exterior').length === 0) out.push(i('NO_EXT_WALL', 'Room has no exterior walls.', r.name));
  if (r.walls.length < 3) out.push(w('FEW_WALLS', 'Fewer than 3 walls recorded; the envelope may be incomplete.', r.name));
  return out;
}

export function validateProject(p: Project): Issue[] {
  const out = validateDesign(p);
  for (const a of p.assemblies) out.push(...validateAssembly(a));
  const ids = new Set<string>();
  for (const r of p.house.rooms) { if (ids.has(r.id)) out.push(e('DUP_ROOM', 'Duplicate room id.', r.name)); ids.add(r.id); }
  if (p.house.rooms.length === 0) out.push(e('NO_ROOMS', 'No rooms entered.'));
  return out;
}
