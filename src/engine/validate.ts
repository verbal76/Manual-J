import type { Issue, Project, Room } from './types';
import { openingArea, wallGross, wallOpeningArea } from './geometry';

const e = (code: string, message: string, where?: string): Issue => ({ severity: 'ERROR', code, message, where });
const w = (code: string, message: string, where?: string): Issue => ({ severity: 'WARNING', code, message, where });
const i = (code: string, message: string, where?: string): Issue => ({ severity: 'INFO', code, message, where });
const pos = (n: number) => typeof n === 'number' && isFinite(n) && n > 0;
const okTemp = (t: number | null) => t === null || (isFinite(t) && t > -80 && t < 150);

export function validateDesign(p: Project): Issue[] {
  const d = p.design; const out: Issue[] = [];
  for (const [k, v] of [['heatOutdoorF', d.heatOutdoorF], ['coolOutdoorF', d.coolOutdoorF], ['heatIndoorF', d.heatIndoorF], ['coolIndoorF', d.coolIndoorF]] as const)
    if (!okTemp(v)) out.push(e('TEMP_RANGE', `Temperature ${k} is outside a plausible range (-80..150 F).`, 'design'));
  if (d.heatOutdoorF !== null && d.heatIndoorF !== null && d.heatOutdoorF >= d.heatIndoorF)
    out.push(e('HEAT_DT', 'Outdoor heating design temperature must be below the indoor heating target.', 'design'));
  if (d.coolOutdoorF !== null && d.coolIndoorF !== null && d.coolOutdoorF <= d.coolIndoorF)
    out.push(e('COOL_DT', 'Outdoor cooling design temperature must be above the indoor cooling target.', 'design'));
  if (!d.source.trim()) out.push(w('NO_DESIGN_SOURCE', 'Design conditions have no stated source.', 'design'));
  if (d.elevationFt !== null && d.elevationFt > 2000) out.push(w('ELEVATION', 'Elevation is above 2000 ft; no air-density correction is applied, so air-side loads are overstated.', 'design'));
  if (d.elevationFt === null) out.push(i('NO_ELEVATION', 'Elevation not entered (no altitude correction is applied in any case).', 'design'));
  return out;
}

export function validateRoom(p: Project, r: Room): Issue[] {
  const out: Issue[] = []; const at = (s: string) => `${r.name} > ${s}`;
  if (!pos(r.lengthFt) || !pos(r.widthFt) || !pos(r.ceilingHeightFt))
    out.push(e('ROOM_DIMS', 'Room length, width and ceiling height must be greater than zero.', r.name));
  const ids = new Set<string>();
  for (const wall of r.walls) {
    if (ids.has(wall.id)) out.push(e('DUP_WALL', 'Duplicate wall id.', at(wall.label)));
    ids.add(wall.id);
    if (!pos(wall.lengthFt) || !pos(wall.heightFt)) out.push(e('WALL_DIMS', 'Wall length and height must be greater than zero.', at(wall.label)));
    if (wall.heading.deg === null || !isFinite(wall.heading.deg)) out.push(wall.exposure.type === 'exterior' ? e('NO_HEADING', 'Exterior wall has no orientation.', at(wall.label)) : i('NO_HEADING', 'Wall orientation not set.', at(wall.label)));
    else if (wall.heading.deg < 0 || wall.heading.deg >= 360) out.push(e('BAD_HEADING', 'Orientation must be 0 to <360 degrees.', at(wall.label)));
    if (wall.heading.source === 'compass' && (wall.heading.confidence ?? 0) < 0.5) out.push(w('LOW_COMPASS', 'Compass reading has low/unknown confidence; confirm orientation manually.', at(wall.label)));
    if (wall.measurement.method !== 'manual' && !wall.measurement.confirmed) out.push(e('UNCONFIRMED_MEASURE', 'Device/camera measurement is not confirmed by the user.', at(wall.label)));
    if (wallOpeningArea(wall) > wallGross(wall) + 1e-9) out.push(e('OPENING_TOO_BIG', 'Openings are larger than the wall.', at(wall.label)));
    for (const o of wall.openings) {
      if (!pos(o.widthFt) || !pos(o.heightFt) || !Number.isInteger(o.quantity) || o.quantity < 1)
        out.push(e('OPENING_DIMS', 'Opening needs a positive size and a whole quantity.', at(wall.label)));
      if (o.widthFt > wall.lengthFt + 1e-9 || o.heightFt > wall.heightFt + 1e-9) out.push(w('OPENING_EXCEEDS_WALL', 'An opening is larger than the wall in one dimension.', at(wall.label)));
      if (openingArea(o) > 0 && o.kind === 'window' && o.shgc.value !== null && (o.shgc.value <= 0 || o.shgc.value > 1)) out.push(e('SHGC_RANGE', 'SHGC must be between 0 and 1.', at(wall.label)));
    }
  }
  if (r.walls.filter(x => x.exposure.type === 'exterior').length === 0) out.push(i('NO_EXT_WALL', 'Room has no exterior walls.', r.name));
  if (r.walls.length < 3) out.push(w('FEW_WALLS', 'Fewer than 3 walls recorded; the envelope may be incomplete.', r.name));
  return out;
}

export function validateProject(p: Project): Issue[] {
  const out = validateDesign(p);
  const ids = new Set<string>();
  for (const r of p.house.rooms) { if (ids.has(r.id)) out.push(e('DUP_ROOM', 'Duplicate room id.', r.name)); ids.add(r.id); }
  if (p.house.rooms.length === 0) out.push(e('NO_ROOMS', 'No rooms entered.'));
  return out;
}
