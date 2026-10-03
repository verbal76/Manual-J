import type { Assembly, AssemblyKind, DesignConditions, Opening, Project, Room, Sourced, Wall } from '../engine/types';
import { normalizeHeading } from '../engine/geometry';

export const SCHEMA_VERSION = 1;
export const uid = (): string => (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
export const unknown = <T>(): Sourced<T> => ({ value: null, quality: 'UNKNOWN' });
export const sourced = <T>(value: T, quality: Sourced<T>['quality'], source?: string): Sourced<T> => ({ value, quality, source });

export function newDesign(): DesignConditions {
  return { location: '', source: '', elevationFt: null, heatOutdoorF: null, coolOutdoorF: null, heatIndoorF: null, coolIndoorF: null, outdoorGrainsCool: null, indoorGrainsCool: null, solarGain: {} };
}
export function newProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION, id: uid(), name, client: '', address: '', createdAt: now, updatedAt: now,
    design: newDesign(),
    infiltration: { heatAch: unknown(), coolAch: unknown() },
    internal: { sensiblePerPersonBtuh: unknown(), latentPerPersonBtuh: unknown() },
    assemblies: [], house: { name: 'House', rooms: [] },
  };
}
export function newAssembly(kind: AssemblyKind, name: string, descriptors: Record<string, string> = {}): Assembly {
  return { id: uid(), kind, name, descriptors, u: unknown() };
}
export function newOpening(kind: 'window' | 'door', widthFt: number, heightFt: number, assemblyId: string | null = null): Opening {
  return { id: uid(), kind, quantity: 1, widthFt, heightFt, assemblyId, shgc: unknown(), shading: 'unknown' };
}
export function newWall(label: string, lengthFt: number, heightFt: number, headingDeg: number | null): Wall {
  return {
    id: uid(), label, heading: { deg: headingDeg === null ? null : normalizeHeading(headingDeg), source: 'manual', confidence: null },
    lengthFt, heightFt, measurement: { method: 'manual', confirmed: true },
    exposure: { type: 'exterior', adjacentHeatTempF: null, adjacentCoolTempF: null },
    assemblyId: null, openings: [],
  };
}
/** Rectangular room with four walls. frontHeadingDeg = outward heading of the first (length-side) wall; others follow clockwise. */
export function newRoom(name: string, lengthFt: number, widthFt: number, ceilingHeightFt: number, frontHeadingDeg: number | null): Room {
  const h = (k: number) => (frontHeadingDeg === null ? null : frontHeadingDeg + 90 * k);
  return {
    id: uid(), name, floorLevel: 1, lengthFt, widthFt, ceilingHeightFt,
    placement: { xFt: 0, yFt: 0, rotationDeg: 0 },
    walls: [newWall('Wall 1', lengthFt, ceilingHeightFt, h(0)), newWall('Wall 2', widthFt, ceilingHeightFt, h(1)), newWall('Wall 3', lengthFt, ceilingHeightFt, h(2)), newWall('Wall 4', widthFt, ceilingHeightFt, h(3))],
    ceiling: { condition: 'unconditioned', assemblyId: null, adjacentHeatTempF: null, adjacentCoolTempF: null },
    floor: { condition: 'conditioned-adjacent', assemblyId: null, adjacentHeatTempF: null, adjacentCoolTempF: null },
    occupants: 0, applianceSensibleBtuh: 0,
  };
}
