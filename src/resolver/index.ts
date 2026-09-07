import type { Fetcher } from '../core/enricher.js';
import type { VenueResolution } from '../core/venue.js';
import { resolveTexas, type ResolveOptions } from './tx.js';

export * from './tx.js';
export * from './similarity.js';

export async function resolve(fetcher: Fetcher, opts: ResolveOptions): Promise<VenueResolution> {
  switch (opts.state) {
    case 'TX':
      return resolveTexas(fetcher, opts);
    case 'CA':
      throw new Error('California resolution lands in Phase 2. See docs/ADDING-A-STATE.md.');
    default: {
      const never: never = opts.state;
      throw new Error(`Unsupported state: ${String(never)}`);
    }
  }
}
