/**
 * Activities: the side-effecting half.
 *
 * All I/O lives here, which is exactly the split the rest of Barback already
 * has — enrichers are pure given an injected fetcher, so they drop into an
 * activity with no adaptation. That is the payoff of the enricher contract:
 * the same code runs under the in-process orchestrator and under Temporal.
 */
import { CachedFetcher, DiskCache } from '../../cache/index.js';
import type { Enricher, Logger } from '../../core/enricher.js';
import type { SourceId } from '../../core/field.js';
import type { StateCode } from '../../core/venue.js';
import type { RunEnricherInput, RunEnricherOutput } from './shared.js';

export type ActivityDeps = {
  cacheDir: string;
  userAgent: string;
  log: Logger;
  /**
   * Which enricher an id refers to.
   *
   * Injected rather than importing the registry directly so the conformance
   * suite can run the SAME workflow over stub enrichers. If the Temporal path
   * could only be exercised against live sources it would not really be under
   * test, and the port would be a boundary in name only.
   */
  resolve(id: SourceId, state: StateCode): Enricher | undefined;
};

export function createActivities(deps: ActivityDeps) {
  const cache = new DiskCache(deps.cacheDir);

  return {
    /**
     * Run one enricher.
     *
     * Idempotent by construction: the enricher is pure given its fetcher, and
     * the fetcher is content-addressed against the cache. A Temporal retry
     * after a partial failure replays from cache rather than re-billing an API
     * or re-hammering a public portal — which is what makes an aggressive retry
     * policy safe here.
     */
    async runEnricher(input: RunEnricherInput): Promise<RunEnricherOutput> {
      const enricher = deps.resolve(input.enricherId, input.state);
      if (!enricher) {
        throw new Error(`No enricher "${input.enricherId}" registered for ${input.state}`);
      }

      const controller = new AbortController();
      const result = await enricher.run(input.venue, {
        fetch: new CachedFetcher(
          {
            cache,
            source: enricher.id,
            userAgent: deps.userAgent,
            now: () => new Date(),
            log: deps.log,
          },
          controller.signal,
        ),
        now: () => new Date(),
        log: deps.log,
        signal: controller.signal,
      });

      return {
        fields: result.fields,
        ...(result.venue_patch ? { venue_patch: result.venue_patch } : {}),
        cost_usd: result.cost?.usd ?? 0,
        ...(result.cost?.tokens === undefined ? {} : { tokens: result.cost.tokens }),
      };
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
