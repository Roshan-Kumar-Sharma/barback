/**
 * In-process orchestrator. The default, and the one CI and the eval harness use.
 *
 * It is deliberately not a toy. It implements the same semantics the Temporal
 * implementation does, because the port is only honest if both sides behave
 * identically:
 *
 *   - failure isolation: one enricher throwing does not fail the run. A profile
 *     missing one source is useful; a run that produced nothing is not.
 *   - wave scheduling on declared requirements, with venue_patch merged between
 *     waves so late-arriving identity (a website URL) unblocks dependents.
 *   - bounded concurrency, because these are public portals run on someone
 *     else's budget.
 *   - idempotency: same venue against the same cache produces the same run.
 */
import { randomUUID } from 'node:crypto';
import pLimit from 'p-limit';
import type { Enricher } from '../core/enricher.js';
import type { FieldCandidate } from '../core/field.js';
import type { Venue } from '../core/venue.js';
import { withSpan } from '../obs/tracing.js';
import { readyEnrichers, type EnrichmentRun, type Orchestrator, type OrchestratorContext, type StepResult } from './port.js';

export class LocalOrchestrator implements Orchestrator {
  readonly kind = 'local' as const;

  async run(venue: Venue, enrichers: Enricher[], ctx: OrchestratorContext): Promise<EnrichmentRun> {
    return withSpan(
      'enrichment',
      { 'barback.orchestrator': this.kind, 'barback.venue_id': venue.id, 'barback.enrichers': enrichers.length },
      () => this.runInner(venue, enrichers, ctx),
    );
  }

  private async runInner(venue: Venue, enrichers: Enricher[], ctx: OrchestratorContext): Promise<EnrichmentRun> {
    const started = ctx.now();
    const limit = pLimit(ctx.concurrency ?? 4);

    let current: Venue = { ...venue };
    let pending = [...enrichers];
    const steps: StepResult[] = [];
    const candidates: FieldCandidate[] = [];
    const ranBy: EnrichmentRun['ran_by'] = [];

    // Loop until a wave adds nothing new to the venue, so a source that only
    // becomes runnable because of another source's output still gets its turn.
    for (;;) {
      const { ready, blocked } = readyEnrichers(pending, current);
      if (ready.length === 0) {
        for (const b of blocked) {
          steps.push({
            source: b.enricher.id,
            status: 'skipped',
            reason: `needs ${b.missing.join(', ')}, which no source supplied`,
            fields_emitted: 0,
            duration_ms: 0,
            attempts: 0,
            cost_usd: 0,
          });
        }
        break;
      }

      const results = await Promise.all(
        ready.map((e) => limit(() => this.runOne(e, current, ctx))),
      );

      let patched = false;
      for (const r of results) {
        steps.push(r.step);
        if (r.step.status === 'ok') {
          ranBy.push({ id: r.enricher.id, produces: r.enricher.produces });
          candidates.push(...r.candidates);
        }
        if (r.patch && Object.keys(r.patch).length > 0) {
          const before = JSON.stringify(current);
          current = { ...current, ...r.patch };
          if (JSON.stringify(current) !== before) patched = true;
        }
      }

      pending = pending.filter((e) => !ready.includes(e));
      if (pending.length === 0) break;
      if (!patched) {
        // No new identity this wave, so nothing blocked can ever unblock.
        const { blocked: stillBlocked } = readyEnrichers(pending, current);
        for (const b of stillBlocked) {
          steps.push({
            source: b.enricher.id,
            status: 'skipped',
            reason: `needs ${b.missing.join(', ')}, which no source supplied`,
            fields_emitted: 0,
            duration_ms: 0,
            attempts: 0,
            cost_usd: 0,
          });
        }
        break;
      }
    }

    const finished = ctx.now();
    return {
      run_id: randomUUID(),
      venue: current,
      candidates,
      ran_by: ranBy,
      steps,
      started_at: started.toISOString(),
      finished_at: finished.toISOString(),
      duration_ms: finished.getTime() - started.getTime(),
      cost_usd: steps.reduce((n, s) => n + s.cost_usd, 0),
      tokens: steps.reduce((n, s) => n + (s.tokens ?? 0), 0),
    };
  }

  private async runOne(
    enricher: Enricher,
    venue: Venue,
    ctx: OrchestratorContext,
  ): Promise<{ enricher: Enricher; step: StepResult; candidates: FieldCandidate[]; patch?: Partial<Venue> }> {
    const t0 = Date.now();
    try {
      const result = await withSpan(
        `enrich ${enricher.id}`,
        { 'barback.source': enricher.id, 'barback.venue_id': venue.id },
        () => enricher.run(venue, {
        fetch: ctx.fetcherFor(enricher.id),
        now: ctx.now,
        log: ctx.log,
        signal: ctx.signal,
        }),
      );
      return {
        enricher,
        candidates: result.fields,
        ...(result.venue_patch ? { patch: result.venue_patch } : {}),
        step: {
          source: enricher.id,
          status: 'ok',
          fields_emitted: result.fields.length,
          duration_ms: Date.now() - t0,
          attempts: 1,
          cost_usd: result.cost?.usd ?? 0,
          ...(result.cost?.tokens === undefined ? {} : { tokens: result.cost.tokens }),
        },
      };
    } catch (err) {
      // Isolated: this source is lost, the rest of the profile is not.
      ctx.log.warn(`enricher ${enricher.id} failed`, { error: String(err) });
      return {
        enricher,
        candidates: [],
        step: {
          source: enricher.id,
          status: 'failed',
          fields_emitted: 0,
          duration_ms: Date.now() - t0,
          attempts: 1,
          cost_usd: 0,
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}
