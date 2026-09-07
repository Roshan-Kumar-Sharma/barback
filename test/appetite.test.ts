import { describe, expect, it } from 'vitest';
import { assessCarrier, assessMarkets, evaluateRule } from '../src/appetite/evaluate.ts';
import { CarrierFileSchema, toCarrierAppetite, toRule } from '../src/appetite/schema.ts';
import type { AppetiteRule, CarrierAppetite } from '../src/appetite/types.ts';
import { path, type FieldCandidate } from '../src/core/field.ts';
import { reduce } from '../src/core/reduce/index.ts';
import { derivationsFor } from '../src/enrichers/index.ts';

const NOW = new Date('2026-09-07T12:00:00.000Z');

const c = (p: string, value: unknown): FieldCandidate => ({
  path: path(p), value, source: 'tabc_license', method: 'record',
  confidence: 0.95, as_of: '2026-08-31', retrieved_at: NOW.toISOString(),
});

const profileOf = (candidates: FieldCandidate[]) =>
  reduce({ candidates, ranBy: [], now: NOW, derivations: derivationsFor('TX') }).profile;

const rule = (over: Partial<AppetiteRule> = {}): AppetiteRule => ({
  id: 'r1', field: path('entertainment.hookah_or_oxygen_inhalation'), op: 'equals', value: true,
  because: 'Hookah refers.', source: 'https://example.invalid/', as_of: '2026-09-01', ...over,
});

const carrier = (over: Partial<CarrierAppetite> = {}): CarrierAppetite => ({
  carrier: 'test', program: 'p', label: 'Test Program',
  states: ['TX'], classes: ['bar', 'nightclub', 'restaurant', 'tavern'],
  hard_declines: [], review_required: [], credits: [], requires_for_submission: [],
  source: 'https://example.invalid/', as_of: '2026-09-01',
  basis: 'test', illustrative: false, ...over,
});

describe('an unknown is never a pass', () => {
  it('reports unknown, not clear, when a decline field is null', () => {
    const o = evaluateRule(profileOf([]), rule(), 'hard_decline');
    expect(o.status).toBe('unknown');
    expect(o.explanation).toContain('Unknown');
  });

  it('refuses to call a carrier eligible while a decline rule is unknown', () => {
    const a = assessCarrier(
      profileOf([c('identity.license_type', 'MB')]),
      carrier({ hard_declines: [rule()] }),
      'bar',
    );
    expect(a.verdict).toBe('needs_review');
    expect(a.blocked_by_unknowns).toContain('entertainment.hookah_or_oxygen_inhalation');
  });

  it('is eligible only when every rule is definitively clear', () => {
    const a = assessCarrier(
      profileOf([c('entertainment.hookah_or_oxygen_inhalation', false)]),
      carrier({ hard_declines: [rule()] }),
      'bar',
    );
    expect(a.verdict).toBe('eligible');
    expect(a.blocked_by_unknowns).toHaveLength(0);
  });
});

describe('verdicts', () => {
  it('a fired hard decline outranks everything', () => {
    const a = assessCarrier(
      profileOf([
        c('entertainment.hookah_or_oxygen_inhalation', true),
        c('security_controls.id_scanner_all_patrons', true),
      ]),
      carrier({
        hard_declines: [rule()],
        credits: [rule({ id: 'cr', field: path('security_controls.id_scanner_all_patrons'), because: 'ID scanner credit.' })],
      }),
      'bar',
    );
    expect(a.verdict).toBe('hard_decline');
    expect(a.reasons.some((r) => r.startsWith('❌'))).toBe(true);
  });

  it('names the rule that fired, in a broker-readable line', () => {
    const a = assessCarrier(
      profileOf([c('entertainment.hookah_or_oxygen_inhalation', true)]),
      carrier({ hard_declines: [rule()] }),
      'bar',
    );
    expect(a.reasons.join(' ')).toContain('Hookah refers.');
  });

  it('surfaces credits without changing the verdict', () => {
    const a = assessCarrier(
      profileOf([c('security_controls.id_scanner_all_patrons', true)]),
      carrier({ credits: [rule({ field: path('security_controls.id_scanner_all_patrons'), because: 'Scanner credit.' })] }),
      'bar',
    );
    expect(a.verdict).toBe('eligible');
    expect(a.reasons.join(' ')).toContain('Scanner credit.');
  });
});

