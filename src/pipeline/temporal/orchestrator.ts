/**
 * Temporal-backed orchestrator.
 *
 * Same interface, same semantics, same conformance suite as the in-process
 * runner — what changes is that the run now has a durable event history, so it
 * survives a worker restart mid-flight, retries each source independently, and
 * can be inspected after the fact in the Temporal UI.
 */
import { randomUUID } from 'node:crypto';
import type { WorkflowClient } from '@temporalio/client';
import type { Enricher } from '../../core/enricher.js';
import type { StateCode } from '../../core/venue.js';
import type { EnrichmentRun, Orchestrator, OrchestratorContext } from '../port.js';
import type { Venue } from '../../core/venue.js';
import { TASK_QUEUE, type EnricherSpec, type EnrichmentOutput } from './shared.js';
import { enrichmentWorkflow } from './workflow.js';

export type TemporalOrchestratorOptions = {
  client: WorkflowClient;
  state: StateCode;
  taskQueue?: string;
};

export class TemporalOrchestrator implements Orchestrator {
  readonly kind = 'temporal' as const;

  constructor(private readonly opts: TemporalOrchestratorOptions) {}

  async run(venue: Venue, enrichers: Enricher[], ctx: OrchestratorContext): Promise<EnrichmentRun> {
    const started = ctx.now();
    const runId = randomUUID();

    // Specs, not instances: the workflow schedules on declared metadata and
    // must stay free of enricher code to remain deterministic.
    const specs: EnricherSpec[] = enrichers.map((e) => ({
      id: e.id,
      requires: [...e.requires] as string[],
      produces: [...e.produces],
    }));

    const handle = await this.opts.client.start(enrichmentWorkflow, {
      taskQueue: this.opts.taskQueue ?? TASK_QUEUE,
      // The run id is the workflow id, so a repeated run is de-duplicated by
      // Temporal rather than by us, and the history is findable from the CLI
      // output.
      workflowId: `barback-${runId}`,
      args: [{
        venue,
        state: this.opts.state,
        specs,
        concurrency: ctx.concurrency ?? 4,
      }],
    });

    ctx.log.debug('temporal: workflow started', { workflowId: handle.workflowId });
    const out: EnrichmentOutput = await handle.result();

    const finished = ctx.now();
    return {
      run_id: runId,
      venue: out.venue,
      candidates: out.candidates,
      ran_by: out.ran_by,
      steps: out.steps,
      started_at: started.toISOString(),
      finished_at: finished.toISOString(),
      duration_ms: finished.getTime() - started.getTime(),
      cost_usd: out.steps.reduce((n, s) => n + s.cost_usd, 0),
      tokens: out.steps.reduce((n, s) => n + (s.tokens ?? 0), 0),
    };
  }
}
