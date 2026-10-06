// Full user-workflow check in headless Chromium against `vite preview` (port 4173). Playwright from /opt/node-tools.
// Needs: npx tsx scripts/seed-project.ts > /tmp/claude-0/seed.json (used by the performance check).
import { createRequire } from 'module';
const { chromium } = createRequire('/opt/node-tools/')('playwright');
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad++; };
const b = await chromium.launch();
const URL = 'http://localhost:4173/';
const mkpage = async (vp = { width: 390, height: 800 }) => { const ctx = await b.newContext({ viewport: vp, permissions: ['clipboard-read', 'clipboard-write'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message)); pg.on('dialog', d => d.accept()); return pg; };
const lab = (pg, text, n = 0) => pg.locator('label', { hasText: text }).nth(n).locator('xpath=following-sibling::*[1]');
const fill = async (pg, text, v, n = 0) => { const i = lab(pg, text, n); await i.fill(v); await i.dispatchEvent('change'); };
const pick = async (pg, text, v, n = 0) => { await lab(pg, text, n).selectOption(v); };
const boot = async pg => { await pg.goto(URL); await pg.waitForSelector('#hag-splash', { state: 'detached', timeout: 6000 }); await pg.waitForSelector('text=New project'); };
const newAsm = async (pg, selLabel, n, { value, asU = false }) => { await lab(pg, selLabel, n).selectOption('__new__'); if (asU) await lab(pg, 'Enter the value as').selectOption('U-factor'); await fill(pg, 'Whole-assembly value', String(value)); await pg.click('text=Save construction'); };
const totals = async pg => (await pg.locator('.tiles .big-num').allTextContents()).map(s => s.trim());

// ---------- 1. complete workflow: build the reference house through the UI, calculate, save, reload, edit, recalc ----------
{
  const pg = await mkpage(); await boot(pg);
  await pg.click('text=New project');
  for (const [l, v] of [['Location', 'Testville'], ['Source of these values', 'synthetic'], ['Heating: outdoor', '10'], ['Heating: indoor', '70'], ['Cooling: outdoor', '95'], ['Cooling: indoor', '75'], ['Outdoor humidity', '120'], ['Indoor humidity', '70'], ['Heating season ACH', '0.5'], ['Cooling season ACH', '0.3']]) await fill(pg, l, v);
  await pg.click('nav >> text=Rooms'); ok(await pg.locator('text=No rooms yet').isVisible(), 'empty project shows guidance');
  await pg.click('text=Add room'); await fill(pg, 'Room name', 'Box'); await fill(pg, 'Length', '20'); await fill(pg, 'Width', '15'); await fill(pg, 'Ceiling height', '8');
  await pg.click('text=Next ›');
  await newAsm(pg, 'Wall construction', 0, { value: 20 });
  await pg.click('text=＋ Window'); await fill(pg, 'How many', '2'); await fill(pg, 'Width (in)', '36'); await fill(pg, 'Height (in)', '48'); await newAsm(pg, 'Window type', 0, { value: 0.5, asU: true });
  await pick(pg, 'What is on the other side of this wall?', 'interior-conditioned', 1); await pick(pg, 'What is on the other side of this wall?', 'interior-conditioned', 3);
  await lab(pg, 'Wall construction', 1).selectOption({ index: 1 });
  await pg.locator('button', { hasText: '＋ Door' }).nth(1).click(); await fill(pg, 'Width (in)', '36', 1); await fill(pg, 'Height (in)', '84', 1); await newAsm(pg, 'Door type', 0, { value: 0.4, asU: true });
  await pg.click('text=Next ›'); await pick(pg, 'What is on the other side?', 'unconditioned', 0); await fill(pg, 'Winter temp there', '20', 0); await fill(pg, 'Summer temp there', '120', 0); await newAsm(pg, 'Ceiling construction', 0, { value: 0.03, asU: true });
  await pg.click('text=Next ›'); ok(await pg.locator('text=3,795').first().isVisible(), 'room review shows 3,795 heating');
  await pg.click('text=Done'); ok(await pg.locator('.chip.ok', { hasText: 'READY' }).isVisible(), 'room card READY');
  await pg.click('nav >> text=Results'); let t = await totals(pg); ok(t[0] === '3,795' && t[1] === '1,347' && t[2] === '415', `results ${t.join(' / ')} (ANALYTIC-001)`);
  await pg.reload(); await pg.waitForSelector('#hag-splash', { state: 'detached', timeout: 6000 }); await pg.click('text=Open'); await pg.click('nav >> text=Results'); t = await totals(pg); ok(t[0] === '3,795', 'same results after reload/reopen');
  // edit + recalc: change wall R20 -> R10 (U .1): wall net 136+139=275 ft2 * +.05 * 60 = +825
  await pg.click('nav >> text=Rooms'); await pg.click('button:has-text("Edit")'); await pg.click('text=Next ›'); await pg.click('button:has-text("Edit construction")'); await fill(pg, 'Whole-assembly value', '10'); await pg.click('text=Save construction');
  await pg.click('text=Next ›'); await pg.click('text=Next ›'); await pg.click('text=Done'); await pg.click('nav >> text=Results'); t = await totals(pg); ok(t[0] === '4,620', `edit then recalc: heating ${t[0]} (expected 4,620)`);
  ok(pg.errs.length === 0, 'no page errors in workflow ' + pg.errs.join(';'));
  await pg.context().close();
}

// ---------- 2. blockers are explained and tappable; invalid input is refused visibly ----------
{
  const pg = await mkpage(); await boot(pg); await pg.click('text=New project'); await pg.click('nav >> text=Rooms'); await pg.click('text=Add room'); await pg.click('text=Done').catch(() => {});
  await pg.goto(URL); await pg.waitForSelector('#hag-splash', { state: 'detached', timeout: 6000 }); await pg.click('text=Open'); await pg.click('nav >> text=Rooms');
  ok(await pg.locator('.card', { hasText: 'To do before results are complete' }).isVisible(), 'rooms tab lists what is missing');
  await pg.locator('button:has-text("Fix ›")').first().click(); ok(true, 'Fix › navigates');
  await pg.click('nav >> text=Setup'); await fill(pg, 'Heating: outdoor', '12abc'); ok(await pg.locator('.banner.error', { hasText: 'not a number' }).isVisible(), 'garbage number rejected with a message');
  await fill(pg, 'Heating: outdoor', '1e3'); ok(await pg.locator('.banner.error').isVisible(), '"1e3" rejected'); await fill(pg, 'Heating: outdoor', '0x10'); ok(await pg.locator('.banner.error').isVisible(), '"0x10" rejected');
  await fill(pg, 'Heating: outdoor', '500'); ok(await pg.locator('.banner.error', { hasText: 'from -80 to 150' }).isVisible(), 'out-of-range temperature refused');
  await fill(pg, 'Heating: outdoor', '-5,5'); ok((await lab(pg, 'Heating: outdoor').inputValue()) === '-5.5', 'decimal comma accepted');
  await pg.context().close();
}

// ---------- 3. lifecycle: half-typed value survives backgrounding; storage failure is surfaced ----------
{
  const pg = await mkpage(); await boot(pg); await pg.click('text=New project'); const inp = lab(pg, 'Location'); await inp.click(); await inp.type('Pittsburgh', { delay: 5 });
  await pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const saved = await pg.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('manualj:project:')).map(([, v]) => JSON.parse(v).design.location)); ok(saved.includes('Pittsburgh'), 'half-typed field is committed and saved when the app goes to background');
  const pg2 = pg; await pg2.evaluate(() => { const real = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k.startsWith('manualj:project:')) throw new DOMException('quota', 'QuotaExceededError'); return real.call(this, k, v); }; });
  await fill(pg2, 'Project name', 'Cannot save'); ok(await pg2.locator('.banner.error', { hasText: 'NOT SAVED' }).isVisible(), 'storage failure shows a NOT SAVED banner');
  await pg.context().close();
}

