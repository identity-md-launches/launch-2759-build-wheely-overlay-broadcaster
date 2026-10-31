import { POLL_MS, validPayload } from './domain.js';

export const ENDPOINTS = {
  status: 'https://api.squeekchain.com/v1/status',
  core: 'https://api.squeekchain.com/v1/core',
  economy: 'https://api.squeekchain.com/v1/economy/state'
};

/** @returns {Feed} */
export function emptyFeed() {
  return { status: null, core: null, economy: null, fetchedAt: { status: 0, core: 0, economy: 0 }, errors: { status: null, core: null, economy: null }, attemptedAt: 0, sequence: 0, pending: true };
}

export class Poller {
  /** @param {(feed:Feed)=>void} onUpdate @param {{fetcher?:typeof fetch, endpoints?:Endpoint[], timeoutMs?:number}} [options] */
  constructor(onUpdate, options = {}) {
    this.onUpdate = onUpdate;
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.endpoints = options.endpoints ?? ['status', 'core', 'economy'];
    this.timeoutMs = options.timeoutMs ?? 4500;
    this.feed = emptyFeed();
    this.running = false;
    /** @type {ReturnType<typeof setInterval>|null} */ this.timer = null;
    /** @type {Set<AbortController>} */ this.controllers = new Set();
  }

  async poll() {
    if (this.running) return;
    this.running = true;
    this.feed.attemptedAt = Date.now();
    await Promise.all(this.endpoints.map(async endpoint => {
      const controller = new AbortController();
      this.controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(ENDPOINTS[endpoint], { signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!validPayload(data, endpoint)) throw new Error('Invalid response shape');
        if (endpoint === 'status') this.feed.status = data;
        else if (endpoint === 'core') this.feed.core = data;
        else this.feed.economy = data;
        this.feed.errors[endpoint] = null;
        this.feed.fetchedAt[endpoint] = Date.now();
      } catch (err) {
        this.feed.errors[endpoint] = err instanceof Error && err.name === 'AbortError' ? 'Request timed out' : err instanceof Error ? err.message : 'Fetch failed';
      } finally { clearTimeout(timeout); this.controllers.delete(controller); }
    }));
    this.feed.pending = false;
    this.feed.sequence++;
    this.running = false;
    this.onUpdate(structuredClone(this.feed));
  }

  start() {
    if (this.timer !== null) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const controller of this.controllers) controller.abort();
  }
}
