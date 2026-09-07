import { describe, expect, it } from 'vitest';
import { path, type FieldCandidate } from '../src/core/field.js';
import { decide } from '../src/core/reduce/precedence.js';

const c = (over: Partial<FieldCandidate>): FieldCandidate => ({
  path: path('operations.seating_capacity'),
  value: 1,
  source: 'osm',
  method: 'api',
  confidence: 0.8,
  as_of: '2026-01-01',
  retrieved_at: '2026-09-07T00:00:00.000Z',
  ...over,
});

describe('precedence', () => {
  it('a government record beats an official API', () => {
    const d = decide('operations.seating_capacity', [
      c({ source: 'osm', method: 'api', value: 50 }),
      c({ source: 'tabc_license', method: 'record', value: 80 }),
    ]);
    expect(d?.winner.value).toBe(80);
    expect(d?.winner.source).toBe('tabc_license');
    expect(d?.conflict).toBeUndefined();
  });

  it("an official API beats the venue's own site", () => {
    const d = decide('operations.seating_capacity', [
      c({ source: 'web', method: 'inferred', value: 200 }),
      c({ source: 'osm', method: 'api', value: 50 }),
    ]);
    expect(d?.winner.source).toBe('osm');
  });

  it('a human correction beats everything', () => {
    const d = decide('operations.seating_capacity', [
      c({ source: 'tabc_license', method: 'record', value: 80 }),
      c({ source: 'human', method: 'record', value: 95 }),
    ]);
    expect(d?.winner.value).toBe(95);
  });

  it('records the value it beat, and why', () => {
    const d = decide('operations.seating_capacity', [
      c({ source: 'osm', method: 'api', value: 50 }),
      c({ source: 'tabc_license', method: 'record', value: 80 }),
    ]);
    expect(d?.superseded).toHaveLength(1);
    expect(d?.superseded[0]?.value).toBe(50);
    expect(d?.superseded[0]?.reason).toContain('outranks');
  });

  it('equally-ranked sources that disagree produce a conflict, not a coin flip', () => {
    const d = decide('operations.seating_capacity', [
      c({ source: 'tabc_license', method: 'record', value: 80 }),
      c({ source: 'tabc_receipts', method: 'record', value: 120 }),
    ]);
    expect(d?.conflict).toBeDefined();
    expect(d?.conflict?.candidates).toHaveLength(2);
    expect(d?.conflict?.reason).toContain('needs a person');
  });

  it('equally-ranked sources that agree do not conflict', () => {
    const d = decide('operations.seating_capacity', [
      c({ source: 'tabc_license', method: 'record', value: 80 }),
      c({ source: 'tabc_receipts', method: 'record', value: 80 }),
    ]);
    expect(d?.conflict).toBeUndefined();
  });

  it('honours a per-path override: observed hours beat a permit', () => {
    const d = decide('operations.latest_closing_time', [
      c({ path: path('operations.latest_closing_time'), source: 'tabc_license', method: 'record', value: '02:00' }),
      c({ path: path('operations.latest_closing_time'), source: 'osm', method: 'api', value: '23:00' }),
    ]);
    expect(d?.winner.value).toBe('23:00');
  });

  it('tolerates small numeric differences where the rule says to', () => {
    const d = decide('revenue.alcohol_on_premise_sales', [
      c({ path: path('revenue.alcohol_on_premise_sales'), source: 'tabc_receipts', method: 'record', value: 1_000_000 }),
      c({ path: path('revenue.alcohol_on_premise_sales'), source: 'tabc_license', method: 'record', value: 1_050_000 }),
    ]);
    expect(d?.conflict).toBeUndefined();
  });

  it('ignores null candidates entirely', () => {
    expect(decide('operations.seating_capacity', [c({ value: null })])).toBeNull();
  });
});

describe('method is a second axis of precedence', () => {
  it('a record beats a derivation from the same source tier, without a false conflict', () => {
    // A permit number assembled from licence fields vs one read off a tax
    // filing. Same publisher tier, very different quality of evidence.
    const d = decide('identity.permit_number', [
      c({ path: path('identity.permit_number'), source: 'tabc_license', method: 'derived', confidence: 0.6, value: 'MB100114241' }),
      c({ path: path('identity.permit_number'), source: 'tabc_receipts', method: 'record', confidence: 0.98, value: 'MB192342' }),
    ]);
    expect(d?.winner.value).toBe('MB192342');
    expect(d?.conflict).toBeUndefined();
    expect(d?.superseded[0]?.reason).toContain('outranks');
  });

  it('still conflicts when two records of equal standing disagree', () => {
    const d = decide('operations.is_operating', [
      c({ path: path('operations.is_operating'), source: 'tabc_license', method: 'derived', value: true }),
      c({ path: path('operations.is_operating'), source: 'tabc_receipts', method: 'derived', value: false }),
    ]);
    expect(d?.conflict).toBeDefined();
  });

  it('names what each source claimed, so the conflict is actionable', () => {
    const d = decide('operations.is_operating', [
      c({ path: path('operations.is_operating'), source: 'tabc_license', method: 'derived', value: true }),
      c({ path: path('operations.is_operating'), source: 'tabc_receipts', method: 'derived', value: false }),
    ]);
    expect(d?.conflict?.reason).toContain('tabc_license says true');
    expect(d?.conflict?.reason).toContain('tabc_receipts says false');
  });

  it('derived evidence outranks inferred evidence', () => {
    const d = decide('operations.seating_capacity', [
      c({ source: 'web', method: 'inferred', confidence: 0.9, value: 200 }),
      c({ source: 'web', method: 'derived', confidence: 0.5, value: 60 }),
    ]);
    expect(d?.winner.value).toBe(60);
  });
});
