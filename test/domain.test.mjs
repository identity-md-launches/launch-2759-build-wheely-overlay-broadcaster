import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, integer, timestamp, freshness, roundClock, eventArgument, eventKey, IntegrityLog, TransitionDetector, validPayload, isRunning } from '../src/scripts/domain.js';
import { emptyFeed } from '../src/scripts/data.js';
import { AT, status, core, feed, event } from './fixtures.mjs';

test('URL options accept supported values, clamp scale, reject CSS injection and invalid circumference', () => {
  assert.deepEqual(parseOptions(new URLSearchParams()), { side:'left', scale:1, theme:'dark', accent:'#ff7c48', hideWhenIdle:false, circumferenceMm:471 });
  assert.deepEqual(parseOptions(new URLSearchParams('side=right&scale=2&theme=light&accent=%23abc&hideWhenIdle=1&circumferenceMm=500')), { side:'right', scale:2, theme:'light', accent:'#abc', hideWhenIdle:true, circumferenceMm:500 });
  const bad = parseOptions(new URLSearchParams('scale=Infinity&circumferenceMm=-5&accent=red%3Bbackground%3Ared'));
  assert.equal(bad.scale,1); assert.equal(bad.circumferenceMm,471); assert.equal(bad.accent,'#ff7c48');
  assert.equal(parseOptions(new URLSearchParams('scale=9')).scale,2);
  assert.equal(parseOptions(new URLSearchParams('scale=0.1')).scale,.5);
});

test('large exact counters never pass through floating point', () => {
  assert.equal(integer('900719925474099312345'),900719925474099312345n);
  assert.equal(integer(9007199254740992),null);
  assert.equal(integer('1.5'),null); assert.equal(integer(null),null); assert.equal(integer(''),null);
});

test('timestamp accepts ISO dates and seconds/milliseconds from public payloads', () => {
  assert.equal(timestamp(new Date(AT).toISOString()),AT);
  assert.equal(timestamp(String(AT / 1000)),AT);
  assert.equal(timestamp(AT),AT);
});

test('inactive hardware is asleep even though its status contains the word active', () => {
  assert.equal(isRunning(status({coreStatus:'INACTIVE',rpmMilli:0})),false);
  assert.equal(isRunning(status({coreStatus:'RUNNING',rpmMilli:0})),true);
});

test('freshness advances between polls and honors the declared timeout and source flag', () => {
  const m = status().measurement;
  assert.equal(freshness(m,AT+20000).stale,false);
  assert.equal(freshness(m,AT+20001).stale,true);
  assert.equal(freshness({...m,freshness:'offline'},AT).stale,true);
  assert.equal(freshness({...m,observedAt:'invalid'},AT).stale,true);
  assert.equal(freshness({...m,observedAt:new Date(AT+6000).toISOString()},AT).stale,true);
});

test('round countdown is derived from genesis and duration, including exact close and pre-genesis', () => {
  const c = core();
  assert.equal(roundClock(c,AT).round,10);
  assert.equal(roundClock(c,AT).remaining,600);
  assert.equal(roundClock(c,AT+599001).remaining,1);
  assert.equal(roundClock(c,AT+600000).round,11);
  assert.equal(roundClock(c,AT+600000).remaining,600);
  const before = roundClock(c,AT-6001000);
  assert.equal(before.beforeGenesis,true); assert.equal(before.remaining,1);
  assert.equal(roundClock({...c,configuration:{...c.configuration,roundDuration:'0'}},AT),null);
});

test('real API event argument shape and log-index identity are supported', () => {
  const e = event('RoundRecorded','test-round','12');
  assert.equal(eventArgument(e,'roundId'),'12');
  assert.notEqual(eventKey({...e,id:undefined,logIndex:'1'}),eventKey({...e,id:undefined,logIndex:'2'}));
});

test('two polls calculate revolutions and work per revolution with exact numerator evidence', () => {
  const log = new IntegrityLog(471);
  log.ingest(feed(),AT);
  log.ingest(feed(status({ distanceMm:'5652', cumulativeWorkUnits:'120', observedAt:new Date(AT+5000).toISOString() }),core(),2,AT+5000),AT+5000);
  const summary = log.summary();
  assert.equal(summary.distance,942n); assert.equal(summary.work,20n);
  assert.equal(summary.revolutions,2); assert.equal(summary.ratio,10);
  assert.equal(summary.latest.verdict,'OK');
  assert.match(summary.latest.reasons[0],/942 mm ≤ 1,000.000 mm/);
});

test('work added at zero rpm is flagged with exact values and excluded from aggregates', () => {
  const log = new IntegrityLog(); log.ingest(feed(),AT);
  log.ingest(feed(status({rpmMilli:0,cumulativeWorkUnits:'110',observedAt:new Date(AT+5000).toISOString()}),core(),2,AT+5000),AT+5000);
  assert.equal(log.summary().latest.verdict,'IMPLAUSIBLE');
  assert.match(log.summary().latest.reasons.join(' '),/Δwork 10 units while rpmMilli = 0/);
  assert.equal(log.summary().work,0n);
});

test('distance exceeding maximum endpoint speed times measurement interval is flagged', () => {
  const log = new IntegrityLog(); log.ingest(feed(),AT);
  log.ingest(feed(status({distanceMm:'5711',observedAt:new Date(AT+5000).toISOString()}),core(),2,AT+5000),AT+5000);
  assert.equal(log.summary().latest.verdict,'IMPLAUSIBLE');
  assert.match(log.summary().latest.reasons.join(' '),/1001 mm > max\(200, 200\)/);
});

