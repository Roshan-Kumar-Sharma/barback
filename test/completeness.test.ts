import { describe, expect, it } from 'vitest';
import { assessCarrier } from '../src/appetite/evaluate.ts';
import type { CarrierAppetite } from '../src/appetite/types.ts';
import { assessCompleteness, producibleFields } from '../src/completeness/index.ts';
import { path, type FieldCandidate } from '../src/core/field.ts';
import { reduce } from '../src/core/reduce/index.ts';
import { derivationsFor, enrichersFor } from '../src/enrichers/index.ts';

const NOW = new Date('2026-09-07T12:00:00.000Z');

const c = (p: string, value: unknown, over: Partial<FieldCandidate> = {}): FieldCandidate => ({
  path: path(p), value, source: 'tabc_license', method: 'record',
  confidence: 0.95, as_of: '2026-08-31', retrieved_at: NOW.toISOString(), ...over,
});

const profileOf = (candidates: FieldCandidate[], ranBy: Parameters<typeof reduce>[0]['ranBy'] = []) =>
  reduce({ candidates, ranBy, now: NOW, derivations: derivationsFor('TX') }).profile;

const carrier = (over: Partial<CarrierAppetite> = {}): CarrierAppetite => ({
  carrier: 'test', program: 'p', label: 'Test Program',
  states: ['TX'], classes: ['bar'], hard_declines: [], review_required: [], credits: [],
  requires_for_submission: [], source: 'https://example.invalid/', as_of: '2026-09-01',
  basis: 'test', illustrative: false, ...over,
});

const cite = { source: 'https://example.invalid/', as_of: '2026-09-01' };

describe('question ordering reflects what moves a placement', () => {
  it('puts a submission requirement above a referral unknown', () => {
    const profile = profileOf([]);
    const a = assessCarrier(profile, carrier({
      requires_for_submission: [
        { field: path('loss_history.losses'), because: 'Loss runs required.', ...cite },
      ],
      review_required: [{
        id: 'r', field: path('entertainment.hookah_or_oxygen_inhalation'), op: 'equals',
        value: true, because: 'Hookah refers.', ...cite,
      }],
    }), 'bar');

    const report = assessCompleteness({ profile, assessments: [a] });
    const paths = report.questions.map((q) => q.path);
    expect(paths.indexOf('loss_history.losses')).toBeLessThan(
      paths.indexOf('entertainment.hookah_or_oxygen_inhalation'),
    );
  });

  it('puts a hard-decline unknown above a referral unknown', () => {
    const profile = profileOf([]);
    const a = assessCarrier(profile, carrier({
      hard_declines: [{
        id: 'd', field: path('entertainment.adult_entertainment'), op: 'equals', value: true,
        because: 'Declined.', ...cite,
      }],
      review_required: [{
        id: 'r', field: path('entertainment.hookah_or_oxygen_inhalation'), op: 'equals', value: true,
        because: 'Refers.', ...cite,
      }],
    }), 'bar');

    const report = assessCompleteness({ profile, assessments: [a] });
    const paths = report.questions.map((q) => q.path);
    expect(paths.indexOf('entertainment.adult_entertainment')).toBeLessThan(
      paths.indexOf('entertainment.hookah_or_oxygen_inhalation'),
    );
  });

  it('accumulates weight when several carriers want the same field', () => {
    const profile = profileOf([]);
    const wanted = (label: string) => assessCarrier(profile, carrier({
      carrier: label, label,
      requires_for_submission: [
        { field: path('loss_history.losses'), because: 'Loss runs.', ...cite },
      ],
    }), 'bar');

    const one = assessCompleteness({ profile, assessments: [wanted('A')] });
    const three = assessCompleteness({ profile, assessments: [wanted('A'), wanted('B'), wanted('C')] });

    const p1 = one.questions.find((q) => q.path === 'loss_history.losses')!;
    const p3 = three.questions.find((q) => q.path === 'loss_history.losses')!;
    expect(p3.priority).toBeGreaterThan(p1.priority);
    // Three carrier requirements, plus the standing cause that no public source
    // can ever supply loss runs.
    expect(p3.causes.filter((cz) => cz.kind === 'submission_requirement')).toHaveLength(3);
  });

  it('breaks ties by asking the quicker question first', () => {
    const profile = profileOf([]);
    const a = assessCarrier(profile, carrier({
      requires_for_submission: [
        // 180s vs 20s in the field registry.
        { field: path('loss_history.losses'), because: 'Loss runs.', ...cite },
        { field: path('coverage_requested.x_date'), because: 'X-date.', ...cite },
      ],
    }), 'bar');

    const report = assessCompleteness({ profile, assessments: [a] });
    const paths = report.questions.map((q) => q.path);
    expect(paths.indexOf('coverage_requested.x_date')).toBeLessThan(paths.indexOf('loss_history.losses'));
  });
});

