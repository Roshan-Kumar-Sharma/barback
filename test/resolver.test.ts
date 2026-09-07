import { describe, expect, it } from 'vitest';
import { AUTO_RESOLVE_SCORE } from '../src/resolver/tx.js';
import { anchorToken, dice, nameScore, normalizeName, specificity } from '../src/resolver/similarity.js';

describe('name normalisation', () => {
  it('drops entity-suffix noise', () => {
    expect(normalizeName("Mala Fama Austin, LLC")).toBe('MALA FAMA AUSTIN');
    expect(normalizeName('The Blue Light')).toBe('BLUE LIGHT');
  });
  it('expands ampersands so tokens line up', () => {
    expect(normalizeName('Bar & Grill')).toBe('BAR AND GRILL');
  });
  it('never returns empty when the name is entirely noise', () => {
    expect(normalizeName('LLC').length).toBeGreaterThan(0);
  });
  it('picks the longest distinctive token to widen a failed search', () => {
    expect(anchorToken('The Blue Light Social')).toBe('SOCIAL');
    expect(anchorToken('Rio')).toBeNull();
  });
});

describe('name scoring', () => {
  it('scores an exact match near 1', () => {
    expect(nameScore('Mala Fama', 'Mala Fama')).toBeGreaterThan(0.95);
  });

  it('does NOT let a short generic query auto-resolve', () => {
    // "Rio" is fully contained in this name. Intersection-over-minimum would
    // score 1.0 and auto-resolve onto an arbitrary venue.
    expect(nameScore('Rio', 'Casa Rio Mexican Foods')).toBeLessThan(AUTO_RESOLVE_SCORE);
    expect(nameScore('Rio', 'Jett Bowl Del Rio')).toBeLessThan(AUTO_RESOLVE_SCORE);
  });

  it('discounts a query that explains only part of the candidate name', () => {
    const partial = nameScore('The Blue Light', "Tom's Daiquiri Place/The Blue Light");
    const exact = nameScore('The Blue Light', 'The Blue Light');
    expect(partial).toBeLessThan(exact);
    expect(partial).toBeLessThan(AUTO_RESOLVE_SCORE);
  });

  it('still matches a name with extra descriptive words', () => {
    expect(nameScore('Luna Rooftop Bar', 'Luna Rooftop Bar')).toBeGreaterThan(0.9);
  });

  it('specificity rises with query length and token count', () => {
    expect(specificity('Rio')).toBeLessThan(specificity('Rio Grande'));
    expect(specificity('Rio Grande')).toBeLessThanOrEqual(specificity('Rio Grande Cantina'));
    expect(specificity('Rio Grande Cantina')).toBe(1);
  });

  it('dice is symmetric and bounded', () => {
    expect(dice('abc', 'abc')).toBe(1);
    expect(dice('abc', 'xyz')).toBe(0);
    expect(dice('night club', 'club night')).toBe(dice('club night', 'night club'));
  });
});
