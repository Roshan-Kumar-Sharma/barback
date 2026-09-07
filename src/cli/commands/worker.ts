import type { Command } from 'commander';
import { enrichersFor } from '../../enrichers/index.js';
import { startWorker } from '../../pipeline/temporal/worker.js';
import { TASK_QUEUE } from '../../pipeline/temporal/shared.js';
import { loadConfig, makeLogger } from '../runtime.js';
import { LlmClient } from '../../llm/client.js';

export function registerWorker(program: Command): void {
  program
    .command('worker')
    .description('Run the durable enrichment worker (needs a Temporal server: docker compose up -d)')
    .option('--address <address>', 'Temporal server address', 'localhost:7233')
    .option('--task-queue <queue>', 'task queue', TASK_QUEUE)
    .action(async (opts: { address: string; taskQueue: string }) => {
      const config = loadConfig({ verbose: true });
      const log = makeLogger(true);
      const llm = new LlmClient({
        baseUrl: config.llm.baseUrl,
        apiKey: config.llm.apiKey,
        model: config.llm.model,
      });

      const worker = await startWorker({
        address: opts.address,
        taskQueue: opts.taskQueue,
        cacheDir: config.cacheDir,
        userAgent: config.userAgent,
        log,
        resolve: (id, state) =>
          enrichersFor(state, {
            socrataAppToken: config.socrataAppToken,
            llm: llm.available ? llm : undefined,
          }).find((e) => e.id === id),
      });

      log.info(`worker listening on ${opts.taskQueue} at ${opts.address}`);
      await worker.run();
    });
}
