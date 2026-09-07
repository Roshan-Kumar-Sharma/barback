/**
 * Types crossing the workflow/activity boundary.
 *
 * Everything here must be plain JSON: it is serialised into Temporal's event
 * history and replayed on every worker restart. That constraint is why the
 * workflow receives enricher SPECS rather than enricher instances — the
 * scheduling logic needs `requires` and `produces`, not the classes, and
 * keeping classes out of the workflow bundle keeps the workflow deterministic
 * and free of Node APIs.
 */
import type { FieldCandidate, FieldPath, SourceId } from '../../core/field.js';
import type { StateCode, Venue } from '../../core/venue.js';
import type { StepResult } from '../port.js';

export const TASK_QUEUE = 'barback-enrichment';

export type EnricherSpec = {
  id: SourceId;
  requires: string[];
  produces: FieldPath[];
};

export type EnrichmentInput = {
  venue: Venue;
  state: StateCode;
  specs: EnricherSpec[];
  concurrency: number;
};

export type RunEnricherInput = {
  enricherId: SourceId;
  state: StateCode;
  venue: Venue;
};

export type RunEnricherOutput = {
  fields: FieldCandidate[];
  venue_patch?: Partial<Venue>;
  cost_usd: number;
  tokens?: number;
};

export type EnrichmentOutput = {
  venue: Venue;
  candidates: FieldCandidate[];
  ran_by: Array<{ id: SourceId; produces: readonly FieldPath[] }>;
  steps: StepResult[];
};
