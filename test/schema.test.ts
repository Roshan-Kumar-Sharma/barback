import { describe, expect, it } from 'vitest';
import { ALL_FIELD_PATHS, emptyProfile, fields, FIELD_REGISTRY, getField, PROFILE_GROUPS } from '../src/core/schema/index.js';
import { enrichersFor } from '../src/enrichers/index.js';

describe('field registry and RiskProfile stay in sync', () => {
  it('every registry path exists on a profile', () => {
    const profile = emptyProfile();
    for (const p of ALL_FIELD_PATHS) {
      expect(getField(profile, p), `registry declares ${p} but the profile has no such field`).toBeDefined();
    }
  });

  it('every profile field is in the registry', () => {
    const profile = emptyProfile() as unknown as Record<string, Record<string, unknown>>;
    for (const group of PROFILE_GROUPS) {
      for (const leaf of Object.keys(profile[group] ?? {})) {
        expect(
          FIELD_REGISTRY.has(`${group}.${leaf}` as never),
          `profile has ${group}.${leaf} but the registry does not describe it`,
        ).toBe(true);
      }
    }
  });

  it('a fresh profile is entirely empty', () => {
    for (const [, f] of fields(emptyProfile())) {
      expect(f.value).toBeNull();
      expect(f.confidence).toBe(0);
    }
  });

  it('every question is a question and every estimate is positive', () => {
    for (const m of FIELD_REGISTRY.values()) {
      expect(m.question.endsWith('?'), `${m.path} question does not read as a question`).toBe(true);
      expect(m.ask_seconds).toBeGreaterThan(0);
      expect(m.label.length).toBeGreaterThan(0);
    }
  });
});

describe('enrichers declare real fields', () => {
  it('every path an enricher claims to produce exists in the schema', () => {
    for (const e of enrichersFor('TX')) {
      for (const p of e.produces) {
        expect(FIELD_REGISTRY.has(p), `${e.id} declares ${p}, which is not a schema field`).toBe(true);
      }
    }
  });

  it('every enricher attributes its data source', () => {
    for (const e of enrichersFor('TX')) {
      expect(e.attribution.url).toMatch(/^https:\/\//);
      expect(e.attribution.license.length).toBeGreaterThan(0);
    }
  });
});
