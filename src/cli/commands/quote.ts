import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import { reduce, unknownPaths } from '../../core/reduce/index.js';
import type { StateCode } from '../../core/venue.js';
import { derivationsFor, enrichersFor } from '../../enrichers/index.js';
import { LocalOrchestrator } from '../../pipeline/index.js';
import { resolve } from '../../resolver/index.js';
import { coverage, DISCLAIMER, renderProfile, renderRun } from '../render.js';
import { loadConfig, makeRuntime } from '../runtime.js';

export function registerQuote(program: Command): void {
  program
    .command('quote')
    .description('Build an underwriting risk profile from a venue name and state')
    .requiredOption('-n, --name <name>', 'trade name of the venue')
    .requiredOption('-s, --state <state>', 'two-letter state code')
    .option('-c, --city <city>', 'narrow resolution to a city')
    .option('--json', 'emit the full profile as JSON')
    .option('--all', 'show empty fields too')
    .option('--save <path>', 'write the run to a JSON file')
    .option('-v, --verbose', 'log cache hits and requests')
    .action(async (opts: {
      name: string; state: string; city?: string;
      json?: boolean; all?: boolean; save?: string; verbose?: boolean;
    }) => {
      const controller = new AbortController();
      const config = loadConfig({ verbose: opts.verbose === true });
      const rt = makeRuntime(config, controller.signal);
      const state = opts.state.toUpperCase() as StateCode;

      const resolution = await resolve(rt.fetcherFor('resolver'), {
        name: opts.name,
        state,
        city: opts.city,
        appToken: config.socrataAppToken,
      });

      if (resolution.status !== 'resolved') {
        // Resolution is the one place a confident wrong answer poisons every
        // downstream field, so an unresolved venue stops here rather than
        // guessing.
        if (resolution.status === 'not_found') {
          process.stdout.write(`\nNo match for "${resolution.searched}".\n${resolution.note}\n\n`);
        } else {
          process.stdout.write(
            `\n${resolution.candidates.length} plausible matches — none clearly best.\n` +
            'Narrow with --city, or run `barback resolve` to see them all.\n\n',
          );
          resolution.candidates.slice(0, 5).forEach((c, i) => {
            process.stdout.write(
              `  [${i + 1}] ${c.score.toFixed(2)}  ${c.venue.trade_name} — ${c.venue.address.city}\n`,
            );
          });
          process.stdout.write('\n');
        }
        process.exitCode = 2;
        return;
      }

      const enrichers = enrichersFor(state, { socrataAppToken: config.socrataAppToken });
      const run = await new LocalOrchestrator().run(resolution.venue, enrichers, {
        fetcherFor: (s) => rt.fetcherFor(s),
        now: rt.now,
        log: rt.log,
        signal: controller.signal,
      });

      const stray = unknownPaths(run.candidates);
      if (stray.length > 0) rt.log.warn('enricher emitted unknown field paths', { paths: stray });

      const { profile } = reduce({
        candidates: run.candidates,
        ranBy: run.ran_by,
        now: rt.now(),
        derivations: derivationsFor(state),
      });
      const cov = coverage(profile);

      if (opts.save) {
        await mkdir(join(process.cwd(), 'data', 'runs'), { recursive: true });
        await writeFile(opts.save, `${JSON.stringify({ run, profile, coverage: cov }, null, 2)}\n`, 'utf8');
        rt.log.info(`saved run to ${opts.save}`);
      }

      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify({ venue: run.venue, profile, coverage: cov }, null, 2)}\n`);
        return;
      }

      const v = resolution.venue;
      process.stdout.write(
        `\n${v.trade_name}\n${v.address.line1}, ${v.address.city}, ${v.address.state} ${v.address.zip}\n` +
        `licence ${v.license_type} ${v.license_id}\n`,
      );
      process.stdout.write(`${renderProfile(profile, { showEmpty: opts.all === true })}\n`);
      process.stdout.write(`${renderRun(run, cov)}\n`);
      process.stdout.write(DISCLAIMER);
    });
}
