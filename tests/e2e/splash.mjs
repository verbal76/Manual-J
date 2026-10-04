// Run against `vite preview` (4173) with Playwright. Verifies the REAL canonical logo: first paint, centring, contain-fit, timing, no replay, skip flag, image-failure safety.
import { createRequire } from 'module';
const { chromium } = createRequire('/opt/node-tools/')('playwright');
const b = await chromium.launch(); let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad++; };
for (const [name, vp] of [['portrait', { width: 390, height: 800 }], ['landscape', { width: 800, height: 390 }], ['tablet', { width: 1024, height: 768 }]]) {
  const ctx = await b.newContext({ viewport: vp }); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const t0 = Date.now(); await pg.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => { const i = document.getElementById('hag-logo'); return i && i.complete && i.naturalWidth > 0; });
  const info = await pg.evaluate(() => { const i = document.getElementById('hag-logo'), s = document.getElementById('hag-splash'), r = i.getBoundingClientRect(); return { nat: [i.naturalWidth, i.naturalHeight], box: [r.x, r.y, r.width, r.height], bg: getComputedStyle(s).backgroundImage.slice(0, 40), fit: getComputedStyle(i).objectFit, vw: innerWidth, vh: innerHeight, src: i.currentSrc }; });
  const [x, y, w, h] = info.box;
  ok(info.nat[0] === 1536 && info.nat[1] === 1024, `${name}: natural size 1536x1024 (canonical bytes loaded) ${info.src.split('/').pop()}`);
  ok(Math.abs(w / h - 1.5) < 0.01, `${name}: displayed aspect ${(w / h).toFixed(3)} == 1.5 (no stretch)`);
  ok(x >= -0.5 && y >= -0.5 && x + w <= info.vw + 0.5 && y + h <= info.vh + 0.5, `${name}: whole logo inside viewport (no crop) box=${[x, y, w, h].map(Math.round)}`);
  ok(Math.abs((x + w / 2) - info.vw / 2) < 1.5 && Math.abs((y + h / 2) - info.vh / 2) < 1.5, `${name}: centred`);
  ok(info.fit === 'contain' && info.bg.includes('radial-gradient'), `${name}: contain + dark background (${info.fit})`);
  if (name === 'portrait') await pg.screenshot({ path: '/tmp/claude-0/splash-portrait.png' });
  if (name === 'landscape') await pg.screenshot({ path: '/tmp/claude-0/splash-landscape.png' });
  await pg.waitForSelector('#hag-splash', { state: 'detached', timeout: 6000 }); const total = Date.now() - t0;
  ok(total > 2300 && total < 3600, `${name}: card gone after ${total} ms incl. page load (target 2.6 s from first paint)`);
  ok(await pg.locator('text=New project').isVisible(), `${name}: Manual J home follows`);
  await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pg.waitForTimeout(300);
  ok((await pg.locator('#hag-splash').count()) === 0, `${name}: resume/visibility change does not replay`);
  ok(errs.length === 0, `${name}: no page errors ${errs.join(';')}`); await ctx.close();
}
{ // OTA-triggered reload must not replay the card
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }); const pg = await ctx.newPage();
  await pg.goto('http://localhost:4173/'); await pg.waitForSelector('#hag-splash', { state: 'detached', timeout: 6000 });
  await pg.evaluate(() => sessionStorage.setItem('manualj:skipSplashOnce', '1')); await pg.reload(); await pg.waitForSelector('text=New project');
  ok((await pg.locator('#hag-splash').count()) === 0, 'update-activation reload skips the card'); ok((await pg.evaluate(() => sessionStorage.getItem('manualj:skipSplashOnce'))) === null, 'skip flag is one-shot');
  await pg.reload(); ok((await pg.locator('#hag-splash').count()) === 1, 'next cold load shows the card again'); await ctx.close();
}
{ // image failure cannot strand the user
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }); const pg = await ctx.newPage();
  await pg.route('**/Hot_Attic_Games_Master_Logo_ALPHA_FINAL*.png', r => r.abort());
  await pg.goto('http://localhost:4173/'); const t = Date.now(); await pg.waitForSelector('text=New project', { timeout: 8000 });
  await pg.waitForSelector('#hag-splash', { state: 'detached', timeout: 8000 }); ok(Date.now() - t < 3000, 'missing logo image: card removed promptly, app usable'); await ctx.close();
}
{ // saved projects still load behind/after the card
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }); const pg = await ctx.newPage();
  await pg.goto('http://localhost:4173/'); await pg.evaluate(() => localStorage.setItem('manualj:index', JSON.stringify([{ id: 'x', name: 'Saved house', updatedAt: new Date().toISOString() }])));
  await pg.reload(); await pg.waitForSelector('#hag-splash', { state: 'detached', timeout: 6000 }); ok(await pg.locator('text=Saved house').isVisible(), 'saved project list loads after the card'); await ctx.close();
}
await b.close(); console.log(bad ? `${bad} FAILURES` : 'ALL PASS'); process.exit(bad ? 1 : 0);
