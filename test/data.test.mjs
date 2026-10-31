import test from 'node:test';
import assert from 'node:assert/strict';
import { Poller, ENDPOINTS } from '../src/scripts/data.js';
import { status, core, economy } from './fixtures.mjs';

const payload = {status:status(),core:core(),economy:economy()};
function endpoint(url) { return Object.entries(ENDPOINTS).find(([,v])=>v===url)[0]; }

test('poller reads all three public endpoints independently, omits credentials and publishes only completed cycles', async () => {
  const calls=[]; const updates=[];
  const poller = new Poller(data=>updates.push(data), {fetcher:async (url,opts)=>{
    calls.push([url,opts]); return new Response(JSON.stringify(payload[endpoint(url)]));
  }});
  await poller.poll();
  assert.equal(calls.length,3); assert.equal(updates.length,1); assert.equal(updates[0].sequence,1);
  assert.equal(updates[0].pending,false);
  for (const [,options] of calls) { assert.equal(options.credentials,'omit'); assert.equal(options.cache,'no-store'); }
  assert.deepEqual(updates[0].status,payload.status);
});

test('a failed or malformed endpoint retains its previous value without blocking other endpoints', async () => {
  let cycle=1; const updates=[];
  const poller = new Poller(data=>updates.push(data), {fetcher:async url=> {
    const key=endpoint(url);
    if(cycle===2 && key==='status') return new Response('upstream unavailable',{status:503});
    if(cycle===3 && key==='status') return new Response('{"measurement":{}}');
    const data=structuredClone(payload[key]);
    if(key==='core' && cycle>1) data.core.blockHeight='1001';
    return new Response(JSON.stringify(data));
  }});
  await poller.poll(); const first=updates[0];
  cycle=2; await poller.poll();
  assert.deepEqual(updates[1].status,first.status); assert.equal(updates[1].fetchedAt.status,first.fetchedAt.status);
  assert.equal(updates[1].errors.status,'HTTP 503'); assert.equal(updates[1].core.core.blockHeight,'1001');
  cycle=3; await poller.poll(); assert.equal(updates[2].errors.status,'Invalid response shape');
  cycle=4; await poller.poll(); assert.equal(updates[3].errors.status,null);
});

test('timeouts abort stalled requests and still publish a usable failure state', async () => {
  const updates=[];
  const poller=new Poller(data=>updates.push(data),{endpoints:['status'],timeoutMs:10,fetcher:async (url,options)=>new Promise((resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));
  })});
  await poller.poll();
  assert.equal(updates.length,1); assert.equal(updates[0].errors.status,'Request timed out'); assert.equal(updates[0].pending,false);
});

test('5-second schedule does not create overlapping request cycles', async t => {
  t.mock.timers.enable({apis:['setInterval']});
  let requests=0; let release;
  const poller=new Poller(()=>{}, {endpoints:['status'],fetcher:async()=> {
    requests++; await new Promise(resolve=>{release=resolve;}); return new Response(JSON.stringify(status()));
  }});
  poller.start(); assert.equal(requests,1);
  t.mock.timers.tick(5000); assert.equal(requests,1);
  release(); await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(5000); assert.equal(requests,2);
  release(); await new Promise(resolve=>setImmediate(resolve));
  poller.stop(); t.mock.timers.tick(10000); assert.equal(requests,2);
});