describe('a question explains itself', () => {
  it('flags a field that unblocks a blocked derivation', () => {
    // alcohol_pct is blocked on food sales; asking for food sales completes it.
    const profile = profileOf([c('revenue.alcohol_on_premise_sales', 5_000_000, { source: 'tabc_receipts' })]);
    const report = assessCompleteness({ profile });

    const q = report.questions.find((x) => x.path === 'revenue.food_sales');
    expect(q).toBeDefined();
    expect(q?.causes.some((cz) => cz.kind === 'unblocks_derived')).toBe(true);
    expect(q?.unblocks).toContain('revenue.alcohol_pct');
  });

  it('distinguishes "no source can provide this" from "sources looked and failed"', () => {
    const profile = profileOf([], [
      { id: 'tabc_license', produces: [path('liquor_profile.wine_percent_allowed')] },
    ]);
    const report = assessCompleteness({
      profile,
      producible: producibleFields(enrichersFor('TX'), derivationsFor('TX').map((d) => d.path)),
    });

    const looked = report.questions.find((q) => q.path === 'liquor_profile.wine_percent_allowed');
    expect(looked?.causes.some((cz) => cz.kind === 'not_found')).toBe(true);

    const never = report.questions.find((q) => q.path === 'loss_history.losses');
    expect(never?.causes.some((cz) => cz.kind === 'structurally_unavailable')).toBe(true);
    expect(report.structurally_unavailable).toContain('loss_history.losses');
  });

  it('asks about a populated field that is only weakly held', () => {
    const profile = profileOf([
      c('entertainment.bottle_service', true, { source: 'web', method: 'inferred', confidence: 0.5 }),
    ]);
    const report = assessCompleteness({ profile });
    const q = report.questions.find((x) => x.path === 'entertainment.bottle_service');
    expect(q?.causes.some((cz) => cz.kind === 'low_confidence')).toBe(true);
    expect(q?.current?.value).toBe(true);
  });

  it('asks about a conflict and says who disagreed', () => {
    const profile = profileOf([
      c('operations.is_operating', true, { source: 'tabc_license', method: 'derived' }),
      c('operations.is_operating', false, { source: 'tabc_receipts', method: 'derived' }),
    ]);
    const report = assessCompleteness({ profile });
    expect(report.conflicts).toBe(1);
    const q = report.questions.find((x) => x.path === 'operations.is_operating');
    expect(q?.causes[0]?.kind).toBe('conflict');
    expect(q?.causes[0]?.detail).toContain('tabc_license says');
  });

  it('does not ask about a field that is confidently known', () => {
    const profile = profileOf([c('liquor_profile.late_hours_permit', true, { confidence: 0.97 })]);
    const report = assessCompleteness({ profile });
    expect(report.questions.find((q) => q.path === 'liquor_profile.late_hours_permit')).toBeUndefined();
  });
});

describe('time saved', () => {
  it('is the total ask time minus what is still on the list', () => {
    const report = assessCompleteness({ profile: profileOf([]) });
    expect(report.minutes.saved + report.minutes.remaining).toBeCloseTo(report.minutes.total, 0);
  });

  it('rises as fields get filled', () => {
    const empty = assessCompleteness({ profile: profileOf([]) });
    const filled = assessCompleteness({
      profile: profileOf([
        c('loss_history.losses', []),
        c('coverage_requested.x_date', '2027-01-01'),
        c('revenue.food_sales', 100000),
      ]),
    });
    expect(filled.minutes.saved).toBeGreaterThanOrEqual(empty.minutes.saved);
  });
});
