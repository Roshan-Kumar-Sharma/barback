/**
 * Carrier appetite as auditable rules.
 *
 * Design rule #4: rules decide eligibility; models only read. An appetite
 * verdict is a legal-adjacent judgement that a broker will act on, so it is
 * produced by deterministic rules that state which one fired and cite where it
 * came from. An LLM is not permitted anywhere in this path.
 *
 * The other principle here is that **an unknown is not a pass.** If a carrier
 * hard-declines venues with adult entertainment and we do not know whether this
 * venue has it, the answer is "we need to ask", never "eligible". Treating
 * silence as compliance is how a submission gets declined after a week of
 * calendar time — or worse, how a risk gets placed that the carrier never
 * wanted.
 */
import type { FieldPath } from '../core/field.js';
import type { StateCode } from '../core/venue.js';

export type Comparator =
  | 'equals' | 'not_equals'
  | 'gt' | 'gte' | 'lt' | 'lte'
  /** Time-of-day comparison on a 30-hour clock, so 02:00 is after 23:00. */
  | 'at_or_after' | 'before'
  | 'in' | 'not_in'
  /** Array field contains the value. */
  | 'contains'
  /** Field has any non-null value. */
  | 'exists';

export type RuleKind = 'hard_decline' | 'review_required' | 'credit';

export type AppetiteRule = {
  /** Stable id, so a verdict can name the exact rule that fired. */
  id: string;
  field: FieldPath;
  op: Comparator;
  value?: unknown;
  /** Why this rule exists, in an underwriter's terms. */
  because: string;
  /** Citation. Required on every rule — see README on appetite being BYO. */
  source: string;
  as_of: string;
};

/**
 * A field the carrier requires before it will look at a submission.
 *
 * Distinct from an appetite rule: this does not change eligibility, it decides
 * whether the submission is even reviewable. Incomplete submissions are the
 * commonest reason an underwriter ignores a broker, so these outrank everything
 * else in the completeness engine's question ordering.
 */
export type SubmissionRequirement = {
  field: FieldPath;
  because: string;
  source: string;
  as_of: string;
};

export type CarrierAppetite = {
  carrier: string;
  program: string;
  /** Display name for output. */
  label: string;
  states: StateCode[];
  classes: string[];
  hard_declines: AppetiteRule[];
  review_required: AppetiteRule[];
  credits: AppetiteRule[];
  requires_for_submission: SubmissionRequirement[];
  limits?: Record<string, string[] | string>;
  source: string;
  as_of: string;
  /**
   * What this file is actually based on. Public program pages are not appetite
   * guides, and saying so is the difference between a useful seed set and a
   * misleading one.
   */
  basis: string;
  /**
   * True when the file demonstrates the format rather than describing a real
   * carrier. Illustrative files are excluded by default and labelled loudly
   * wherever they appear, so nobody can mistake one for real appetite.
   */
  illustrative: boolean;
  notes?: string;
};

export type Verdict = 'eligible' | 'needs_review' | 'hard_decline';

export type RuleOutcome = {
  rule: AppetiteRule;
  kind: RuleKind;
  /**
   * 'fired'   the condition is met
   * 'clear'   the condition is definitively not met
   * 'unknown' the field is null, so we cannot say — never treated as clear
   */
  status: 'fired' | 'clear' | 'unknown';
  actual: unknown;
  /** One line, written for a broker to read aloud. */
  explanation: string;
};

export type CarrierAssessment = {
  carrier: string;
  program: string;
  label: string;
  verdict: Verdict;
  /** Present only when the verdict is limited by missing information. */
  blocked_by_unknowns: FieldPath[];
  outcomes: RuleOutcome[];
  /** Ordered, human-readable reasons. */
  reasons: string[];
  /** Required submission fields this profile is still missing. */
  missing_submission_requirements: SubmissionRequirement[];
  source: string;
  as_of: string;
  basis: string;
  illustrative: boolean;
};

export type MarketShortlist = {
  assessments: CarrierAssessment[];
  /** Carriers excluded before rules ran, e.g. wrong state. */
  out_of_footprint: Array<{ carrier: string; label: string; reason: string }>;
};
