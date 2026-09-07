/**
 * The completeness engine.
 *
 * Given a profile and the carriers being targeted, produce the MINIMUM ordered
 * list of questions a human still needs to ask.
 *
 * This is the highest value-per-line component in the project, and the one most
 * likely to make a broker want it tomorrow — it does not replace the intake
 * call, it cuts it from forty-five minutes to eight and says exactly what to
 * ask, in the order that moves the placement furthest.
 *
 * Ordering is the whole product. The ranking below is a claim about what
 * actually moves a placement:
 *
 *   1. Submission requirements. An incomplete submission is the commonest
 *      reason an underwriter ignores a broker. Nothing else matters if the file
 *      cannot be reviewed at all.
 *   2. Unknowns on hard declines. One answer can remove a carrier from the list
 *      entirely — worth knowing before spending days of calendar time.
 *   3. Unknowns on referrals, then conflicts, then questions that unblock a
 *      derived field, then merely weak values.
 *
 * Cheap questions break ties, because a broker asking ten things in a row would
 * rather get the five-second ones out of the way.
 */
import type { CarrierAssessment } from '../appetite/types.js';
import type { Field, FieldPath, SourceId } from '../core/field.js';
import { path } from '../core/field.js';
import { ALL_FIELD_PATHS, getField, meta, TOTAL_ASK_SECONDS, type RiskProfile } from '../core/schema/index.js';
import type { CompletenessReport, Question, QuestionCause } from './types.js';

export * from './types.js';

/** Below this, a populated field is not solid enough to submit on. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

const WEIGHT: Record<QuestionCause['kind'], number> = {
  submission_requirement: 100,
  hard_decline_unknown: 80,
  review_unknown: 40,
  conflict: 35,
  unblocks_derived: 25,
  low_confidence: 15,
  structurally_unavailable: 3,
  not_found: 2,
};

export type CompletenessInput = {
  profile: RiskProfile;
  /** Assessments for the carriers being targeted. Drives most of the ranking. */
  assessments?: CarrierAssessment[];
  /** Every field the configured sources could in principle produce. */
  producible?: ReadonlySet<string>;
};

