export const POLL_MS = 5000;
export const LOG_LIMIT = 120;
export const DEFAULT_ACCENT = '#ff7c48';
export const WIDGETS = [
  { id: 'ticker', name: 'Live ticker', description: 'The wheel, in real time. RPM, rim speed and block progress.', icon: 'activity', placement: 'Lower third', width: 1920, height: 1080 },
  { id: 'round', name: 'Round timer', description: 'A countdown to the next close, with a flash when the round is recorded.', icon: 'timer', placement: 'Top corner', width: 1920, height: 1080 },
  { id: 'alerts', name: 'Stream alerts', description: 'The moments that matter. State changes, blocks and settlements.', icon: 'bell', placement: 'Top corner', width: 1920, height: 1080 },
  { id: 'integrity', name: 'Integrity panel', description: 'An independent check of distance, work and hardware freshness.', icon: 'shield', placement: 'Top corner', width: 1920, height: 1080 },
  { id: 'commands', name: 'Game commands', description: 'A rotating guide to playing along, hash families and rarity tiers.', icon: 'terminal', placement: 'Lower corner', width: 1920, height: 1080 }
];

/** @param {URLSearchParams} params @returns {OverlayOptions} */
export function parseOptions(params) {
  const scale = Number(params.get('scale') ?? 1);
  const circumference = Number(params.get('circumferenceMm') ?? 471);
  const accent = (params.get('accent') || DEFAULT_ACCENT).replace(/^#/, '');
  return {
    side: params.get('side') === 'right' ? 'right' : 'left',
    scale: Number.isFinite(scale) ? Math.min(2, Math.max(0.5, scale)) : 1,
    theme: params.get('theme') === 'light' ? 'light' : 'dark',
    accent: /^(?:[\da-f]{3}|[\da-f]{6})$/i.test(accent) ? '#' + accent : DEFAULT_ACCENT,
    hideWhenIdle: params.get('hideWhenIdle') === '1',
    circumferenceMm: Number.isFinite(circumference) && circumference > 0 ? circumference : 471
  };
}

/** @param {unknown} value @returns {bigint | null} */
export function integer(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value))) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (!/^-?\d+$/.test(String(value))) return null;
  try { return BigInt(value); } catch { return null; }
}

/** @param {unknown} value */
export function timestamp(value) {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value))) {
    const n = Number(value); return n < 1e12 ? n * 1000 : n;
  }
  return Date.parse(String(value));
}

/** @param {unknown} value @param {number} [places] */
export function format(value, places = 0) {
  if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return '–';
  if (typeof value === 'bigint') return value.toLocaleString('en-US');
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places }) : '–';
}

