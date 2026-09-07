/**
 * Provenance-carrying values.
 *
 * Design rule #1: every field carries provenance. No value without a source, a
 * timestamp and a confidence. Underwriting on unattributed data is how you get
 * an E&O claim.
 *
 * The consequence is that `Field<T>` is the ONLY way a value enters a
 * RiskProfile. There is deliberately no path that produces a bare value.
 */

/** Where a value came from. One id per enricher, plus two synthetic sources. */
export type SourceId =
  | 'tabc_license'   // Texas TABC License Information (data.texas.gov 7hf9-qc9f)
  | 'tabc_receipts'  // Texas Mixed Beverage Gross Receipts (data.texas.gov naix-2893)
  | 'osm'            // OpenStreetMap via Overpass + Nominatim
  | 'web'            // the venue's own website / menu
  | 'derived'        // computed from other fields by the reducer
  | 'human';         // entered or corrected by a person

/** No source at all — we looked and found nothing, or never had a way to look. */
export type NoSource = 'none';

/**
 * How much weight the value carries. This drives precedence (see reduce/), so
 * the ordering here is load-bearing, not documentation.
 *
 *   record   an authoritative government or registry record. A licence, a tax
 *            filing. Someone signed their name to it under penalty of perjury.
 *   api      an official API's own assertion. Believable, but it is a
 *            third party describing the venue, not the venue on the record.
 *   derived  a deterministic function of other Fields. Must list `inputs`.
 *            Confidence is bounded by its weakest input.
 *   inferred an LLM or heuristic guess. Never authoritative, never used to
 *            adjudicate anything (design rule #4).
 */
export type Method = 'record' | 'api' | 'derived' | 'inferred';
export type NoMethod = 'none';

/**
 * Ranking of methods, strongest first.
 *
 * This is a second axis of precedence, independent of the source. A permit
 * number ASSEMBLED from licence fields and a permit number READ OFF a tax
 * filing may come from equally trustworthy publishers, but they are not
 * equally good evidence, and treating them as a tie would push a false
 * disagreement in front of a broker.
 *
 * `derived` outranks `inferred` because a derivation is a deterministic
 * function of fields that each carry their own provenance, whereas an inference
 * is a model's guess.
 */
export const METHOD_RANK: readonly Method[] = ['record', 'api', 'derived', 'inferred'] as const;

export function methodRank(m: Method | NoMethod): number {
  const i = METHOD_RANK.indexOf(m as Method);
  return i >= 0 ? i : METHOD_RANK.length;
}

/**
 * A dotted path into a RiskProfile, e.g. 'liquor_profile.late_hours_permit'.
 * Kept as a branded string rather than a generated union so that enrichers,
 * appetite YAML and the completeness engine can all refer to fields by name
 * without a build step. Validated against FIELD_REGISTRY at load time.
 */
export type FieldPath = string & { readonly __brand: 'FieldPath' };

export const path = (s: string): FieldPath => s as FieldPath;

/** A value that lost a precedence contest, kept so the decision is auditable. */
export type Superseded<T> = {
  value: T | null;
  source: SourceId;
  method: Method;
  confidence: number;
  as_of: string | null;
  /** Which rule beat it, in words. e.g. "tabc_license (record) outranks osm (api)" */
  reason: string;
};

/**
 * Precedence could not decide. Both candidates survive and the field is routed
 * to a human. Design rule #3: ties surface to the human, they are not resolved
 * by an LLM and they are not silently coin-flipped.
 */
export type Conflict<T> = {
  candidates: Array<{
    value: T | null;
    source: SourceId;
    method: Method;
    confidence: number;
    as_of: string | null;
    evidence_url?: string;
  }>;
  /** Why the tie could not be broken. */
  reason: string;
};

export type Field<T> = {
  /**
   * `null` means "we have no value". It never means "false" and never means
   * "zero". Never silently guess a field an underwriter prices on — a null
   * plus a question beats a confident wrong answer.
   */
  value: T | null;

  source: SourceId | NoSource;
  method: Method | NoMethod;

  /** 0..1. Always 0 when `value` is null. */
  confidence: number;

  /**
   * ISO date of the UNDERLYING RECORD — when the fact was true, not when we
   * learned it. A licence issued in 1987 has as_of 1987 even if fetched today.
   * This is the date an underwriter cares about.
   */
  as_of: string | null;

  /**
   * ISO datetime WE fetched it. Distinct from as_of: this is the date the
   * cache and the staleness timers care about. Conflating the two makes
   * staleness unauditable, which is why they are separate.
   */
  retrieved_at: string | null;

  /** Human-followable citation for the value. */
  evidence_url?: string;

  /**
   * Cache key of the raw payload this was extracted from. Lets `barback replay`
   * walk from any field in the output back to the exact bytes that produced it.
   */
  evidence_ref?: string;

  /** Required when method === 'derived'. The fields this was computed from. */
  inputs?: FieldPath[];

  /**
   * Enrichers that looked for this field and came back empty. Distinguishes
   * "nobody tried" from "three sources tried and none of them knew", which are
   * very different things to tell a broker.
   */
  attempted?: SourceId[];

  /** Values this one beat, and why. Makes design rule #3 visible, not claimed. */
  superseded?: Superseded<T>[];

  /** Set when precedence could not decide. Implies the field needs a human. */
  conflict?: Conflict<T>;

  notes?: string;
};

/** A field nobody has filled yet. The default state of every field in a profile. */
export function empty<T>(attempted: SourceId[] = []): Field<T> {
  return {
    value: null,
    source: 'none',
    method: 'none',
    confidence: 0,
    as_of: null,
    retrieved_at: null,
    ...(attempted.length > 0 ? { attempted } : {}),
  };
}

/** True when a field carries a usable value. */
export function isKnown<T>(f: Field<T>): f is Field<T> & { value: T } {
  return f.value !== null && f.conflict === undefined;
}

/** True when a human needs to look at this field before it can be trusted. */
export function needsHuman<T>(f: Field<T>, threshold = 0.6): boolean {
  if (f.conflict !== undefined) return true;
  if (f.value === null) return true;
  return f.confidence < threshold;
}

/**
 * What an enricher emits. Deliberately NOT a `Field<T>`: an enricher states
 * what it observed, the reducer decides what wins. An enricher that could
 * construct a finished Field could also overwrite another enricher's work,
 * which would make precedence unenforceable.
 */
export type FieldCandidate<T = unknown> = {
  path: FieldPath;
  value: T | null;
  source: SourceId;
  method: Method;
  confidence: number;
  as_of: string | null;
  retrieved_at: string;
  evidence_url?: string;
  evidence_ref?: string;
  inputs?: FieldPath[];
  notes?: string;
};