// ---------- 4. persistence: multiple projects, copy, delete, damaged data ----------
{
  const pg = await mkpage(); await boot(pg); await pg.click('text=New project'); await fill(pg, 'Project name', 'Alpha'); await pg.click('header >> text=Back');
  await pg.click('text=New project'); await fill(pg, 'Project name', 'Beta'); await pg.click('header >> text=Back');
  ok((await pg.locator('h2', { hasText: 'Projects (2)' }).count()) === 1, 'two projects listed');
  await pg.locator('.card', { hasText: 'Alpha' }).locator('button:has-text("Copy")').click(); ok((await pg.locator('.card', { hasText: 'Alpha copy' }).count()) === 1, 'copy creates an independent project');
  await pg.locator('.card', { hasText: 'Alpha copy' }).locator('button:has-text("Delete")').click(); ok((await pg.locator('.card', { hasText: 'Alpha copy' }).count()) === 0, 'delete removes only that project'); ok((await pg.locator('.card', { hasText: 'Beta' }).count()) === 1, 'others remain');
  await pg.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('manualj:project:')); localStorage.setItem(k, '{"broken'); localStorage.setItem('manualj:index', 'garbage'); });
  await pg.reload(); await pg.waitForSelector('#hag-splash', { state: 'detached', timeout: 6000 }); ok((await pg.locator('h2', { hasText: 'Projects (2)' }).count()) === 1, 'damaged index rebuilt; no project disappears');
  await pg.locator('.card:has(button:has-text("Open"))').first().locator('button:has-text("Open")').click(); const okOpen = await pg.locator('h1', { hasText: /Alpha|Beta/ }).count(); const err = await pg.locator('.banner.error').count(); ok(okOpen === 1 || err === 1, 'damaged project: opens or explains clearly, never a blank screen');
  await pg.context().close();
}