/** @param {number} seconds */
export function ageLabel(seconds) {
  if (!Number.isFinite(seconds)) return 'age unknown';
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60 % 60)}m`;
}

/** @param {Measurement | null | undefined} m @param {number} now */
export function freshness(m, now) {
  if (!m) return { stale: true, age: NaN, limit: NaN, reason: 'Waiting for first measurement' };
  const age = (now - timestamp(m.observedAt)) / 1000;
  const limit = Number(m.staleAfterSeconds);
  const invalid = !Number.isFinite(age) || !Number.isFinite(limit) || limit < 0 || age < -5;
  const declaredStale = /stale|offline|unavailable|expired/i.test(m.freshness);
  return { stale: invalid || age > limit || declaredStale, age, limit,
    reason: invalid ? `Observed ${m.observedAt}; age ${format(age, 3)}s; limit ${limit}s${age < -5 ? '; timestamp is more than 5s ahead of the browser clock' : '; invalid timestamp or limit'}` : `${declaredStale ? `Source freshness ${m.freshness}; ` : ''}${format(Math.max(0, age), 3)}s ${age > limit ? '>' : '≤'} ${limit}s limit` };
}

/** @param {StatusData | null} status */
export function isRunning(status) {
  return !!status && (Number(status.measurement.rpmMilli) > 0 || /^(running|active|moving)$/i.test(status.measurement.coreStatus));
}

/** @param {CoreData | null} data @param {number} now */
export function roundClock(data, now) {
  if (!data) return null;
  const genesis = timestamp(data.configuration.genesisTimestamp);
  const duration = Number(data.configuration.roundDuration) * 1000;
  if (!Number.isFinite(genesis) || !Number.isFinite(duration) || duration <= 0) return null;
  const beforeGenesis = now < genesis;
  const round = Math.max(0, Math.floor((now - genesis) / duration));
  const close = beforeGenesis ? genesis : genesis + (round + 1) * duration;
  const remaining = Math.max(0, Math.ceil((close - now) / 1000));
  return { round, close, remaining, duration: duration / 1000, beforeGenesis, progress: beforeGenesis ? 0 : Math.min(1, Math.max(0, (now - (close - duration)) / duration)) };
}

/** @param {ChainEvent} event */
export function eventKey(event) {
  return event.id || `${event.transactionHash}:${event.logIndex ?? ''}:${event.eventName ?? event.name}:${eventArgument(event, 'roundId') ?? ''}`;
}

/** @param {ChainEvent} event @param {string} name */
export function eventArgument(event, name) {
  return event.arguments?.find(arg => arg.name === name)?.value ?? event.args?.[name] ?? (name === 'roundId' ? event.roundId : undefined);
}

/** @param {unknown} data @param {Endpoint} endpoint */
export function validPayload(data, endpoint) {
  if (!data || typeof data !== 'object') return false;
  const d = /** @type {Record<string, any>} */ (data);
  if (endpoint === 'status') {
    const m = d.measurement;
    return !!m && Number.isFinite(timestamp(m.observedAt)) && Number.isFinite(m.rpmMilli) && m.rpmMilli >= 0 && Number.isFinite(m.speedMmPerSecond) && m.speedMmPerSecond >= 0 &&
      integer(m.distanceMm) !== null && integer(m.cumulativeWorkUnits) !== null && typeof m.counterEpoch === 'string' && m.counterEpoch.length > 0 &&
      Number.isFinite(m.staleAfterSeconds) && m.staleAfterSeconds >= 0 && !!d.builder?.anchor && integer(d.builder.anchor.blockHeight) !== null && integer(d.builder.anchor.blockProgress) !== null && !!d.signer && !!d.oracle && !!d.settlementQueue && Array.isArray(d.modules);
  }
  if (endpoint === 'core') return !!d.core && integer(d.core.cumulativeWork) !== null && integer(d.core.blockHeight) !== null && Number.isFinite(Number(d.configuration?.roundDuration)) && Number(d.configuration?.roundDuration) > 0 && Number.isFinite(timestamp(d.configuration?.genesisTimestamp)) && Array.isArray(d.events);
  return !!d.identities && !!d.supply && !!d.mining;
}

/** @typedef {{at:number, observedAt:string|null, epoch:string|null, distance:string|null, work:string|null, measurement:Measurement|null, fetchErrors:Record<Endpoint,string|null>, chainWork:string|null, verdict:'OK'|'STALE'|'IMPLAUSIBLE', reasons:string[], deltaDistance:bigint|null, deltaWork:bigint|null, counted:boolean, elapsed:number|null}} LogEntry */

export class IntegrityLog {
  /** @param {number} circumferenceMm */
  constructor(circumferenceMm = 471) {
    this.circumferenceMm = circumferenceMm;
    /** @type {LogEntry[]} */ this.entries = [];
    /** @type {Measurement | null} */ this.previous = null;
    this.lastSequence = -1;
  }

  /** @param {Feed} feed @param {number} [now] */
  ingest(feed, now = Date.now()) {
    if (feed.pending || feed.sequence === 0) return;
    if (feed.sequence === this.lastSequence) return;
    this.lastSequence = feed.sequence;
    const m = feed.status?.measurement;
    /** @type {LogEntry} */
    const entry = { at: feed.attemptedAt || now, observedAt: m?.observedAt ?? null, epoch: m?.counterEpoch ?? null,
      distance: m ? String(m.distanceMm) : null, work: m ? String(m.cumulativeWorkUnits) : null,
      measurement: m ? { ...m } : null, fetchErrors: { ...feed.errors }, chainWork: feed.core ? String(feed.core.core.cumulativeWork) : null,
      verdict: 'OK', reasons: [], deltaDistance: null, deltaWork: null, counted: false, elapsed: null };
    if (!m || feed.errors.status) {
      entry.verdict = 'STALE';
      entry.reasons.push(m ? `Poll failed; retaining measurement aged ${format(freshness(m, now).age, 1)}s` : 'No successful status poll; retrying every 5s');
    } else {
      const fresh = freshness(m, now);
      const prev = this.previous;
      const distance = integer(m.distanceMm), work = integer(m.cumulativeWorkUnits);
      if (distance === null || work === null) {
        entry.verdict = 'IMPLAUSIBLE'; entry.reasons.push('Counter cannot be represented as an exact integer');
      } else if (prev) {
        const prevDistance = integer(prev.distanceMm), prevWork = integer(prev.cumulativeWorkUnits);
        if (prevDistance !== null && prevWork !== null) {
          const dd = distance - prevDistance, dw = work - prevWork;
          const elapsed = (timestamp(m.observedAt) - timestamp(prev.observedAt)) / 1000;
          entry.elapsed = elapsed;
          if (m.counterEpoch !== prev.counterEpoch) {
            entry.reasons.push(`Epoch ${prev.counterEpoch} → ${m.counterEpoch}; distance ${prevDistance} → ${distance} mm; work ${prevWork} → ${work}; boundary deltas discarded`);
            entry.verdict = 'IMPLAUSIBLE';
          } else if (elapsed === 0 && dd === 0n && dw === 0n) {
            entry.reasons.push(`Same observation; Δdistance 0 mm; Δwork 0; no interval counted`);
          } else {
            entry.deltaDistance = dd; entry.deltaWork = dw;
            if (dd < 0n) entry.reasons.push(`Distance decreased: ${prevDistance} → ${distance} mm (Δ ${dd} mm)`);
            if (dw < 0n) entry.reasons.push(`Work decreased: ${prevWork} → ${work} (Δ ${dw} units)`);
            if (dw > 0n && Number(m.rpmMilli) === 0) entry.reasons.push(`Δwork ${dw} units while rpmMilli = 0 (${prevWork} → ${work})`);
            const speed = Math.max(Number(prev.speedMmPerSecond), Number(m.speedMmPerSecond));
            const allowed = speed * elapsed;
            if (elapsed <= 0) entry.reasons.push(`Observation time did not advance: Δt ${format(elapsed, 3)}s; Δdistance ${dd} mm; Δwork ${dw}`);
            else if (!Number.isFinite(allowed)) entry.reasons.push(`Speed bound overflow: max(${prev.speedMmPerSecond}, ${m.speedMmPerSecond}) mm/s × ${elapsed}s; Δdistance ${dd} mm`);
            else if (dd > BigInt(Math.floor(allowed))) entry.reasons.push(`Δdistance ${dd} mm > max(${prev.speedMmPerSecond}, ${m.speedMmPerSecond}) mm/s × ${format(elapsed, 3)}s = ${format(allowed, 3)} mm`);
            if (entry.reasons.length) entry.verdict = 'IMPLAUSIBLE';
            else {
              entry.counted = true;
              entry.reasons.push(`Δdistance ${dd} mm ≤ ${format(allowed, 3)} mm; Δwork ${dw}; rpmMilli ${m.rpmMilli}; Δt ${format(elapsed, 3)}s`);
            }
          }
        }
      } else entry.reasons.push(`Baseline: distance ${m.distanceMm} mm; work ${m.cumulativeWorkUnits}; rpmMilli ${m.rpmMilli}; one more observation needed`);
      if (fresh.stale && entry.verdict === 'OK') { entry.verdict = 'STALE'; entry.reasons.push(fresh.reason); }
      // A reset or bad sample becomes a new baseline; it can never contribute a cross-boundary delta.
      this.previous = { ...m };
    }
    this.entries.push(entry);
    if (this.entries.length > LOG_LIMIT) this.entries.shift();
  }

  summary() {
    let distance = 0n, work = 0n;
    for (const e of this.entries) if (e.counted && e.verdict === 'OK') { distance += e.deltaDistance ?? 0n; work += e.deltaWork ?? 0n; }
    const revolutions = Number(distance) / this.circumferenceMm;
    const anomalies = this.entries.filter(e => e.verdict === 'IMPLAUSIBLE');
    return { distance, work, revolutions, ratio: revolutions > 0 ? Number(work) / revolutions : null, anomalies, latest: this.entries.at(-1), count: this.entries.length };
  }

  /** @returns {string} */
  exportJSON() { return JSON.stringify({ circumferenceMm: this.circumferenceMm, limit: LOG_LIMIT, entries: this.entries }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2); }
}

/** A stateful transition detector. Initial fetches establish a baseline and never replay history. */
export class TransitionDetector {
  constructor() {
    /** @type {StatusData|null} */ this.previous = null;
    /** @type {Set<string>} */ this.seen = new Set();
    this.eventsReady = false;
    /** @type {boolean|null} */ this.wasStale = null;
    this.lastStatusAt = 0;
    this.lastCoreAt = 0;
  }

  /** @param {Feed} feed @param {number} now */
  update(feed, now) {
    /** @type {{kind:string,title:string,detail:string}[]} */ const toasts = [];
    const s = feed.status;
    if (s && !feed.errors.status && feed.fetchedAt.status !== this.lastStatusAt) {
      const p = this.previous;
      if (p) {
        if (isRunning(p) !== isRunning(s)) toasts.push({ kind: 'wheel', title: isRunning(s) ? 'The hamster is awake' : 'The hamster is asleep', detail: `${format(s.measurement.rpmMilli / 1000, 1)} rpm · ${format(s.measurement.speedMmPerSecond)} mm/s` });
        const before = integer(p.builder.anchor.blockHeight), after = integer(s.builder.anchor.blockHeight);
        if (before !== null && after !== null && after > before) toasts.push({ kind: 'block', title: `Block #${format(after)} complete`, detail: `${after - before} new ${after - before === 1n ? 'block' : 'blocks'} · ${format(before)} → ${format(after)}` });
        if (p.oracle.state === 'accepted' && s.oracle.state !== 'accepted') toasts.push({ kind: 'warning', title: `Oracle: ${s.oracle.state}`, detail: 'Left accepted state' });
        if (p.settlementQueue.state === 'submitted' && s.settlementQueue.state !== 'submitted') toasts.push({ kind: 'warning', title: `Settlement queue: ${s.settlementQueue.state}`, detail: 'Left submitted state' });
      }
      this.previous = s; this.lastStatusAt = feed.fetchedAt.status;
    }
    if (feed.core && !feed.errors.core && feed.fetchedAt.core !== this.lastCoreAt) {
      const events = [...feed.core.events].sort((a,b) => Number(timestamp(a.blockTimestamp) - timestamp(b.blockTimestamp)));
      for (const event of events) {
        const key = eventKey(event);
        if (this.eventsReady && !this.seen.has(key) && (event.eventName ?? event.name) === 'BatchSettled') toasts.push({ kind: 'settlement', title: 'Batch settled', detail: `Through round #${eventArgument(event, 'settledThroughRound') ?? feed.core.core.settledThroughRound} · chain block ${event.blockNumber}` });
        this.seen.add(key);
      }
      if (this.seen.size > 2048) this.seen = new Set([...this.seen].slice(-1024));
      this.eventsReady = true; this.lastCoreAt = feed.fetchedAt.core;
    }
    if (s) {
      const fresh = freshness(s.measurement, now);
      if (fresh.stale && this.wasStale === false) toasts.push({ kind: 'warning', title: 'Wheel telemetry is stale', detail: `${format(fresh.age, 1)}s old · ${format(fresh.limit)}s limit` });
      this.wasStale = fresh.stale;
    }
    return toasts;
  }
}
