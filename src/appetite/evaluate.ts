/**
 * The appetite rule engine.
 *
 * Deterministic, auditable, and explicit about what it does not know. Every
 * verdict names the rules that produced it and cites where each came from.
 *
 * The load-bearing decision is how UNKNOWNS are handled. A rule whose field is
 * null is reported as `unknown`, never as `clear` — so a venue cannot be called
 * eligible on the strength of information nobody has. In practice that turns
 * appetite matching into a question generator, which is precisely what a broker
 * wants: not "yes", but "yes, once you confirm these three things".
 */
import { isAtOrAfter, isBefore } from '../core/time.js';
import { getField, type RiskProfile } from '../core/schema/index.js';
import type { FieldPath } from '../core/field.js';
import type { StateCode } from '../core/venue.js';
import type {
  AppetiteRule, CarrierAppetite, CarrierAssessment, MarketShortlist, RuleKind, RuleOutcome,
  SubmissionRequirement, Verdict,
} from './types.js';

export type EvaluateInput = {
  profile: RiskProfile;
  state: StateCode;
  carriers: CarrierAppetite[];
};

export function assessMarkets(input: EvaluateInput): MarketShortlist {
  const assessments: CarrierAssessment[] = [];
  const outOfFootprint: MarketShortlist['out_of_footprint'] = [];

  const venueClass = getField(input.profile, 'operations.venue_class' as FieldPath)?.value as string | null;

  for (const carrier of input.carriers) {
    if (!carrier.states.includes(input.state)) {
      outOfFootprint.push({
        carrier: carrier.carrier,
        label: carrier.label,
        reason: `Does not write ${input.state} (writes ${carrier.states.join(', ')}).`,
      });
      continue;
    }
    // An unknown class is not an exclusion — it is a question. Excluding here
    // would silently shrink the market list for the venues we know least about,
    // which is backwards.
    if (venueClass !== null && !carrier.classes.includes(venueClass)) {
      outOfFootprint.push({
        carrier: carrier.carrier,
        label: carrier.label,
        reason: `Does not write class "${venueClass}" (writes ${carrier.classes.join(', ')}).`,
      });
      continue;
    }
    assessments.push(assessCarrier(input.profile, carrier, venueClass));
  }

  assessments.sort(byVerdictThenCertainty);
  return { assessments, out_of_footprint: outOfFootprint };
}

const VERDICT_ORDER: Record<Verdict, number> = { eligible: 0, needs_review: 1, hard_decline: 2 };

function byVerdictThenCertainty(a: CarrierAssessment, b: CarrierAssessment): number {
  const v = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict];
  if (v !== 0) return v;
  // Within a verdict, prefer the carrier we know most about — fewer open
  // questions means a submission that can actually go out today.
  return a.blocked_by_unknowns.length - b.blocked_by_unknowns.length;
}

export function assessCarrier(
  profile: RiskProfile,
  carrier: CarrierAppetite,
  venueClass: string | null,
): CarrierAssessment {
  const outcomes: RuleOutcome[] = [
    ...carrier.hard_declines.map((r) => evaluateRule(profile, r, 'hard_decline')),
    ...carrier.review_required.map((r) => evaluateRule(profile, r, 'review_required')),
    ...carrier.credits.map((r) => evaluateRule(profile, r, 'credit')),
  ];

  const declined = outcomes.filter((o) => o.kind === 'hard_decline' && o.status === 'fired');
  const reviews = outcomes.filter((o) => o.kind === 'review_required' && o.status === 'fired');
  const credits = outcomes.filter((o) => o.kind === 'credit' && o.status === 'fired');

  // Unknowns on decline and review rules are what stop an "eligible".
  const unknowns = outcomes.filter((o) => o.kind !== 'credit' && o.status === 'unknown');
  const blocked = [...new Set(unknowns.map((o) => o.rule.field))];

  let verdict: Verdict;
  if (declined.length > 0) verdict = 'hard_decline';
  else if (reviews.length > 0 || unknowns.length > 0) verdict = 'needs_review';
  else verdict = 'eligible';

  const missingRequirements: SubmissionRequirement[] = carrier.requires_for_submission.filter(
    (r) => (getField(profile, r.field)?.value ?? null) === null,
  );

  const reasons: string[] = [];
  if (venueClass === null) {
    reasons.push('? Operating class not yet established — class eligibility unconfirmed.');
  } else {
    reasons.push(`✅ Class "${venueClass}" is written by this program.`);
  }
  for (const o of declined) reasons.push(`❌ ${o.explanation}`);
  for (const o of reviews) reasons.push(`⚠️ ${o.explanation}`);
  for (const o of unknowns) reasons.push(`? ${o.explanation}`);
  for (const o of credits) reasons.push(`✅ ${o.explanation}`);
  if (declined.length === 0 && reviews.length === 0 && unknowns.length === 0) {
    reasons.push('✅ No declines or referrals triggered by what is known.');
  }

  if (missingRequirements.length > 0) {
    reasons.push(
      `📋 Submission incomplete: ${missingRequirements.length} required item(s) still needed.`,
    );
  }

  return {
    carrier: carrier.carrier,
    program: carrier.program,
    label: carrier.label,
    verdict,
    missing_submission_requirements: missingRequirements,
    blocked_by_unknowns: blocked,
    outcomes,
    reasons,
    source: carrier.source,
    as_of: carrier.as_of,
    basis: carrier.basis,
    illustrative: carrier.illustrative,
  };
}

