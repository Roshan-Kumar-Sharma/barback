/**
 * TABC licence and permit codes.
 *
 * Every meaning here is taken from TABC's own published list, not from memory:
 * https://www.tabc.texas.gov/services/tabc-licenses-permits/tabc-license-permit-types/
 *
 * These codes decide whether a venue is even in our class and how
 * alcohol-forward it is, so getting them wrong is not a cosmetic error.
 */
import type { VenueClass } from '../../core/schema/types.js';

export const TABC_TYPES_URL =
  'https://www.tabc.texas.gov/services/tabc-licenses-permits/tabc-license-permit-types/';

export type TabcTypeInfo = {
  label: string;
  /** Consumption on the premises — the only kind we can insure as this class. */
  on_premise: boolean;
  /** Full liquor, as opposed to beer and wine only. */
  spirits: boolean;
  /** Retail tier. Excludes manufacturers, wholesalers and shippers. */
  retail: boolean;
};

export const TABC_TYPES: Readonly<Record<string, TabcTypeInfo>> = {
  MB: { label: "Mixed Beverage Permit", on_premise: true, spirits: true, retail: true },
  BG: { label: "Wine and Malt Beverage Retailer's Permit", on_premise: true, spirits: false, retail: true },
  BE: { label: "Retailer's On-Premise License", on_premise: true, spirits: false, retail: true },
  N:  { label: 'Private Club Registration Permit', on_premise: true, spirits: true, retail: true },
  NB: { label: 'Private Club Malt Beverage and Wine Permit', on_premise: true, spirits: false, retail: true },
  NE: { label: 'Private Club Exemption Certificate', on_premise: true, spirits: true, retail: true },

  // Off-premise and non-retail. Present in the dataset, never in our class.
  BQ: { label: "Wine and Malt Beverage Retailer's Off-Premise Permit", on_premise: false, spirits: false, retail: true },
  BF: { label: "Retail Dealer's Off-Premise License", on_premise: false, spirits: false, retail: true },
  P:  { label: 'Package Store Permit', on_premise: false, spirits: true, retail: true },
  Q:  { label: 'Wine-Only Package Store Permit', on_premise: false, spirits: false, retail: true },
  D:  { label: "Distiller's and Rectifier's Permit", on_premise: false, spirits: true, retail: false },
  DS: { label: "Out-of-State Winery Direct Shipper's Permit", on_premise: false, spirits: false, retail: false },
  S:  { label: "Nonresident Seller's Permit", on_premise: false, spirits: true, retail: false },
  W:  { label: "Wholesaler's Permit", on_premise: false, spirits: true, retail: false },
  G:  { label: 'Winery Permit', on_premise: false, spirits: false, retail: false },
};

/**
 * Subordinate permits that carry underwriting meaning.
 *
 * The dataset has eight subordinate columns; the other six (SD, E, FC, LP, WP,
 * BP) are transport, manufacturing and distribution authorities that tell an
 * underwriter nothing about a bar. We read the two that matter and ignore the
 * rest rather than emitting noise.
 */
export const SUBORDINATE = {
  /** Late Hours Certificate — authorises alcohol sales past the standard cutoff. */
  LH: 'lh',
  /** Food and Beverage Certificate — marks a food-primary operation. */
  FB: 'fb',
} as const;

export function typeInfo(code: string | undefined): TabcTypeInfo | undefined {
  return code ? TABC_TYPES[code.trim().toUpperCase()] : undefined;
}

/** True when this licence type puts the venue in the class Barback covers. */
export function isInClass(code: string | undefined): boolean {
  const t = typeInfo(code);
  return t !== undefined && t.retail && t.on_premise;
}

/**
 * Operating class from records alone.
 *
 * The reasoning, stated so it can be argued with:
 *   - a Food and Beverage Certificate is TABC's own marker of a food-primary
 *     operation, so MB+FB is a restaurant unless something contradicts it;
 *   - cover charge receipts mean patrons pay at the door, which is a nightclub
 *     behaviour and not a restaurant one;
 *   - a Late Hours Certificate on an alcohol-primary venue is the difference
 *     between a tavern and a bar that trades after midnight.
 *
 * Everything here is a signal, not a certainty, which is why the caller assigns
 * `derived` rather than `record` and keeps confidence below 1.
 */
export function classify(input: {
  license_type: string | undefined;
  food_beverage_certificate: boolean;
  late_hours: boolean;
  cover_charge_share: number | null;
}): { value: VenueClass; confidence: number; why: string[] } | null {
  const t = typeInfo(input.license_type);
  if (!t || !t.retail || !t.on_premise) return null;

  const why: string[] = [];
  const cover = input.cover_charge_share ?? 0;

  if (cover >= 0.02) {
    why.push(`cover charges are ${(cover * 100).toFixed(1)}% of alcohol receipts`);
    if (input.late_hours) why.push('holds a Late Hours Certificate');
    return { value: 'nightclub', confidence: input.late_hours ? 0.8 : 0.65, why };
  }

  if (input.food_beverage_certificate) {
    why.push('holds a Food and Beverage Certificate (food-primary)');
    if (input.late_hours) {
      why.push('also holds a Late Hours Certificate');
      return { value: 'tavern', confidence: 0.6, why };
    }
    return { value: 'restaurant', confidence: 0.75, why };
  }

  why.push(`${t.label} without a Food and Beverage Certificate`);
  if (input.late_hours) {
    why.push('holds a Late Hours Certificate');
    return { value: 'bar', confidence: 0.7, why };
  }
  return { value: 'bar', confidence: 0.55, why };
}
