import type { Cardinal, HorizontalSurface, Opening, Room, Wall } from './types';

export const roomFloorArea = (r: Room) => r.lengthFt * r.widthFt;
export const roomVolume = (r: Room) => r.lengthFt * r.widthFt * r.ceilingHeightFt;
export const openingArea = (o: Opening) => o.quantity * o.widthFt * o.heightFt;
export const wallGross = (w: Wall) => w.lengthFt * w.heightFt;
export const wallOpeningArea = (w: Wall) => w.openings.reduce((s, o) => s + openingArea(o), 0);
export const wallNet = (w: Wall) => wallGross(w) - wallOpeningArea(w);

const CARDS: Cardinal[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function normalizeHeading(deg: number): number { return ((deg % 360) + 360) % 360; }
/** Outward-facing compass heading (0=N, clockwise) -> 8-point cardinal. */
export function cardinalFromHeading(deg: number | null): Cardinal | null {
  if (deg === null || !isFinite(deg)) return null;
  return CARDS[Math.round(normalizeHeading(deg) / 45) % 8];
}
/** Ceiling/floor area: explicit override (sloped roof etc.) or the room's floor area. */
export const horizontalArea = (r: Room, h: HorizontalSurface) => (typeof h.areaFt2 === 'number' && h.areaFt2 > 0 ? h.areaFt2 : roomFloorArea(r));
