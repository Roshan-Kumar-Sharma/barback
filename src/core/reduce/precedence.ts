/**
 * Design rule #3: conflicts are resolved by explicit precedence, not by an LLM.
 * Ties surface to the human.
 *
 * The ordering is a claim about evidence quality, so it is stated once, here,
 * rather than scattered through enrichers:
 *
 *   human            a licensed broker corrected it. Ends the argument.
 *   government record a licence or a tax filing. Someone signed it.
 *   official API     a third party describing the venue. Believable.
 *   venue's own site  the venue describing itself. Motivated, but first-hand.
 *   inferred          a model's guess. Never wins anything.
 */
import { methodRank } from '../field.js';
import type { FieldCandidate, Field, SourceId, Superseded } from '../field.js';

/** Lower is stronger. */
export const SOURCE_RANK: Readonly<Record<SourceId, number>> = {
  human: 0,
  tabc_license: 1,
  tabc_receipts: 1,
  ca_abc: 1,
  health_austin: 1,
  osm: 2,
  web: 3,
  derived: 4,
};

export const SOURCE_LABEL: Readonly<Record<SourceId, string>> = {
  human: 'human correction',
  tabc_license: 'government record',
  tabc_receipts: 'government record',
  ca_abc: 'government record',
  health_austin: 'government record',
  osm: 'official API',
  web: "venue's own site",
  derived: 'derived',
};

/**
 * Per-path overrides.
 *
 * The default ordering is about evidence quality in general. A few fields have
 * a better answer for a specific reason, and those reasons belong in one
 * readable place rather than inside an enricher.
 */
export type PathRule = {
  /** Source order for this path, strongest first. Sources absent fall back to SOURCE_RANK. */
  order?: SourceId[];
  /** Numbers within this fraction of each other are not in conflict. */
  numeric_tolerance?: number;
  why: string;
};

export const PATH_RULES: Readonly<Record<string, PathRule>> = {
  // What time the doors actually shut is something an observer sees and a
  // permit does not record. The Late Hours Certificate answers a different
  // question and lives in its own field.
  'operations.latest_closing_time': {
    order: ['human', 'osm', 'web', 'tabc_license', 'tabc_receipts', 'derived'],
    why: "Observed hours beat permitted hours: a Late Hours Certificate says what a venue MAY do, not what it does.",
  },
  // Annual revenue figures move; a filing three months apart is not a conflict.
  'revenue.alcohol_on_premise_sales': {
    numeric_tolerance: 0.15,
    why: 'Alcohol receipts vary month to month; small differences between filing windows are not disagreements.',
  },
};

export type Decision<T> = {
  winner: FieldCandidate<T>;
  superseded: Superseded<T>[];
  conflict?: Field<T>['conflict'];
};

function rankOf(path: string, source: SourceId): number {
  const rule = PATH_RULES[path];
  if (rule?.order) {
    const i = rule.order.indexOf(source);
    if (i >= 0) return i;
    return rule.order.length + SOURCE_RANK[source];
  }
  return SOURCE_RANK[source];
}

function sameValue(path: string, a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    const tol = PATH_RULES[path]?.numeric_tolerance;
    if (tol !== undefined) {
      const scale = Math.max(Math.abs(a), Math.abs(b));
      return scale === 0 ? true : Math.abs(a - b) / scale <= tol;
    }
    return false;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Pick a winner among candidates for one field.
 *
 * Two candidates at the same rank with different values is a genuine
 * disagreement between equally trustworthy sources. We do not break that tie —
 * we hand it to a person, and say what each source claimed.
 */
export function decide<T>(path: string, candidates: FieldCandidate<T>[]): Decision<T> | null {
  const usable = candidates.filter((c) => c.value !== null);
  if (usable.length === 0) return null;

  // Two axes, in order: how trustworthy the publisher is, then how good the
  // evidence is. A record beats a derivation even from the same publisher.
  const sorted = [...usable].sort((a, b) => {
    const r = rankOf(path, a.source) - rankOf(path, b.source);
    if (r !== 0) return r;
    const m = methodRank(a.method) - methodRank(b.method);
    if (m !== 0) return m;
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    // Same standing throughout: prefer the more recent underlying record.
    return (b.as_of ?? '').localeCompare(a.as_of ?? '');
  });

  const winner = sorted[0]!;
  const winnerRank = rankOf(path, winner.source);
  const winnerMethod = methodRank(winner.method);

  // A conflict requires genuinely equal standing on BOTH axes. Anything else
  // has a defensible winner, and surfacing it as a tie would waste the one
  // scarce resource here: a broker's attention.
  const rivals = sorted
    .slice(1)
    .filter(
      (c) =>
        rankOf(path, c.source) === winnerRank &&
        methodRank(c.method) === winnerMethod &&
        !sameValue(path, c.value, winner.value),
    );

  const superseded: Superseded<T>[] = sorted.slice(1).map((c) => ({
    value: c.value,
    source: c.source,
    method: c.method,
    confidence: c.confidence,
    as_of: c.as_of,
    reason: sameValue(path, c.value, winner.value)
      ? 'agrees with the accepted value'
      : rankOf(path, c.source) === winnerRank
        ? `${winner.method} evidence outranks ${c.method} evidence from the same source tier`
        : `${winner.source} (${SOURCE_LABEL[winner.source]}) outranks ${c.source} (${SOURCE_LABEL[c.source]})`,
  }));

  if (rivals.length > 0) {
    return {
      winner,
      superseded,
      conflict: {
        candidates: [winner, ...rivals].map((c) => ({
          value: c.value,
          source: c.source,
          method: c.method,
          confidence: c.confidence,
          as_of: c.as_of,
          ...(c.evidence_url ? { evidence_url: c.evidence_url } : {}),
        })),
        reason:
          'Sources of equal standing disagree: ' +
          [winner, ...rivals]
            .map((c) => `${c.source} says ${JSON.stringify(c.value)}`)
            .join('; ') +
          (PATH_RULES[path] ? `. ${PATH_RULES[path]!.why}` : '') +
          '. Precedence cannot break this tie, so it needs a person.',
      },
    };
  }

  return { winner, superseded };
}
