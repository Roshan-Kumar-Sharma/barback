/** Shared process setup: config, cache, logging, fetcher construction. */
import { join } from 'node:path';
import type { Fetcher, Logger } from '../core/enricher.js';
import type { SourceId } from '../core/field.js';
import { CachedFetcher, DiskCache } from '../cache/index.js';

export type Config = {
  cacheDir: string;
  userAgent: string;
  socrataAppToken: string | undefined;
  llm: { baseUrl: string; apiKey: string | undefined; model: string };
  offline: boolean;
  verbose: boolean;
};

const DEFAULT_UA =
  'Barback/0.1 (open-source insurance risk intake; +https://github.com/barback/barback)';

export function loadConfig(overrides: Partial<Config> = {}): Config {
  return {
    cacheDir: process.env['BARBACK_CACHE_DIR'] ?? join(process.cwd(), 'data', 'cache'),
    userAgent: process.env['BARBACK_USER_AGENT']?.trim() || DEFAULT_UA,
    socrataAppToken: process.env['SOCRATA_APP_TOKEN']?.trim() || undefined,
    llm: {
      baseUrl: process.env['LLM_BASE_URL']?.trim() || 'https://openrouter.ai/api/v1',
      apiKey: process.env['LLM_API_KEY']?.trim() || undefined,
      model: process.env['LLM_MODEL']?.trim() || 'nvidia/nemotron-3.5-lightning:free',
    },
    offline: process.env['BARBACK_OFFLINE'] === '1',
    verbose: false,
    ...overrides,
  };
}

export function makeLogger(verbose: boolean): Logger {
  const emit = (level: string, msg: string, meta?: Record<string, unknown>): void => {
    const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    process.stderr.write(`${level} ${msg}${suffix}\n`);
  };
  return {
    debug: (m, meta) => { if (verbose) emit('·', m, meta); },
    info: (m, meta) => emit('›', m, meta),
    warn: (m, meta) => emit('!', m, meta),
  };
}

export type Runtime = {
  config: Config;
  log: Logger;
  cache: DiskCache;
  signal: AbortSignal;
  now: () => Date;
  fetcherFor(source: SourceId | 'resolver'): Fetcher;
};

export function makeRuntime(config: Config, signal: AbortSignal): Runtime {
  const log = makeLogger(config.verbose);
  const cache = new DiskCache(config.cacheDir);
  const now = (): Date => new Date();
  return {
    config,
    log,
    cache,
    signal,
    now,
    fetcherFor(source) {
      return new CachedFetcher(
        { cache, source, userAgent: config.userAgent, now, log, offline: config.offline },
        signal,
      );
    },
  };
}
