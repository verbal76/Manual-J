// ANALYTIC REFERENCE (not ACCA). Expected values hand-derived from Q = U*A*dT and the air formulas,
// worked independently of the engine. Hand arithmetic is shown beside each expected number.
import { newProject, newRoom, newAssembly, newOpening, sourced } from '../../src/model/factory';
import type { Project } from '../../src/engine/types';

export const FIXTURE_ID = 'ANALYTIC-001';
export const FIXTURE_SOURCE = 'Hand-derived first-principles arithmetic (this repo). Not an ACCA/Manual J published example.';
export const TOLERANCE_BTUH = 0.01;

export function buildProject(): Project {
  const p = newProject('Analytic box room');
  p.design = { ...p.design, location: 'n/a (synthetic)', source: 'Synthetic test values', heatOutdoorF: 10, heatIndoorF: 70, coolOutdoorF: 95, coolIndoorF: 75, outdoorGrainsCool: 120, indoorGrainsCool: 70, solarGain: {} };
  p.infiltration = { heatAch: sourced(0.5, 'KNOWN'), coolAch: sourced(0.3, 'KNOWN') };
  const wall = newAssembly('wall', 'Test wall'); wall.u = sourced(0.05, 'KNOWN');
  const win = newAssembly('window', 'Test window'); win.u = sourced(0.5, 'KNOWN');
  const door = newAssembly('door', 'Test door'); door.u = sourced(0.4, 'KNOWN');
  const roof = newAssembly('roof-ceiling', 'Test ceiling'); roof.u = sourced(0.03, 'KNOWN');
  p.assemblies = [wall, win, door, roof];
  const r = newRoom('Box', 20, 15, 8, 0); // wall1 N (20x8), wall2 E (15x8), wall3 S (20x8), wall4 W (15x8)
  const [n, e, s, w] = r.walls;
  n.assemblyId = wall.id; n.openings = [{ ...newOpening('window', 3, 4, win.id), quantity: 2 }];
  s.assemblyId = wall.id; s.openings = [newOpening('door', 3, 7, door.id)];
  e.exposure.type = 'interior-conditioned'; w.exposure.type = 'interior-conditioned';
  r.ceiling = { condition: 'unconditioned', assemblyId: roof.id, adjacentHeatTempF: 20, adjacentCoolTempF: 120 };
  p.house.rooms = [r];
  return p;
}
// V = 20*15*8 = 2400 ft3; floor/ceiling area = 300 ft2
export const EXPECTED = {
  // N net 160-24=136 -> 136*.05*60=408; windows 24*.5*60=720; S net 160-21=139 -> 139*.05*60=417; door 21*.4*60=504;
  // ceiling 300*.03*(70-20)=450; infiltration CFM=.5*2400/60=20 -> 1.08*20*60=1296.  Sum=3795
  heating: 408 + 720 + 417 + 504 + 450 + 1296,
  // dT=20: 136*.05*20=136; 24*.5*20=240; 139*.05*20=139; 21*.4*20=168; ceiling 300*.03*(120-75)=405; inf CFM=.3*2400/60=12 -> 1.08*12*20=259.2
  coolingSensible: 136 + 240 + 139 + 168 + 405 + 259.2,
  // 60*.075*1076=4842 ; *12 CFM *(120-70=50 gr)/7000 = 4842*12*50/7000
  coolingLatent: 4842 * 12 * 50 / 7000,
};
