import type { Enricher } from '../core/enricher.js';
import { CORE_DERIVATIONS, type Derivation } from '../core/reduce/derived.js';
import type { StateCode } from '../core/venue.js';
import { TabcLicenseEnricher } from './tabc/license.js';
import { TabcReceiptsEnricher } from './tabc/receipts.js';

import { LlmClient } from '../llm/client.js';
import { CaAbcEnricher } from './ca_abc/license.js';
import { AustinHealthEnricher } from './health_austin/index.js';
import { OsmEnricher } from './osm/index.js';
import { WebEnricher } from './web/index.js';
import { CA_DERIVATIONS } from './ca_abc/derivations.js';
import { TX_DERIVATIONS } from './tabc/derivations.js';

export { TabcLicenseEnricher } from './tabc/license.js';
export { TabcReceiptsEnricher } from './tabc/receipts.js';
export { OsmEnricher } from './osm/index.js';
export { CaAbcEnricher } from './ca_abc/license.js';
export { AustinHealthEnricher } from './health_austin/index.js';
export { WebEnricher } from './web/index.js';
export * from './tabc/codes.js';

export type EnricherOptions = {
  socrataAppToken?: string | undefined;
  /** Omit to run without site reading; the web enricher then contributes nothing. */
  llm?: LlmClient | undefined;
};

/**
 * Sources available for a state.
 *
 * Adding a source means adding it here and nowhere else — the orchestrator
 * schedules on declared requirements, the reducer folds on declared paths, and
 * the completeness engine reads `produces` to work out what is structurally
 * unavailable. See docs/ADDING-A-SOURCE.md.
 */
export function enrichersFor(state: StateCode, opts: EnricherOptions = {}): Enricher[] {
  switch (state) {
    case 'TX':
      return [
        new TabcLicenseEnricher(opts.socrataAppToken),
        new TabcReceiptsEnricher(opts.socrataAppToken),
        new OsmEnricher(),
        new AustinHealthEnricher(),
        ...(opts.llm ? [new WebEnricher(opts.llm)] : []),
      ];
    case 'CA':
      return [
        new CaAbcEnricher(),
        new OsmEnricher(),
        ...(opts.llm ? [new WebEnricher(opts.llm)] : []),
      ];
    default: {
      const never: never = state;
      throw new Error(`Unsupported state: ${String(never)}`);
    }
  }
}

/**
 * Ordered derivations for a state: the state's own first, then the generic
 * ones, which may depend on what the state-specific ones produced.
 */
export function derivationsFor(state: StateCode): readonly Derivation[] {
  switch (state) {
    case 'TX':
      return [...TX_DERIVATIONS, ...CORE_DERIVATIONS];
    case 'CA':
      return [...CA_DERIVATIONS, ...CORE_DERIVATIONS];
    default: {
      const never: never = state;
      throw new Error(`Unsupported state: ${String(never)}`);
    }
  }
}
