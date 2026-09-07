import { describe, expect, it } from 'vitest';
import { path, type FieldCandidate } from '../src/core/field.js';
import { reduce } from '../src/core/reduce/index.js';
import { getField } from '../src/core/schema/index.js';
import { derivationsFor } from '../src/enrichers/index.js';

const NOW = new Date('2026-09-07T12:00:00.000Z');

const c = (p: string, value: unknown, over: Partial<FieldCandidate> = {}): FieldCandidate => ({
  path: path(p),
  value,
  source: 'tabc_license',
  method: 'record',
  confidence: 0.95,
  as_of: '2026-08-31',
  retrieved_at: NOW.toISOString(),
  ...over,
});

const run = (candidates: FieldCandidate[]) =>
  reduce({ candidates, ranBy: [], now: NOW, derivations: derivationsFor('TX') }).profile;

describe('alcohol_pct', () => {
  it('reports the numerator it has and names the missing input rather than guessing', () => {
    const p = run([c('revenue.alcohol_on_premise_sales', 5_211_768, { source: 'tabc_receipts' })]);
    const f = getField(p, path('revenue.alcohol_pct'))!;
    expect(f.value).toBeNull();
    expect(f.method).toBe('derived');
    expect(f.notes).toContain('food sales');
    expect(f.inputs).toContain('revenue.food_sales');
  });

  it('computes the share once food sales are supplied', () => {
    const p = run([
      c('revenue.alcohol_on_premise_sales', 600_000, { source: 'tabc_receipts' }),
      c('revenue.food_sales', 400_000, { source: 'human' }),
    ]);
    const f = getField(p, path('revenue.alcohol_pct'))!;
    expect(f.value).toBe(0.6);
    expect(f.inputs).toContain('revenue.alcohol_on_premise_sales');
  });

  it('does not fire at all with no alcohol figure', () => {
    const f = getField(run([]), path('revenue.alcohol_pct'))!;
    expect(f.value).toBeNull();
    expect(f.source).toBe('none');
  });
});

describe('late_night', () => {
  it('is true on a Late Hours Certificate even when observed hours end early', () => {
    const p = run([
      c('liquor_profile.late_hours_permit', true),
      c('operations.latest_closing_time', '23:00', { source: 'osm', method: 'api' }),
    ]);
    const f = getField(p, path('operations.late_night'))!;
    expect(f.value).toBe(true);
    expect(f.notes).toContain('authorised to trade late');
  });

  it('treats hours after midnight as late, not early', () => {
    const p = run([c('operations.latest_closing_time', '02:30', { source: 'osm', method: 'api' })]);
    expect(getField(p, path('operations.late_night'))!.value).toBe(true);
  });

  it('is false when the venue closes early and holds no late-hours permit', () => {
    const p = run([
      c('operations.latest_closing_time', '22:00', { source: 'osm', method: 'api' }),
      c('liquor_profile.late_hours_permit', false),
    ]);
    expect(getField(p, path('operations.late_night'))!.value).toBe(false);
  });
});

describe('venue_class', () => {
  it('calls a cover-charging late-hours venue a nightclub', () => {
    const p = run([
      c('identity.license_type', 'MB'),
      c('liquor_profile.late_hours_permit', true),
      c('liquor_profile.food_beverage_certificate', false),
      c('revenue.alcohol_on_premise_sales', 5_211_768, { source: 'tabc_receipts' }),
      c('revenue.cover_charge_sales', 689_501, { source: 'tabc_receipts' }),
    ]);
    const f = getField(p, path('operations.venue_class'))!;
    expect(f.value).toBe('nightclub');
    expect(f.notes).toContain('cover charges');
    expect(getField(p, path('identity.naics_code'))!.value).toBe('722410');
  });

  it('calls a food-certificate venue with no cover a restaurant', () => {
    const p = run([
      c('identity.license_type', 'MB'),
      c('liquor_profile.food_beverage_certificate', true),
      c('liquor_profile.late_hours_permit', false),
      c('revenue.alcohol_on_premise_sales', 200_000, { source: 'tabc_receipts' }),
      c('revenue.cover_charge_sales', 0, { source: 'tabc_receipts' }),
    ]);
    expect(getField(p, path('operations.venue_class'))!.value).toBe('restaurant');
    expect(getField(p, path('identity.naics_code'))!.value).toBe('722511');
  });

  it('refuses to classify an off-premise licence as being in class', () => {
    const p = run([c('identity.license_type', 'BQ')]);
    expect(getField(p, path('operations.venue_class'))!.value).toBeNull();
  });
});

describe('derivation never displaces a record', () => {
  it('leaves a recorded value alone', () => {
    const p = run([
      c('operations.venue_class', 'bar', { source: 'human' }),
      c('identity.license_type', 'MB'),
      c('liquor_profile.food_beverage_certificate', true),
    ]);
    const f = getField(p, path('operations.venue_class'))!;
    expect(f.value).toBe('bar');
    expect(f.source).toBe('human');
  });
});

describe('attempted vs never-looked', () => {
  it('marks fields a source looked for and did not find', () => {
    const p = reduce({
      candidates: [],
      ranBy: [{ id: 'tabc_license', produces: [path('liquor_profile.wine_percent_allowed')] }],
      now: NOW,
      derivations: derivationsFor('TX'),
    }).profile;
    const looked = getField(p, path('liquor_profile.wine_percent_allowed'))!;
    expect(looked.attempted).toEqual(['tabc_license']);
    const never = getField(p, path('property.roof_type'))!;
    expect(never.attempted).toBeUndefined();
  });
});
