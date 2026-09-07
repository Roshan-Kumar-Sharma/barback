import { describe, expect, it } from 'vitest';
import { ExtractionSchema, toCandidates } from '../src/enrichers/web/extract.ts';

const PAGE = `## https://venue.example/
Anywhere Cantina — open until 2am on Fridays and Saturdays.
Our kitchen serves fried pickles, chargrilled fajitas and hand-cut fries.
Rooftop bar with skyline views. DJ every Friday and Saturday night.
21+ after 9pm. No BYOB.`;

const base = {
  sourceText: PAGE,
  pageUrl: 'https://venue.example/',
  evidenceRef: 'abc123',
  retrievedAt: '2026-09-07T12:00:00.000Z',
  model: 'test-model',
};

const empty = ExtractionSchema.parse({
  cooking_equipment: {}, hookah_or_oxygen_inhalation: {}, bottle_service: {},
  dancing_permitted: {}, gaming_machines: {}, mechanical_bull: {},
  dj_with_dancing: {}, live_music: {}, adult_entertainment: {}, banquet: {},
  minimum_age_21: {}, bar_with_seating: {}, byob_permitted: {},
  drink_specials_after_9pm: {}, drink_specials_after_11pm: {},
  outdoor_seating: {}, elevated_deck_or_rooftop: {}, table_service: {},
  seating_capacity: {}, latest_closing_time: {},
});

const withField = (patch: Record<string, unknown>) =>
  ExtractionSchema.parse({ ...empty, ...patch });

describe('quote verification is the anti-hallucination guard', () => {
  it('keeps a value whose quote really appears on the page', () => {
    const { candidates, unsupported } = toCandidates({
      ...base,
      extraction: withField({
        elevated_deck_or_rooftop: { value: true, evidence: 'Rooftop bar with skyline views' },
      }),
    });
    expect(unsupported).toHaveLength(0);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.path).toBe('property.elevated_deck_or_rooftop');
    expect(candidates[0]?.method).toBe('inferred');
    expect(candidates[0]?.source).toBe('web');
  });

  it('discards a hallucinated value whose quote is not on the page', () => {
    const { candidates, unsupported } = toCandidates({
      ...base,
      extraction: withField({
        hookah_or_oxygen_inhalation: { value: true, evidence: 'Hookah lounge open nightly' },
      }),
    });
    expect(candidates).toHaveLength(0);
    expect(unsupported[0]).toContain('quote not found');
  });

  it('discards a value offered with no quote at all', () => {
    const { candidates, unsupported } = toCandidates({
      ...base,
      extraction: withField({ bottle_service: { value: true, evidence: null } }),
    });
    expect(candidates).toHaveLength(0);
    expect(unsupported[0]).toContain('no supporting quote');
  });

  it('tolerates whitespace and smart-quote drift in the quote', () => {
    const { candidates } = toCandidates({
      ...base,
      extraction: withField({
        minimum_age_21: { value: true, evidence: '21+   after\n9pm' },
      }),
    });
    expect(candidates).toHaveLength(1);
  });

  it('never emits a field the model left null', () => {
    expect(toCandidates({ ...base, extraction: empty }).candidates).toHaveLength(0);
  });

  it('carries the supporting quote into the field notes', () => {
    const { candidates } = toCandidates({
      ...base,
      extraction: withField({
        cooking_equipment: { value: ['deep_fryer'], evidence: 'fried pickles' },
      }),
    });
    expect(candidates[0]?.notes).toContain('fried pickles');
    expect(candidates[0]?.notes).toContain('marketing copy');
  });

  it('shapes an activity with its frequency', () => {
    const { candidates } = toCandidates({
      ...base,
      extraction: withField({
        dj_with_dancing: { value: true, per_week: 2, evidence: 'DJ every Friday and Saturday night' },
      }),
    });
    expect(candidates[0]?.value).toEqual({ present: true, per_week: 2 });
  });

  it('records a stated absence as false, since the page addressed it', () => {
    const { candidates } = toCandidates({
      ...base,
      extraction: withField({ byob_permitted: { value: false, evidence: 'No BYOB' } }),
    });
    expect(candidates[0]?.value).toBe(false);
  });

  it('drops an empty cooking-equipment list rather than emitting "none"', () => {
    // An empty list would read as "we checked and there is no fryer", which is
    // a different and much stronger claim than "the menu did not say".
    const { candidates } = toCandidates({
      ...base,
      extraction: withField({ cooking_equipment: { value: [], evidence: 'fried pickles' } }),
    });
    expect(candidates).toHaveLength(0);
  });

  it('dates the value to when we read the site, not to a record date', () => {
    const { candidates } = toCandidates({
      ...base,
      extraction: withField({ outdoor_seating: { value: true, evidence: 'Rooftop bar' } }),
    });
    expect(candidates[0]?.as_of).toBe('2026-09-07');
  });
});

describe('tolerates the shapes models actually produce', () => {
  const shapes = (raw: Record<string, unknown>) => ExtractionSchema.safeParse(raw);

  it('accepts a bare null for an observation', () => {
    // What a free model returned on the first real run.
    const r = shapes({ hookah_or_oxygen_inhalation: null, bottle_service: null });
    expect(r.success).toBe(true);
  });

  it('accepts missing keys entirely', () => {
    expect(shapes({}).success).toBe(true);
  });

  it('accepts a bare value instead of an observation object', () => {
    const r = shapes({ bottle_service: true });
    expect(r.success).toBe(true);
    // ...but it has no quote, so it is discarded downstream rather than trusted.
    if (r.success) {
      const { candidates, unsupported } = toCandidates({ ...base, extraction: r.data });
      expect(candidates).toHaveLength(0);
      expect(unsupported[0]).toContain('no supporting quote');
    }
  });

  it('drops a value of the wrong type without failing the whole response', () => {
    const r = shapes({
      seating_capacity: { value: 'about a hundred', evidence: 'seats 100' },
      outdoor_seating: { value: true, evidence: 'Rooftop bar with skyline views' },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      const { candidates } = toCandidates({ ...base, extraction: r.data });
      // The good field survives; the malformed one does not.
      expect(candidates.map((c) => c.path)).toEqual(['property.outdoor_seating']);
    }
  });
});
