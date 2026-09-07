#!/usr/bin/env node
import { Command } from 'commander';
import { registerQuote } from './commands/quote.js';
import { registerResolve } from './commands/resolve.js';

const program = new Command();

program
  .name('barback')
  .description(
    'Risk intake and carrier appetite matching for restaurant & bar insurance.\n' +
    'Not insurance advice. Output is a draft for a licensed producer to verify.',
  )
  .version('0.1.0');

registerResolve(program);
registerQuote(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`\nbarback: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
