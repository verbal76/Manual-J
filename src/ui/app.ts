import { calculate } from '../engine/calc';
import { cardinalFromHeading } from '../engine/geometry';
import type { Assembly, AssemblyKind, Cardinal, Project, Quality, Room, Wall } from '../engine/types';
import { btuhToTons, formatFtIn, parseLength, rToU, uToR } from '../engine/units';
import { newAssembly, newOpening, newProject, newRoom, sourced, uid } from '../model/factory';
import { ProjectStore } from '../model/persistence';
import { renderReportHtml } from '../report/report';
import { h, type Child } from './dom';
import { RUNTIME_VERSION } from '../ota/runtime';
import { OtaUpdater, type OtaAdapter } from '../ota/updater';
import { capgoAdapter, isNative } from '../ota/capgoAdapter';
import { SCHEMA_VERSION } from '../model/factory';
import { collectDiagnostics, installedVersionCode } from '../release/identity';
type Tab = 'setup' | 'rooms' | 'results' | 'report';
type Screen = { n: 'home' } | { n: 'settings' } | { n: 'about' } | { n: 'proj'; tab: Tab } | { n: 'room'; id: string; step: number } | { n: 'asm'; kind: AssemblyKind; editId?: string; back: Screen; apply?: (id: string) => void };

const DESCRIPTORS: Record<AssemblyKind, Record<string, string[]>> = {
  wall: { Framing: ['2x4', '2x6', 'masonry', 'block', 'log', 'other', 'unknown'], Insulation: ['none', 'fiberglass', 'cellulose', 'foam', 'other', 'unknown'], 'Exterior finish': ['brick', 'siding', 'stucco', 'other', 'unknown'] },
  window: { Glazing: ['single', 'double', 'triple', 'unknown'], Frame: ['wood', 'vinyl', 'aluminum', 'other', 'unknown'], 'Low-E': ['yes', 'no', 'unknown'] },
  door: { Type: ['wood', 'steel', 'fiberglass', 'glass', 'other', 'unknown'] },
  'roof-ceiling': { Type: ['flat ceiling under attic', 'cathedral/vaulted', 'other', 'unknown'], Insulation: ['none', 'fiberglass', 'cellulose', 'foam', 'other', 'unknown'] },
  floor: { Type: ['over crawl/basement', 'over garage', 'other', 'unknown'], Insulation: ['none', 'fiberglass', 'foam', 'other', 'unknown'] },
};
const FREE_ERA: AssemblyKind[] = ['wall', 'roof-ceiling', 'floor'];
const CARD_DEG: Record<string, number> = { N: 0, E: 90, S: 180, W: 270 };