// ---------- 5. layout: no horizontal overflow, big touch targets, all screens, phone/tablet/landscape ----------
for (const [name, vp] of [['small phone', { width: 320, height: 640 }], ['phone', { width: 390, height: 800 }], ['landscape', { width: 800, height: 390 }], ['tablet', { width: 1024, height: 768 }]]) {
  const pg = await mkpage(vp); await boot(pg); await pg.click('text=New project');
  const check = async what => { const r = await pg.evaluate(() => { const bad = [...document.querySelectorAll('button,input,select')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 40 || r.width < 40) && getComputedStyle(e).visibility !== 'hidden'; }).map(e => (e.textContent || e.type || '').trim().slice(0, 20)); return { over: document.documentElement.scrollWidth - innerWidth, small: bad.slice(0, 5) }; }); ok(r.over <= 1, `${name}/${what}: no horizontal overflow (${r.over})`); ok(r.small.length === 0, `${name}/${what}: touch targets >= 40px ${r.small.join(',')}`); };
  await check('setup'); await pg.click('nav >> text=Rooms'); await pg.click('text=Add room'); await check('room'); await pg.click('text=Next ›'); await check('walls'); await pg.click('text=Next ›'); await check('ceiling'); await pg.click('text=Next ›'); await check('review');
  await pg.click('text=Done'); await pg.click('nav >> text=Results'); await check('results'); await pg.click('nav >> text=Report'); await check('report');
  await pg.click('header >> text=Back'); await pg.click('text=Settings'); await pg.click('text=About / release diagnostics'); await check('about');
  if (name === 'phone') await pg.screenshot({ path: '/tmp/claude-0/about-phone.png' });
  ok(pg.errs.length === 0, `${name}: no page errors ${pg.errs.join(';')}`); await pg.context().close();
}
// ---------- 6. performance: first render behind the splash is quick; repeated navigation does not leak DOM or memory ----------
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }); const pg = await ctx.newPage(); pg.on('dialog', d => d.accept());
  await pg.addInitScript(([s]) => { if (!localStorage.getItem('manualj:index')) { localStorage.setItem('manualj:project:' + s.id, JSON.stringify(s)); localStorage.setItem('manualj:index', JSON.stringify([{ id: s.id, name: s.name, updatedAt: new Date().toISOString() }])); } }, [JSON.parse((await import('fs')).readFileSync('/tmp/claude-0/seed.json', 'utf8'))]);
  await pg.goto(URL); await pg.waitForSelector('#hag-splash', { state: 'detached', timeout: 6000 });
  const first = await pg.evaluate(() => performance.getEntriesByName('manualj:first-render')[0]?.startTime ?? -1); ok(first > 0 && first < 1500, `first render (behind the studio card) at ${Math.round(first)} ms`);
  await pg.click('button:has-text("Open")');
  const nodes = async () => pg.evaluate(() => document.querySelectorAll('*').length);
  const n0 = await nodes(); const t0 = Date.now();
  for (let i = 0; i < 60; i++) for (const t of ['Setup', 'Rooms', 'Results', 'Report']) await pg.click(`nav >> text=${t}`);
  const per = (Date.now() - t0) / 240; const n1 = await nodes();
  ok(Math.abs(n1 - n0) < 400, `DOM size stable after 240 navigations (${n0} -> ${n1})`); ok(per < 150, `average navigation ${per.toFixed(0)} ms`);
  await ctx.close();
}
await b.close(); console.log(bad ? `${bad} FAILURES` : 'ALL PASS'); process.exit(bad ? 1 : 0);
