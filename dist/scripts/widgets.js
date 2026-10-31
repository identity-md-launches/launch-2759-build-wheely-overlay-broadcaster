import { ageLabel, eventArgument, eventKey, format, freshness, integer, IntegrityLog, isRunning, parseOptions, roundClock, timestamp, TransitionDetector } from './domain.js';
import { emptyFeed, Poller } from './data.js';
import { escapeHTML as esc, icon } from './icons.js';

const params = new URLSearchParams(location.search);
const options = parseOptions(params);
const kind = document.body.dataset.widget || 'ticker';
const root = /** @type {HTMLElement} */ (document.getElementById('widget'));
document.documentElement.dataset.theme = options.theme;
document.documentElement.style.setProperty('--accent', options.accent);
root.dataset.side = options.side;
root.className = `widget widget-${kind}`;
let feed = emptyFeed();
let paused = false;
const log = new IntegrityLog(options.circumferenceMm);
const transitions = new TransitionDetector();
/** @type {{kind:string,title:string,detail:string,expires:number,id:number}[]} */ let toasts = [];
let toastId = 0;
/** @type {Set<string>} */ let seenEvents = new Set();
const watchedRounds = new Set();
let roundInitialized = false;
let lastRoundPoll = 0;
let flashUntil = 0;
let recordedRound = '';
let commandIndex = 0;
let commandAt = Date.now();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
/** @type {Record<string,{from:number,to:number,at:number}>} */ const counters = {};

/** @param {string} key @param {number} target @param {number} now */
function animated(key, target, now) {
  const c = counters[key];
  if (!c) { counters[key] = { from: target, to: target, at: now }; return target; }
  if (c.to !== target) {
    c.from = valueAt(c, now); c.to = target; c.at = now;
  }
  return reducedMotion.matches || paused ? c.to : valueAt(c, now);
}
/** @param {{from:number,to:number,at:number}} c @param {number} now */
function valueAt(c, now) {
  const t = Math.min(1, Math.max(0, (now - c.at) / 1800));
  return c.from + (c.to - c.from) * (1 - Math.pow(1 - t, 3));
}

/** @param {Feed} next */
function receive(next) {
  feed = next;
  log.ingest(feed);
  const now = Date.now();
  addToasts(transitions.update(feed, now), now);
  const clock = roundClock(feed.core, now);
  if (clock) watchedRounds.add(clock.round);
  if (feed.core && feed.fetchedAt.core !== lastRoundPoll) {
    for (const event of feed.core.events) {
      const key = eventKey(event);
      const round = eventArgument(event, 'roundId');
      if (roundInitialized && !seenEvents.has(key) && (event.eventName ?? event.name) === 'RoundRecorded' && round !== undefined && watchedRounds.has(Number(round))) {
        flashUntil = now + 6000; recordedRound = String(round);
      }
      seenEvents.add(key);
    }
    if (seenEvents.size > 2048) seenEvents = new Set([...seenEvents].slice(-1024));
    lastRoundPoll = feed.fetchedAt.core; roundInitialized = true;
  }
  render(now);
}

/** @param {{kind:string,title:string,detail:string}[]} additions @param {number} now */
function addToasts(additions, now) {
  for (const item of additions) toasts.push({ ...item, expires: now + 10000, id: ++toastId });
  toasts = toasts.slice(-3);
}

/** @param {number} now */
function connectionLine(now) {
  const fresh = freshness(feed.status?.measurement, now);
  const errors = [feed.errors.status, ...(kind === 'round' || kind === 'integrity' || kind === 'alerts' ? [feed.errors.core] : [])].filter(Boolean);
  if (!feed.status) return `<span class="source-state">${feed.pending ? 'Connecting to Squeekchain…' : 'STALE · no measurement yet · retrying every 5s'}</span>`;
  return `<span class="source-state ${fresh.stale || errors.length ? 'source-stale' : ''}">${fresh.stale || errors.length ? 'STALE · ' : ''}${ageLabel(fresh.age)} since wheel observation${errors.length ? ' · connection interrupted; last values kept' : ''}</span>`;
}

