/**
 * The one place in Barback that touches the network.
 *
 * Enrichers never call fetch() themselves — they receive this. That is what
 * keeps them replayable, keeps rate limits enforceable in one place, and keeps
 * the guardrails (identifying User-Agent, per-host politeness) impossible to
 * forget in a new enricher.
 */
import type { FetchRequest, Fetched, Fetcher, Logger } from '../core/enricher.js';
import { cacheKey, DiskCache, type CacheEntry } from './store.js';

/**
 * Minimum milliseconds between requests to a host.
 *
 * Nominatim's usage policy is an absolute maximum of 1 request per second and
 * requires an identifying User-Agent. Overpass is donated capacity. We are
 * deliberately slower than we are allowed to be.
 */
const HOST_MIN_INTERVAL_MS: Record<string, number> = {
  'nominatim.openstreetmap.org': 1100,
  'overpass-api.de': 1100,
  'data.texas.gov': 150,
};
const DEFAULT_MIN_INTERVAL_MS = 250;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export type FetcherOptions = {
  cache: DiskCache;
  source: string;
  userAgent: string;
  now: () => Date;
  log: Logger;
  /** Fail instead of hitting the network. Used by CI and by `--offline`. */
  offline?: boolean;
  maxAttempts?: number;
};

/** Serialises requests per host across every enricher in a run. */
const lastRequestAt = new Map<string, number>();

async function politeWait(host: string, signal: AbortSignal): Promise<void> {
  const min = HOST_MIN_INTERVAL_MS[host] ?? DEFAULT_MIN_INTERVAL_MS;
  const last = lastRequestAt.get(host) ?? 0;
  const waitMs = last + min - Date.now();
  lastRequestAt.set(host, Math.max(Date.now(), last + min));
  if (waitMs > 0) {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, waitMs);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
    });
  }
}

export class CachedFetcher implements Fetcher {
  constructor(private readonly opts: FetcherOptions, private readonly signal: AbortSignal) {}

  async get(req: FetchRequest): Promise<Fetched> {
    const method = req.method ?? 'GET';
    const ref = req.cache_key ?? cacheKey({ method, url: req.url, body: req.body });
    const now = this.opts.now();

    const hit = await this.opts.cache.read(this.opts.source, ref);
    if (hit && this.isFresh(hit, req, now)) {
      this.opts.log.debug('cache hit', { source: this.opts.source, ref, url: req.url });
      return { body: hit.body, status: hit.status, ref, retrieved_at: hit.retrieved_at, from_cache: true, url: hit.url };
    }

    if (this.opts.offline) {
      if (hit) {
        // Offline and stale beats offline and nothing — but say so.
        this.opts.log.warn('offline: serving stale cache', { ref, url: req.url });
        return { body: hit.body, status: hit.status, ref, retrieved_at: hit.retrieved_at, from_cache: true, url: hit.url };
      }
      throw new Error(`offline: no cached response for ${method} ${req.url} (ref ${ref})`);
    }

    const entry = await this.fetchWithRetry(req, method, ref);
    await this.opts.cache.write(this.opts.source, entry);
    return { body: entry.body, status: entry.status, ref, retrieved_at: entry.retrieved_at, from_cache: false, url: entry.url };
  }

  private isFresh(hit: CacheEntry, req: FetchRequest, now: Date): boolean {
    if (req.ttl_seconds === undefined) return true;
    return DiskCache.ageSeconds(hit, now) < req.ttl_seconds;
  }

  private async fetchWithRetry(req: FetchRequest, method: string, ref: string): Promise<CacheEntry> {
    const host = new URL(req.url).host;
    const maxAttempts = this.opts.maxAttempts ?? 4;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await politeWait(host, this.signal);
      try {
        const res = await fetch(req.url, {
          method,
          headers: {
            'user-agent': this.opts.userAgent,
            accept: 'application/json, text/html;q=0.9, */*;q=0.5',
            ...(req.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
            ...req.headers,
          },
          ...(req.body === undefined ? {} : { body: req.body }),
          signal: this.signal,
        });

        if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 2 ** attempt * 500;
          this.opts.log.warn('retrying', { url: req.url, status: res.status, attempt, backoff });
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }

        const text = await res.text();
        const ct = res.headers.get('content-type') ?? '';
        const body: unknown = ct.includes('json') ? safeJson(text) : text;

        return {
          ref,
          url: res.url || req.url,
          method,
          status: res.status,
          retrieved_at: this.opts.now().toISOString(),
          body,
        };
      } catch (err) {
        lastErr = err;
        if (this.signal.aborted) throw err;
        if (attempt >= maxAttempts) break;
        this.opts.log.warn('fetch error, retrying', { url: req.url, attempt, error: String(err) });
        await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
      }
    }
    throw new Error(`fetch failed after ${maxAttempts} attempts: ${method} ${req.url}: ${String(lastErr)}`);
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}
