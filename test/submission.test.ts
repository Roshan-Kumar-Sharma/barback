import { describe, expect, it } from 'vitest';
import { assessCarrier } from '../src/appetite/evaluate.ts';
import type { CarrierAppetite } from '../src/appetite/types.ts';
import { assessCompleteness } from '../src/completeness/index.ts';
import { path, type FieldCandidate } from '../src/core/field.ts';
import { reduce } from '../src/core/reduce/index.ts';
import type { Venue } from '../src/core/venue.ts';
import { derivationsFor } from '../src/enrichers/index.ts';
import { draftSubmission, REDACTED } from '../src/submission/index.ts';

const NOW = new Date('2026-09-07T12:00:00.000Z');

const c = (p: string, value: unknown, over: Partial<FieldCandidate> = {}): FieldCandidate => ({
  path: path(p), value, source: 'tabc_license', method: 'record',
  confidence: 0.95, as_of: '2026-08-31', retrieved_at: NOW.toISOString(), ...over,
});

const VENUE: Venue = {
  id: 'TX:1', state: 'TX', trade_name: 'IRON CACTUS', legal_name: 'Jane Doe',
  address: { line1: '606 Trinity St', city: 'Austin', state: 'TX', zip: '78701' },
  license_id: '100114241', license_type: 'MB',
};

const carrier = (over: Partial<CarrierAppetite> = {}): CarrierAppetite => ({
  carrier: 'test', program: 'p', label: 'Test Program', states: ['TX'],
  classes: ['bar', 'tavern', 'restaurant', 'nightclub'],
  hard_declines: [], review_required: [], credits: [], requires_for_submission: [],
  source: 'https://example.invalid/', as_of: '2026-09-01', basis: 'test', illustrative: false, ...over,
});

function build(candidates: FieldCandidate[], carrierOver: Partial<CarrierAppetite> = {}, redact = false) {
  const profile = reduce({ candidates, ranBy: [], now: NOW, derivations: derivationsFor('TX') }).profile;
  const assessment = assessCarrier(profile, carrier(carrierOver), 'tavern');
  const completeness = assessCompleteness({ profile, assessments: [assessment] });
  return draftSubmission({ profile, venue: VENUE, assessment, completeness, redact });
}

describe('the draft never invents a fact', () => {
  it('maps only fields that actually have a value', () => {
    const d = build([c('identity.trade_name', 'IRON CACTUS')]);
    expect(d.field_map.map((f) => f.path)).toContain('identity.trade_name');
    expect(d.field_map.every((f) => f.value !== null)).toBe(true);
  });

  it('carries provenance onto every mapped field', () => {
    const d = build([c('liquor_profile.late_hours_permit', true, { evidence_url: 'https://x.invalid/' })]);
    const f = d.field_map.find((x) => x.path === 'liquor_profile.late_hours_permit')!;
    expect(f.source).toBe('tabc_license');
    expect(f.as_of).toBe('2026-08-31');
    expect(f.evidence_url).toBe('https://x.invalid/');
  });

  it('separates low-confidence values into an "unconfirmed" section', () => {
    const d = build([
      c('entertainment.bottle_service', true, { source: 'web', method: 'inferred', confidence: 0.5 }),
      c('liquor_profile.late_hours_permit', true),
    ]);
    expect(d.email.body).toContain('Unconfirmed');
    const unconfirmedBlock = d.email.body.slice(d.email.body.indexOf('Unconfirmed'));
    expect(unconfirmedBlock).toContain('Bottle service');
  });

  it('tells the underwriter what is still being confirmed', () => {
    const d = build([]);
    expect(d.email.body).toContain('Still being confirmed with the insured');
  });

  it('formats a year as a year and money as money', () => {
    const d = build([
      c('operations.year_started_at_location', 1993),
      c('revenue.alcohol_on_premise_sales', 896_581, { source: 'tabc_receipts' }),
    ]);
    expect(d.email.body).toContain('1993');
    expect(d.email.body).not.toContain('1,993');
    expect(d.email.body).toContain('$896,581');
  });
});

describe('the draft is a draft', () => {
  it('never populates a recipient', () => {
    const d = build([]);
    expect(d.email.to).toContain('never sends');
    expect(d.email.to).not.toMatch(/@[a-z]/i);
  });

  it('always warns that a producer must verify it', () => {
    expect(build([]).warnings[0]).toContain('licensed producer must verify');
  });

  it('warns loudly when the carrier is a hard decline', () => {
    const d = build([c('entertainment.mosh_pits', true)], {
      hard_declines: [{
        id: 'd', field: path('entertainment.mosh_pits'), op: 'equals', value: true,
        because: 'Excluded.', source: 'https://example.invalid/', as_of: '2026-09-01',
      }],
    });
    expect(d.warnings.join(' ')).toContain('HARD DECLINE');
  });

  it('warns when required submission items are missing', () => {
    const d = build([], {
      requires_for_submission: [{
        field: path('loss_history.losses'), because: 'Loss runs.',
        source: 'https://example.invalid/', as_of: '2026-09-01',
      }],
    });
    expect(d.warnings.join(' ')).toContain('required submission item');
  });

  it('warns when the carrier file is illustrative', () => {
    expect(build([], { illustrative: true }).warnings.join(' ')).toContain('ILLUSTRATIVE');
  });
});

describe('personal data', () => {
  it('redacts the licensee name when asked', () => {
    const d = build([c('identity.legal_name', 'Jane Doe')], {}, true);
    const f = d.field_map.find((x) => x.path === 'identity.legal_name')!;
    expect(f.value).toBe(REDACTED);
    expect(d.email.body).not.toContain('Jane Doe');
  });

  it('keeps it for a real submission, but warns', () => {
    const d = build([c('identity.legal_name', 'Jane Doe')]);
    expect(d.field_map.find((x) => x.path === 'identity.legal_name')?.value).toBe('Jane Doe');
    expect(d.warnings.join(' ')).toContain('--redact');
  });
});
