// Real typing (user-originated change event) followed by ONE tap on a button must act on that single tap.
import { createRequire } from 'module';
const { chromium } = createRequire('/opt/node-tools/')('playwright');
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad++; };
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true }); const pg = await ctx.newPage(); pg.on('dialog', d => d.accept());
await pg.goto('http://localhost:4173/'); await pg.waitForSelector('#hag-splash', { state: 'detached', timeout: 6000 });
await pg.click('text=New project'); await pg.click('nav >> text=Rooms'); await pg.click('text=Add room');
const inp = pg.locator('label', { hasText: 'Room name' }).locator('xpath=following-sibling::*[1]');
// mouse path
await inp.click(); await inp.press('Control+a'); await inp.type('Kitchen', { delay: 10 }); await pg.click('text=Next ›', { timeout: 3000 });
ok(await pg.locator('.steps button.on', { hasText: 'Walls' }).count() === 1, 'mouse: one click on Next after typing goes to the next step');
await pg.click('.actionbar >> text=Back'); const inp2 = pg.locator('label', { hasText: 'Room name' }).locator('xpath=following-sibling::*[1]');
ok((await inp2.inputValue()) === 'Kitchen', 'typed value was kept');
// touch path
await inp2.tap(); await inp2.press('Control+a'); await inp2.type('Den', { delay: 10 }); await pg.locator('text=Next ›').tap({ timeout: 3000 });
ok(await pg.locator('.steps button.on', { hasText: 'Walls' }).count() === 1, 'touch: one tap on Next after typing goes to the next step');
// bottom-nav tap after typing in project name
await pg.click('header >> text=Back'); await pg.click('header >> text=Back'); await pg.click('nav >> text=Setup');
const nm = pg.locator('label', { hasText: 'Project name' }).locator('xpath=following-sibling::*[1]'); await nm.click(); await nm.press('Control+a'); await nm.type('Renamed', { delay: 10 });
await pg.locator('nav >> text=Rooms').tap({ timeout: 3000 }); ok(await pg.locator('button:has-text("Add room")').count() === 1, 'touch: one tap on a nav tab after typing switches tab');
await b.close(); console.log(bad ? `${bad} FAILURES` : 'ALL PASS'); process.exit(bad ? 1 : 0);
