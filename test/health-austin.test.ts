import { describe, expect, it } from 'vitest';
import { describeTrend, streetKey } from '../src/enrichers/health_austin/index.ts';

describe('address normalisation for matching', () => {
  it('matches a licence address to the health dataset format', () => {
    // TABC: "606 TRINITY ST". Austin health: "606 Trinity St Austin".
    expect(streetKey('606 TRINITY ST')).toBe(streetKey('606 Trinity St Austin'));
  });

  it('ignores suite numbers', () => {
    expect(streetKey('1625 E 6th St Ste A')).toBe(streetKey('1625 E 6TH ST'));
  });

  it('does not collapse different addresses onto one key', () => {
    expect(streetKey('606 TRINITY ST')).not.toBe(streetKey('608 TRINITY ST'));
    expect(streetKey('100 MAIN ST')).not.toBe(streetKey('100 MAIN AVE'));
  });
});

describe('trend reading', () => {
  const at = (date: string, score: number) => ({ date, score, kind: 'Routine Inspection' });

  it('says so when there is only one inspection', () => {
    expect(describeTrend([at('2026-01-01', 95)])).toContain('no trend');
  });

  it('calls a falling series declining', () => {
    const t = describeTrend([
      at('2026-06-01', 78), at('2026-01-01', 80), at('2025-08-01', 79),
      at('2025-02-01', 95), at('2024-09-01', 96), at('2024-03-01', 94),
    ]);
    expect(t).toContain('declining');
  });

  it('calls a rising series improving', () => {
    const t = describeTrend([
      at('2026-06-01', 97), at('2026-01-01', 96), at('2025-08-01', 95),
      at('2025-02-01', 80), at('2024-09-01', 78), at('2024-03-01', 79),
    ]);
    expect(t).toContain('improving');
  });

  it('does not read noise as a trend', () => {
    // The real Iron Cactus series: 82, 96, 81, 88. Bouncy, not declining.
    const t = describeTrend([
      at('2025-09-25', 82), at('2025-01-15', 96), at('2024-05-21', 81), at('2023-12-22', 88),
    ]);
    expect(t).toContain('stable');
  });
});
