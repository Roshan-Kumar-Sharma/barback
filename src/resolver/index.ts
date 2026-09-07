import type { Fetcher } from '../core/enricher.js';
import type { VenueResolution } from '../core/venue.js';
import { resolveCalifornia } from './ca.js';
import { resolveTexas, type ResolveOptions } from './tx.js';

export * from './tx.js';
export * from './ca.js';
export * from '../core/text/similarity.js';

export async function resolve(fetcher: Fetcher, opts: ResolveOptions): Promise<VenueResolution> {
  switch (opts.state) {
    case 'TX':
      return resolveTexas(fetcher, opts);
    case 'CA':
      return resolveCalifornia(fetcher, opts);
    default: {
      const never: never = opts.state;
      throw new Error(`Unsupported state: ${String(never)}`);
    }
  }
}
