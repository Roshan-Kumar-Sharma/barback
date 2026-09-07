/**
 * Worker process: hosts the workflow and the activities.
 *
 *   docker compose up -d
 *   pnpm barback worker
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';
import type { Enricher, Logger } from '../../core/enricher.js';
import type { SourceId } from '../../core/field.js';
import type { StateCode } from '../../core/venue.js';
import { createActivities } from './activities.js';
import { TASK_QUEUE } from './shared.js';

/**
 * Where Temporal's bundler finds the workflow.
 *
 * NodeNext requires `.js` in import specifiers, but under tsx and vitest the
 * file on disk is still `.ts`. Temporal's bundler stats the real path, so it
 * needs whichever one actually exists.
 */
export const WORKFLOWS_PATH = ((): string => {
  const compiled = fileURLToPath(new URL('./workflow.js', import.meta.url));
  if (existsSync(compiled)) return compiled;
  const source = fileURLToPath(new URL('./workflow.ts', import.meta.url));
  if (existsSync(source)) return source;
  return compiled;
})();

export type StartWorkerOptions = {
  address: string;
  taskQueue?: string;
  cacheDir: string;
  userAgent: string;
  log: Logger;
  resolve(id: SourceId, state: StateCode): Enricher | undefined;
};

export async function startWorker(opts: StartWorkerOptions): Promise<Worker> {
  const connection = await NativeConnection.connect({ address: opts.address });
  return Worker.create({
    connection,
    taskQueue: opts.taskQueue ?? TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities: createActivities({
      cacheDir: opts.cacheDir,
      userAgent: opts.userAgent,
      log: opts.log,
      resolve: opts.resolve,
    }),
  });
}
