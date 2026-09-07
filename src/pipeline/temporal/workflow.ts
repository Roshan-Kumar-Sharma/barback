/**
 * The enrichment workflow.
 *
 * Deterministic by construction: no I/O, no Date.now(), no randomness, no
 * imports of enricher code. It receives specs and does nothing but schedule.
 * Every non-deterministic thing lives in an activity, so a worker restarting
 * mid-run replays this function against the event history and lands in exactly
 * the state it left.
 *
 * The wave scheduling is the same algorithm as LocalOrchestrator, and both are
 * held to the same conformance suite — a fallback that behaved differently
 * would make the port a lie rather than a boundary.
 */
import { proxyActivities } from '@temporalio/workflow';
import type { FieldCandidate } from '../../core/field.js';
import type { Venue } from '../../core/venue.js';
import type { StepResult } from '../port.js';
import type { Activities } from './activities.js';
import type { EnricherSpec, EnrichmentInput, EnrichmentOutput } from './shared.js';

const { runEnricher } = proxyActivities<Activities>({
  // Public data portals rate-limit and time out. Retrying is safe because every
  // fetch is content-addressed and cached, so a retry replays rather than
  // re-billing.
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '2s',
    backoffCoefficient: 2,
    maximumAttempts: 4,
    maximumInterval: '30s',
  },
});

export async function enrichmentWorkflow(input: EnrichmentInput): Promise<EnrichmentOutput> {
  let venue: Venue = { ...input.venue };
  let pending: EnricherSpec[] = [...input.specs];

  const steps: StepResult[] = [];
  const candidates: FieldCandidate[] = [];
  const ranBy: EnrichmentOutput['ran_by'] = [];

  for (;;) {
    const ready = pending.filter((s) => missingRequirements(s, venue).length === 0);

    if (ready.length === 0) {
      for (const s of pending) {
        steps.push(skipped(s, missingRequirements(s, venue)));
      }
      break;
    }

    // Bounded concurrency, in batches. Public portals are shared infrastructure.
    const results: Array<{ spec: EnricherSpec; step: StepResult; out?: Awaited<ReturnType<typeof runEnricher>> }> = [];
    for (let i = 0; i < ready.length; i += input.concurrency) {
      const batch = ready.slice(i, i + input.concurrency);
      const settled = await Promise.all(
        batch.map(async (spec) => {
          try {
            const out = await runEnricher({ enricherId: spec.id, state: input.state, venue });
            return {
              spec,
              out,
              step: {
                source: spec.id,
                status: 'ok' as const,
                fields_emitted: out.fields.length,
                duration_ms: 0,
                attempts: 1,
                cost_usd: out.cost_usd,
                ...(out.tokens === undefined ? {} : { tokens: out.tokens }),
              },
            };
          } catch (err) {
            // Isolated, exactly as in the local runner: one dead source must not
            // cost us the rest of the profile.
            return {
              spec,
              step: {
                source: spec.id,
                status: 'failed' as const,
                fields_emitted: 0,
                duration_ms: 0,
                attempts: 1,
                cost_usd: 0,
                error: rootCauseMessage(err),
              },
            };
          }
        }),
      );
      results.push(...settled);
    }

    let patched = false;
    for (const r of results) {
      steps.push(r.step);
      if (r.out) {
        ranBy.push({ id: r.spec.id, produces: r.spec.produces });
        candidates.push(...r.out.fields);
        if (r.out.venue_patch && Object.keys(r.out.venue_patch).length > 0) {
          const before = JSON.stringify(venue);
          venue = { ...venue, ...r.out.venue_patch };
          if (JSON.stringify(venue) !== before) patched = true;
        }
      }
    }

    pending = pending.filter((s) => !ready.includes(s));
    if (pending.length === 0) break;

    if (!patched) {
      // Nothing new about the venue this wave, so nothing blocked can unblock.
      for (const s of pending) steps.push(skipped(s, missingRequirements(s, venue)));
      break;
    }
  }

  return { venue, candidates, ran_by: ranBy, steps };
}

/**
 * The message a human needs, not the wrapper Temporal produced.
 *
 * Temporal wraps an activity throw in an ActivityFailure whose own message is
 * the generic "Activity task failed"; the real reason sits further down the
 * `cause` chain. Surfacing the wrapper would make a step's `error` useless for
 * diagnosis and would diverge from the in-process runner, which reports the
 * thrown message directly. The conformance suite caught exactly this.
 */
export function rootCauseMessage(err: unknown): string {
  let current: unknown = err;
  let best = '';

  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current.message && current.message.length > 0) best = current.message;
    const next: unknown = (current as { cause?: unknown }).cause;
    if (next === undefined || next === null) break;
    current = next;
  }
  if (best.length > 0) return best;
  return err instanceof Error ? err.message : String(err);
}

function missingRequirements(spec: EnricherSpec, venue: Venue): string[] {
  return spec.requires.filter((k) => {
    const v = (venue as unknown as Record<string, unknown>)[k];
    return v === undefined || v === null;
  });
}

function skipped(spec: EnricherSpec, missing: string[]): StepResult {
  return {
    source: spec.id,
    status: 'skipped',
    reason: `needs ${missing.join(', ')}, which no source supplied`,
    fields_emitted: 0,
    duration_ms: 0,
    attempts: 0,
    cost_usd: 0,
  };
}
