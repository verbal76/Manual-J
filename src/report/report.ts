import type { CalcResult, ModeResult, Project, Quality } from '../engine/types';
import { btuhToTons, formatFtIn } from '../engine/units';
import { cardinalFromHeading } from '../engine/geometry';
import { SOURCES } from '../engine/provenance';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const n0 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US'));
const qBadge = (q: Quality) => `<span class="q q-${q}">${q}</span>`;

function modeTable(m: ModeResult | null, label: string): string {
  if (!m) return `<p class="bad"><b>${esc(label)}:</b> not calculated (see issues).</p>`;
  const rows = m.components.map(c => `<tr><td>${esc(c.label)}</td><td class="r">${c.areaFt2 !== undefined ? c.areaFt2.toFixed(1) : ''}</td><td class="r">${c.u !== undefined ? c.u.toFixed(3) : ''}</td><td class="r">${c.deltaT !== undefined ? c.deltaT.toFixed(0) : ''}</td><td class="r">${n0(c.btuh)}</td><td>${qBadge(c.quality)}${c.note ? ' ' + esc(c.note) : ''}</td></tr>`).join('');
  return `<h4>${esc(label)}: ${n0(m.btuh)} Btu/h</h4><div class="tw"><table><tr><th>Item</th><th>ft²</th><th>U</th><th>ΔT °F</th><th>Btu/h</th><th>Basis</th></tr>${rows}</table></div>`;
}

export function renderReportHtml(p: Project, r: CalcResult): string {
  const d = p.design; const t = r.totals;
  const tot = (v: number | null) => (v === null ? '<span class="bad">not calculated</span>' : `${n0(v)} Btu/h (${btuhToTons(v).toFixed(2)} tons)`);
  const partial = !(r.complete.heating && r.complete.coolingSensible);
  const roomSummary = r.rooms.map((rr, i) => {
    const room = p.house.rooms[i];
    const walls = room.walls.map((w, k) => `<tr><td>${esc(w.label)}</td><td>${cardinalFromHeading(w.heading.deg) ?? '?'} ${w.heading.deg === null ? '' : Math.round(w.heading.deg) + '° (' + w.heading.source + ')'}</td><td>${formatFtIn(w.lengthFt)} × ${formatFtIn(w.heightFt)}</td><td class="r">${rr.walls[k].grossFt2.toFixed(1)}</td><td class="r">${rr.walls[k].openingFt2.toFixed(1)}</td><td class="r">${rr.walls[k].netFt2.toFixed(1)}</td><td>${esc(w.exposure.type)}</td><td>${esc(p.assemblies.find(a => a.id === w.assemblyId)?.name ?? 'none')}</td><td>${w.openings.map(o => `${o.quantity}× ${esc(o.kind)} ${formatFtIn(o.widthFt)}×${formatFtIn(o.heightFt)}`).join('; ') || '—'}</td></tr>`).join('');
    return `<section class="room"><h3>${esc(rr.name)}</h3><p>${room.lengthFt}×${room.widthFt} ft, ceiling ${room.ceilingHeightFt} ft · floor ${rr.floorAreaFt2.toFixed(0)} ft² · volume ${rr.volumeFt3.toFixed(0)} ft³ · ceiling: ${esc(room.ceiling.condition)} · floor: ${esc(room.floor.condition)}</p>
<div class="tw"><table><tr><th>Wall</th><th>Facing</th><th>Size</th><th>Gross</th><th>Openings</th><th>Net</th><th>Exposure</th><th>Construction</th><th>Openings</th></tr>${walls}</table></div>
${modeTable(rr.heating, 'Heating')}${modeTable(rr.coolingSensible, 'Cooling – sensible (incomplete method)')}${modeTable(rr.coolingLatent, 'Cooling – latent')}
${rr.issues.length ? `<ul>${rr.issues.map(x => `<li class="${x.severity}"><b>${x.severity}</b> ${esc(x.message)}</li>`).join('')}</ul>` : ''}</section>`;
  }).join('');
  const assumed = p.assemblies.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.kind)}</td><td>${esc(Object.values(a.descriptors).join(', '))}</td><td class="r">${a.u.value === null ? '—' : a.u.value.toFixed(3)}</td><td>${qBadge(a.u.quality)} ${esc(a.u.source ?? '')}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Load report – ${esc(p.name)}</title><style>