export function assessCompleteness(input: CompletenessInput): CompletenessReport {
  const assessments = input.assessments ?? [];
  const causes = new Map<string, QuestionCause[]>();

  const add = (p: FieldPath | string, cause: QuestionCause): void => {
    const key = String(p);
    const list = causes.get(key);
    if (list) list.push(cause);
    else causes.set(key, [cause]);
  };

  // 1 — carrier-driven causes.
  for (const a of assessments) {
    const tag = a.illustrative ? `${a.label}` : a.label;

    for (const req of a.missing_submission_requirements) {
      add(req.field, {
        kind: 'submission_requirement',
        detail: `${tag} will not review the submission without it: ${req.because}`,
        carriers: [a.carrier],
        weight: WEIGHT.submission_requirement,
      });
    }

    for (const o of a.outcomes) {
      if (o.status !== 'unknown') continue;
      if (o.kind === 'hard_decline') {
        add(o.rule.field, {
          kind: 'hard_decline_unknown',
          detail: `${tag} declines on this. Unknown, so eligibility cannot be confirmed: ${o.rule.because}`,
          carriers: [a.carrier],
          weight: WEIGHT.hard_decline_unknown,
        });
      } else if (o.kind === 'review_required') {
        add(o.rule.field, {
          kind: 'review_unknown',
          detail: `${tag} refers on this: ${o.rule.because}`,
          carriers: [a.carrier],
          weight: WEIGHT.review_unknown,
        });
      }
    }
  }

  // 2 — profile-driven causes.
  let conflicts = 0;
  let lowConfidence = 0;
  let populated = 0;
  const structurallyUnavailable: FieldPath[] = [];

  for (const p of ALL_FIELD_PATHS) {
    const f = getField(input.profile, p);
    if (!f) continue;
    const m = meta(p);

    if (f.conflict) {
      conflicts++;
      add(p, {
        kind: 'conflict',
        detail: f.conflict.reason,
        weight: WEIGHT.conflict,
      });
      continue;
    }

    if (f.value !== null) {
      populated++;
      if (f.confidence < LOW_CONFIDENCE_THRESHOLD) {
        lowConfidence++;
        add(p, {
          kind: 'low_confidence',
          detail:
            `Held at ${(f.confidence * 100).toFixed(0)}% confidence from ${f.source}` +
            `${f.method === 'inferred' ? ' (inferred, not recorded)' : ''} — confirm before submission.`,
          weight: WEIGHT.low_confidence,
        });
      }
      continue;
    }

    // Missing. Say WHY it is missing, which is different information.
    const cannotBeSourced = input.producible !== undefined && !input.producible.has(String(p));
    if (cannotBeSourced || m.human_only === true) {
      structurallyUnavailable.push(p);
      add(p, {
        kind: 'structurally_unavailable',
        detail: 'No public source can provide this. It has to come from the insured.',
        weight: WEIGHT.structurally_unavailable,
      });
    } else if (f.attempted && f.attempted.length > 0) {
      add(p, {
        kind: 'not_found',
        detail: `${f.attempted.join(', ')} looked and found nothing.`,
        weight: WEIGHT.not_found,
      });
    }
  }

  // 3 — questions that unblock a derived field. A blocked derivation names the
  // inputs it needed, so asking one of them completes two fields at once.
  const unblocks = new Map<string, FieldPath[]>();
  for (const p of ALL_FIELD_PATHS) {
    const f = getField(input.profile, p);
    if (!f || f.value !== null || f.method !== 'derived' || !f.inputs) continue;
    for (const dep of f.inputs) {
      const depField = getField(input.profile, dep);
      if (!depField || depField.value !== null) continue;
      const list = unblocks.get(String(dep));
      if (list) list.push(p);
      else unblocks.set(String(dep), [p]);
    }
  }
  for (const [dep, blocked] of unblocks) {
    add(dep, {
      kind: 'unblocks_derived',
      detail: `Answering this completes ${blocked.map((b) => meta(b).label).join(', ')}.`,
      weight: WEIGHT.unblocks_derived * blocked.length,
    });
  }

  // Assemble, rank, and count what did not make the list.
  const questions: Question[] = [];
  for (const [key, list] of causes) {
    const p = path(key);
    const m = meta(p);
    const f = getField(input.profile, p);
    const priority = list.reduce((n, c) => n + c.weight, 0);
    const blocked = unblocks.get(key);

    questions.push({
      path: p,
      label: m.label,
      ask: m.question,
      ask_seconds: m.ask_seconds,
      priority,
      causes: list.sort((a, b) => b.weight - a.weight),
      ...(f && f.value !== null
        ? { current: { value: f.value, source: f.source, confidence: f.confidence } }
        : {}),
      ...(blocked ? { unblocks: blocked } : {}),
    });
  }

  questions.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    // Same value: ask the quick one first.
    if (a.ask_seconds !== b.ask_seconds) return a.ask_seconds - b.ask_seconds;
    return a.path.localeCompare(b.path);
  });

  const askedSeconds = questions.reduce((n, q) => n + q.ask_seconds, 0);
  const missing = ALL_FIELD_PATHS.length - populated;

  return {
    carriers: assessments.map((a) => a.label),
    populated,
    total: ALL_FIELD_PATHS.length,
    conflicts,
    low_confidence: lowConfidence,
    structurally_unavailable: structurallyUnavailable,
    questions,
    not_worth_asking: Math.max(0, missing - questions.filter((q) => q.current === undefined).length),
    minutes: (() => {
      // Derive `saved` from the rounded pair so the three always reconcile.
      // Rounding each independently produced 34 + 1 = 35 vs a total of 35,
      // which reads as a bug to anyone checking the arithmetic.
      const total = Math.round(TOTAL_ASK_SECONDS / 60);
      const remaining = Math.round(askedSeconds / 60);
      return { saved: Math.max(0, total - remaining), remaining, total };
    })(),
  };
}

/** Every field the configured enrichers declare they can produce. */
export function producibleFields(
  enrichers: ReadonlyArray<{ produces: readonly FieldPath[] }>,
  derivedPaths: readonly FieldPath[] = [],
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const e of enrichers) for (const p of e.produces) out.add(String(p));
  for (const p of derivedPaths) out.add(String(p));
  return out;
}

export type { SourceId, Field };
