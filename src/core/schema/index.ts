import { empty, type Field, type FieldPath } from '../field.js';
import { ALL_FIELD_PATHS } from './registry.js';
import { PROFILE_GROUPS, type RiskProfile } from './profile.js';

export * from './types.js';
export * from './profile.js';
export * from './registry.js';

/**
 * A profile where every field exists and every field is empty.
 *
 * Every field is always present. There is no "missing key" state, because
 * "we never looked" and "we looked and found nothing" are different answers to
 * a broker and both need somewhere to live (see Field.attempted).
 */
export function emptyProfile(): RiskProfile {
  const out: Record<string, Record<string, Field<unknown>>> = {};
  for (const g of PROFILE_GROUPS) out[g] = {};
  for (const p of ALL_FIELD_PATHS) {
    const [group, leaf] = p.split('.') as [string, string];
    out[group]![leaf] = empty();
  }
  return out as unknown as RiskProfile;
}

export function getField(profile: RiskProfile, p: FieldPath): Field<unknown> | undefined {
  const [group, leaf] = p.split('.') as [string, string?];
  if (leaf === undefined) return undefined;
  const g = (profile as unknown as Record<string, Record<string, Field<unknown>>>)[group];
  return g?.[leaf];
}

export function setField(profile: RiskProfile, p: FieldPath, f: Field<unknown>): void {
  const [group, leaf] = p.split('.') as [string, string?];
  if (leaf === undefined) throw new Error(`Malformed field path: ${p}`);
  const g = (profile as unknown as Record<string, Record<string, Field<unknown>>>)[group];
  if (!g) throw new Error(`Unknown group in field path: ${p}`);
  g[leaf] = f;
}

/** Walk every field in a profile, in registry order. */
export function* fields(profile: RiskProfile): Generator<[FieldPath, Field<unknown>]> {
  for (const p of ALL_FIELD_PATHS) {
    const f = getField(profile, p);
    if (f) yield [p, f];
  }
}