test('distance and work decreases are separately flagged without Number precision loss', () => {
  const log = new IntegrityLog();
  log.ingest(feed(status({distanceMm:'900719925474099312345',cumulativeWorkUnits:'900719925474099312345'})),AT);
  log.ingest(feed(status({distanceMm:'900719925474099312344',cumulativeWorkUnits:'900719925474099312344',observedAt:new Date(AT+5000).toISOString()}),core(),2,AT+5000),AT+5000);
  assert.equal(log.summary().latest.verdict,'IMPLAUSIBLE');
  assert.equal(log.summary().latest.reasons.filter(x=>x.includes('decreased')).length,2);
  assert.match(log.summary().latest.reasons[0],/Δ -1 mm/);
});

test('epoch restart discards the entire boundary and establishes a new baseline', () => {
  const log = new IntegrityLog(); log.ingest(feed(),AT);
  const restarted = status({distanceMm:'0',cumulativeWorkUnits:'0',counterEpoch:'test-epoch-b',observedAt:new Date(AT+5000).toISOString()});
  log.ingest(feed(restarted,core(),2,AT+5000),AT+5000);
  assert.equal(log.summary().latest.verdict,'IMPLAUSIBLE');
  assert.equal(log.summary().latest.deltaDistance,null);
  assert.equal(log.summary().latest.counted,false);
  assert.match(log.summary().latest.reasons[0],/boundary deltas discarded/);
  log.ingest(feed(status({...restarted.measurement,distanceMm:'471',cumulativeWorkUnits:'10',observedAt:new Date(AT+10000).toISOString()}),core(),3,AT+10000),AT+10000);
  assert.equal(log.summary().latest.verdict,'OK');
  assert.equal(log.summary().revolutions,1); assert.equal(log.summary().ratio,10);
  assert.equal(log.summary().anomalies.length,1);
});

test('repeated observations, repeated feed sequence and pending UI messages cannot double-count', () => {
  const log = new IntegrityLog(); log.ingest(emptyFeed(),AT); assert.equal(log.entries.length,0);
  log.ingest(feed(),AT); log.ingest(feed(),AT);
  assert.equal(log.entries.length,1);
  log.ingest(feed(status(),core(),2,AT+5000),AT+5000);
  assert.equal(log.summary().latest.counted,false); assert.equal(log.summary().revolutions,0);
});

test('failure polls keep a log entry and the last successful baseline, then recover across the true measurement interval', () => {
  const log = new IntegrityLog(); log.ingest(feed(),AT);
  const failed = feed(status(),core(),2,AT+5000); failed.errors.status='HTTP 503';
  log.ingest(failed,AT+5000);
  assert.equal(log.summary().latest.verdict,'STALE');
  const next = status({distanceMm:'6594',cumulativeWorkUnits:'140',observedAt:new Date(AT+10000).toISOString()});
  log.ingest(feed(next,core(),3,AT+10000),AT+10000);
  assert.equal(log.summary().latest.elapsed,10); assert.equal(log.summary().revolutions,4);
});

test('rolling poll log stays bounded and exports exact BigInt deltas as JSON strings', () => {
  const log = new IntegrityLog();
  for(let i=0;i<150;i++) log.ingest(feed(status({distanceMm:String(4710+i*471),cumulativeWorkUnits:String(100+i*10),observedAt:new Date(AT+i*5000).toISOString()}),core(),i+1,AT+i*5000),AT+i*5000);
  assert.equal(log.entries.length,120);
  const exported=JSON.parse(log.exportJSON());
  assert.equal(exported.entries.length,120); assert.equal(exported.entries[119].deltaDistance,'471');
});

test('alerts establish a silent baseline, then emit only named transitions and deduplicate events', () => {
  const detector = new TransitionDetector();
  const initial = feed(status(),core([event()]));
  assert.deepEqual(detector.update(initial,AT),[]);
  const nextStatus = status({coreStatus:'IDLE',rpmMilli:0,observedAt:new Date(AT+5000).toISOString()});
  nextStatus.builder.anchor.blockHeight='1002'; nextStatus.oracle.state='rejected'; nextStatus.settlementQueue.state='empty';
  const next = feed(nextStatus,core([event(),event('BatchSettled','test-event-2','11')]),2,AT+5000);
  const toasts = detector.update(next,AT+5000);
  assert.equal(toasts.length,5);
  assert.deepEqual(toasts.map(x=>x.kind),['wheel','block','warning','warning','settlement']);
  assert.deepEqual(detector.update(next,AT+5001),[]);
  assert.equal(detector.update(next,AT+25001).length,1);
  assert.deepEqual(detector.update(next,AT+30000),[]);
});

test('wake after idle, no startup historical settlements, and nonaccepted-to-nonaccepted state changes are silent', () => {
  const d = new TransitionDetector(); const s = status({coreStatus:'IDLE',rpmMilli:0});
  s.oracle.state='pending'; s.settlementQueue.state='empty';
  assert.deepEqual(d.update(feed(s,core([event()])),AT),[]);
  const next=status({observedAt:new Date(AT+5000).toISOString()}); next.oracle.state='rejected'; next.settlementQueue.state='buffered';
  const result=d.update(feed(next,core([event()]),2,AT+5000),AT+5000);
  assert.equal(result.length,1); assert.equal(result[0].title,'The hamster is awake');
});

test('payload validation rejects malformed timestamps, noninteger counters and missing required sections', () => {
  assert.equal(validPayload(status(),'status'),true);
  assert.equal(validPayload(status({observedAt:'no'}),'status'),false);
  assert.equal(validPayload(status({distanceMm:'1.5'}),'status'),false);
  assert.equal(validPayload(status({rpmMilli:-1}),'status'),false);
  assert.equal(validPayload({},'core'),false);
  assert.equal(validPayload({...core(),configuration:{...core().configuration,roundDuration:'Infinity'}},'core'),false);
});
