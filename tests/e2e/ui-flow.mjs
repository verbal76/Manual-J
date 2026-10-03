// Manual UI flow check: npm run build && npx vite preview --port 4173, then run with a Playwright install. Reproduces ANALYTIC-001 through the UI (expects 3,795 / 1,347 / 415).
import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/');
const { chromium } = require('playwright');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
const pg = await ctx.newPage();
const errs=[]; pg.on('pageerror',e=>errs.push(e.message)); pg.on('dialog',d=>d.accept());
await pg.goto('http://localhost:4173/');
const inp=(label,nth=0)=>pg.locator('label',{hasText:label}).nth(nth).locator('xpath=following-sibling::*[1]');
const fill=async(l,v,n=0)=>{const i=inp(l,n); await i.fill(v); await i.dispatchEvent('change');};
const pick=async(l,v,n=0)=>{await inp(l,n).selectOption(v);};
const newAsm=async(selLabel,n,{u,asU=false,descr})=>{ await inp(selLabel,n).selectOption('__new__');
  if(asU) await inp('Enter value as').selectOption('U-factor');
  await fill('Whole-assembly',String(u)); await pg.click('text=Save construction'); };
await pg.click('text=New project');
for (const [l,v] of [['Location','Testville'],['Source of design','synthetic'],['Heating outdoor','10'],['Heating indoor','70'],['Cooling outdoor','95'],['Cooling indoor','75'],['Outdoor humidity','120'],['Indoor humidity','70'],['Heating ACH','0.5'],['Cooling ACH','0.3']]) await fill(l,v);
await pg.click('nav >> text=Rooms'); await pg.click('text=Add room');
await fill('Room name','Box'); await fill('Length','20'); await fill('Width','15'); await fill('Ceiling height','8');
await pg.click('text=Next ›');
// wall 1: N default; construction + 2 windows
await newAsm('Wall construction',0,{u:20});
await pg.click('text=＋ Window',{});
await fill('Qty','2'); await fill('Width (in)','36'); await fill('Height (in)','48');
await newAsm('Window type',0,{u:0.5,asU:true});
// wall 2 interior
await pick('This wall borders','interior-conditioned',1);
await pick('This wall borders','interior-conditioned',3);
// wall 3 (now the 2nd 'Wall construction'): pick existing wall assembly, add door
const wasm = await inp('Wall construction',1).locator('option').allTextContents(); console.log(wasm);
await inp('Wall construction',1).selectOption({index:1});
await pg.locator('button',{hasText:'＋ Door'}).nth(1).click();
await fill('Width (in)','36',1); await fill('Height (in)','84',1);
await newAsm('Door type',0,{u:0.4,asU:true});
await pg.click('text=Next ›');
await pick('What is on the other side?','unconditioned',0);
await fill('Winter temp there','20',0); await fill('Summer temp there','120',0);
await newAsm('Ceiling construction',0,{u:0.03,asU:true});
await pg.click('text=Next ›');
console.log((await pg.locator('.card').first().innerText()).replace(/\n/g,' | '));
await pg.click('text=Done');
await pg.click('nav >> text=Results');
console.log((await pg.locator('.big-num').allTextContents()));
await pg.screenshot({path:'/tmp/claude-0/res.png',fullPage:true});
// persistence: reload and reopen
await pg.reload(); await pg.click('text=Open'); await pg.click('nav >> text=Results');
console.log('after reload', await pg.locator('.big-num').allTextContents());
await pg.click('nav >> text=Report'); const f=pg.frameLocator('iframe'); console.log((await f.locator('h2').allTextContents()).slice(0,4));
console.log('errs',errs);
await b.close();