/** @param {number} now */
function renderTicker(now) {
  const s = feed.status;
  const m = s?.measurement;
  const stale = freshness(m, now).stale || !!feed.errors.status;
  const rpm = m ? animated('rpm', m.rpmMilli / 1000, now) : null;
  const speed = m ? animated('speed', m.speedMmPerSecond, now) : null;
  const block = s ? integer(s.builder.anchor.blockHeight) : null;
  const progress = s ? animated('progress', Math.min(1, Math.max(0, Number(s.builder.anchor.blockProgress) / 1e9)), now) : 0;
  // Large chain counters remain exact; interpolation is only used while Number is lossless.
  const height = block !== null && block <= BigInt(Number.MAX_SAFE_INTEGER) ? Math.floor(animated('block', Number(block), now)) : block;
  return `<div class="ticker-shell overlay-surface"><div class="ticker-brand">${icon('wheel')}<strong>WHEELY</strong></div>
    <div class="ticker-status"><span class="state-dot ${m && isRunning(s) ? 'running' : ''}"></span><strong>${m ? isRunning(s) ? 'RUNNING' : 'ASLEEP' : 'CONNECTING'}</strong>${stale && m ? '<span class="stale-tag">STALE</span>' : ''}</div>
    <div class="ticker-metric"><strong>${format(rpm, 1)}</strong><span>rpm</span></div>
    <div class="ticker-metric"><strong>${format(speed, 0)}</strong><span>mm/s</span></div>
    <div class="ticker-block"><div><span>Block</span><strong>#${format(height)}</strong><span>${format(progress * 100, 1)}%</span></div><div class="progress-track" role="progressbar" aria-label="Block progress" aria-valuenow="${(progress * 100).toFixed(1)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${progress * 100}%"></i></div></div>
    </div><div class="ticker-freshness">${connectionLine(now)}</div>`;
}

/** @param {number} now */
function renderRound(now) {
  const clock = roundClock(feed.core, now);
  if (clock) watchedRounds.add(clock.round);
  const time = clock ? `${String(Math.floor(clock.remaining / 60)).padStart(2, '0')}:${String(clock.remaining % 60).padStart(2, '0')}` : '–:––';
  const coreAge = feed.fetchedAt.core ? (now - feed.fetchedAt.core) / 1000 : NaN;
  const stale = !feed.core || !!feed.errors.core || coreAge > 15;
  const flashed = now < flashUntil;
  return `<div class="overlay-surface round-shell"><div class="overlay-heading">${icon('timer')}<span>${clock?.beforeGenesis ? 'First round opens in' : `Round ${clock ? '#' + format(clock.round) : '–'} closes in`}</span></div><strong class="round-countdown">${time}</strong><div class="progress-track"><i style="width:${(clock?.progress ?? 0) * 100}%"></i></div><p class="round-caption">${flashed ? `Round #${esc(recordedRound)} recorded` : feed.core?.core.paused ? 'Core paused · scheduled close shown' : 'Synced to chain round schedule'}</p><div class="source-state ${stale ? 'source-stale' : ''}">${stale ? 'STALE · ' : ''}Core ${feed.core ? `${ageLabel(coreAge)} ago` : 'unavailable · retrying every 5s'}</div></div>`;
}

/** @param {number} now */
function renderAlerts(now) {
  addToasts(transitions.update(feed, now), now);
  toasts = toasts.filter(t => t.expires > now);
  const content = toasts.map(t => `<div class="overlay-surface toast toast-${esc(t.kind)}" data-toast="${t.id}">${icon(t.kind === 'warning' ? 'shield' : t.kind === 'wheel' ? 'wheel' : 'check')}<div><strong>${esc(t.title)}</strong><span>${esc(t.detail)}</span></div></div>`).join('');
  const fresh = freshness(feed.status?.measurement, now);
  return content + ((!feed.pending && (!feed.status || fresh.stale || feed.errors.status || feed.errors.core)) ? `<div class="alert-source-note">${connectionLine(now)}${feed.errors.core ? `<span class="source-state source-stale">${feed.fetchedAt.core ? `Core connection interrupted · last update ${ageLabel((now - feed.fetchedAt.core) / 1000)} ago` : 'Core unavailable · no successful fetch yet · retrying every 5s'}</span>` : ''}</div>` : '');
}

