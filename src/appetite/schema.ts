/**
 * YAML schema for a carrier appetite file.
 *
 * Every rule must carry a `source` and an `as_of`. That is not bureaucracy: a
 * published appetite is often stale the moment it is printed, carriers pull
 * capacity without notice, and a broker acting on a rule needs to know where it
 * came from and how old it is. A rule without a citation is folklore, and
 * folklore is what this project exists to replace.
 */
import { z } from 'zod';
import { path } from '../core/field.js';
import type { AppetiteRule, CarrierAppetite, Comparator, SubmissionRequirement } from './types.js';

const StateSchema = z.enum(['TX', 'CA']);

const RuleSchema = z.object({
  field: z.string().min(1),
  // Exactly one comparator key, expressed as its own field for readability in
  // YAML: `equals: true` reads better than `op: equals, value: true`.
  equals: z.unknown().optional(),
  not_equals: z.unknown().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  at_or_after: z.string().optional(),
  before: z.string().optional(),
  in: z.array(z.unknown()).optional(),
  not_in: z.array(z.unknown()).optional(),
  contains: z.unknown().optional(),
  exists: z.boolean().optional(),
  because: z.string().min(1),
  source: z.string().url().optional(),
  as_of: z.string().optional(),
});

export const CarrierFileSchema = z.object({
  carrier: z.string().min(1),
  program: z.string().min(1),
  label: z.string().min(1),
  states: z.array(StateSchema).min(1),
  classes: z.array(z.string()).min(1),
  hard_declines: z.array(RuleSchema).default([]),
  review_required: z.array(RuleSchema).default([]),
  credits: z.array(RuleSchema).default([]),
  requires_for_submission: z.array(z.object({
    field: z.string().min(1),
    because: z.string().min(1),
    source: z.string().url().optional(),
    as_of: z.string().optional(),
  })).default([]),
  limits: z.record(z.union([z.array(z.string()), z.string()])).optional(),
  source: z.string().url(),
  as_of: z.string(),
  basis: z.string().min(1),
  illustrative: z.boolean().default(false),
  notes: z.string().optional(),
});

export type CarrierFile = z.infer<typeof CarrierFileSchema>;
type RuleFile = z.infer<typeof RuleSchema>;

const COMPARATORS: Comparator[] = [
  'equals', 'not_equals', 'gt', 'gte', 'lt', 'lte',
  'at_or_after', 'before', 'in', 'not_in', 'contains', 'exists',
];

/** Turn one YAML rule into a typed rule, or explain why it cannot be. */
export function toRule(
  raw: RuleFile,
  carrier: string,
  kind: string,
  index: number,
  fileDefaults: { source: string; as_of: string },
): AppetiteRule {
  const present = COMPARATORS.filter((c) => raw[c] !== undefined);
  if (present.length === 0) {
    throw new Error(`${carrier}: ${kind}[${index}] on "${raw.field}" has no comparator`);
  }
  if (present.length > 1) {
    throw new Error(
      `${carrier}: ${kind}[${index}] on "${raw.field}" has ${present.length} comparators ` +
      `(${present.join(', ')}). One rule, one condition — split it.`,
    );
  }

  const op = present[0]!;
  return {
    id: `${carrier}.${kind}.${index}.${raw.field}`,
    field: path(raw.field),
    op,
    value: raw[op],
    because: raw.because,
    source: raw.source ?? fileDefaults.source,
    as_of: raw.as_of ?? fileDefaults.as_of,
  };
}

export function toCarrierAppetite(file: CarrierFile): CarrierAppetite {
  const defaults = { source: file.source, as_of: file.as_of };
  const convert = (rules: RuleFile[], kind: string): AppetiteRule[] =>
    rules.map((r, i) => toRule(r, file.carrier, kind, i, defaults));

  const requirements: SubmissionRequirement[] = file.requires_for_submission.map((r) => ({
    field: path(r.field),
    because: r.because,
    source: r.source ?? file.source,
    as_of: r.as_of ?? file.as_of,
  }));

  return {
    carrier: file.carrier,
    program: file.program,
    label: file.label,
    states: file.states,
    classes: file.classes,
    hard_declines: convert(file.hard_declines, 'hard_decline'),
    review_required: convert(file.review_required, 'review_required'),
    credits: convert(file.credits, 'credit'),
    requires_for_submission: requirements,
    ...(file.limits ? { limits: file.limits } : {}),
    source: file.source,
    as_of: file.as_of,
    basis: file.basis,
    illustrative: file.illustrative,
    ...(file.notes ? { notes: file.notes } : {}),
  };
}
