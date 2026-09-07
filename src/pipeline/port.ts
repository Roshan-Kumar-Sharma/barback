/**
 * The orchestration port.
 *
 * Enrichment is many slow, flaky, rate-limited calls against public
 * infrastructure. That is a durable-execution problem, and Temporal is the
 * right tool for it — but a portfolio repo that cannot run without a cluster
 * is a repo nobody runs, and an eval suite that needs one is an eval suite CI
 * will not keep green.
 *
 * So durable execution lives behind this interface. `LocalOrchestrator` runs
 * in-process with the same retry, isolation and idempotency semantics;
 * `TemporalOrchestrator` runs the same activities under a real event history.
 * One conformance suite runs against both, because a fallback that quietly
 * behaves differently would make this design a lie rather than a boundary.
 */
import type { Enricher, EnricherContext, Logger } from '../core/enricher.js';
import type { FieldCandidate, SourceId, FieldPath } from '../core/field.js';
import type { Venue } from '../core/venue.js';

export type StepStatus = 'ok' | 'skipped' | 'failed';

export type StepResult = {
  source: SourceId;
  status: StepStatus;
  /** Why a step was skipped: which declared requirement the venue never gained. */
  reason?: string;
  fields_emitted: number;
  duration_ms: number;
  attempts: number;
  cost_usd: number;
  tokens?: number;
  error?: string;
};

export type EnrichmentRun = {
  run_id: string;
  venue: Venue;
  candidates: FieldCandidate[];
  ran_by: Array<{ id: SourceId; produces: readonly FieldPath[] }>;
  steps: StepResult[];
  started_at: string;
  finished_at: string;
  duration_ms: number;
  cost_usd: number;
  /** LLM tokens across the run. Zero when no model was involved. */
  tokens: number;
};

export type OrchestratorContext = {
  /** One fetcher per source, so cache namespaces and rate limits stay per-source. */
  fetcherFor(source: SourceId): EnricherContext['fetch'];
  now: () => Date;
  log: Logger;
  signal: AbortSignal;
  /** Enrichers that may run at once. Public data portals are shared infrastructure. */
  concurrency?: number;
};

export interface Orchestrator {
  readonly kind: 'local' | 'temporal';
  run(venue: Venue, enrichers: Enricher[], ctx: OrchestratorContext): Promise<EnrichmentRun>;
}

/**
 * Wave scheduling.
 *
 * Enrichers declare what they need rather than being ordered by hand, because
 * the dependency is real but sparse: `web` cannot run until `osm` has found a
 * website, and `osm` cannot run until the licence record has produced an
 * address. Ordering them manually would put that knowledge in the wrong place
 * and rot the first time a source is added.
 *
 * Returns the enrichers runnable against the venue as it currently stands.
 */
export function readyEnrichers(
  pending: Enricher[],
  venue: Venue,
): { ready: Enricher[]; blocked: Array<{ enricher: Enricher; missing: string[] }> } {
  const ready: Enricher[] = [];
  const blocked: Array<{ enricher: Enricher; missing: string[] }> = [];
  for (const e of pending) {
    const missing = e.requires.filter((k) => venue[k] === undefined || venue[k] === null);
    if (missing.length === 0) ready.push(e);
    else blocked.push({ enricher: e, missing: missing.map(String) });
  }
  return { ready, blocked };
}