body{font:14px/1.4 system-ui,sans-serif;margin:16px;color:#111;max-width:900px}.tw{overflow-x:auto;-webkit-overflow-scrolling:touch}table{border-collapse:collapse;width:100%;margin:6px 0 12px}td,th{border:1px solid #bbb;padding:3px 6px;text-align:left}.r{text-align:right}
.q{font-size:11px;padding:1px 5px;border-radius:4px;background:#ddd}.q-ESTIMATED,.q-DEFAULTED{background:#ffd9a0}.q-UNKNOWN{background:#f5a3a3}.q-KNOWN{background:#bfe8bf}.bad,.ERROR{color:#b00020}.WARNING{color:#8a5a00}.banner{border:2px solid #b00020;padding:8px;margin:8px 0}
.room{page-break-inside:avoid;border-top:2px solid #333;margin-top:14px}</style></head><body>
<h1>Residential load survey report</h1>
<div class="banner"><b>Not an ACCA Manual J report and not ACCA-approved software.</b> This is a preliminary survey calculation using a partial method (see "Not included"). Do not use it alone to size equipment.${partial ? ' <b>INCOMPLETE:</b> one or more required inputs are missing, so house totals are not final.' : ''}</div>
<h2>Project</h2><p><b>${esc(p.name)}</b><br>Client: ${esc(p.client) || '—'}<br>Address: ${esc(p.address) || '—'}<br>Report generated: ${esc(new Date().toISOString())}<br>Manual J ${esc(__DELIVERED__ ? `v${__PUBLIC_VERSION__}` : `v${__PUBLIC_VERSION__} (development build)`)} · Engine ${esc(r.engineVersion)} · source ${esc(__BUILD_SHA__)}</p>
<h2>Design conditions</h2><table><tr><td>Location</td><td>${esc(d.location) || '—'}</td></tr><tr><td>Source</td><td>${esc(d.source) || '<span class="bad">none stated</span>'}</td></tr>
<tr><td>Heating: outdoor / indoor</td><td>${d.heatOutdoorF ?? '—'} °F / ${d.heatIndoorF ?? '—'} °F</td></tr><tr><td>Cooling: outdoor / indoor</td><td>${d.coolOutdoorF ?? '—'} °F / ${d.coolIndoorF ?? '—'} °F</td></tr>
<tr><td>Humidity ratio outdoor / indoor (cooling)</td><td>${d.outdoorGrainsCool ?? '—'} / ${d.indoorGrainsCool ?? '—'} gr/lb</td></tr><tr><td>Elevation</td><td>${d.elevationFt ?? '—'} ft</td></tr>
<tr><td>Air changes/hr heating / cooling</td><td>${p.infiltration.heatAch.value ?? '—'} ${qBadge(p.infiltration.heatAch.quality)} / ${p.infiltration.coolAch.value ?? '—'} ${qBadge(p.infiltration.coolAch.quality)}</td></tr></table>
<h2>Whole-house totals</h2><table><tr><td>Heating</td><td>${tot(t.heating)}</td></tr><tr><td>Cooling sensible</td><td>${tot(t.coolingSensible)}</td></tr><tr><td>Cooling latent</td><td>${tot(t.coolingLatent)}</td></tr><tr><td>Cooling total</td><td>${tot(t.coolingTotal)}</td></tr></table>
<h2>Not included in these numbers</h2><ul>${r.notIncluded.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
<h2>Value quality summary</h2><p>${(Object.keys(r.qualityCounts) as Quality[]).map(k => `${qBadge(k)} ${r.qualityCounts[k]}`).join(' ')}</p>
<h2>Constructions used</h2><table><tr><th>Name</th><th>Type</th><th>Descriptors</th><th>U</th><th>Basis</th></tr>${assumed}</table>
<h2>Rooms</h2>${roomSummary}
<h2>Project-level issues</h2><ul>${r.issues.map(x => `<li class="${x.severity}"><b>${x.severity}</b> ${esc(x.message)}</li>`).join('') || '<li>None</li>'}</ul>
<h2>Method and sources</h2><ul>${Object.values(SOURCES).map(s => `<li><b>${esc(s.what)}</b> — ${esc(s.basis)} [${esc(s.status)}]</li>`).join('')}</ul>
</body></html>`;
}

