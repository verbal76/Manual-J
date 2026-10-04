import { calculate } from '../engine/calc';
import { cardinalFromHeading, roomFloorArea, roomVolume, wallGross, wallNet, wallOpeningArea } from '../engine/geometry';
import type { Assembly, AssemblyKind, CalcResult, Cardinal, Issue, Project, Quality, Room, Wall } from '../engine/types';
import { btuhToTons, formatFtIn, parseLength, parseNumber, rToU, uToR } from '../engine/units';
import { SCHEMA_VERSION, newAssembly, newOpening, newProject, newRoom, sourced, uid } from '../model/factory';
import { ProjectLoadError, ProjectStore, browserKV } from '../model/persistence';
import { renderReportHtml } from '../report/report';
import { h, type Child } from './dom';
import { clearSkipNextSplash, markSkipNextSplash } from './splash';
import { RUNTIME_VERSION } from '../ota/runtime';
import { OtaUpdater, type OtaAdapter } from '../ota/updater';
import { capgoAdapter, isNative } from '../ota/capgoAdapter';
import { APP_NAME, PUBLIC_VERSION_LABEL, collectDiagnostics, installedVersionCode } from '../release/identity';
import { logError } from '../release/errorlog';

type Tab = 'setup' | 'rooms' | 'results' | 'report';
type Screen = { n: 'home' } | { n: 'settings' } | { n: 'about' } | { n: 'proj'; tab: Tab } | { n: 'room'; id: string; step: number } | { n: 'asm'; kind: AssemblyKind; editId?: string; back: Screen; apply?: (id: string) => void };
type Notice = { kind: 'error' | 'warn' | 'info'; text: string } | null;

const DESCRIPTORS: Record<AssemblyKind, Record<string, string[]>> = {
  wall: { Framing: ['2x4', '2x6', 'masonry', 'block', 'log', 'other', 'unknown'], Insulation: ['none', 'fiberglass', 'cellulose', 'foam', 'other', 'unknown'], 'Exterior finish': ['brick', 'siding', 'stucco', 'other', 'unknown'] },
  window: { Glazing: ['single', 'double', 'triple', 'unknown'], Frame: ['wood', 'vinyl', 'aluminum', 'other', 'unknown'], 'Low-E': ['yes', 'no', 'unknown'] },
  door: { Type: ['wood', 'steel', 'fiberglass', 'glass', 'other', 'unknown'] },
  'roof-ceiling': { Type: ['flat ceiling under attic', 'cathedral/vaulted', 'other', 'unknown'], Insulation: ['none', 'fiberglass', 'cellulose', 'foam', 'other', 'unknown'] },
  floor: { Type: ['over crawl/basement', 'over garage', 'other', 'unknown'], Insulation: ['none', 'fiberglass', 'foam', 'other', 'unknown'] },
};
const KIND_LABEL: Record<AssemblyKind, string> = { wall: 'wall', window: 'window', door: 'door', 'roof-ceiling': 'ceiling/roof', floor: 'floor' };
const FREE_ERA: AssemblyKind[] = ['wall', 'roof-ceiling', 'floor'];
const CARD_DEG: Record<string, number> = { N: 0, E: 90, S: 180, W: 270 };
const ICONS: Record<string, string> = {
  setup: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  rooms: '<path d="M4 20V4h10v16M14 8h6v12M4 20h16"/><circle cx="11" cy="12" r=".8"/>',
  results: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  report: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/>',
};
const icon = (n: string): HTMLElement => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONS[n]; return s as unknown as HTMLElement; };

