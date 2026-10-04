// ANALYTIC REFERENCE SUITE. Every expected number is derived by hand from the stated formulas
// (Q = U*A*dT; sensible air = 1.08*CFM*dT; latent air = 60*0.075*1076*CFM*dGrains/7000; CFM = ACH*V/60) and written
// next to the case. These prove the engine implements its stated method. They are NOT Manual J / ACCA reference values.
import { newProject, newRoom, newAssembly, newOpening, sourced } from '../../src/model/factory';
import type { Assembly, Project, Room } from '../../src/engine/types';
import * as box from './analytic-box-room';

export interface RefCase { id: string; what: string; build: () => Project; expected: { heating: number; coolingSensible: number; coolingLatent: number }; tol: number; source: string }
const SRC = 'Hand-derived first-principles arithmetic (this repo); not an ACCA/Manual J published example.';

function base(name: string): Project {
  const p = newProject(name);
  p.design = { ...p.design, location: 'synthetic', source: 'synthetic test values', heatOutdoorF: 10, heatIndoorF: 70, coolOutdoorF: 95, coolIndoorF: 75, outdoorGrainsCool: 120, indoorGrainsCool: 70, solarGain: {} };
  p.infiltration = { heatAch: sourced(0, 'KNOWN'), coolAch: sourced(0, 'KNOWN') };
  return p;
}
const asm = (p: Project, kind: Assembly['kind'], u: number) => { const a = newAssembly(kind, `${kind} ${u}`); a.u = sourced(u, 'KNOWN'); p.assemblies.push(a); return a; };
/** Room whose four walls are all interior partitions and floor/ceiling are conditioned: only what the case adds can load it. */
function sealed(name: string, L: number, W: number, H: number, heading = 0): Room {
  const r = newRoom(name, L, W, H, heading);
  r.walls.forEach(w => (w.exposure.type = 'interior-conditioned'));
  r.ceiling = { condition: 'conditioned-adjacent', assemblyId: null, adjacentHeatTempF: null, adjacentCoolTempF: null };
  r.floor = { condition: 'conditioned-adjacent', assemblyId: null, adjacentHeatTempF: null, adjacentCoolTempF: null };
  return r;
}

