// Optional browser checks. Install Playwright outside the repository; see README.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { AT, status, core, economy, event } from '../test/fixtures.mjs';

const modulePath = process.env.WHEELY_PLAYWRIGHT;
const { chromium, webkit } = modulePath ? await import(pathToFileURL(modulePath).href) : await import('playwright');
const engine = process.argv.includes('--webkit') ? webkit : chromium;
const engineName = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
const out = resolve('test/scratch/browser-checks', engineName);
await mkdir(out, { recursive: true });
const root = resolve('dist');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png' };
const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://localhost');
    if (!url.pathname.startsWith('/preview/')) throw new Error('Missing prefix');
    let path = resolve(root, '.' + decodeURIComponent(url.pathname.slice('/preview'.length)));
    if (path !== root && !path.startsWith(root+sep)) throw new Error('Outside root');
    if ((await stat(path)).isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(308,{Location:url.pathname+'/'+url.search});res.end();return; }
      path += '/index.html';
    }
    res.writeHead(200,{'Content-Type':mime[extname(path)] || 'application/octet-stream'});res.end(await readFile(path));
  } catch {res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = origin+'/preview/';
const report = { engine:engineName, assertions:[], failures:[], consoleErrors:[], localFailures:[], screenshots:[], axe:[] };
const browser = await engine.launch({headless:true});

async function check(name, fn) {
  try { await fn();report.assertions.push(name); console.log('PASS',name); }
  catch(error) {report.failures.push({name,message:error.stack});console.error('FAIL',name,error.message);}
}
async function until(fn, message, timeout=6000) {
  const start=Date.now();
  while(Date.now()-start<timeout) { if(await fn()) return; await new Promise(r=>setTimeout(r,30)); }
  throw new Error(message);
}
function track(page) {
  page.on('pageerror',e=>report.consoleErrors.push(e.message));
  page.on('response',r=>{if(r.url().startsWith(origin) && r.status()>=400)report.localFailures.push(r.url());});
}
async function mockAPI(page, getStatus, getCore=()=>core(), getEconomy=()=>economy()) {
  await page.route('https://api.squeekchain.com/v1/**', async route=> {
    const endpoint = route.request().url().split('/v1/')[1];
    const value = endpoint === 'status' ? getStatus() : endpoint === 'core' ? getCore() : getEconomy();
    if (value === null) {await route.fulfill({status:503,body:'Test outage',headers:{'Access-Control-Allow-Origin':'*'}});return;}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value),headers:{'Access-Control-Allow-Origin':'*'}});
  });
}
async function screenshot(page, name, fullPage=false) {
  const path=resolve(out,name+'.png'); await page.screenshot({path,fullPage});report.screenshots.push(path);
}
async function transparentBounds(page) {
  return page.evaluate(()=>{
    const r=document.getElementById('widget').getBoundingClientRect();
    return {html:getComputedStyle(document.documentElement).backgroundColor, body:getComputedStyle(document.body).backgroundColor, scroll:document.documentElement.scrollWidth>innerWidth || document.documentElement.scrollHeight>innerHeight, bounds:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},w:innerWidth,h:innerHeight};
  });
}

async function freeze(page, at=AT) {
  await page.clock.install({time:new Date(at-60000)});
  await page.clock.setSystemTime(new Date(at-60000));
  await page.clock.pauseAt(new Date(at));
}

