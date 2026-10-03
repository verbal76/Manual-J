// Run against `vite preview` (port 4173) with a Playwright install. Checks splash timing/layout, Settings -> About, Copy diagnostics, modal styling.
import { createRequire } from 'module';
const { chromium } = createRequire('/opt/node-tools/')('playwright');
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
const t0 = Date.now(); await pg.goto('http://localhost:4173/', { waitUntil: 'commit' });
await pg.waitForSelector('.splash', { timeout: 3000 }).catch(() => console.log('NO SPLASH (asset missing?)'));
const box = await pg.locator('.splash img').boundingBox().catch(() => null); const bg = await pg.locator('.splash').evaluate(e => getComputedStyle(e).backgroundColor).catch(() => null);
console.log('splash bg', bg, 'img box', box && JSON.stringify(box), 'fit', await pg.locator('.splash img').evaluate(e => getComputedStyle(e).objectFit).catch(() => null));
await pg.waitForSelector('.splash', { state: 'detached', timeout: 6000 }).catch(() => {}); console.log('splash gone after ms ~', Date.now() - t0);
await pg.reload(); await pg.waitForSelector('text=Settings'); await pg.waitForSelector('.splash', { state: 'detached' }).catch(() => {});
await pg.click('text=⚙ Settings'); await pg.click('text=About / release diagnostics'); await pg.waitForSelector('pre.diag');
const txt = await pg.locator('pre.diag').innerText(); console.log(txt);
await pg.click('text=Copy diagnostics'); console.log('clipboard matches:', (await pg.evaluate(() => navigator.clipboard.readText())) === txt);
await pg.evaluate(() => { document.querySelector('.ota-modal').hidden = false; }); await pg.screenshot({ path: '/tmp/claude-0/modal.png' });
console.log('modal text:', await pg.locator('.ota-msg').innerText()); console.log('errs', errs); await b.close();