/** @param {number} now */
function renderIntegrity(now) {
  const s = feed.status;
  const m = s?.measurement;
  const summary = log.summary();
  const fresh = freshness(m, now);
  const latest = summary.latest;
  const anomaly = summary.anomalies.at(-1);
  const verdict = anomaly ? 'IMPLAUSIBLE' : fresh.stale || feed.errors.status || !m ? 'STALE' : 'OK';
  const chain = feed.core ? integer(feed.core.core.cumulativeWork) : null;
  const hardware = m ? integer(m.cumulativeWorkUnits) : null;
  const chainLag = chain !== null && hardware !== null ? hardware - chain : null;
  const verifiedAge = s ? (now - timestamp(s.signer.lastVerifiedAt)) / 1000 : NaN;
  const coreAge = feed.fetchedAt.core ? (now - feed.fetchedAt.core) / 1000 : NaN;
  const coreNote = feed.core ? `${feed.errors.core || coreAge > 15 ? 'STALE · ' : ''}Core update ${ageLabel(coreAge)} ago; settlement may lag.` : 'STALE · core unavailable; retrying every 5s.';
  const reason = anomaly ? anomaly.reasons.join('; ') : latest?.reasons.join('; ') || 'Waiting for first status sample';
  return `<div class="overlay-surface integrity-shell"><div class="integrity-title"><div class="overlay-heading">${icon('shield')}<strong>Wheel integrity</strong></div><span class="verdict verdict-${verdict.toLowerCase()}">${verdict}</span></div>
    <p class="integrity-overview">${summary.anomalies.length}/${summary.count} polls flagged · rolling ${summary.count}/120 polls</p>
    <div class="integrity-metrics"><div><span>Implied revolutions</span><strong>${format(summary.revolutions, 3)}</strong><small>${summary.distance} mm ÷ ${esc(options.circumferenceMm)} mm</small></div><div><span>Work / revolution</span><strong>${format(summary.ratio, 3)}</strong><small>${summary.distance > 0n ? `${summary.work} × ${esc(options.circumferenceMm)} ÷ ${summary.distance} mm` : 'Waiting for wheel movement'}</small></div></div>
    <div class="integrity-check"><strong>${verdict} · Plausibility</strong><p>${esc(reason)}</p></div>
    <div class="integrity-check"><strong>${fresh.stale || feed.errors.status ? 'STALE' : 'OK'} · Freshness</strong><p>${esc(fresh.reason)}${feed.errors.status ? `; ${esc(feed.errors.status)}; last successful fetch ${ageLabel((now - feed.fetchedAt.status) / 1000)} ago` : ''}</p></div>
    <div class="integrity-check"><strong>Counter / chain</strong><p>${hardware === null ? 'Waiting for hardware' : `${hardware} hardware units`} · ${chain === null ? 'chain unavailable' : `${chain} settled units; difference ${chainLag}`}<br>${coreNote}</p></div>
    <div class="attestation"><strong>Attestation reported by API</strong><p>${s ? `${esc(s.signer.kind)} · ${esc(s.signer.algorithm)} · slot ${esc(s.signer.keySlot)}<br>Last verified ${ageLabel(verifiedAge)} ago` : 'Signer unavailable'}<br>${m ? `${esc(m.provenance)} · epoch ${esc(m.counterEpoch)}` : 'Awaiting counter epoch'}</p></div>
    <div class="integrity-log">${log.entries.slice(-3).reverse().map(e => `<div><time>${new Date(e.at).toLocaleTimeString('en-GB')}</time><span class="log-verdict">${e.verdict}</span><span>Δ ${e.deltaDistance ?? '–'} mm / ${e.deltaWork ?? '–'} work</span></div>`).join('') || '<span>Log starts with the first poll.</span>'}</div></div>`;
}

