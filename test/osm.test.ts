import { describe, expect, it } from 'vitest';
import { bestMatch } from '../src/enrichers/osm/index.js';
import type { OsmElement } from '../src/enrichers/osm/client.js';

const node = (id: number, tags: Record<string, string>): OsmElement => ({ type: 'node', id, tags });

/**
 * These are the seven named features Overpass actually returns within 70m of
 * 606 Trinity St, Austin — the licensed address of Iron Cactus. Any one of them
 * would be a plausible-looking, well-sourced, completely wrong attribution.
 */
const REAL_BLOCK: OsmElement[] = [
  node(1481633318, { amenity: 'bar', name: 'Mooseknuckle' }),
  node(1481633321, {
    amenity: 'restaurant', name: 'Iron Cactus', cuisine: 'mexican',
    opening_hours: 'Mo-Th 11:00-22:30; Fr,Sa 11:00-23:00; Su 10:00-22:30',
    outdoor_seating: 'yes', website: 'https://ironcactus.com/austin-downtown',
  }),
  node(1481633328, { amenity: 'bar', name: 'Blind Pig' }),
  node(1481633334, { amenity: 'bar', name: "Shakespeare's" }),
  node(1481633336, { amenity: 'restaurant', name: 'Old Pecan Street Cafe' }),
  node(1481633338, { amenity: 'bar', name: '311' }),
  node(3181780232, { amenity: 'bar', name: 'The Jackalope', opening_hours: '11:00-02:00' }),
];

describe('OSM feature matching guards against misattribution', () => {
  it('picks the venue with the matching name out of a crowded block', () => {
    const m = bestMatch(REAL_BLOCK, 'IRON CACTUS');
    expect(m?.element.id).toBe(1481633321);
  });

  it('attributes nothing when no nearby feature matches the trade name', () => {
    // The licensed venue is simply not mapped. Every candidate here belongs to
    // somebody else, and hanging their hours on this venue would be a
    // confidently-sourced lie.
    expect(bestMatch(REAL_BLOCK, 'CASA CHAPALA')).toBeNull();
  });

  it('does not match on amenity type alone', () => {
    // Six of the seven are bars. A bar-shaped query must not attach to one.
    expect(bestMatch(REAL_BLOCK, 'SOME OTHER BAR')).toBeNull();
  });

  it('ignores features with no name at all', () => {
    expect(bestMatch([node(1, { amenity: 'bar' })], 'Anything')).toBeNull();
  });

  it('prefers a hospitality amenity over a same-named non-venue', () => {
    const els = [
      node(1, { name: 'The Jackalope' }),
      node(2, { amenity: 'bar', name: 'The Jackalope' }),
    ];
    expect(bestMatch(els, 'The Jackalope')?.element.id).toBe(2);
  });

  it('will not let a short generic query match a neighbour', () => {
    expect(bestMatch(REAL_BLOCK, 'Pig')).toBeNull();
  });
});
