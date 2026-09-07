/**
 * The enricher contract.
 *
 * Design rule #2: enrichers are pure and independent. Venue -> FieldCandidate[].
 * No shared mutable state, no reaching into the profile, no knowledge of each
 * other. Adding a source must not require touching the core.
 *
 * They cannot be literally pure, because they do I/O. The honest version is
 * that an enricher is pure GIVEN a Fetcher — all network access goes through an
 * injected, cache-backed port. That is what makes evals reproducible, CI
 * offline and free, and `barback replay` possible at all.
 */
import type { FieldCandidate, FieldPath, SourceId } from './field.js';
import type { Venue } from './venue.js';

export type FetchRequest = {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** Form-encoded body, for the Overpass API. */
  body?: string;
  /**
   * Stable identity for caching. Two requests with the same key are the same
   * request even if header order or transient params differ. Defaults to a
   * hash of method + url + body.
   */
  cache_key?: string;
  /** Seconds. How long a cached copy stays fresh for this source. */
  ttl_seconds?: number;
};

export type Fetched = {
  /** Parsed JSON, or raw text when the response is not JSON. */
  body: unknown;
  status: number;
  /** Cache key — becomes Field.evidence_ref, making every value replayable. */
  ref: string;
  /** When this copy was fetched. Becomes Field.retrieved_at. */
  retrieved_at: string;
  /** True when served from cache rather than the network. */
  from_cache: boolean;
  url: string;
};

export type FetchedFile = {
  /** Absolute path to the cached file on disk. */
  path: string;
  ref: string;
  retrieved_at: string;
  from_cache: boolean;
  url: string;
  bytes: number;
};

export interface Fetcher {
  get(req: FetchRequest): Promise<Fetched>;

  /**
   * Fetch a bulk file to disk rather than into memory.
   *
   * Some public sources publish a daily archive rather than an API —
   * California ABC ships a 7MB zip containing a 27MB CSV of every licence in
   * the state. Forcing that through the JSON cache would be silly, but letting
   * an enricher call `fetch` directly would put I/O outside the one place that
   * enforces caching, rate limiting and the identifying User-Agent. So the port
   * grows a second method instead of growing an exception.
   */
  getFile(req: FetchRequest & { extension?: string }): Promise<FetchedFile>;
}

export type Logger = {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
};

export type EnricherContext = {
  fetch: Fetcher;
  /** Injected so enrichers stay deterministic under replay. Never call Date.now(). */
  now: () => Date;
  log: Logger;
  signal: AbortSignal;
};

/** Where the data came from and under what terms. Compiled into NOTICE. */
export type Attribution = {
  name: string;
  url: string;
  /** e.g. 'Public domain (Texas Public Information Act)', 'ODbL 1.0'. */
  license: string;
  /** Attribution line required by that licence, if any. */
  notice?: string;
};

export type EnrichResult = {
  fields: FieldCandidate[];
  /**
   * Facts discovered about the venue's identity that other enrichers can key
   * off — a geocode, a website URL. Merged into the Venue between waves.
   * Kept separate from `fields` because identity is not underwriting data.
   */
  venue_patch?: Partial<Venue>;
  /** Dollars and tokens spent. Summed into the run's cost accounting. */
  cost?: { usd: number; tokens?: number };
};

export interface Enricher {
  readonly id: SourceId;

  /**
   * Every field this enricher can produce. Declared, not discovered.
   *
   * This is what lets the completeness engine COMPUTE that no source in the
   * build can ever fill `loss_history.losses`, rather than hardcoding a list of
   * "human" fields that silently rots as sources are added.
   *
   * A test asserts that every emitted path was declared here.
   */
  readonly produces: readonly FieldPath[];

  /**
   * Venue keys this enricher needs before it can run. An enricher whose
   * requirements are unmet is skipped, not failed — `web` cannot run until
   * `osm` has found a website, and that is a normal outcome, not an error.
   */
  readonly requires: readonly (keyof Venue)[];

  readonly attribution: Attribution;

  run(venue: Venue, ctx: EnricherContext): Promise<EnrichResult>;
}

/** True when the venue carries everything the enricher declared it needs. */
export function canRun(e: Enricher, v: Venue): boolean {
  return e.requires.every((k) => v[k] !== undefined && v[k] !== null);
}