try {
  const context = await browser.newContext({viewport:{width:1440,height:1000},ignoreHTTPSErrors:true});
  if (engineName==='chromium') await context.grantPermissions(['clipboard-read','clipboard-write']);
  context.setDefaultTimeout(6000);
  const page=await context.newPage();track(page);
  let apiCalls=0;
  page.on('request',r=>{if(r.url().startsWith('https://api.squeekchain.com'))apiCalls++;});
  await freeze(page, AT);
  await mockAPI(page,()=>status({staleAfterSeconds:120}));
  await page.goto(url);
  await until(async()=> (await page.locator('#api-status').textContent()).includes('Public feed connected'),'control room did not connect');
  await page.clock.pauseAt(new Date(AT+1000));

  await check('subpath assets, real fetch binding and five shared live previews', async()=>{
    assert.equal(await page.locator('.widget-card').count(),5);
    await until(async()=>page.frames().filter(f=>f.url().includes('/overlay/')).length===6,'all previews missing');
    for(const frame of page.frames().filter(f=>f.url().includes('/overlay/'))) assert.ok(!(await frame.locator('body').textContent()).includes('CONNECTING'));
    assert.equal(apiCalls,3,'embedded previews should share one endpoint poll');
    await page.clock.runFor(5000);
    await until(async()=>apiCalls===6,'expected a single shared 5s poll');
  });
  await check('desktop widget selection changes the source URL and scene',async()=>{
    await page.getByRole('button',{name:'Preview integrity panel',exact:true}).click();
    await until(async()=>page.frames().some(f=>f.url().includes('/overlay/integrity/')),'integrity scene not loaded').catch(async()=>{assert.ok(await page.locator('#scene-frame').getAttribute('src'));});
    assert.match(await page.locator('#source-url').inputValue(),/\/preview\/overlay\/integrity\/\?/);
    assert.equal(await page.locator('#selected-name').textContent(),'Integrity panel');
  });
  await check('every operator setting reaches generated URLs and live iframe parameters',async()=>{
    await page.locator('input[name="side"][value="right"]').check();
    await page.locator('input[name="theme"][value="light"]').check();
    await page.locator('#scale').fill('1.5');
    await page.locator('[data-color="#a9c6b1"]').click();
    await page.locator('#hide-idle').check();
    await page.locator('#circumference').fill('500');
    await page.clock.runFor(250);
    await until(async()=> (await page.locator('#source-url').inputValue()).includes('circumferenceMm=500'),'settings debounce did not update');
    const result=new URL(await page.locator('#source-url').inputValue());
    assert.equal(result.searchParams.get('side'),'right');assert.equal(result.searchParams.get('theme'),'light');
    assert.equal(result.searchParams.get('scale'),'1.5');assert.equal(result.searchParams.get('accent'),'a9c6b1');
    assert.equal(result.searchParams.get('hideWhenIdle'),'1');assert.equal(result.searchParams.get('circumferenceMm'),'500');
    for(const id of ['ticker','round','alerts','integrity','commands']) assert.match(await page.locator(`#url-${id}`).inputValue(),/side=right/);
  });
  await check('invalid circumference has a nearby error and preserves the last valid URL',async()=>{
    const before=await page.locator('#source-url').inputValue();
    await page.locator('#circumference').fill('0');await page.clock.runFor(250);
    assert.equal(await page.locator('#circumference').getAttribute('aria-invalid'),'true');
    assert.ok(await page.locator('#circumference-error').isVisible());
    assert.equal(await page.locator('#source-url').inputValue(),before);
    await page.locator('#circumference').fill('471');await page.clock.runFor(250);
  });
  await check('copy action writes the selected browser-source URL',async()=>{
    await page.locator('#copy-selected').click();
    await until(async()=> (await page.locator('#copy-announcement').textContent()).includes('copied'),'copy action did not confirm');
    if(engineName==='chromium') assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),await page.locator('#source-url').inputValue());
  });
  await check('native setup modal supports keyboard dismissal and returns focus',async()=>{
    await page.locator('.setup-button').click();assert.ok(await page.locator('#setup-dialog').isVisible());
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(()=>document.getElementById('setup-dialog').contains(document.activeElement)));
    await page.keyboard.press('Escape');assert.ok(!(await page.locator('#setup-dialog').isVisible()));
    assert.ok(await page.locator('.setup-button').evaluate(el=>el===document.activeElement));
  });
  await check('poll log export is JSON with the actual session entries',async()=>{
    const downloadPromise=page.waitForEvent('download');await page.locator('#download-log').click();
    const download=await downloadPromise;const exported=JSON.parse(await readFile(await download.path(),'utf8'));
    assert.ok(exported.entries.length>=2);assert.equal(exported.limit,120);assert.equal(exported.circumferenceMm,471);
    assert.ok(exported.entries.every(e=>e.distance==='4710'));
  });
  await check('reset restores the full default configuration',async()=>{
    await page.locator('#reset-settings').click();
    const result=new URL(await page.locator('#source-url').inputValue());
    assert.equal(result.searchParams.get('side'),'left');assert.equal(result.searchParams.get('theme'),'dark');assert.equal(result.searchParams.get('accent'),'ff7c48');
    assert.equal(result.searchParams.get('scale'),'1');assert.equal(result.searchParams.get('hideWhenIdle'),'0');
  });
  await check('preview test alert is clearly labeled and dismisses automatically',async()=>{
    await page.getByRole('button',{name:'Preview stream alerts',exact:true}).click();
    const frame=await page.locator('#scene-frame').contentFrame();
    await page.locator('#test-alert').click();
    await until(async()=> (await frame.locator('body').textContent()).includes('Test alert'),'preview alert missing');
    assert.match(await frame.locator('.toast').textContent(),/Preview · the hamster is awake/);
    await page.clock.fastForward(11000);
    assert.equal(await frame.locator('.toast-preview').count(),0);
  });
  await check('commands rotate and the preview motion control pauses and resumes rotation',async()=>{
    await page.getByRole('button',{name:'Preview game commands',exact:true}).click();
    const frame=await page.locator('#scene-frame').contentFrame();
    await until(async()=>await frame.locator('.command-main').count()===1,'commands preview missing');
    const first=await frame.locator('.command-main').textContent();await page.clock.fastForward(8500);
    const second=await frame.locator('.command-main').textContent();assert.notEqual(first,second);
    await page.locator('#pause-preview').click();
    await until(async()=>await frame.locator('.motion-paused').count()===1,'pause message not delivered');
    await page.clock.fastForward(9000);
    assert.equal(await frame.locator('.command-main').textContent(),second);
    await page.locator('#pause-preview').click();
    await until(async()=>await frame.locator('.motion-paused').count()===0,'resume message not delivered');
    await page.clock.fastForward(8500);
    assert.notEqual(await frame.locator('.command-main').textContent(),second);
  });
  await page.getByRole('button',{name:'Preview live ticker',exact:true}).click();
  await page.clock.runFor(300);
  await screenshot(page,'control-desktop',true);

  await check('control room reflows at 320, 360, 390, 1280 and 1920 pixels',async()=>{
    for(const [width,height] of [[320,800],[360,800],[390,844],[1280,720],[1920,1080]]) {
      await page.setViewportSize({width,height});
      await page.evaluate(()=>scrollTo(0,0));
      await until(async()=>await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
      if(width===390) {
        const r=await page.locator('#copy-selected').boundingBox();
        assert.ok(r.y+r.height<=height,'main copy action must be in first screen at 390');
        await page.evaluate(()=>scrollTo(0,0));await screenshot(page,'control-390');
      }
      if(width===1280 || width===1920){await page.evaluate(()=>scrollTo(0,0));await screenshot(page,`control-${width}`);}
    }
  });

  await page.clock.resume();
  await check('axe accessibility scan of control room has no serious or critical violations',async()=>{
    if(!process.env.WHEELY_AXE) { report.axe.push('Not run: WHEELY_AXE not configured');return; }
    const {default:AxeBuilder}=await import(pathToFileURL(process.env.WHEELY_AXE).href);
    await page.setViewportSize({width:390,height:844});
    const scan=await new AxeBuilder({page}).exclude('iframe').disableRules(['frame-tested']).analyze();
    report.axe.push(...scan.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})));
    assert.equal(scan.violations.filter(v=>v.impact==='serious'||v.impact==='critical').length,0,JSON.stringify(report.axe));
  });

  await check('five standalone routes are transparent, have no scrollbars and fit both broadcast canvases',async()=>{
    for(const [width,height] of [[1920,1080],[1280,720]]) {
      for(const theme of ['dark','light']) for(const id of ['ticker','round','alerts','integrity','commands']) {
        const p=await context.newPage();track(p);await p.setViewportSize({width,height});
        await mockAPI(p,()=>status({observedAt:new Date(AT+6000).toISOString(),staleAfterSeconds:120}));
        await p.goto(url+`overlay/${id}/?side=right&scale=2&theme=${theme}&accent=74c0fc`);
        await until(async()=> !(await p.locator('body').textContent()).includes('Connecting to Squeekchain'),'standalone did not load');
        const result=await transparentBounds(p);
        assert.equal(result.html,'rgba(0, 0, 0, 0)');assert.equal(result.body,'rgba(0, 0, 0, 0)');assert.equal(result.scroll,false);
        const b=result.bounds;assert.ok(b.x>=-1 && b.y>=-1 && b.right<=width+1 && b.bottom<=height+1,`${id} bounds outside ${width}: ${JSON.stringify(b)}`);
        if(width===1920 && theme==='dark') await screenshot(p,`overlay-${id}`);
        await p.close();
      }
    }
  });

  await page.close();
  const telemetry=await context.newPage();track(telemetry);
  let cycle=1;let outage=false;
  const observation=()=> cycle===1 ? status() : cycle===2 ? status({distanceMm:'5652',cumulativeWorkUnits:'120',observedAt:new Date(AT+5000).toISOString()}) : cycle===3 ? status({distanceMm:'0',cumulativeWorkUnits:'0',counterEpoch:'test-epoch-b',observedAt:new Date(AT+10000).toISOString()}) : status({distanceMm:'471',cumulativeWorkUnits:'10',counterEpoch:'test-epoch-b',observedAt:new Date(AT+15000).toISOString()});
  await freeze(telemetry, AT);
  await mockAPI(telemetry,()=>outage ? null : observation());
  await telemetry.goto(url+'overlay/integrity/?circumferenceMm=471');
  await until(async()=> (await telemetry.locator('.integrity-overview').textContent()).includes('1/120'),'integrity baseline missing');
  await telemetry.clock.pauseAt(new Date(AT+1000));
  await check('integrity calculates actual 2 revolutions and 10 work/rev from two samples',async()=>{
    cycle=2;await telemetry.clock.runFor(5000);
    await until(async()=> (await telemetry.locator('.integrity-metrics').textContent()).includes('2.000'),'revolutions not calculated');
    const text=await telemetry.locator('.integrity-metrics').textContent();assert.match(text,/10.000/);assert.match(text,/942 mm ÷ 471 mm/);
    assert.equal(await telemetry.locator('.integrity-title .verdict').textContent(),'OK');
  });
  await check('epoch reset is flagged and discarded; following same-epoch interval is counted',async()=>{
    cycle=3;await telemetry.clock.runFor(5000);
    await until(async()=> (await telemetry.locator('body').textContent()).includes('boundary deltas discarded'),'epoch reset missing');
    assert.equal(await telemetry.locator('.integrity-title .verdict').textContent(),'IMPLAUSIBLE');
    cycle=4;await telemetry.clock.runFor(5000);
    await until(async()=> (await telemetry.locator('.integrity-metrics').textContent()).includes('3.000'),'post-reset deltas not counted');
    assert.match(await telemetry.locator('.integrity-log').textContent(),/471 mm \/ 10 work/);
  });
  await check('outage keeps exact values, shows stale age and advances the freshness clock without new data',async()=>{
    outage=true;await telemetry.clock.runFor(25000);
    await until(async()=> (await telemetry.locator('body').textContent()).includes('HTTP 503'),'outage state missing');
    const text=await telemetry.locator('body').textContent();assert.match(text,/STALE · Freshness/);assert.match(text,/3.000/);assert.match(text,/10 hardware units/);
    await screenshot(telemetry,'integrity-reset-and-outage');
  });
  await telemetry.close();

  const alerts=await context.newPage();track(alerts);let alertCycle=1;
  await freeze(alerts, AT);
  await mockAPI(alerts,()=> {
    const s=status({coreStatus:alertCycle===1?'IDLE':'RUNNING',rpmMilli:alertCycle===1?0:120000,observedAt:new Date(AT+(alertCycle-1)*5000).toISOString()});
    if(alertCycle>=3){s.builder.anchor.blockHeight='1001';s.oracle.state='rejected';s.settlementQueue.state='empty';}
    return s;
  },()=>core(alertCycle>=3 ? [event('BatchSettled','new-test-event')] : []));
  await alerts.goto(url+'overlay/alerts/');await alerts.clock.pauseAt(new Date(AT+1000));
  await check('alert startup is silent, wake transitions fire, and at most three toasts remain',async()=>{
    assert.equal(await alerts.locator('.toast').count(),0);
    alertCycle=2;await alerts.clock.runFor(5000);await until(async()=>await alerts.locator('.toast').count()===1,'wake toast missing');
    assert.match(await alerts.locator('.toast').textContent(),/hamster is awake/);
    alertCycle=3;await alerts.clock.runFor(5000);await until(async()=>await alerts.locator('.toast').count()===3,'toast cap not respected');
    assert.match(await alerts.locator('body').textContent(),/Batch settled/);
    await alerts.clock.runFor(11000);assert.equal(await alerts.locator('.toast').count(),0,'stable values should not replay transitions');
  });
  await alerts.close();

  const round=await context.newPage();track(round);let recorded=false;
  await freeze(round, AT+599000);
  await mockAPI(round,()=>status({observedAt:new Date(AT+599000).toISOString()}),()=>core(recorded?[event('RoundRecorded','recorded-ten','10')]:[]));
  await round.goto(url+'overlay/round/');
  await until(async()=>await round.locator('.round-countdown').count()===1,'round not loaded');
  await round.clock.pauseAt(new Date(AT+599500));
  await check('round closes from genesis schedule and flashes only on a newly observed watched round event',async()=>{
    assert.equal(await round.locator('.round-countdown').textContent(),'00:01');
    await round.clock.runFor(1000);assert.equal(await round.locator('.round-countdown').textContent(),'10:00');
    assert.equal(await round.locator('.is-recorded').count(),0);
    recorded=true;await round.clock.runFor(5000);await until(async()=>await round.locator('.is-recorded').count()===1,'round event did not flash');
    assert.match(await round.locator('.round-caption').textContent(),/Round #10 recorded/);
    await round.clock.runFor(7000);assert.equal(await round.locator('.is-recorded').count(),0);
  });
  await round.close();

  const ticker=await context.newPage();track(ticker);let moving=true;let nextRPM=false;
  await freeze(ticker, AT);
  await mockAPI(ticker,()=>status({coreStatus:moving?'RUNNING':'IDLE',rpmMilli:moving?(nextRPM?240000:120000):0,observedAt:new Date(AT).toISOString()}));
  await ticker.goto(url+'overlay/ticker/?hideWhenIdle=1');
  await until(async()=> (await ticker.locator('.ticker-metric').first().textContent()).includes('120.0'),'ticker baseline not loaded');
  await ticker.clock.pauseAt(new Date(AT+1000));
  await check('ticker counts smoothly between polls, hides asleep state and reappears when stale',async()=>{
    nextRPM=true;await ticker.clock.runFor(4100);await until(async()=>await ticker.locator('.ticker-metric').count()>0,'ticker disappeared');
    await ticker.clock.runFor(900);
    const rpm=Number((await ticker.locator('.ticker-metric strong').first().textContent()).replaceAll(',',''));
    assert.ok(rpm>120 && rpm<240,`expected interpolated RPM, got ${rpm}`);
    await ticker.clock.runFor(1500);assert.equal(await ticker.locator('.ticker-metric strong').first().textContent(),'240.0');
    moving=false;await ticker.clock.runFor(5000);await until(async()=>await ticker.locator('#widget').getAttribute('hidden')!==null,'idle not hidden');
    await ticker.clock.runFor(15000);assert.ok(await ticker.locator('#widget').isVisible());assert.match(await ticker.locator('.source-state').textContent(),/STALE/);
  });
  await ticker.close();

  const reduced=await browser.newContext({reducedMotion:'reduce',viewport:{width:1920,height:1080}});
  const commands=await reduced.newPage();track(commands);await freeze(commands, AT);await mockAPI(commands,()=>status());
  await commands.goto(url+'overlay/commands/');await commands.clock.pauseAt(new Date(AT+1000));
  await check('reduced motion stops command rotation while all commands, families and tiers stay visible',async()=>{
    const before=await commands.locator('.command-main').textContent();await commands.clock.runFor(30000);
    assert.equal(await commands.locator('.command-main').textContent(),before);
    const text=await commands.locator('body').textContent();for(const word of ['spin','use','merge','me','help','fire','water','earth','air','lightning','star','common','uncommon','rare','epic','legendary'])assert.ok(text.includes(word));
  });
  await reduced.close();

  await check('no uncaught browser errors or missing local resources',async()=>{
    assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.localFailures,[]);
  });
  await context.close();
} finally {
  await browser.close();await new Promise(resolve=>server.close(resolve));
  await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
}
console.log(`${engineName}: ${report.assertions.length} passed, ${report.failures.length} failed. Report: ${out}/report.json`);
if(report.failures.length)process.exitCode=1;