describe('comparators', () => {
  it('treats 02:00 as later than 23:00 for a closing-time rule', () => {
    const late = evaluateRule(
      profileOf([c('operations.latest_closing_time', '02:00')]),
      rule({ field: path('operations.latest_closing_time'), op: 'at_or_after', value: '02:00' }),
      'review_required',
    );
    expect(late.status).toBe('fired');

    const early = evaluateRule(
      profileOf([c('operations.latest_closing_time', '23:00')]),
      rule({ field: path('operations.latest_closing_time'), op: 'at_or_after', value: '02:00' }),
      'review_required',
    );
    expect(early.status).toBe('clear');
  });

  it('matches an activity field against a plain boolean', () => {
    // Entertainment fields are {present, per_week}; carrier files should not
    // have to know that.
    const o = evaluateRule(
      profileOf([c('entertainment.dj_with_dancing', { present: true, per_week: 2 })]),
      rule({ field: path('entertainment.dj_with_dancing'), op: 'equals', value: true }),
      'review_required',
    );
    expect(o.status).toBe('fired');
  });

  it('handles numeric thresholds', () => {
    const o = evaluateRule(
      profileOf([c('revenue.cover_charge_sales', 689_501)]),
      rule({ field: path('revenue.cover_charge_sales'), op: 'gt', value: 250_000 }),
      'review_required',
    );
    expect(o.status).toBe('fired');
  });
});

describe('footprint', () => {
  it('excludes a carrier that does not write the state', () => {
    const s = assessMarkets({
      profile: profileOf([]), state: 'CA', carriers: [carrier({ states: ['TX'] })],
    });
    expect(s.assessments).toHaveLength(0);
    expect(s.out_of_footprint[0]?.reason).toContain('Does not write CA');
  });

  it('excludes a carrier that does not write the class', () => {
    const s = assessMarkets({
      profile: profileOf([
        c('identity.license_type', 'MB'),
        c('liquor_profile.food_beverage_certificate', false),
        c('liquor_profile.late_hours_permit', true),
      ]),
      state: 'TX',
      carriers: [carrier({ classes: ['restaurant'] })],
    });
    expect(s.assessments).toHaveLength(0);
    expect(s.out_of_footprint[0]?.reason).toContain('Does not write class');
  });

  it('keeps a carrier in play when the class is unknown', () => {
    // Excluding on an unknown would silently shrink the market list for the
    // venues we know least about, which is backwards.
    const s = assessMarkets({ profile: profileOf([]), state: 'TX', carriers: [carrier()] });
    expect(s.assessments).toHaveLength(1);
    expect(s.assessments[0]?.reasons.join(' ')).toContain('class not yet established');
  });

  it('ranks eligible above needs_review above hard_decline', () => {
    const s = assessMarkets({
      profile: profileOf([c('entertainment.hookah_or_oxygen_inhalation', true)]),
      state: 'TX',
      carriers: [
        carrier({ carrier: 'declines', label: 'Declines', hard_declines: [rule()] }),
        carrier({ carrier: 'clean', label: 'Clean' }),
        carrier({ carrier: 'refers', label: 'Refers', review_required: [rule()] }),
      ],
    });
    expect(s.assessments.map((a) => a.carrier)).toEqual(['clean', 'refers', 'declines']);
  });
});

describe('carrier file schema', () => {
  const base = {
    carrier: 'x', program: 'p', label: 'X', states: ['TX'], classes: ['bar'],
    source: 'https://example.invalid/', as_of: '2026-09-01', basis: 'test',
  };

  it('rejects a rule with no comparator', () => {
    expect(() => toRule({ field: 'a.b', because: 'why' } as never, 'x', 'hard_decline', 0,
      { source: 's', as_of: 'd' })).toThrow(/no comparator/);
  });

  it('rejects a rule with two comparators', () => {
    expect(() => toRule({ field: 'a.b', because: 'why', equals: true, gt: 1 } as never, 'x', 'hard_decline', 0,
      { source: 's', as_of: 'd' })).toThrow(/One rule, one condition/);
  });

  it('inherits source and as_of from the file when a rule omits them', () => {
    const file = CarrierFileSchema.parse({
      ...base,
      hard_declines: [{ field: 'entertainment.mosh_pits', equals: true, because: 'no' }],
    });
    const appetite = toCarrierAppetite(file);
    expect(appetite.hard_declines[0]?.source).toBe('https://example.invalid/');
    expect(appetite.hard_declines[0]?.as_of).toBe('2026-09-01');
  });

  it('requires a citation on the file', () => {
    expect(CarrierFileSchema.safeParse({ ...base, source: undefined }).success).toBe(false);
  });

  it('requires a stated basis, so a marketing page is not mistaken for an appetite guide', () => {
    expect(CarrierFileSchema.safeParse({ ...base, basis: undefined }).success).toBe(false);
  });

  it('defaults illustrative to false', () => {
    expect(toCarrierAppetite(CarrierFileSchema.parse(base)).illustrative).toBe(false);
  });
});
