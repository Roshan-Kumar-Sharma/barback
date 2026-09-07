/**
 * The Temporal orchestrator, held to the SAME conformance suite as the
 * in-process one.
 *
 * This is the test that makes the orchestration port an honest boundary rather
 * than a convenient fiction. If the durable path could only be exercised
 * against live sources, "both implementations behave identically" would be a
 * claim in a README instead of something the build checks.
 *
 * Uses Temporal's local test server, so it needs no Docker and runs in CI.
 */
import { afterAll, beforeAll, describe } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import type { Enricher } from '../src/core/enricher.js';
import type { SourceId } from '../src/core/field.js';
import type { Venue } from '../src/core/venue.js';
import { createActivities } from '../src/pipeline/temporal/activities.js';
import { TemporalOrchestrator } from '../src/pipeline/temporal/orchestrator.js';
import { WORKFLOWS_PATH } from '../src/pipeline/temporal/worker.js';
import type { Orchestrator, OrchestratorContext } from '../src/pipeline/port.js';
import type { EnrichmentRun } from '../src/pipeline/port.js';
import { conformanceSuite } from './orchestrator-conformance.js';

const TASK_QUEUE = 'barback-conformance';

/** Stubs for the run in flight; the activity resolves enricher ids through this. */
const registry = new Map<SourceId, Enricher>();

/** Publishes this run's stubs before delegating, so the activity can find them. */
class HarnessOrchestrator extends TemporalOrchestrator {
  override async run(v: Venue, enrichers: Enricher[], ctx: OrchestratorContext): Promise<EnrichmentRun> {
    registry.clear();
    for (const e of enrichers) registry.set(e.id, e);
    return super.run(v, enrichers, ctx);
  }
}

let env: TestWorkflowEnvironment;
let worker: Worker;
let running: Promise<void>;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
  worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities: createActivities({
      cacheDir: '/tmp/barback-conformance-cache',
      userAgent: 'barback-test',
      log: { debug: () => {}, info: () => {}, warn: () => {} },
      resolve: (id) => registry.get(id),
    }),
  });
  running = worker.run();
}, 120_000);

afterAll(async () => {
  worker?.shutdown();
  await running?.catch(() => {});
  await env?.teardown();
});

describe('TemporalOrchestrator', () => {
  conformanceSuite((): Orchestrator =>
    new HarnessOrchestrator({ client: env.client.workflow, state: 'TX', taskQueue: TASK_QUEUE }));
});