const commands = [
  { command: 'spin', description: 'Spin for a hash.', subtitle: 'Play along in stream chat' },
  { command: 'use', description: 'Put a hash to work.', subtitle: 'Play along in stream chat' },
  { command: 'merge', description: 'Merge hashes to upgrade.', subtitle: 'Play along in stream chat' },
  { command: 'me', description: 'Check your player profile.', subtitle: 'Play along in stream chat' },
  { command: 'help', description: 'See the full command guide.', subtitle: 'Play along in stream chat' }
];
/** @param {number} now */
function renderCommands(now) {
  if (!paused && !reducedMotion.matches && now - commandAt >= 8000) { commandIndex = (commandIndex + 1) % commands.length; commandAt = now; }
  const command = commands[commandIndex];
  return `<div class="overlay-surface commands-shell"><div class="overlay-heading">${icon('terminal')}<span>${command.subtitle}</span><span class="command-position">${commandIndex + 1}/5</span></div><div class="command-main"><strong>${command.command}</strong><span>${command.description}</span></div><div class="command-list">${commands.map((c,i) => `<span class="${i === commandIndex ? 'current-command' : ''}">${c.command}</span>`).join('')}</div><div class="family-list">${['fire', 'water', 'earth', 'air', 'lightning', 'star'].map(f => `<span class="family family-${f}"><i></i>${f}</span>`).join('')}</div><div class="tier-list"><span>common</span><span>uncommon</span><span>rare</span><span>epic</span><span>legendary</span></div>${connectionLine(now)}</div>`;
}

let lastHTML = '';
/** @param {number} now */
function render(now) {
  const s = feed.status;
  const idle = s && !isRunning(s) && !freshness(s.measurement, now).stale && !feed.errors.status;
  root.hidden = !!(options.hideWhenIdle && idle && (kind !== 'alerts' || toasts.length === 0));
  const html = kind === 'ticker' ? renderTicker(now) : kind === 'round' ? renderRound(now) : kind === 'alerts' ? renderAlerts(now) : kind === 'integrity' ? renderIntegrity(now) : renderCommands(now);
  root.classList.toggle('is-recorded', kind === 'round' && now < flashUntil);
  if (html !== lastHTML) { root.innerHTML = html; lastHTML = html; }
  fitScale();
}

function fitScale() {
  const naturalWidth = kind === 'ticker' ? 1390 : kind === 'integrity' ? 680 : kind === 'commands' ? 670 : kind === 'alerts' ? 660 : 400;
  const available = Math.max(1, innerWidth - 2 * Math.min(48, innerWidth * 0.025));
  let scale = Math.min(options.scale, available / naturalWidth);
  root.style.setProperty('--effective-scale', String(scale));
  const naturalHeight = root.scrollHeight;
  if (naturalHeight > 0) scale = Math.min(scale, Math.max(0.1, (innerHeight - 2 * Math.min(48, innerHeight * 0.045)) / naturalHeight));
  root.style.setProperty('--effective-scale', String(scale));
}

const embedded = window.parent !== window;
const embeddedHere = embedded && (() => { try { return window.parent.location.origin === location.origin; } catch { return false; } })();
/** @type {Poller|null} */ let poller = null;
let sharedFeed = false;
if (embeddedHere) {
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent || !event.data) return;
    if (event.data.type === 'wheely:feed') { sharedFeed = true; poller?.stop(); receive(event.data.feed); }
    if (event.data.type === 'wheely:pause') { paused = !!event.data.paused; root.classList.toggle('motion-paused', paused); commandAt = Date.now(); }
    if (event.data.type === 'wheely:preview-alert' && kind === 'alerts') { addToasts([{ kind: 'preview', title: 'Preview · the hamster is awake', detail: 'Test alert · never sent to your broadcast source' }], Date.now()); render(Date.now()); }
  });
  window.parent.postMessage({ type: 'wheely:ready' }, location.origin);
  setTimeout(() => { if (!sharedFeed) { poller = new Poller(receive, { endpoints: kind === 'commands' || kind === 'ticker' ? ['status'] : ['status', 'core'] }); poller.start(); } }, 1500);
} else {
  poller = new Poller(receive, { endpoints: kind === 'commands' || kind === 'ticker' ? ['status'] : ['status', 'core'] });
  poller.start();
}
window.addEventListener('pagehide', () => poller?.stop());
window.addEventListener('resize', fitScale);
setInterval(() => render(Date.now()), kind === 'ticker' ? 50 : 250);
render(Date.now());
