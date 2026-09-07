import type { Command } from 'commander';
import { resolve } from '../../resolver/index.js';
import type { StateCode } from '../../core/venue.js';
import { loadConfig, makeRuntime } from '../runtime.js';

export function registerResolve(program: Command): void {
  program
    .command('resolve')
    .description('Resolve a venue name and state to a licensed venue record')
    .requiredOption('-n, --name <name>', 'trade name of the venue')
    .requiredOption('-s, --state <state>', 'two-letter state code')
    .option('-c, --city <city>', 'narrow to a city')
    .option('--include-inactive', 'include licences that are not currently active')
    .option('--json', 'emit JSON instead of a table')
    .option('-v, --verbose', 'log cache hits and requests')
    .action(async (opts: {
      name: string; state: string; city?: string;
      includeInactive?: boolean; json?: boolean; verbose?: boolean;
    }) => {
      const controller = new AbortController();
      const rt = makeRuntime(loadConfig({ verbose: opts.verbose === true }), controller.signal);

      const result = await resolve(rt.fetcherFor('resolver'), {
        name: opts.name,
        state: opts.state.toUpperCase() as StateCode,
        city: opts.city,
        ...(opts.includeInactive === true ? { includeInactive: true } : {}),
        appToken: rt.config.socrataAppToken,
      });

      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      switch (result.status) {
        case 'not_found':
          process.stdout.write(`\nNo match for "${result.searched}".\n${result.note}\n\n`);
          process.exitCode = 1;
          return;
        case 'resolved': {
          const v = result.venue;
          process.stdout.write(
            `\n✓ Resolved (score ${result.score.toFixed(2)})\n\n` +
            `  ${v.trade_name}\n` +
            `  ${v.address.line1}, ${v.address.city}, ${v.address.state} ${v.address.zip}\n` +
            `  licence ${v.license_type} ${v.license_id}   permit ${v.permit_number ?? '—'}\n` +
            (result.alternatives.length > 0
              ? `\n  ${result.alternatives.length} other candidate(s) considered; rerun with --json to see them.\n`
              : '') +
            '\n',
          );
          return;
        }
        case 'ambiguous': {
          process.stdout.write(
            `\n${result.candidates.length} plausible matches — none clearly best. Narrow with --city.\n\n`,
          );
          result.candidates.forEach((c, i) => {
            process.stdout.write(
              `  [${i + 1}] ${c.score.toFixed(2)}  ${c.venue.trade_name}\n` +
              `        ${c.venue.address.line1}, ${c.venue.address.city} ${c.venue.address.zip}\n` +
              `        ${c.signals.join(' · ')}\n\n`,
            );
          });
          process.exitCode = 2;
          return;
        }
      }
    });
}
