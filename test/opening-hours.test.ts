import { describe, expect, it } from 'vitest';
import { parseOpeningHours } from '../src/enrichers/osm/opening-hours.js';

describe('opening_hours: the forms that appear in real data', () => {
  it('reads a simple range', () => {
    expect(parseOpeningHours('07:00-23:00').latest_close).toBe('23:00');
  });

  it('takes the latest close across day rules', () => {
    // Iron Cactus, Austin.
    const r = parseOpeningHours('Mo-Th 11:00-22:30; Fr,Sa 11:00-23:00; Su 10:00-22:30');
    expect(r.latest_close).toBe('23:00');
    expect(r.understood).toBe(true);
  });

  it('ranks an after-midnight close as LATER than an evening one', () => {
    // The Jackalope, Austin. 02:00 must beat 23:00, not lose to it.
    expect(parseOpeningHours('11:00-02:00').latest_close).toBe('02:00');
    expect(parseOpeningHours('Mo-Th 11:00-23:00; Fr,Sa 11:00-02:00').latest_close).toBe('02:00');
  });

  it('treats midnight as the end of the day, not the start', () => {
    expect(parseOpeningHours('17:00-24:00').latest_close).toBe('00:00');
    expect(parseOpeningHours('17:00-00:00').latest_close).toBe('00:00');
  });

  it('flags 24/7 rather than inventing a closing time', () => {
    const r = parseOpeningHours('24/7');
    expect(r.always_open).toBe(true);
    expect(r.latest_close).toBeNull();
    expect(r.understood).toBe(true);
  });

  it('skips closed-day rules without treating them as unreadable', () => {
    const r = parseOpeningHours('Mo-Sa 11:00-23:00; Su off');
    expect(r.latest_close).toBe('23:00');
    expect(r.understood).toBe(true);
  });

  it('handles public-holiday rules', () => {
    expect(parseOpeningHours('Mo-Su 11:00-22:00; PH off').latest_close).toBe('22:00');
  });

  it('handles multiple ranges in one rule', () => {
    expect(parseOpeningHours('Mo-Fr 11:00-14:00,17:00-23:30').latest_close).toBe('23:30');
  });
});

describe('opening_hours: refuses to guess', () => {
  it('returns null on variable times it cannot evaluate', () => {
    const r = parseOpeningHours('sunrise-sunset');
    expect(r.latest_close).toBeNull();
    expect(r.understood).toBe(false);
    expect(r.note).toContain('rather than risk understating');
  });

  it('returns null when ANY rule is unreadable, even if others parsed', () => {
    // The unreadable rule could be the late one, so a partial answer would
    // understate the closing time. That is the dangerous direction.
    const r = parseOpeningHours('Mo-Th 11:00-22:00; Fr-Sa sunset-dawn');
    expect(r.latest_close).toBeNull();
    expect(r.understood).toBe(false);
  });

  it('returns null on an empty or meaningless tag', () => {
    expect(parseOpeningHours('').understood).toBe(false);
    expect(parseOpeningHours('by appointment').understood).toBe(false);
  });

  it('rejects impossible times', () => {
    expect(parseOpeningHours('11:00-99:99').latest_close).toBeNull();
  });
});