export function evaluateRule(profile: RiskProfile, rule: AppetiteRule, kind: RuleKind): RuleOutcome {
  const field = getField(profile, rule.field);
  const actual = field?.value ?? null;

  if (rule.op === 'exists') {
    const has = actual !== null;
    const want = rule.value === true;
    return {
      rule, kind,
      status: has === want ? 'fired' : 'clear',
      actual,
      explanation: has === want ? rule.because : `${rule.because} — not applicable`,
    };
  }

  if (actual === null) {
    return {
      rule, kind, status: 'unknown', actual: null,
      explanation: `Unknown: ${describeCondition(rule)} — ${rule.because}`,
    };
  }

  const fired = compare(actual, rule);
  return {
    rule, kind,
    status: fired ? 'fired' : 'clear',
    actual,
    explanation: fired
      ? `${rule.because} (${describeValue(actual)})`
      : `${rule.because} — does not apply (${describeValue(actual)})`,
  };
}

function compare(actual: unknown, rule: AppetiteRule): boolean {
  const expected = rule.value;
  switch (rule.op) {
    case 'equals': return deepEqual(actual, expected);
    case 'not_equals': return !deepEqual(actual, expected);
    case 'gt': return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte': return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lt': return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte': return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'at_or_after':
      return typeof actual === 'string' && typeof expected === 'string' && isAtOrAfter(actual, expected);
    case 'before':
      return typeof actual === 'string' && typeof expected === 'string' && isBefore(actual, expected);
    case 'in': return Array.isArray(expected) && expected.some((e) => deepEqual(actual, e));
    case 'not_in': return Array.isArray(expected) && !expected.some((e) => deepEqual(actual, e));
    case 'contains': return Array.isArray(actual) && actual.some((a) => deepEqual(a, expected));
    case 'exists': return actual !== null;
  }
}

/**
 * Activity fields are `{present, per_week}`, and a rule written as
 * `equals: true` means "is it happening at all". Comparing the object to a
 * boolean would silently never fire, so the presence flag is unwrapped here
 * rather than requiring every carrier file to know the internal shape.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a !== null && typeof a === 'object' && 'present' in (a as object) && typeof b === 'boolean') {
    return (a as { present: boolean }).present === b;
  }
  if (a === b) return true;
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function describeCondition(rule: AppetiteRule): string {
  const readable: Record<string, string> = {
    equals: 'is', not_equals: 'is not', gt: 'is over', gte: 'is at least',
    lt: 'is under', lte: 'is at most', at_or_after: 'is at or after',
    before: 'is before', in: 'is one of', not_in: 'is not one of',
    contains: 'includes', exists: 'is known',
  };
  return `whether ${rule.field} ${readable[rule.op] ?? rule.op} ${describeValue(rule.value)}`;
}

function describeValue(v: unknown): string {
  if (v === null || v === undefined) return 'unknown';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return v.toLocaleString('en-US');
  if (Array.isArray(v)) return v.map(describeValue).join(', ');
  if (typeof v === 'object' && 'present' in (v as object)) {
    const a = v as { present: boolean; per_week: number | null };
    return a.present ? (a.per_week ? `yes, ${a.per_week}×/week` : 'yes') : 'no';
  }
  return String(v);
}
