/**
 * California ABC licence type codes.
 *
 * Every meaning is taken from ABC's own published list, not from memory:
 * https://www.abc.ca.gov/licensing/license-types/
 *
 * The distinction that matters most is "Eating Place" versus "Public Premises",
 * which is California's structural equivalent of the Texas Food and Beverage
 * Certificate. ABC's own text for type 48 says minors "are not allowed to enter
 * and remain" — so a licence type answers an underwriting question directly,
 * rather than merely hinting at it.
 */
import type { VenueClass } from '../../core/schema/types.js';

export const CA_TYPES_URL = 'https://www.abc.ca.gov/licensing/license-types/';

export type CaTypeInfo = {
  label: string;
  on_premise: boolean;
  spirits: boolean;
  /** A bona fide eating place: food-primary by licence condition. */
  eating_place: boolean;
  /** Public premises: ABC states minors may not enter and remain. */
  public_premises: boolean;
  /** Licensed specifically as a music entertainment facility. */
  music_venue: boolean;
  class?: VenueClass;
};

const t = (
  label: string,
  o: Partial<CaTypeInfo> & { on_premise: boolean },
): CaTypeInfo => ({
  label,
  spirits: false, eating_place: false, public_premises: false, music_venue: false,
  ...o,
});

export const CA_TYPES: Readonly<Record<string, CaTypeInfo>> = {
  '40': t('On-Sale Beer', { on_premise: true, class: 'bar' }),
  '41': t('On-Sale Beer & Wine — Eating Place', { on_premise: true, eating_place: true, class: 'restaurant' }),
  '42': t('On-Sale Beer & Wine — Public Premises', { on_premise: true, public_premises: true, class: 'bar' }),
  '47': t('On-Sale General — Eating Place', { on_premise: true, spirits: true, eating_place: true, class: 'restaurant' }),
  '48': t('On-Sale General — Public Premises', { on_premise: true, spirits: true, public_premises: true, class: 'bar' }),
  '49': t('On-Sale General — Seasonal', { on_premise: true, spirits: true, class: 'other' }),
  '51': t('Club', { on_premise: true, spirits: true, class: 'other' }),
  '52': t("Veteran's Club", { on_premise: true, spirits: true, class: 'other' }),
  '61': t('On-Sale Beer — Public Premises', { on_premise: true, public_premises: true, class: 'bar' }),
  '70': t('On-Sale General — Restrictive Service', { on_premise: true, spirits: true, class: 'other' }),
  '75': t('Brewpub-Restaurant', { on_premise: true, eating_place: true, class: 'brewpub' }),
  '90': t('On-Sale General — Music Venue', { on_premise: true, spirits: true, music_venue: true, class: 'nightclub' }),
  '99': t('On-Sale General for Special Use', { on_premise: true, spirits: true, class: 'other' }),

  // Present in the export, never in our class.
  '20': t('Off-Sale Beer & Wine', { on_premise: false }),
  '21': t('Off-Sale General', { on_premise: false, spirits: true }),
  '23': t('Small Beer Manufacturer', { on_premise: false }),
  '02': t('Winegrower', { on_premise: false }),
  '17': t('Beer & Wine Wholesaler', { on_premise: false }),
};

/** Codes arrive zero-padded ("02", "47"); normalise before lookup. */
export function caTypeInfo(code: string | undefined): CaTypeInfo | undefined {
  if (!code) return undefined;
  const key = code.trim().replace(/^0+(?=\d)/, '').padStart(2, '0');
  return CA_TYPES[key] ?? CA_TYPES[code.trim()];
}

export function isCaInClass(code: string | undefined): boolean {
  const info = caTypeInfo(code);
  return info !== undefined && info.on_premise;
}

/** Operating class from the licence type alone, which in California is unusually informative. */
export function classifyCa(code: string | undefined): { value: VenueClass; confidence: number; why: string } | null {
  const info = caTypeInfo(code);
  if (!info || !info.on_premise || !info.class) return null;

  if (info.music_venue) {
    return { value: 'nightclub', confidence: 0.8, why: `${info.label} — licensed as a music entertainment facility` };
  }
  if (info.eating_place) {
    return { value: info.class, confidence: 0.8, why: `${info.label} — licence requires a bona fide eating place` };
  }
  if (info.public_premises) {
    return { value: 'bar', confidence: 0.75, why: `${info.label} — public premises, minors may not enter and remain` };
  }
  return { value: info.class, confidence: 0.6, why: info.label };
}