export function startApp(root: HTMLElement, boot: { splashDone: Promise<void> } = { splashDone: Promise.resolve() }): void {
  const store = new ProjectStore(browserKV(window.localStorage));
  let screen: Screen = { n: 'home' };
  let p: Project | null = null;
  let notice: Notice = null;
  let currentBack: Screen | undefined;
  let updater: OtaUpdater | null = null;
  let splashGone = false;
  const noAdapter: OtaAdapter = { fetchManifest: async () => { throw new Error('web'); }, download: async () => { throw new Error('web'); }, deleteBundle: async () => undefined, activate: async () => undefined, notifyReady: async () => undefined };
  const say = (kind: 'error' | 'warn' | 'info', text: string) => { notice = { kind, text }; };

  // ---- OTA: safe activation point = Home screen, studio card finished. Projects autosave on every change. -------------
  const maybeActivate = () => {
    if (!updater || !splashGone || updater.state.kind !== 'staged' || screen.n !== 'home') return;
    markSkipNextSplash(); // the activation reload is not a cold launch: don't replay the studio card
    void updater.activateIfStaged().then(ok => { if (!ok) clearSkipNextSplash(); if (!ok && updater!.state.kind === 'failed') { say('warn', 'The update could not be applied. Your projects are safe and the current version keeps running.'); render(); } });
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
  boot.splashDone.then(() => { splashGone = true; maybeActivate(); });

  const go = (s: Screen) => { screen = s; if (notice && notice.kind !== 'error') notice = null; render(); window.scrollTo(0, 0); maybeActivate(); };

  // ---- persistence + lifecycle ---------------------------------------------------------------------------------------
  const persist = (): boolean => {
    if (!p) return true;
    try { store.save(p); if (notice?.kind === 'error' && notice.text.startsWith('NOT SAVED')) notice = null; return true; }
    catch (e) { logError('save', e); say('error', `NOT SAVED: this device refused to store the project (${(e as Error).message}). Free up storage, then change a value again to retry. Nothing is lost while the app stays open.`); return false; }
  };
  const commit = () => { persist(); render(); };
  /** Commit a half-typed field and write to storage. Called whenever the app may be about to go away. */
  const flush = () => { (document.activeElement as HTMLElement | null)?.blur?.(); persist(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  window.addEventListener('error', ev => { logError('window', ev.error ?? ev.message); say('error', 'Something went wrong. Your saved projects are unaffected; if it keeps happening use Settings → About → Copy diagnostics.'); render(); });
  window.addEventListener('unhandledrejection', ev => { logError('promise', ev.reason); });
  if (isNative()) {
    void import('@capacitor/app').then(({ App }) => {
      void App.addListener('backButton', () => { if (currentBack) go(currentBack); else void App.exitApp(); });
      void App.addListener('appStateChange', s => { if (!s.isActive) flush(); });
    });
  }

  // ---- field helpers -------------------------------------------------------------------------------------------------
  const selectAll = (e: Event) => { const t = e.target as HTMLInputElement; setTimeout(() => t.select?.(), 0); };
  const doneOnEnter = (e: KeyboardEvent) => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); };
  const field = (label: string, input: HTMLElement, hint?: string) => h('div', {}, h('label', {}, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
  const txt = (label: string, v: string, set: (s: string) => void, hint?: string) => field(label, h('input', { type: 'text', value: v, autocomplete: 'off', enterkeyhint: 'done', onKeydown: doneOnEnter, onChange: (e: Event) => { set((e.target as HTMLInputElement).value.trim()); commit(); } }), hint);
  /** Numeric field. Blank = null (UNKNOWN). Rejects look-alikes ("1e3", "0x10") and out-of-range values with a visible message. */
  const num = (label: string, v: number | null, set: (n: number | null) => void, hint?: string, o: { min?: number; max?: number; int?: boolean } = {}) =>
    field(label, h('input', { type: 'text', inputmode: 'decimal', enterkeyhint: 'done', autocomplete: 'off', value: v === null ? '' : String(v), onFocus: selectAll, onKeydown: doneOnEnter,
      onChange: (e: Event) => {
        const s = (e.target as HTMLInputElement).value.trim();
        if (s === '') { set(null); return commit(); }
        const n = parseNumber(s);
        if (n === null) { say('error', `"${s}" is not a number. Use digits and a decimal point, like 12.5.`); return render(); }
        if ((o.min !== undefined && n < o.min) || (o.max !== undefined && n > o.max) || (o.int && !Number.isInteger(n))) { say('error', `${label}: enter ${o.int ? 'a whole number' : 'a number'}${o.min !== undefined ? ` from ${o.min}` : ''}${o.max !== undefined ? ` to ${o.max}` : ''}.`); return render(); }
        set(n); commit();
      } }), hint);
  const len = (label: string, ft: number, set: (ft: number) => void, bare: 'ft' | 'in' = 'ft') =>
    field(label, h('input', { type: 'text', inputmode: 'text', enterkeyhint: 'done', autocomplete: 'off', value: bare === 'in' ? String(Math.round(ft * 12 * 100) / 100) : formatFtIn(ft), onFocus: selectAll, onKeydown: doneOnEnter,
      onChange: (e: Event) => { const raw = (e.target as HTMLInputElement).value; const v = parseLength(raw, bare); if (v === null || v <= 0) { say('error', `Could not read "${raw}" as a length. Try ${bare === 'ft' ? `10'6" or 10.5` : '36'}.`); return render(); } set(v); commit(); } }),
      bare === 'ft' ? `e.g. 10'6" or 10.5 (now ${ft.toFixed(2)} ft)` : 'inches');
  const sel = (label: string, opts: [string, string][], v: string, set: (s: string) => void, hint?: string) =>
    field(label, h('select', { onChange: (e: Event) => { set((e.target as HTMLSelectElement).value); commit(); } }, opts.map(([val, lab]) => h('option', { value: val, selected: val === v }, lab))), hint);
  const simpleSel = (label: string, opts: string[], v: string, set: (s: string) => void) => sel(label, opts.map(o => [o, o]), v, set);
  const sourcedNum = (label: string, s: { value: number | null; quality: Quality; source?: string }, set: (v: number | null, q: Quality) => void, hint?: string, o: { min?: number; max?: number } = {}) => h('div', {},
    num(label, s.value, n => set(n, n === null ? 'UNKNOWN' : s.quality === 'UNKNOWN' ? 'ESTIMATED' : s.quality), s.value === null ? `${hint ?? ''} UNKNOWN until entered.`.trim() : hint, o),
    s.value !== null ? sel('How sure are you of this value?', (['KNOWN', 'SELECTED', 'ESTIMATED'] as Quality[]).map(q => [q, q === 'KNOWN' ? 'KNOWN (measured / documented)' : q === 'SELECTED' ? 'SELECTED (picked from a reference)' : 'ESTIMATED (my best guess)']), s.quality, q => set(s.value, q as Quality)) : null);
  const qb = (q: Quality) => h('span', { class: `q q-${q}` }, q);
  const fmt = (n: number | null) => (n === null ? '—' : Math.round(n).toLocaleString('en-US'));
  const noticeEl = () => (notice ? h('div', { class: `banner ${notice.kind}`, role: notice.kind === 'error' ? 'alert' : 'status' }, notice.text, notice.kind === 'error' ? h('div', {}, h('button', { class: 'sec', onClick: () => { notice = null; render(); } }, 'Dismiss')) : null) : null);

  // ---- shell ---------------------------------------------------------------------------------------------------------
  function shell(title: string, body: Child, backTo?: Screen, nav?: Tab): void {
    currentBack = backTo;
    const kids: Child[] = [h('header', { class: 'top' }, backTo ? h('button', { onClick: () => go(backTo), 'aria-label': 'Back' }, '‹ Back') : null, h('h1', {}, title)), noticeEl(), body];
    if (nav) kids.push(h('nav', { class: 'bottom', 'aria-label': 'Project sections' }, h('div', { class: 'navin' }, ([['setup', 'Setup'], ['rooms', 'Rooms'], ['results', 'Results'], ['report', 'Report']] as [Tab, string][]).map(([t, l]) => h('button', { class: nav === t ? 'on' : '', 'aria-current': nav === t ? 'page' : undefined, onClick: () => go({ n: 'proj', tab: t }) }, icon(t), l)))));
    root.replaceChildren(...(kids.flat(3).filter(Boolean) as Node[]));
  }

  let rendering = false, again = false, firstRendered = false;
  function render(): void {
    // Blurring the focused field fires its pending 'change' (which commits and re-renders); coalesce those.
    if (rendering) { again = true; return; }
    rendering = true;
    try { (document.activeElement as HTMLElement | null)?.blur?.(); do { again = false; renderNow(); } while (again); if (!firstRendered) { firstRendered = true; try { performance.mark('manualj:first-render'); } catch { /* optional */ } } }
    catch (e) { logError('render', e); root.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'Something went wrong showing this screen'), h('p', { class: 'mut' }, 'Your saved projects are unaffected.'), h('button', { class: 'big', onClick: () => { screen = { n: 'home' }; p = null; render(); } }, 'Back to projects'))); }
    finally { rendering = false; }
  }
  function renderNow(): void {
    if (screen.n === 'settings') return settings();
    if (screen.n === 'about') return about();
    if (screen.n === 'home' || !p) return home();
    if (screen.n === 'proj') return screen.tab === 'setup' ? setup() : screen.tab === 'rooms' ? roomsTab() : screen.tab === 'results' ? results() : reportTab();
    if (screen.n === 'room') return roomWizard(screen);
    return asmEditor(screen);
  }

  // ---- what still blocks a calculation, in plain language, with a tap-to-fix target -----------------------------------
  interface Todo { text: string; to: Screen }
  function todos(P: Project, res: CalcResult): Todo[] {
    const out: Todo[] = []; const seen = new Set<string>();
    const add = (text: string, to: Screen) => { if (!seen.has(text)) { seen.add(text); out.push({ text, to }); } };
    for (const x of res.issues) if (x.severity === 'ERROR') add(x.message, x.where === 'NO_ROOMS' || x.code === 'NO_ROOMS' ? { n: 'proj', tab: 'rooms' } : { n: 'proj', tab: 'setup' });
    for (const rr of res.rooms) {
      const room = P.house.rooms.find(r => r.id === rr.roomId); if (!room) continue;
      for (const x of rr.issues) {
        if (x.severity !== 'ERROR' || x.code === 'ROOM_NOT_CALCULATED') continue;
        const setupFix = ['NO_ACH', 'NO_DESIGN_TEMPS', 'NO_HUMIDITY'].includes(x.code);
        const step = /ceiling|floor/i.test(x.message) ? 2 : x.code === 'ROOM_DIMS' || x.code === 'ROOM_IMPLAUSIBLE' || x.code === 'OCCUPANTS' || x.code === 'APPLIANCE' ? 0 : 1;
        add(`${setupFix ? '' : room.name + ': '}${x.message}`, setupFix ? { n: 'proj', tab: 'setup' } : { n: 'room', id: room.id, step });
      }
    }
    return out;
  }
  const todoCard = (items: Todo[], title = 'To do before results are complete') => items.length === 0 ? null : h('div', { class: 'card' }, h('h3', {}, title, ' ', h('span', { class: 'chip todo' }, String(items.length))),
    h('ul', { class: 'iss' }, items.slice(0, 8).map(t => h('li', {}, t.text, ' ', h('button', { class: 'linkish', onClick: () => go(t.to) }, 'Fix ›')))), items.length > 8 ? h('div', { class: 'mut' }, `…and ${items.length - 8} more.`) : null);
  const issueList = (xs: Issue[]) => h('ul', { class: 'iss' }, xs.map(x => h('li', { class: x.severity }, h('b', {}, x.severity + ' '), x.message)));

  // ---- home ----------------------------------------------------------------------------------------------------------
  function home(): void {
    let list = store.list(); const when = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
    shell('Manual J', [
      h('div', { class: 'card hero' }, h('div', { style: 'font-size:1.35rem;font-weight:800' }, 'Manual J Survey'), h('div', { class: 'sub' }, 'Walk the house, room by room. Heating and cooling loads, with every assumption shown.')),
      h('button', { class: 'big', onClick: () => {
        const base = 'New house'; const names = new Set(list.map(x => x.name)); let name = base; for (let k = 2; names.has(name); k++) name = `${base} ${k}`;
        p = newProject(name); if (persist()) go({ n: 'proj', tab: 'setup' }); else { p = null; render(); }
      } }, '＋ New project'),
      list.length ? h('h2', {}, `Projects (${list.length})`) : h('div', { class: 'card' }, h('b', {}, 'No projects yet'), h('div', { class: 'mut' }, 'Start a project, enter the design conditions, then add the rooms as you walk the house.')),
      list.map(x => h('div', { class: 'card' }, h('div', { style: 'font-weight:700;font-size:1.05rem' }, x.name), h('div', { class: 'mut' }, `Saved ${when(x.updatedAt)}`),
        h('div', { class: 'row', style: 'margin-top:10px' },
          h('button', { onClick: () => { try { p = store.load(x.id); go({ n: 'proj', tab: 'rooms' }); } catch (e) { p = null; logError('open', e); say('error', (e as Error).message); render(); } } }, 'Open'),
          h('button', { class: 'sec', onClick: () => { try { store.duplicate(x.id); say('info', `Copied "${x.name}".`); } catch (e) { logError('duplicate', e); say('error', (e as ProjectLoadError).message); } render(); } }, 'Copy'),
          h('button', { class: 'danger', onClick: () => { if (confirm(`Delete "${x.name}" and all its rooms? This cannot be undone.`)) { store.remove(x.id); list = store.list(); render(); } } }, 'Delete')))),
      h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { class: 'sec', onClick: () => go({ n: 'settings' }) }, '⚙ Settings')),
      h('p', { class: 'mut' }, `${APP_NAME} ${PUBLIC_VERSION_LABEL}. Preliminary survey tool, not ACCA-approved.`),
    ]);
  }

  // ---- settings / about ----------------------------------------------------------------------------------------------
  function settings(): void {
    shell('Settings', [h('div', { class: 'card' }, h('button', { class: 'big', onClick: () => go({ n: 'about' }) }, 'About / release diagnostics ›'), h('div', { class: 'mut' }, 'Version, install and update information. Copy it to share with support.'))], { n: 'home' });
  }
  function about(): void {
    const body = h('div', {}, h('p', { class: 'mut' }, 'Loading…'));
    shell('About', body, { n: 'settings' });
    void collectDiagnostics(updater).then(({ text }) => {
      if (screen.n !== 'about') return;
      const pre = h('pre', { class: 'diag' }, text);
      const copy = async () => {
        try { await navigator.clipboard.writeText(text); say('info', 'Diagnostics copied.'); }
        catch { const ta = h('textarea', { class: 'diag-copy' }) as HTMLTextAreaElement; ta.value = text; document.body.append(ta); ta.select(); try { document.execCommand('copy'); say('info', 'Diagnostics copied.'); } catch { say('warn', 'Copy failed: select the text above and copy it manually.'); } ta.remove(); }
        render();
      };
      const kids: Node[] = [pre, h('button', { class: 'big', onClick: copy }, 'Copy diagnostics')];
      if (updater && updater.state.kind !== 'disabled') kids.push(h('button', { class: 'sec big', onClick: () => { void updater!.check({ force: true }).then(() => render()); } }, 'Check for update now'));
      body.replaceChildren(...kids);
    });
  }

  // ---- setup ---------------------------------------------------------------------------------------------------------
  const sectionChip = (done: boolean, optional = false) => h('span', { class: `chip ${done ? 'ok' : optional ? '' : 'todo'}` }, done ? 'DONE' : optional ? 'OPTIONAL' : 'NEEDED');
  function setup(): void {
    const P = p!, d = P.design;
    const sg = (c: Cardinal) => num(c, d.solarGain[c] ?? null, n => { if (n === null) delete d.solarGain[c]; else d.solarGain[c] = n; }, undefined, { min: 0, max: 1000 });
    const designDone = [d.heatOutdoorF, d.heatIndoorF, d.coolOutdoorF, d.coolIndoorF, d.outdoorGrainsCool, d.indoorGrainsCool].every(v => v !== null);
    const achDone = P.infiltration.heatAch.value !== null && P.infiltration.coolAch.value !== null;
    shell(P.name || 'Project', [
      h('div', { class: 'card' }, h('h3', {}, 'Project'), txt('Project name', P.name, s => (P.name = s || 'Untitled project')), txt('Client', P.client, s => (P.client = s)), txt('Address', P.address, s => (P.address = s))),
      h('div', { class: 'card' }, h('h3', {}, 'Design conditions ', sectionChip(designDone)), h('p', { class: 'mut' }, 'No national defaults are supplied. Enter the values from your source and say where they came from; the report prints it.'),
        txt('Location', d.location, s => (d.location = s)), txt('Source of these values', d.source, s => (d.source = s), 'For example the table or tool you used.'),
        num('Elevation (ft)', d.elevationFt, n => (d.elevationFt = n), 'Optional. Above 2000 ft the air loads are overstated (no altitude correction).', { min: -500, max: 20000 }),
        h('div', { class: 'grid2' }, num('Heating: outdoor °F', d.heatOutdoorF, n => (d.heatOutdoorF = n), undefined, { min: -80, max: 150 }), num('Heating: indoor °F', d.heatIndoorF, n => (d.heatIndoorF = n), undefined, { min: -80, max: 150 }),
          num('Cooling: outdoor °F', d.coolOutdoorF, n => (d.coolOutdoorF = n), undefined, { min: -80, max: 150 }), num('Cooling: indoor °F', d.coolIndoorF, n => (d.coolIndoorF = n), undefined, { min: -80, max: 150 }),
          num('Outdoor humidity (grains/lb)', d.outdoorGrainsCool, n => (d.outdoorGrainsCool = n), undefined, { min: 0, max: 500 }), num('Indoor humidity (grains/lb)', d.indoorGrainsCool, n => (d.indoorGrainsCool = n), undefined, { min: 0, max: 500 }))),
      h('div', { class: 'card' }, h('h3', {}, 'Air leakage ', sectionChip(achDone)), h('p', { class: 'mut' }, 'Air changes per hour for the whole house. Required — no default is assumed.'),
        sourcedNum('Heating season ACH', P.infiltration.heatAch, (v, q) => (P.infiltration.heatAch = { value: v, quality: q }), undefined, { min: 0, max: 20 }),
        sourcedNum('Cooling season ACH', P.infiltration.coolAch, (v, q) => (P.infiltration.coolAch = { value: v, quality: q }), undefined, { min: 0, max: 20 })),
      h('div', { class: 'card' }, h('h3', {}, 'Occupant heat gain ', sectionChip(P.internal.sensiblePerPersonBtuh.value !== null && P.internal.latentPerPersonBtuh.value !== null, true)), h('p', { class: 'mut' }, 'Only needed if you enter occupants in rooms. Otherwise occupant gains are left out (and the report says so).'),
        sourcedNum('Sensible per person (Btu/h)', P.internal.sensiblePerPersonBtuh, (v, q) => (P.internal.sensiblePerPersonBtuh = { value: v, quality: q }), undefined, { min: 0, max: 2000 }),
        sourcedNum('Latent per person (Btu/h)', P.internal.latentPerPersonBtuh, (v, q) => (P.internal.latentPerPersonBtuh = { value: v, quality: q }), undefined, { min: 0, max: 2000 })),
      h('details', { class: 'card' }, h('summary', {}, 'Window solar gain factors (optional)'), h('p', { class: 'mut' }, 'Btu/h per ft² of glass at SHGC 1.0, by the direction the wall faces. Leave blank to leave solar gain out (the report says so).'), h('div', { class: 'grid2' }, (['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as Cardinal[]).map(sg))),
    ], { n: 'home' }, 'setup');
  }

  // ---- rooms ---------------------------------------------------------------------------------------------------------
  function roomsTab(): void {
    const P = p!; const res = calculate(P); const items = todos(P, res);
    shell(P.name || 'Rooms', [
      h('button', { class: 'big', onClick: () => { const r = newRoom(`Room ${P.house.rooms.length + 1}`, 12, 12, 8, 0); P.house.rooms.push(r); persist(); go({ n: 'room', id: r.id, step: 0 }); } }, '＋ Add room'),
      P.house.rooms.length === 0 ? h('div', { class: 'card' }, h('b', {}, 'No rooms yet'), h('div', { class: 'mut' }, 'Add a room, then enter its size, walls, windows and doors as you stand in it.')) : null,
      P.house.rooms.map((r, i) => { const rr = res.rooms[i]; const blocked = rr.heating === null || rr.coolingSensible === null; const errs = rr.issues.filter(x => x.severity === 'ERROR' && x.code !== 'ROOM_NOT_CALCULATED').length;
        return h('div', { class: 'card' }, h('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:center' }, h('b', { style: 'font-size:1.05rem' }, r.name), blocked ? h('span', { class: 'chip todo' }, errs ? `${errs} TO FIX` : 'INCOMPLETE') : h('span', { class: 'chip ok' }, 'READY')),
          h('div', { class: 'mut' }, `${formatFtIn(r.lengthFt)} × ${formatFtIn(r.widthFt)} × ${formatFtIn(r.ceilingHeightFt)} · ${rr.floorAreaFt2.toFixed(0)} ft² · ${rr.volumeFt3.toFixed(0)} ft³`),
          blocked ? null : h('div', { style: 'margin-top:6px' }, `Heating ${fmt(rr.heating!.btuh)} · Cooling ${fmt(rr.coolingSensible!.btuh)} Btu/h sensible`),
          h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { onClick: () => go({ n: 'room', id: r.id, step: 0 }) }, 'Edit'),
            h('button', { class: 'sec', onClick: () => { const c = structuredClone(r); c.id = uid(); c.name += ' copy'; c.walls.forEach(w => { w.id = uid(); w.openings.forEach(o => (o.id = uid())); }); P.house.rooms.splice(i + 1, 0, c); commit(); } }, 'Copy'),
            h('button', { class: 'danger', onClick: () => { if (confirm(`Delete ${r.name}?`)) { P.house.rooms.splice(i, 1); commit(); } } }, 'Delete')));
      }),
      todoCard(items),
      h('div', { class: 'card tight' }, h('div', { class: 'mut' }, 'House total heating'), h('div', { class: 'big-num' }, res.totals.heating === null ? 'not yet' : `${fmt(res.totals.heating)} Btu/h`), h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'ghost', onClick: () => go({ n: 'proj', tab: 'results' }) }, 'Open results ›'))),
    ], { n: 'home' }, 'rooms');
  }

  // ---- construction picker/editor ------------------------------------------------------------------------------------
  const asmLabel = (a: Assembly) => `${a.name} — ${a.u.value === null ? 'value needed' : `R-${uToR(a.u.value).toFixed(1)} · ${a.u.quality}`}`;
  const asmUsed = (id: string) => !!p && (p.house.rooms.some(r => r.ceiling.assemblyId === id || r.floor.assemblyId === id || r.walls.some(w => w.assemblyId === id || w.openings.some(o => o.assemblyId === id))));
  function asmSelect(label: string, kind: AssemblyKind, cur: string | null, set: (id: string | null) => void): HTMLElement {
    const here = screen;
    const opts: [string, string][] = [['', `— choose ${KIND_LABEL[kind]} construction —`], ...p!.assemblies.filter(a => a.kind === kind).map(a => [a.id, asmLabel(a)] as [string, string]), ['__new__', '＋ New / describe construction…']];
    return sel(label, opts, cur ?? '', v => { if (v === '__new__') { notice = null; screen = { n: 'asm', kind, back: here, apply: id => set(id) }; } else set(v || null); });
  }
  function asmEditor(s: Extract<Screen, { n: 'asm' }>): void {
    const P = p!;
    const a = (s.editId && P.assemblies.find(x => x.id === s.editId)) || newAssembly(s.kind, '');
    const isNew = !P.assemblies.includes(a);
    const useR = !(s.kind === 'window' || s.kind === 'door');
    let mode: 'R' | 'U' = useR ? 'R' : 'U'; let val = a.u.value === null ? '' : String(Math.round((mode === 'R' ? uToR(a.u.value) : a.u.value) * 1000) / 1000); let q: Quality = a.u.quality === 'UNKNOWN' ? 'ESTIMATED' : a.u.quality; let src = a.u.source ?? ''; let name = a.name; let era = a.descriptors['Age/era'] ?? '';
    const desc = { ...a.descriptors };
    const body = h('div', { class: 'card' },
      h('p', { class: 'mut' }, 'Describe the construction as you see it. These choices do not set a number: no unsourced R/U table is built in. Enter the value you know or estimate, and say which it is.'),
      Object.entries(DESCRIPTORS[s.kind]).map(([k, opts]) => simpleSelNoCommit(k, ['', ...opts], desc[k] ?? '', v => (desc[k] = v))),
      FREE_ERA.includes(s.kind) ? field('Age / era (optional)', h('input', { type: 'text', value: era, onChange: (e: Event) => (era = (e.target as HTMLInputElement).value) })) : null,
      field('Name (blank = automatic)', h('input', { type: 'text', value: name, onChange: (e: Event) => (name = (e.target as HTMLInputElement).value) })),
      simpleSelNoCommit('Enter the value as', ['R-value', 'U-factor'], mode === 'R' ? 'R-value' : 'U-factor', v => (mode = v === 'R-value' ? 'R' : 'U')),
      field('Whole-assembly value (framing, air films, glass included)', h('input', { type: 'text', inputmode: 'decimal', value: val, onFocus: selectAll, onChange: (e: Event) => (val = (e.target as HTMLInputElement).value) }), 'Leave blank if you do not know yet; the room will ask for it.'),
      simpleSelNoCommit('How sure are you of this value?', ['KNOWN', 'SELECTED', 'ESTIMATED'], q, v => (q = v as Quality)),
      field('Where it came from (label, spec sheet, table name…)', h('input', { type: 'text', value: src, onChange: (e: Event) => (src = (e.target as HTMLInputElement).value) })),
      h('button', { class: 'big', onClick: () => {
        const n = val.trim() === '' ? null : parseNumber(val);
        if (val.trim() !== '' && (n === null || n <= 0)) { alert('The value must be a positive number, like 13 or 0.35.'); return; }
        const u = n === null ? null : mode === 'R' ? rToU(n) : n;
        if (u !== null && u > 6) { alert('That is a higher U-factor than any real assembly. Did you enter a U-factor where an R-value belongs (or the reverse)?'); return; }
        a.descriptors = { ...desc }; if (era) a.descriptors['Age/era'] = era; else delete a.descriptors['Age/era'];
        let nm = name.trim() || Object.values(a.descriptors).filter(x => x && x !== 'unknown').join(' · ') || KIND_LABEL[s.kind];
        if (!name.trim()) { const taken = new Set(P.assemblies.filter(x => x !== a && x.kind === s.kind).map(x => x.name)); const base = nm; for (let k = 2; taken.has(nm); k++) nm = `${base} (${k})`; }
        a.name = nm; a.u = u === null ? { value: null, quality: 'UNKNOWN' } : sourced(u, q, src || undefined);
        if (isNew) P.assemblies.push(a);
        notice = null; screen = s.back; s.apply?.(a.id); commit();
      } }, 'Save construction'),
      !isNew && !asmUsed(a.id) ? h('button', { class: 'danger big', onClick: () => { if (confirm(`Delete construction "${a.name}"?`)) { P.assemblies = P.assemblies.filter(x => x !== a); screen = s.back; commit(); } } }, 'Delete this construction') : null);
    shell(isNew ? `New ${KIND_LABEL[s.kind]} construction` : 'Edit construction', body, s.back);
  }
  function simpleSelNoCommit(label: string, opts: string[], v: string, set: (s: string) => void) {
    return field(label, h('select', { onChange: (e: Event) => set((e.target as HTMLSelectElement).value) }, opts.map(o => h('option', { value: o, selected: o === v }, o || '—'))));
  }

  // ---- room wizard ---------------------------------------------------------------------------------------------------
  const STEPS = ['Room', 'Walls', 'Ceiling & floor', 'Review'];
  function roomWizard(s: Extract<Screen, { n: 'room' }>): void {
    const P = p!; const r = P.house.rooms.find(x => x.id === s.id); if (!r) return go({ n: 'proj', tab: 'rooms' });
    const step = (i: number) => go({ n: 'room', id: r.id, step: i });
    const body: Child[] = [h('div', { class: 'steps', role: 'tablist' }, STEPS.map((t, i) => h('button', { class: i === s.step ? 'on' : i < s.step ? 'done' : '', role: 'tab', 'aria-selected': String(i === s.step), onClick: () => step(i) }, `${i + 1}. ${t}`)))];
    if (s.step === 0) body.push(roomBasics(r));
    if (s.step === 1) body.push(wallsStep(r));
    if (s.step === 2) body.push(horizontals(r));
    if (s.step === 3) body.push(roomReview(r));
    body.push(h('div', { class: 'actionbar' }, s.step > 0 ? h('button', { class: 'sec', onClick: () => step(s.step - 1) }, '‹ Back') : h('button', { class: 'sec', onClick: () => go({ n: 'proj', tab: 'rooms' }) }, 'Rooms'),
      s.step < 3 ? h('button', { onClick: () => step(s.step + 1) }, 'Next ›') : h('button', { onClick: () => go({ n: 'proj', tab: 'rooms' }) }, 'Done')));
    shell(r.name, body, s.step > 0 ? { n: 'room', id: r.id, step: s.step - 1 } : { n: 'proj', tab: 'rooms' }); // Android back steps back through the wizard
  }
  function roomBasics(r: Room): Child {
    const resync = (apply: () => void) => { const old = { L: r.lengthFt, W: r.widthFt, H: r.ceilingHeightFt }; apply();
      r.walls.forEach((w, i) => { const o = i % 2 === 0 ? old.L : old.W; if (w.lengthFt === o) w.lengthFt = i % 2 === 0 ? r.lengthFt : r.widthFt; if (w.heightFt === old.H) w.heightFt = r.ceilingHeightFt; }); };
    return h('div', { class: 'card' }, txt('Room name', r.name, s => (r.name = s || 'Room')),
      h('div', { class: 'grid3' }, len('Length (walls 1 & 3)', r.lengthFt, v => resync(() => (r.lengthFt = v))), len('Width (walls 2 & 4)', r.widthFt, v => resync(() => (r.widthFt = v))), len('Ceiling height', r.ceilingHeightFt, v => resync(() => (r.ceilingHeightFt = v)))),
      h('div', { class: 'mut', style: 'margin-top:8px' }, `Floor ${roomFloorArea(r).toFixed(0)} ft² · volume ${roomVolume(r).toFixed(0)} ft³`),
      num('Floor level (1 = main floor)', r.floorLevel, n => (r.floorLevel = n ?? 1), undefined, { min: -5, max: 20, int: true }));
  }
  function wallsStep(r: Room): Child {
    const first = r.walls[0]; const faceNow = first ? cardinalFromHeading(first.heading.deg) : null;
    const rotate = (deg: number) => { r.walls.forEach((w, i) => { w.heading = { deg: (deg + 90 * i) % 360, source: 'manual', confidence: null }; }); };
    return h('div', {},
      h('div', { class: 'card' }, h('h3', {}, 'Which way does wall 1 face?'), h('div', { class: 'row' }, ['N', 'E', 'S', 'W'].map(c => h('button', { class: faceNow === c ? '' : 'sec', onClick: () => { rotate(CARD_DEG[c]); commit(); } }, c))),
        h('div', { class: 'hint' }, 'Sets all four walls going clockwise (walls 2, 3, 4 follow). Adjust any single wall below.')),
      r.walls.map(w => wallCard(r, w)));
  }
  function wallCard(r: Room, w: Wall): Child {
    const card = cardinalFromHeading(w.heading.deg); const setHeading = (deg: number | null) => { w.heading = { deg, source: 'manual', confidence: null }; };
    const interior = w.exposure.type === 'interior-conditioned';
    return h('div', { class: 'card' }, h('h3', {}, `${w.label} — faces ${card ?? '?'}`),
      h('div', { class: 'row' }, ['N', 'E', 'S', 'W'].map(c => h('button', { class: card === c ? '' : 'sec', onClick: () => { setHeading(CARD_DEG[c]); commit(); } }, c))),
      num('Facing (compass degrees, 0 = north, 90 = east)', w.heading.deg, n => setHeading(n), undefined, { min: 0, max: 359.99 }),
      h('div', { class: 'grid2' }, len('Length', w.lengthFt, v => (w.lengthFt = v)), len('Height', w.heightFt, v => (w.heightFt = v))),
      sel('What is on the other side of this wall?', [['exterior', 'Outdoors'], ['interior-conditioned', 'Another heated/cooled room'], ['unconditioned', 'Unconditioned space (garage, attic…)']], w.exposure.type, v => (w.exposure.type = v as Wall['exposure']['type'])),
      w.exposure.type === 'unconditioned' ? h('div', { class: 'grid2' }, num('Winter temp there °F', w.exposure.adjacentHeatTempF, n => (w.exposure.adjacentHeatTempF = n), undefined, { min: -80, max: 170 }), num('Summer temp there °F', w.exposure.adjacentCoolTempF, n => (w.exposure.adjacentCoolTempF = n), undefined, { min: -80, max: 170 })) : null,
      !interior ? asmSelect('Wall construction', 'wall', w.assemblyId, id => (w.assemblyId = id)) : null,
      !interior && w.assemblyId ? h('div', { class: 'row' }, h('button', { class: 'sec', onClick: () => go({ n: 'asm', kind: 'wall', editId: w.assemblyId!, back: screen }) }, 'Edit construction'),
        h('button', { class: 'ghost', onClick: () => { r.walls.filter(x => x.exposure.type === 'exterior').forEach(x => (x.assemblyId = w.assemblyId)); commit(); } }, 'Use for all exterior walls')) : null,
      !interior ? h('div', {}, h('h3', { style: 'margin-top:14px' }, 'Windows and doors'), w.openings.map((o, i) => h('div', { class: 'card', style: 'background:#fbf8f3' }, h('b', {}, `${o.kind === 'window' ? 'Window' : 'Door'} ${i + 1}`),
        h('div', { class: 'grid3' }, num('How many', o.quantity, n => (o.quantity = n ?? 1), undefined, { min: 1, max: 99, int: true }), len('Width (in)', o.widthFt, v => (o.widthFt = v), 'in'), len('Height (in)', o.heightFt, v => (o.heightFt = v), 'in')),
        asmSelect(o.kind === 'window' ? 'Window type' : 'Door type', o.kind, o.assemblyId, id => (o.assemblyId = id)),
        o.kind === 'window' ? h('div', {}, sourcedNum('SHGC (optional, only for solar gain)', o.shgc, (v, q) => (o.shgc = { value: v, quality: q }), undefined, { min: 0.01, max: 1 }), simpleSel('Shading', ['unknown', 'none', 'interior', 'exterior'], o.shading, v => (o.shading = v as typeof o.shading))) : null,
        h('button', { class: 'danger big', onClick: () => { w.openings = w.openings.filter(x => x !== o); commit(); } }, `Remove this ${o.kind}`))),
        h('div', { class: 'row' }, h('button', { class: 'sec', onClick: () => { w.openings.push(newOpening('window', 3, 4, lastAsm('window'))); commit(); } }, '＋ Window'), h('button', { class: 'sec', onClick: () => { w.openings.push(newOpening('door', 3, 6.67, lastAsm('door'))); commit(); } }, '＋ Door')),
        h('div', { class: 'hint', style: 'margin-top:8px' }, `Gross ${wallGross(w).toFixed(1)} ft² − openings ${wallOpeningArea(w).toFixed(1)} ft² = net ${wallNet(w).toFixed(1)} ft²`)) : null);
  }
  const lastAsm = (kind: AssemblyKind): string | null => { const l = p!.assemblies.filter(a => a.kind === kind); return l.length === 1 ? l[0].id : null; };
  function horizontals(r: Room): Child {
    const one = (name: 'Ceiling' | 'Floor', hs: Room['ceiling'], kind: AssemblyKind) => h('div', { class: 'card' }, h('h3', {}, name),
      sel('What is on the other side?', name === 'Ceiling'
        ? [['conditioned-adjacent', 'Heated/cooled room above'], ['unconditioned', 'Attic / unconditioned space'], ['exterior', 'Roof directly (vaulted)'], ['ground', 'Not applicable']]
        : [['conditioned-adjacent', 'Heated/cooled room below'], ['unconditioned', 'Garage / crawl / unconditioned'], ['exterior', 'Open to outdoors'], ['ground', 'Slab / below grade (NOT calculated)']], hs.condition, v => (hs.condition = v as Room['ceiling']['condition'])),
      hs.condition === 'unconditioned' ? h('div', { class: 'grid2' }, num('Winter temp there °F', hs.adjacentHeatTempF, n => (hs.adjacentHeatTempF = n), undefined, { min: -80, max: 170 }), num('Summer temp there °F', hs.adjacentCoolTempF, n => (hs.adjacentCoolTempF = n), undefined, { min: -80, max: 170 })) : null,
      hs.condition === 'unconditioned' || hs.condition === 'exterior' ? asmSelect(`${name} construction`, kind, hs.assemblyId, id => (hs.assemblyId = id)) : null,
      hs.condition === 'unconditioned' || hs.condition === 'exterior' ? num(`${name} area (ft²)`, hs.areaFt2 ?? null, n => { if (n === null) delete hs.areaFt2; else hs.areaFt2 = n; }, `Leave blank to use the floor area (${roomFloorArea(r).toFixed(0)} ft²). Enter the real area for a sloped or vaulted roof.`, { min: 1, max: 100000 }) : null,
      hs.condition === 'ground' && name === 'Floor' ? h('div', { class: 'banner warn' }, 'No sourced slab/below-grade method is built in. This floor is left out of the load and the results say so.') : null);
    return [one('Ceiling', r.ceiling, 'roof-ceiling'), one('Floor', r.floor, 'floor'),
      h('div', { class: 'card' }, h('h3', {}, 'Internal gains in this room'), num('Occupants', r.occupants, n => (r.occupants = n ?? 0), 'Needs the per-person values in Setup.', { min: 0, max: 200, int: true }), num('Appliances/lighting (Btu/h)', r.applianceSensibleBtuh, n => (r.applianceSensibleBtuh = n ?? 0), 'Only if you know it.', { min: 0 }))];
  }
  function roomReview(r: Room): Child {
    const res = calculate(p!); const rr = res.rooms.find(x => x.roomId === r.id)!; const items = todos(p!, res).filter(t => t.to.n === 'room' && (t.to as { id: string }).id === r.id);
    return h('div', {}, h('div', { class: 'card' }, h('div', { class: 'mut' }, 'Heating'), h('div', { class: 'big-num' }, `${fmt(rr.heating?.btuh ?? null)} Btu/h`), h('div', { class: 'row', style: 'margin-top:8px' }, h('div', {}, h('div', { class: 'mut' }, 'Cooling sensible'), h('b', {}, fmt(rr.coolingSensible?.btuh ?? null))), h('div', {}, h('div', { class: 'mut' }, 'Cooling latent'), h('b', {}, fmt(rr.coolingLatent?.btuh ?? null))))),
      todoCard(items, 'Still needed for this room'), rr.issues.length ? h('div', { class: 'card' }, h('h3', {}, 'Notes'), issueList(rr.issues.filter(x => x.code !== 'ROOM_NOT_CALCULATED'))) : null);
  }

  // ---- results -------------------------------------------------------------------------------------------------------
  function results(): void {
    const P = p!; const res = calculate(P); const t = res.totals; const items = todos(P, res);
    const tile = (l: string, v: number | null, sub?: string) => h('div', { class: 'card' }, h('div', { class: 'mut' }, l), h('div', { class: 'big-num' }, v === null ? '—' : fmt(v)), h('div', { class: 'mut' }, v === null ? 'not calculated yet' : `Btu/h${sub ? ' · ' + sub : ''}`));
    shell(P.name || 'Results', [
      h('div', { class: 'banner warn' }, h('b', {}, 'Preliminary, partial method. '), 'Not ACCA Manual J and not for sizing equipment on its own. Cooling leaves out sun and thermal-mass effects on walls and roofs.'),
      todoCard(items, 'Results are incomplete'),
      h('div', { class: 'tiles' }, tile('Heating', t.heating), tile('Cooling — sensible', t.coolingSensible), tile('Cooling — latent', t.coolingLatent), tile('Cooling — total', t.coolingTotal, t.coolingTotal === null ? undefined : `${btuhToTons(t.coolingTotal).toFixed(2)} tons`)),
      h('h2', {}, 'By room'),
      res.rooms.map(rr => h('details', { class: 'card' }, h('summary', {}, `${rr.name}: heat ${fmt(rr.heating?.btuh ?? null)} · cool ${fmt(rr.coolingSensible?.btuh ?? null)}`),
        rr.walls.map(w => h('div', { class: 'mut' }, `${w.label} ${w.cardinal ?? '?'}: gross ${w.grossFt2.toFixed(1)} − openings ${w.openingFt2.toFixed(1)} = net ${w.netFt2.toFixed(1)} ft²`)),
        ([['Heating', rr.heating], ['Cooling sensible', rr.coolingSensible], ['Cooling latent', rr.coolingLatent]] as const).map(([l, m]) => m ? h('div', {}, h('h3', { style: 'margin-top:12px' }, `${l}: ${fmt(m.btuh)} Btu/h`), h('table', { class: 't' }, m.components.map(c => h('tr', {}, h('td', {}, c.label), h('td', { class: 'r' }, fmt(c.btuh)), h('td', {}, qb(c.quality)))))) : null),
        rr.issues.length ? issueList(rr.issues) : null)),
      res.issues.length ? h('details', { class: 'card' }, h('summary', {}, `Project notes (${res.issues.length})`), issueList(res.issues)) : null,
      h('details', { class: 'card' }, h('summary', {}, 'Not included in these numbers'), h('ul', { class: 'iss' }, res.notIncluded.map(x => h('li', {}, x)))),
      h('p', { class: 'mut' }, 'Values are rounded for display only; calculations use unrounded numbers, so a displayed total can differ from the sum of displayed lines by a few Btu/h. ' + Object.entries(res.qualityCounts).map(([k, v]) => `${k}: ${v}`).join(' · ')),
    ], { n: 'home' }, 'results');
  }

  // ---- report --------------------------------------------------------------------------------------------------------
  function reportTab(): void {
    const P = p!; const html = renderReportHtml(P, calculate(P));
    const fileName = `${P.name.replace(/[^\w-]+/g, '_') || 'report'}-load-report.html`;
    const file = new File([html], fileName, { type: 'text/html' });
    const save = async () => {
      if (isNative()) { // Android WebView has no Web Share / blob download: write the file and open the system share sheet
        try {
          const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
          const w = await Filesystem.writeFile({ path: `reports/${fileName}`, data: html, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
          await Share.share({ title: `${P.name} load report`, text: `Manual J load report: ${P.name}`, files: [w.uri], dialogTitle: 'Share or save report' });
        } catch (e) { if (!/cancel|dismiss/i.test((e as Error).message ?? '')) { logError('share-report', e); say('error', `Could not share the report: ${(e as Error).message}`); render(); } }
        return;
      }
      try { if ((navigator as any).canShare?.({ files: [file] })) { await (navigator as any).share({ files: [file], title: P.name }); return; } } catch (e) { if ((e as Error).name === 'AbortError') return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = fileName; document.body.append(a); a.click(); a.remove();
    };
    const frame = h('iframe', { title: 'Report', class: 'report' }) as HTMLIFrameElement; frame.srcdoc = html;
    shell(P.name || 'Report', [h('div', { class: 'row' }, h('button', { onClick: save }, 'Share / save report'), isNative() ? null : h('button', { class: 'sec', onClick: () => frame.contentWindow?.print() }, 'Print')), frame], { n: 'home' }, 'report');
  }

  render();
  void initOta();
}