export const CASES: RefCase[] = [
  { id: 'ANALYTIC-001', what: 'Box room: 2 windows, door, attic ceiling, two partitions, infiltration, latent (the original reference house)', build: box.buildProject, expected: box.EXPECTED, tol: box.TOLERANCE_BTUH, source: box.FIXTURE_SOURCE },
  { id: 'ANALYTIC-002', what: 'Single exterior wall only, no openings, no infiltration', source: SRC, tol: 1e-9,
    build: () => { const p = base('a2'); const w = asm(p, 'wall', 0.08); const r = sealed('R', 12, 10, 8); r.walls[0].exposure.type = 'exterior'; r.walls[0].assemblyId = w.id; p.house.rooms = [r]; return p; },
    // wall 12x8=96 ft2; heat 96*.08*60=460.8; cool 96*.08*20=153.6; no air, no latent (ACH 0 => 0 CFM)
    expected: { heating: 96 * 0.08 * 60, coolingSensible: 96 * 0.08 * 20, coolingLatent: 0 } },
  { id: 'ANALYTIC-003', what: 'Infiltration only (fully sealed envelope, ACH 1 heating/cooling) - sensible and latent air formulas', source: SRC, tol: 1e-9,
    build: () => { const p = base('a3'); p.infiltration = { heatAch: sourced(1, 'KNOWN'), coolAch: sourced(1, 'KNOWN') }; p.house.rooms = [sealed('R', 10, 10, 10)]; return p; },
    // V=1000 ft3 -> CFM = 1*1000/60 = 16.6667. heat 1.08*16.6667*60 = 1080; cool 1.08*16.6667*20 = 360; latent 4842*16.6667*50/7000 = 576.43
    expected: { heating: 1.08 * (1000 / 60) * 60, coolingSensible: 1.08 * (1000 / 60) * 20, coolingLatent: 4842 * (1000 / 60) * 50 / 7000 } },
  { id: 'ANALYTIC-004', what: 'Wall to an unconditioned garage (winter 40F / summer 100F) plus a door in it', source: SRC, tol: 1e-9,
    build: () => { const p = base('a4'); const w = asm(p, 'wall', 0.1); const d = asm(p, 'door', 0.5); const r = sealed('R', 10, 10, 8); const wl = r.walls[0];
      wl.exposure = { type: 'unconditioned', adjacentHeatTempF: 40, adjacentCoolTempF: 100 }; wl.assemblyId = w.id; wl.openings = [newOpening('door', 3, 7, d.id)]; p.house.rooms = [r]; return p; },
    // wall 10x8=80, door 21 -> net 59. heat dT=70-40=30: 59*.1*30=177 + 21*.5*30=315 -> 492.  cool dT=100-75=25: 59*.1*25=147.5 + 21*.5*25=262.5 -> 410
    expected: { heating: 59 * 0.1 * 30 + 21 * 0.5 * 30, coolingSensible: 59 * 0.1 * 25 + 21 * 0.5 * 25, coolingLatent: 0 } },
  { id: 'ANALYTIC-005', what: 'Vaulted ceiling open to outdoors with explicit sloped area (400 ft2 vs 100 ft2 floor)', source: SRC, tol: 1e-9,
    build: () => { const p = base('a5'); const c = asm(p, 'roof-ceiling', 0.04); const r = sealed('R', 10, 10, 8); r.ceiling = { condition: 'exterior', assemblyId: c.id, adjacentHeatTempF: null, adjacentCoolTempF: null, areaFt2: 400 }; p.house.rooms = [r]; return p; },
    // 400*.04*60 = 960 ; cool 400*.04*20 = 320
    expected: { heating: 400 * 0.04 * 60, coolingSensible: 400 * 0.04 * 20, coolingLatent: 0 } },
  { id: 'ANALYTIC-006', what: 'South window solar gain (user factor 150, SHGC 0.4) added to window conduction', source: SRC, tol: 1e-9,
    build: () => { const p = base('a6'); p.design.solarGain = { S: 150 }; const w = asm(p, 'wall', 0.05); const g = asm(p, 'window', 0.5); const r = sealed('R', 12, 10, 8, 180);
      const wl = r.walls[0]; wl.exposure.type = 'exterior'; wl.assemblyId = w.id; const win = { ...newOpening('window', 5, 6, g.id), shgc: sourced(0.4, 'KNOWN') }; wl.openings = [win]; p.house.rooms = [r]; return p; },
    // wall 12x8=96, window 30 -> net 66. heat: 66*.05*60=198 + 30*.5*60=900 -> 1098. cool: 66*.05*20=66 + 30*.5*20=300 + solar 30*.4*150=1800 -> 2166
    expected: { heating: 66 * 0.05 * 60 + 30 * 0.5 * 60, coolingSensible: 66 * 0.05 * 20 + 30 * 0.5 * 20 + 30 * 0.4 * 150, coolingLatent: 0 } },
  { id: 'ANALYTIC-007', what: 'Occupant and appliance gains (user-supplied 230/200 Btu/h per person, 4 people, 500 Btu/h appliances)', source: SRC, tol: 1e-9,
    build: () => { const p = base('a7'); p.internal = { sensiblePerPersonBtuh: sourced(230, 'ESTIMATED'), latentPerPersonBtuh: sourced(200, 'ESTIMATED') }; const r = sealed('R', 10, 10, 8); r.occupants = 4; r.applianceSensibleBtuh = 500; p.house.rooms = [r]; return p; },
    // sensible 4*230 + 500 = 1420 ; latent 4*200 = 800 (ACH 0 => no infiltration latent); heating has no internal gains
    expected: { heating: 0, coolingSensible: 4 * 230 + 500, coolingLatent: 4 * 200 } },
  { id: 'ANALYTIC-008', what: 'Two rooms, shared partition: partition carries no load, totals equal the sum of independent rooms', source: SRC, tol: 1e-9,
    build: () => { const p = base('a8'); const w = asm(p, 'wall', 0.05); const a = sealed('A', 10, 10, 8, 0); const b = sealed('B', 10, 10, 8, 0);
      a.walls[0].exposure.type = 'exterior'; a.walls[0].assemblyId = w.id; b.walls[2].exposure.type = 'exterior'; b.walls[2].assemblyId = w.id; p.house.rooms = [a, b]; return p; },
    // each room: one 10x8=80 ft2 exterior wall: heat 80*.05*60=240, cool 80*.05*20=80 -> totals 480 / 160
    expected: { heating: 2 * 80 * 0.05 * 60, coolingSensible: 2 * 80 * 0.05 * 20, coolingLatent: 0 } },
  { id: 'ANALYTIC-009', what: 'Dehumidifying credit: outdoor humidity ratio below indoor gives negative infiltration latent (sign check)', source: SRC, tol: 1e-9,
    build: () => { const p = base('a9'); p.design.outdoorGrainsCool = 50; p.design.indoorGrainsCool = 70; p.infiltration = { heatAch: sourced(0, 'KNOWN'), coolAch: sourced(0.6, 'KNOWN') }; p.house.rooms = [sealed('R', 10, 10, 10)]; return p; },
    // V=1000, ACH .6 -> CFM 10. dGrains = 50-70 = -20 -> latent 4842*10*(-20)/7000 = -138.343 ; sensible 1.08*10*20 = 216 ; heating (ACH 0) 0
    expected: { heating: 0, coolingSensible: 1.08 * 10 * 20, coolingLatent: 4842 * 10 * (-20) / 7000 } },
];
