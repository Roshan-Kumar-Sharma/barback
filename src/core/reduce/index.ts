/**
 * Fold enricher output into a RiskProfile.
 *
 * Two phases, deliberately separate:
 *   1. Precedence — resolve competing claims about the same field.
 *   2. Derivation — compute fields no single source could see.
 *
 * Keeping them apart matters: a derivation must never beat a record. Running
 * derivations only against fields still empty after precedence makes that a
 * structural property rather than a rule someone has to remember.
 */
import { empty, path, type Field, type FieldCandidate, type FieldPath, type SourceId } from '../field.js';
import { ALL_FIELD_PATHS, emptyProfile, getField, setField, type RiskProfile } from '../schema/index.js';
import { CORE_DERIVATIONS, type Derivation } from './derived.js';
import { decide } from './precedence.js';

export * from './precedence.js';
export * from './derived.js';

export type ReduceInput = {
  candidates: FieldCandidate[];
  /**
   * What each enricher that actually ran declared it can produce. Used to fill
   * `attempted`, which is what separates "nobody looked" from "three sources
   * looked and none of them knew" — different answers for a broker.
   */
  ranBy: Array<{ id: SourceId; produces: readonly FieldPath[] }>;
  now: Date;
  /**
   * Ordered derivations. State-specific ones come first so that generic ones
   * (NAICS from operating class) can read what they produced. Defaults to the
   * core set alone.
   */
  derivations?: readonly Derivation[];
};

export type ReduceStats = {
  populated: number;
  conflicts: number;
  derived: number;
  /** Fields an enricher looked for and did not find. */
  attempted_empty: number;
  total: number;
};

export function reduce(input: ReduceInput): { profile: RiskProfile; stats: ReduceStats } {
  const profile = emptyProfile();

  const byPath = new Map<string, FieldCandidate[]>();
  for (const c of input.candidates) {
    const list = byPath.get(c.path);
    if (list) list.push(c);
    else byPath.set(c.path, [c]);
  }

  // Which sources looked for each path, whether or not they found anything.
  const lookedFor = new Map<string, SourceId[]>();
  for (const e of input.ranBy) {
    for (const p of e.produces) {
      const list = lookedFor.get(p);
      if (list) list.push(e.id);
      else lookedFor.set(p, [e.id]);
    }
  }

  let conflicts = 0;

  // Phase 1 — precedence.
  for (const p of ALL_FIELD_PATHS) {
    const candidates = byPath.get(p) ?? [];
    const decision = decide(p, candidates);

    if (!decision) {
      const attempted = lookedFor.get(p);
      if (attempted && attempted.length > 0) setField(profile, p, empty(dedupe(attempted)));
      continue;
    }

    const w = decision.winner;
    const field: Field<unknown> = {
      value: w.value,
      source: w.source,
      method: w.method,
      confidence: w.confidence,
      as_of: w.as_of,
      retrieved_at: w.retrieved_at,
      ...(w.evidence_url ? { evidence_url: w.evidence_url } : {}),
      ...(w.evidence_ref ? { evidence_ref: w.evidence_ref } : {}),
      ...(w.inputs ? { inputs: w.inputs } : {}),
      ...(w.notes ? { notes: w.notes } : {}),
      ...(decision.superseded.length > 0 ? { superseded: decision.superseded } : {}),
      ...(decision.conflict ? { conflict: decision.conflict } : {}),
    };
    if (decision.conflict) conflicts++;
    setField(profile, p, field);
  }

  // Phase 2 — derivation. Only fills what precedence left empty, so a derived
  // value can never displace a record.
  let derived = 0;
  for (const d of input.derivations ?? CORE_DERIVATIONS) {
    const existing = getField(profile, d.path);
    if (existing && existing.value !== null) continue;

    const c = d.derive(profile, { now: input.now });
    if (!c) continue;

    setField(profile, d.path, {
      value: c.value,
      source: c.source,
      method: c.method,
      confidence: c.confidence,
      as_of: c.as_of,
      retrieved_at: c.retrieved_at,
      ...(c.evidence_url ? { evidence_url: c.evidence_url } : {}),
      ...(c.inputs ? { inputs: c.inputs } : {}),
      ...(c.notes ? { notes: c.notes } : {}),
      ...(existing?.attempted ? { attempted: existing.attempted } : {}),
    });
    if (c.value !== null) derived++;
  }

  let populated = 0;
  let attemptedEmpty = 0;
  for (const p of ALL_FIELD_PATHS) {
    const f = getField(profile, p);
    if (!f) continue;
    if (f.value !== null) populated++;
    else if (f.attempted && f.attempted.length > 0) attemptedEmpty++;
  }

  return {
    profile,
    stats: {
      populated,
      conflicts,
      derived,
      attempted_empty: attemptedEmpty,
      total: ALL_FIELD_PATHS.length,
    },
  };
}

const dedupe = <T>(xs: T[]): T[] => [...new Set(xs)];

/** Every path an enricher emitted that the schema does not define. Guards typos. */
export function unknownPaths(candidates: FieldCandidate[]): FieldPath[] {
  const known = new Set<string>(ALL_FIELD_PATHS);
  return dedupe(candidates.map((c) => c.path).filter((p) => !known.has(p))).map(path);
}
