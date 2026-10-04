// Single authoritative data model. Internal units: feet, ft2, ft3, degF, Btu/h, U in Btu/(h*ft2*degF).
export type Quality = 'KNOWN' | 'SELECTED' | 'ESTIMATED' | 'DEFAULTED' | 'UNKNOWN';
export interface Sourced<T> { value: T | null; quality: Quality; source?: string }
export type Severity = 'ERROR' | 'WARNING' | 'INFO';
export interface Issue { severity: Severity; code: string; message: string; where?: string }

export type AssemblyKind = 'wall' | 'window' | 'door' | 'roof-ceiling' | 'floor';
export interface Assembly {
  id: string; kind: AssemblyKind; name: string;
  /** Practical descriptors the technician picks; they never imply a number on their own. */
  descriptors: Record<string, string>;
  /** Overall U-factor. null = UNKNOWN. Never filled from an unsourced table. */
  u: Sourced<number>;
}

export interface Opening {
  id: string; kind: 'window' | 'door'; quantity: number; widthFt: number; heightFt: number;
  assemblyId: string | null;
  shgc: Sourced<number>;
  shading: 'none' | 'interior' | 'exterior' | 'unknown';
}
export type WallExposure = 'exterior' | 'interior-conditioned' | 'unconditioned';
export interface Wall {
  id: string; label: string;
  heading: { deg: number | null; source: 'manual' | 'compass' | 'derived'; confidence: number | null };
  lengthFt: number; heightFt: number;
  measurement: { method: 'manual' | 'device' | 'ar'; confirmed: boolean };
  exposure: {
    type: WallExposure;
    adjacentRoomId?: string; adjacentWallId?: string; // floor-plan snapping fills these later
    adjacentHeatTempF: number | null; adjacentCoolTempF: number | null;
  };
  assemblyId: string | null;
  openings: Opening[];
  photoRef?: string;
}
export type HorizontalCondition = 'conditioned-adjacent' | 'unconditioned' | 'exterior' | 'ground';
export interface HorizontalSurface {
  condition: HorizontalCondition; assemblyId: string | null;
  /** Surface area when it differs from the room's floor area (sloped/vaulted roof). null = use floor area. */
  areaFt2?: number | null;
  adjacentHeatTempF: number | null; adjacentCoolTempF: number | null;
}
export interface Room {
  id: string; name: string; floorLevel: number;
  lengthFt: number; widthFt: number; ceilingHeightFt: number;
  /** Reserved for the future floor-plan editor. */
  placement: { xFt: number; yFt: number; rotationDeg: number };
  walls: Wall[]; ceiling: HorizontalSurface; floor: HorizontalSurface;
  occupants: number; applianceSensibleBtuh: number;
}
export interface DesignConditions {
  location: string; source: string;
  elevationFt: number | null;
  heatOutdoorF: number | null; coolOutdoorF: number | null;
  heatIndoorF: number | null; coolIndoorF: number | null;
  outdoorGrainsCool: number | null; indoorGrainsCool: number | null; // humidity ratio, grains/lb
  /** Optional user-supplied solar gain by 8-point orientation, Btu/(h*ft2) of glass * SHGC. */
  solarGain: Partial<Record<Cardinal, number>>;
}
export type Cardinal = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export interface House { name: string; rooms: Room[] }
export interface Project {
  schemaVersion: number; id: string; name: string; client: string; address: string;
  createdAt: string; updatedAt: string;
  design: DesignConditions;
  infiltration: { heatAch: Sourced<number>; coolAch: Sourced<number> };
  internal: { sensiblePerPersonBtuh: Sourced<number>; latentPerPersonBtuh: Sourced<number> };
  assemblies: Assembly[];
  house: House;
}

export interface Component {
  label: string; kind: string; areaFt2?: number; u?: number; deltaT?: number;
  btuh: number; quality: Quality; note?: string;
}
export interface ModeResult { btuh: number; components: Component[] }
export interface RoomResult {
  roomId: string; name: string; floorAreaFt2: number; volumeFt3: number;
  heating: ModeResult | null; coolingSensible: ModeResult | null; coolingLatent: ModeResult | null;
  walls: { wallId: string; label: string; cardinal: Cardinal | null; grossFt2: number; openingFt2: number; netFt2: number }[];
  issues: Issue[];
}
export interface CalcResult {
  engineVersion: string; rooms: RoomResult[]; issues: Issue[];
  totals: { heating: number | null; coolingSensible: number | null; coolingLatent: number | null; coolingTotal: number | null };
  complete: { heating: boolean; coolingSensible: boolean; coolingLatent: boolean };
  notIncluded: string[];
  qualityCounts: Record<Quality, number>;
}