export function startApp(root: HTMLElement, boot: { splashDone: Promise<void> } = { splashDone: Promise.resolve() }): void {
  const store = new ProjectStore(window.localStorage);
  let screen: Screen = { n: 'home' };
  let p: Project | null = null;
  let toast = '';
  let currentBack: Screen | undefined;
  let updater: OtaUpdater | null = null;
  let splashGone = false;
  const noAdapter: OtaAdapter = { fetchManifest: async () => { throw new Error('web'); }, download: async () => { throw new Error('web'); }, deleteBundle: async () => undefined, activate: async () => undefined, notifyReady: async () => undefined };

  // Safe moment for an update to reload the app: Home screen, splash finished. Projects autosave on every change.
  const maybeActivate = () => {
    if (!updater || !splashGone || updater.state.kind !== 'staged' || screen.n !== 'home') return;
    void updater.activateIfStaged().then(ok => { if (!ok && updater!.state.kind === 'failed') { toast = 'The update could not be applied. Your projects are safe and the current version keeps running.'; render(); } });
  };
  const modal = h('div', { class: 'ota-modal', role: 'alertdialog', 'aria-live': 'assertive', hidden: true }, h('div', { class: 'card ota-panel' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('div', { class: 'ota-msg' }, 'Please wait, applying update')));
  document.body.append(modal);
  const syncModal = () => { modal.hidden = updater?.state.kind !== 'applying'; };
  async function initOta(): Promise<void> {
    const native = isNative();
    updater = new OtaUpdater(native ? capgoAdapter : noAdapter,
      { channel: __OTA_CHANNEL__, runtime: RUNTIME_VERSION, versionCode: native ? await installedVersionCode() : null, currentSeq: __OTA_SEQ__, projectSchema: SCHEMA_VERSION, runningId: __OTA_ID__ },
      { manifestUrl: native ? __OTA_MANIFEST_URL__ : '', store: window.localStorage, now: Date.now, minIntervalMs: 15 * 60_000, activateTimeoutMs: 20_000 });
    updater.onChange(() => { syncModal(); maybeActivate(); if (screen.n === 'about') render(); });
    await updater.confirmStarted(); // tells the platform this bundle's UI came up (otherwise an OTA is rolled back)
    void updater.check().then(maybeActivate);
  }
  if (isNative()) void import('@capacitor/app').then(({ App }) => App.addListener('backButton', () => { if (currentBack) go(currentBack); else void App.exitApp(); }));
  boot.splashDone.then(() => { splashGone = true; maybeActivate(); });

  const go = (s: Screen) => { screen = s; render(); window.scrollTo(0, 0); maybeActivate(); };
  const commit = () => { if (p) { try { store.save(p); toast = ''; } catch (e) { toast = 'SAVE FAILED: ' + (e as Error).message; } } render(); };
  document.addEventListener('visibilitychange', () => { if (p && document.visibilityState === 'hidden') try { store.save(p); } catch { /* shown on next commit */ } });

  // ---- field helpers -------------------------------------------------------
  const field = (label: string, input: HTMLElement, hint?: string) => h('div', {}, h('label', {}, label), input, hint ? h('div', { class: 'mut' }, hint) : null);
  const txt = (label: string, v: string, set: (s: string) => void) => field(label, h('input', { type: 'text', value: v, onChange: (e: Event) => { set((e.target as HTMLInputElement).value); commit(); } }));
  const num = (label: string, v: number | null, set: (n: number | null) => void, hint?: string) =>
    field(label, h('input', { type: 'text', inputmode: 'decimal', value: v === null ? '' : String(v), onChange: (e: Event) => { const s = (e.target as HTMLInputElement).value.trim(); if (s === '') set(null); else { const n = Number(s); if (!isFinite(n)) { toast = `"${s}" is not a number`; render(); return; } set(n); } commit(); } }), hint);
  const len = (label: string, ft: number, set: (ft: number) => void, bare: 'ft' | 'in' = 'ft') =>
    field(label, h('input', { type: 'text', inputmode: 'text', value: bare === 'in' ? String(Math.round(ft * 12 * 100) / 100) : formatFtIn(ft), onChange: (e: Event) => { const v = parseLength((e.target as HTMLInputElement).value, bare); if (v === null || v <= 0) { toast = 'Could not read that length. Try 10\'6" or 10.5'; render(); return; } set(v); commit(); } }), bare === 'ft' ? `= ${ft.toFixed(2)} ft` : '');
  const sel = (label: string, opts: [string, string][], v: string, set: (s: string) => void) =>
    field(label, h('select', { onChange: (e: Event) => { set((e.target as HTMLSelectElement).value); commit(); } }, opts.map(([val, lab]) => h('option', { value: val, selected: val === v }, lab))));
  const simpleSel = (label: string, opts: string[], v: string, set: (s: string) => void) => sel(label, opts.map(o => [o, o]), v, set);
  const sourcedNum = (label: string, s: { value: number | null; quality: Quality; source?: string }, set: (v: number | null, q: Quality) => void, hint?: string) => h('div', {},
    num(label, s.value, n => set(n, n === null ? 'UNKNOWN' : s.quality === 'UNKNOWN' ? 'ESTIMATED' : s.quality), hint),
    s.value !== null ? h('div', { class: 'row' }, sel('Basis', (['KNOWN', 'SELECTED', 'ESTIMATED'] as Quality[]).map(q => [q, q]), s.quality, q => set(s.value, q as Quality))) : h('div', { class: 'mut' }, 'UNKNOWN until entered'));
  const qb = (q: Quality) => h('span', { class: `q q-${q}` }, q);
  const fmt = (n: number | null) => (n === null ? '—' : Math.round(n).toLocaleString('en-US'));

  // ---- shell ---------------------------------------------------------------
  function shell(title: string, body: Child, backTo?: Screen, nav?: Tab): void {
    currentBack = backTo;
    const kids: Child[] = [h('header', { class: 'top' }, backTo ? h('button', { onClick: () => go(backTo) }, '‹ Back') : null, h('h1', {}, title)), toast ? h('div', { class: 'banner' }, toast) : null, body];
    if (nav) kids.push(h('nav', { class: 'bottom' }, ([['setup', 'Setup'], ['rooms', 'Rooms'], ['results', 'Results'], ['report', 'Report']] as [Tab, string][]).map(([t, l]) => h('button', { class: nav === t ? 'on' : '', onClick: () => go({ n: 'proj', tab: t }) }, l))));
    root.replaceChildren(...(kids.flat(3).filter(Boolean) as Node[]));
  }

  let rendering = false, again = false;
  function render(): void {
    // Blurring the focused field fires its pending 'change' (which commits and re-renders); coalesce those.
    if (rendering) { again = true; return; }
    rendering = true;
    try { (document.activeElement as HTMLElement | null)?.blur?.(); do { again = false; renderNow(); } while (again); } finally { rendering = false; }
  }
  function renderNow(): void {
    if (screen.n === 'settings') return settings();
    if (screen.n === 'about') return about();
    if (screen.n === 'home' || !p) return home();
    if (screen.n === 'proj') return screen.tab === 'setup' ? setup() : screen.tab === 'rooms' ? roomsTab() : screen.tab === 'results' ? results() : reportTab();
    if (screen.n === 'room') return roomWizard(screen);
    return asmEditor(screen);
  }

  // ---- home ----------------------------------------------------------------
  function home(): void {
    const list = store.list();
    shell('Manual J Survey', [
      h('button', { class: 'sec big', onClick: () => go({ n: 'settings' }) }, '⚙ Settings'),
      h('button', { class: 'big', onClick: () => { p = newProject('New house'); store.save(p); go({ n: 'proj', tab: 'setup' }); } }, '＋ New project'),
      list.length ? h('h2', {}, 'Saved projects') : h('p', { class: 'mut' }, 'No projects yet.'),
      list.map(x => h('div', { class: 'card' }, h('b', {}, x.name), h('div', { class: 'mut' }, new Date(x.updatedAt).toLocaleString()),
        h('div', { class: 'row' }, h('button', { onClick: () => { try { p = store.load(x.id); go({ n: 'proj', tab: 'rooms' }); } catch (e) { toast = (e as Error).message; render(); } } }, 'Open'),
          h('button', { class: 'danger', onClick: () => { if (confirm(`Delete "${x.name}"?`)) { store.remove(x.id); render(); } } }, 'Delete')))),
      h('p', { class: 'mut' }, `v${__APP_VERSION__} · build ${__BUILD_SHA__} · Not ACCA-approved. Preliminary survey tool; see report for method limits. Details: Settings → About.`),
    ]);
  }

  // ---- settings / about ------------------------------------------------------
  function settings(): void {
    shell('Settings', [h('div', { class: 'card' }, h('button', { class: 'big', onClick: () => go({ n: 'about' }) }, 'About / release diagnostics ›'))], { n: 'home' });
  }
  function about(): void {
    const body = h('div', {}, h('p', { class: 'mut' }, 'Loading…'));
    shell('About', body, { n: 'settings' });
    void collectDiagnostics(updater).then(({ text }) => {
      if (screen.n !== 'about') return;
      const pre = h('pre', { class: 'diag' }, text);
      const copy = async () => {
        try { await navigator.clipboard.writeText(text); toast = 'Diagnostics copied.'; }
        catch { const ta = h('textarea', { class: 'diag-copy' }) as HTMLTextAreaElement; ta.value = text; document.body.append(ta); ta.select(); try { document.execCommand('copy'); toast = 'Diagnostics copied.'; } catch { toast = 'Copy failed: select the text above and copy it manually.'; } ta.remove(); }
        render();
      };
      const kids: Node[] = [pre, h('button', { class: 'big', onClick: copy }, 'Copy diagnostics')];
      if (updater && updater.state.kind !== 'disabled') kids.push(h('button', { class: 'sec big', onClick: () => { void updater!.check({ force: true }).then(() => render()); } }, 'Check for update now'));
      body.replaceChildren(...kids);
    });
  }

  // ---- setup ---------------------------------------------------------------
  function setup(): void {
    const P = p!, d = P.design;
    const sg = (c: Cardinal) => num(`${c}`, d.solarGain[c] ?? null, n => { if (n === null) delete d.solarGain[c]; else d.solarGain[c] = n; });
    shell(P.name, [
      h('div', { class: 'card' }, h('h3', {}, 'Project'), txt('Project name', P.name, s => (P.name = s)), txt('Client', P.client, s => (P.client = s)), txt('Address', P.address, s => (P.address = s))),
      h('div', { class: 'card' }, h('h3', {}, 'Design conditions'), h('p', { class: 'mut' }, 'No national defaults are supplied. Enter values from your source and say where they came from.'),
        txt('Location', d.location, s => (d.location = s)), txt('Source of design values (required for the report)', d.source, s => (d.source = s)),
        num('Elevation (ft)', d.elevationFt, n => (d.elevationFt = n)),
        h('div', { class: 'grid2' }, num('Heating outdoor °F', d.heatOutdoorF, n => (d.heatOutdoorF = n)), num('Heating indoor °F', d.heatIndoorF, n => (d.heatIndoorF = n)),
          num('Cooling outdoor °F', d.coolOutdoorF, n => (d.coolOutdoorF = n)), num('Cooling indoor °F', d.coolIndoorF, n => (d.coolIndoorF = n)),
          num('Outdoor humidity ratio (gr/lb)', d.outdoorGrainsCool, n => (d.outdoorGrainsCool = n)), num('Indoor humidity ratio (gr/lb)', d.indoorGrainsCool, n => (d.indoorGrainsCool = n)))),
      h('div', { class: 'card' }, h('h3', {}, 'Air leakage'), h('p', { class: 'mut' }, 'Air changes per hour. Required; no default is shipped.'),
        sourcedNum('Heating ACH', P.infiltration.heatAch, (v, q) => (P.infiltration.heatAch = { value: v, quality: q })),
        sourcedNum('Cooling ACH', P.infiltration.coolAch, (v, q) => (P.infiltration.coolAch = { value: v, quality: q }))),
      h('div', { class: 'card' }, h('h3', {}, 'Occupant gains (optional)'),
        sourcedNum('Sensible per person (Btu/h)', P.internal.sensiblePerPersonBtuh, (v, q) => (P.internal.sensiblePerPersonBtuh = { value: v, quality: q })),
        sourcedNum('Latent per person (Btu/h)', P.internal.latentPerPersonBtuh, (v, q) => (P.internal.latentPerPersonBtuh = { value: v, quality: q }))),
      h('details', { class: 'card' }, h('summary', {}, 'Window solar gain factors (optional)'), h('p', { class: 'mut' }, 'Btu/h per ft² of glass at SHGC 1.0, by wall facing. Leave blank to omit solar gain (the report will say so).'), h('div', { class: 'grid2' }, (['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as Cardinal[]).map(sg))),
    ], { n: 'home' }, 'setup');
  }

  // ---- rooms ---------------------------------------------------------------
  function roomsTab(): void {
    const P = p!; const res = calculate(P);
    shell(`${P.name} — Rooms`, [
      h('button', { class: 'big', onClick: () => { const r = newRoom(`Room ${P.house.rooms.length + 1}`, 12, 12, 8, 0); P.house.rooms.push(r); commit(); go({ n: 'room', id: r.id, step: 0 }); } }, '＋ Add room'),
      P.house.rooms.map((r, i) => { const rr = res.rooms[i]; const blocked = rr.heating === null || rr.coolingSensible === null;
        return h('div', { class: 'card' }, h('b', {}, r.name), h('div', { class: 'mut' }, `${r.lengthFt}×${r.widthFt} ft · ${rr.floorAreaFt2.toFixed(0)} ft² · ${rr.volumeFt3.toFixed(0)} ft³`),
          blocked ? h('div', { class: 'ERROR' }, 'Incomplete: ' + (rr.issues.find(x => x.severity === 'ERROR' && x.code !== 'ROOM_NOT_CALCULATED')?.message ?? 'see results')) : h('div', {}, `Heat ${fmt(rr.heating!.btuh)} · Cool ${fmt(rr.coolingSensible!.btuh)} sens Btu/h`),
          h('div', { class: 'row' }, h('button', { onClick: () => go({ n: 'room', id: r.id, step: 0 }) }, 'Edit'),
            h('button', { class: 'sec', onClick: () => { const c = structuredClone(r); c.id = uid(); c.name += ' copy'; c.walls.forEach(w => { w.id = uid(); w.openings.forEach(o => (o.id = uid())); }); P.house.rooms.splice(i + 1, 0, c); commit(); } }, 'Duplicate'),
            h('button', { class: 'danger', onClick: () => { if (confirm(`Delete ${r.name}?`)) { P.house.rooms.splice(i, 1); commit(); } } }, 'Delete')));
      }),
      h('div', { class: 'card' }, h('b', {}, 'House'), h('div', {}, `Heating ${fmt(res.totals.heating)} Btu/h`), h('div', { class: 'mut' }, 'Open Results for detail.')),
    ], { n: 'home' }, 'rooms');
  }

  // ---- construction picker/editor -----------------------------------------
  const asmLabel = (a: Assembly) => `${a.name} — ${a.u.value === null ? 'UNKNOWN value' : 'U ' + a.u.value.toFixed(3) + ' ' + a.u.quality}`;
  function asmSelect(label: string, kind: AssemblyKind, cur: string | null, set: (id: string | null) => void): HTMLElement {
    const here = screen;
    const opts: [string, string][] = [['', '— choose construction —'], ...p!.assemblies.filter(a => a.kind === kind).map(a => [a.id, asmLabel(a)] as [string, string]), ['__new__', '＋ New / describe construction…']];
    return sel(label, opts, cur ?? '', v => { if (v === '__new__') { toast = ''; screen = { n: 'asm', kind, back: here, apply: id => set(id) }; } else set(v || null); });
  }
  function asmEditor(s: Extract<Screen, { n: 'asm' }>): void {
    const P = p!;
    const a = (s.editId && P.assemblies.find(x => x.id === s.editId)) || newAssembly(s.kind, '');
    const isNew = !P.assemblies.includes(a);
    const useR = !(s.kind === 'window' || s.kind === 'door');
    let mode: 'R' | 'U' = useR ? 'R' : 'U'; let val = a.u.value === null ? '' : String(mode === 'R' ? uToR(a.u.value) : a.u.value); let q: Quality = a.u.quality === 'UNKNOWN' ? 'ESTIMATED' : a.u.quality; let src = a.u.source ?? ''; let name = a.name; let era = a.descriptors['Age/era'] ?? '';
    const desc = { ...a.descriptors };
    const body = h('div', { class: 'card' },
      h('p', { class: 'mut' }, 'Describe the construction as you see it. Descriptors do not set a number: no unsourced R/U table is built in. Enter the value you know or estimate, and mark which it is.'),
      Object.entries(DESCRIPTORS[s.kind]).map(([k, opts]) => simpleSelNoCommit(k, ['', ...opts], desc[k] ?? '', v => (desc[k] = v))),
      FREE_ERA.includes(s.kind) ? field('Age / era (optional)', h('input', { type: 'text', value: era, onChange: (e: Event) => (era = (e.target as HTMLInputElement).value) })) : null,
      field('Name (blank = auto)', h('input', { type: 'text', value: name, onChange: (e: Event) => (name = (e.target as HTMLInputElement).value) })),
      simpleSelNoCommit('Enter value as', ['R-value', 'U-factor'], mode === 'R' ? 'R-value' : 'U-factor', v => (mode = v === 'R-value' ? 'R' : 'U')),
      field('Whole-assembly value (incl. framing, films, glass)', h('input', { type: 'text', inputmode: 'decimal', value: val, onChange: (e: Event) => (val = (e.target as HTMLInputElement).value) })),
      simpleSelNoCommit('This value is', ['KNOWN', 'SELECTED', 'ESTIMATED'], q, v => (q = v as Quality)),
      field('Where it came from (label, spec sheet, table name…)', h('input', { type: 'text', value: src, onChange: (e: Event) => (src = (e.target as HTMLInputElement).value) })),
      h('button', { class: 'big', onClick: () => {
        const n = val.trim() === '' ? null : Number(val);
        if (n !== null && (!isFinite(n) || n <= 0)) { alert('Value must be a positive number'); return; }
        a.descriptors = { ...desc }; if (era) a.descriptors['Age/era'] = era; else delete a.descriptors['Age/era'];
        a.name = name.trim() || Object.values(a.descriptors).filter(x => x && x !== 'unknown').join(' · ') || `${s.kind} ${P.assemblies.length + 1}`;
        a.u = n === null ? { value: null, quality: 'UNKNOWN' } : sourced(mode === 'R' ? rToU(n) : n, q, src || undefined);
        if (isNew) P.assemblies.push(a);
        toast = ''; screen = s.back; s.apply?.(a.id); commit();
      } }, 'Save construction'));
    shell(isNew ? 'New construction' : 'Edit construction', body, s.back);
  }
  function simpleSelNoCommit(label: string, opts: string[], v: string, set: (s: string) => void) {
    return field(label, h('select', { onChange: (e: Event) => set((e.target as HTMLSelectElement).value) }, opts.map(o => h('option', { value: o, selected: o === v }, o || '—'))));
  }

  // ---- room wizard ---------------------------------------------------------
  function roomWizard(s: Extract<Screen, { n: 'room' }>): void {
    const P = p!; const r = P.house.rooms.find(x => x.id === s.id); if (!r) return go({ n: 'proj', tab: 'rooms' });
    const steps = ['Room', 'Walls', 'Ceiling & floor', 'Review'];
    const step = (i: number) => go({ n: 'room', id: r.id, step: i });
    const body: Child[] = [h('div', { class: 'steps' }, steps.map((_, i) => h('span', { class: i <= s.step ? 'on' : '' }))), h('h2', {}, `${s.step + 1}/4 ${steps[s.step]}`)];
    if (s.step === 0) body.push(roomBasics(r));
    if (s.step === 1) body.push(r.walls.map(w => wallCard(r, w)));
    if (s.step === 2) body.push(horizontals(r));
    if (s.step === 3) body.push(roomReview(r));
    body.push(h('div', { class: 'row' }, s.step > 0 ? h('button', { class: 'sec', onClick: () => step(s.step - 1) }, '‹ Back') : h('span'), s.step < 3 ? h('button', { onClick: () => step(s.step + 1) }, 'Next ›') : h('button', { onClick: () => go({ n: 'proj', tab: 'rooms' }) }, 'Done')));
    shell(r.name, body, { n: 'proj', tab: 'rooms' });
  }
  function roomBasics(r: Room): Child {
    const resync = (apply: () => void) => { const old = { L: r.lengthFt, W: r.widthFt, H: r.ceilingHeightFt }; apply();
      r.walls.forEach((w, i) => { const o = i % 2 === 0 ? old.L : old.W; if (w.lengthFt === o) w.lengthFt = i % 2 === 0 ? r.lengthFt : r.widthFt; if (w.heightFt === old.H) w.heightFt = r.ceilingHeightFt; }); };
    return h('div', { class: 'card' }, txt('Room name', r.name, s => (r.name = s)),
      len('Length (Wall 1 & 3 side)', r.lengthFt, v => resync(() => (r.lengthFt = v))), len('Width (Wall 2 & 4 side)', r.widthFt, v => resync(() => (r.widthFt = v))), len('Ceiling height', r.ceilingHeightFt, v => resync(() => (r.ceilingHeightFt = v))),
      h('div', { class: 'mut' }, `Floor ${(r.lengthFt * r.widthFt).toFixed(0)} ft² · Volume ${(r.lengthFt * r.widthFt * r.ceilingHeightFt).toFixed(0)} ft³`),
      num('Floor level (1 = main)', r.floorLevel, n => (r.floorLevel = n ?? 1)));
  }
  function wallCard(r: Room, w: Wall): Child {
    const card = cardinalFromHeading(w.heading.deg);
    const setHeading = (deg: number | null) => { w.heading = { deg, source: 'manual', confidence: null }; };
    return h('div', { class: 'card' }, h('h3', {}, `${w.label} — faces ${card ?? '?'}`),
      h('div', { class: 'row' }, ['N', 'E', 'S', 'W'].map(c => h('button', { class: card === c ? '' : 'sec', onClick: () => { setHeading(CARD_DEG[c]); commit(); } }, c))),
      num('Facing (° true/magnetic as you measured, 0–359)', w.heading.deg, n => setHeading(n)),
      h('div', { class: 'grid2' }, len('Length', w.lengthFt, v => (w.lengthFt = v)), len('Height', w.heightFt, v => (w.heightFt = v))),
      sel('This wall borders', [['exterior', 'Outdoors'], ['interior-conditioned', 'Another heated/cooled room'], ['unconditioned', 'Unconditioned space (garage, attic…)']], w.exposure.type, v => (w.exposure.type = v as Wall['exposure']['type'])),
      w.exposure.type === 'unconditioned' ? h('div', { class: 'grid2' }, num('Winter temp there °F', w.exposure.adjacentHeatTempF, n => (w.exposure.adjacentHeatTempF = n)), num('Summer temp there °F', w.exposure.adjacentCoolTempF, n => (w.exposure.adjacentCoolTempF = n))) : null,
      w.exposure.type !== 'interior-conditioned' ? asmSelect('Wall construction', 'wall', w.assemblyId, id => (w.assemblyId = id)) : null,
      w.assemblyId && w.exposure.type !== 'interior-conditioned' ? h('button', { class: 'sec', onClick: () => go({ n: 'asm', kind: 'wall', editId: w.assemblyId!, back: screen }) }, 'Edit this construction') : null,
      w.exposure.type !== 'interior-conditioned' ? h('div', {}, h('h3', {}, 'Openings'), w.openings.map(o => h('div', { class: 'card' }, h('b', {}, `${o.kind === 'window' ? 'Window' : 'Door'}`),
        h('div', { class: 'grid2' }, num('Qty', o.quantity, n => (o.quantity = n ?? 1)), h('span')),
        h('div', { class: 'grid2' }, len('Width (in)', o.widthFt, v => (o.widthFt = v), 'in'), len('Height (in)', o.heightFt, v => (o.heightFt = v), 'in')),
        asmSelect(o.kind === 'window' ? 'Window type' : 'Door type', o.kind, o.assemblyId, id => (o.assemblyId = id)),
        o.kind === 'window' ? h('div', {}, sourcedNum('SHGC (optional, for solar)', o.shgc, (v, q) => (o.shgc = { value: v, quality: q })), simpleSel('Shading', ['unknown', 'none', 'interior', 'exterior'], o.shading, v => (o.shading = v as typeof o.shading))) : null,
        h('button', { class: 'danger', onClick: () => { w.openings = w.openings.filter(x => x !== o); commit(); } }, 'Remove'))),
        h('div', { class: 'row' }, h('button', { class: 'sec', onClick: () => { w.openings.push(newOpening('window', 3, 4, lastAsm('window'))); commit(); } }, '＋ Window'), h('button', { class: 'sec', onClick: () => { w.openings.push(newOpening('door', 3, 6.67, lastAsm('door'))); commit(); } }, '＋ Door')),
        h('div', { class: 'mut' }, `Gross ${(w.lengthFt * w.heightFt).toFixed(1)} ft² · openings ${w.openings.reduce((s, o) => s + o.quantity * o.widthFt * o.heightFt, 0).toFixed(1)} ft² · net ${(w.lengthFt * w.heightFt - w.openings.reduce((s, o) => s + o.quantity * o.widthFt * o.heightFt, 0)).toFixed(1)} ft²`)) : null);
  }
  const lastAsm = (kind: AssemblyKind): string | null => { const l = p!.assemblies.filter(a => a.kind === kind); return l.length === 1 ? l[0].id : null; };
  function horizontals(r: Room): Child {
    const one = (name: 'Ceiling' | 'Floor', hs: Room['ceiling'], kind: AssemblyKind) => h('div', { class: 'card' }, h('h3', {}, name),
      sel('What is on the other side?', name === 'Ceiling'
        ? [['conditioned-adjacent', 'Heated/cooled room above'], ['unconditioned', 'Attic / unconditioned space'], ['exterior', 'Roof directly (vaulted)'], ['ground', 'n/a']]
        : [['conditioned-adjacent', 'Heated/cooled room below'], ['unconditioned', 'Garage / crawl / unconditioned'], ['exterior', 'Open to outdoors'], ['ground', 'Slab / below grade (NOT calculated)']], hs.condition, v => (hs.condition = v as Room['ceiling']['condition'])),
      hs.condition === 'unconditioned' ? h('div', { class: 'grid2' }, num('Winter temp there °F', hs.adjacentHeatTempF, n => (hs.adjacentHeatTempF = n)), num('Summer temp there °F', hs.adjacentCoolTempF, n => (hs.adjacentCoolTempF = n))) : null,
      hs.condition === 'unconditioned' || hs.condition === 'exterior' ? asmSelect(`${name} construction`, kind, hs.assemblyId, id => (hs.assemblyId = id)) : null,
      hs.condition === 'ground' ? h('div', { class: 'banner' }, 'No sourced slab/below-grade method is implemented. This surface is excluded and flagged in results.') : null);
    return [one('Ceiling', r.ceiling, 'roof-ceiling'), one('Floor', r.floor, 'floor'),
      h('div', { class: 'card' }, h('h3', {}, 'Internal gains'), num('Occupants', r.occupants, n => (r.occupants = n ?? 0)), num('Appliance/lighting sensible (Btu/h, if known)', r.applianceSensibleBtuh, n => (r.applianceSensibleBtuh = n ?? 0)))];
  }
  function roomReview(r: Room): Child {
    const res = calculate(p!); const rr = res.rooms.find(x => x.roomId === r.id)!;
    return h('div', { class: 'card' }, h('div', {}, 'Heating: ', h('span', { class: 'big-num' }, fmt(rr.heating?.btuh ?? null)), ' Btu/h'), h('div', {}, 'Cooling sensible: ', h('b', {}, fmt(rr.coolingSensible?.btuh ?? null))), h('div', {}, 'Cooling latent: ', h('b', {}, fmt(rr.coolingLatent?.btuh ?? null))),
      issueList(rr.issues));
  }
  const issueList = (xs: { severity: string; message: string }[]) => h('ul', { class: 'iss' }, xs.map(x => h('li', { class: x.severity }, h('b', {}, x.severity + ' '), x.message)));

  // ---- results -------------------------------------------------------------
  function results(): void {
    const P = p!; const res = calculate(P); const t = res.totals;
    const tile = (l: string, v: number | null) => h('div', { class: 'card' }, h('div', { class: 'mut' }, l), h('div', { class: 'big-num' }, v === null ? 'not calculated' : `${fmt(v)} Btu/h`), v !== null ? h('div', { class: 'mut' }, `${btuhToTons(v).toFixed(2)} tons`) : null);
    shell(`${P.name} — Results`, [
      h('div', { class: 'banner' }, 'Preliminary, partial-method results. Not ACCA Manual J and not for equipment sizing on their own. Cooling excludes opaque solar/mass effects. See "Not included" below.'),
      tile('Whole-house heating', t.heating), tile('Cooling — sensible (incomplete method)', t.coolingSensible), tile('Cooling — latent', t.coolingLatent), tile('Cooling — total', t.coolingTotal),
      res.rooms.map(rr => h('details', { class: 'card' }, h('summary', {}, `${rr.name}: H ${fmt(rr.heating?.btuh ?? null)} · CS ${fmt(rr.coolingSensible?.btuh ?? null)} · CL ${fmt(rr.coolingLatent?.btuh ?? null)}`),
        rr.walls.map(w => h('div', { class: 'mut' }, `${w.label} ${w.cardinal ?? '?'}: gross ${w.grossFt2.toFixed(1)} − openings ${w.openingFt2.toFixed(1)} = net ${w.netFt2.toFixed(1)} ft²`)),
        ([['Heating', rr.heating], ['Cooling sensible', rr.coolingSensible], ['Cooling latent', rr.coolingLatent]] as const).map(([l, m]) => m ? h('div', {}, h('h3', {}, `${l}: ${fmt(m.btuh)}`), h('table', { class: 't' }, m.components.map(c => h('tr', {}, h('td', {}, c.label), h('td', { class: 'r' }, fmt(c.btuh)), h('td', {}, qb(c.quality)))))) : null),
        issueList(rr.issues))),
      h('h2', {}, 'Project issues'), issueList(res.issues),
      h('h2', {}, 'Not included'), h('ul', { class: 'iss' }, res.notIncluded.map(x => h('li', {}, x))),
      h('p', { class: 'mut' }, Object.entries(res.qualityCounts).map(([k, v]) => `${k}: ${v}`).join(' · ')),
    ], { n: 'home' }, 'results');
  }

  // ---- report --------------------------------------------------------------
  function reportTab(): void {
    const P = p!; const html = renderReportHtml(P, calculate(P));
    const fileName = `${P.name.replace(/[^\w-]+/g, '_') || 'report'}-load-report.html`;
    const file = new File([html], fileName, { type: 'text/html' });
    const save = async () => {
      try { if ((navigator as any).canShare?.({ files: [file] })) { await (navigator as any).share({ files: [file], title: P.name }); return; } } catch (e) { if ((e as Error).name === 'AbortError') return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = fileName; document.body.append(a); a.click(); a.remove();
    };
    const frame = h('iframe', { title: 'Report' }) as HTMLIFrameElement; frame.srcdoc = html;
    shell(`${P.name} — Report`, [h('div', { class: 'row' }, h('button', { onClick: save }, 'Share / save report'), h('button', { class: 'sec', onClick: () => frame.contentWindow?.print() }, 'Print')), frame], { n: 'home' }, 'report');
  }

  render();
  void initOta();
}
