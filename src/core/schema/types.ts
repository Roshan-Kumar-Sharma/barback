/**
 * Value types used inside a RiskProfile.
 *
 * These model the UNION of what carriers ask, not any single carrier's form.
 * Field names are generic on purpose: ACORD forms and carrier applications are
 * copyrighted, so we model the underlying facts and cite documents by URL.
 */

/** 24-hour local time, "HH:MM". "02:30" sorts after "00:00" — see lateNight(). */
export type TimeOfDay = string;

/** ISO-4217-less USD amount. Whole dollars; carriers do not ask for cents. */
export type Usd = number;

export type BusinessForm =
  | 'individual' | 'partnership' | 'corporation' | 'llc' | 'trust' | 'other';

/**
 * Operating class. Drives which carrier programs are even in scope, so it is
 * derived from records (licence type + food certificate + cover charge), not
 * from a name or a category string.
 */
export type VenueClass =
  | 'restaurant'   // food-primary, alcohol incidental
  | 'bar'          // alcohol-primary, limited food
  | 'tavern'       // alcohol-primary with a real kitchen
  | 'lounge'
  | 'nightclub'    // alcohol-primary + entertainment + cover charge
  | 'brewpub'
  | 'other';

export type ConstructionClass =
  | 'frame'
  | 'joisted_masonry'
  | 'noncombustible'
  | 'masonry_noncombustible'
  | 'modified_fire_resistive'
  | 'fire_resistive';

/** ISO protection class 1-10. Lower is better fire-department access. */
export type ProtectionClass = 1|2|3|4|5|6|7|8|9|10;

export type RoofType = 'built_up' | 'membrane' | 'metal' | 'shingle' | 'tile' | 'other';

export type PlumbingType = 'pvc' | 'copper' | 'galvanized' | 'lead' | 'mixed';

export type BurglarAlarm = 'none' | 'local' | 'central_station';

/** Kitchen fire suppression. Dry systems with deep fryers are a known red flag. */
export type SuppressionType = 'wet' | 'dry' | 'none';

/** Cooking equipment that triggers hood/suppression underwriting questions. */
export type CookingEquipment = 'grill' | 'deep_fryer' | 'wok' | 'open_flame' | 'none';

/**
 * An entertainment activity with how often it happens. Carriers ask both —
 * a DJ once a year and a DJ five nights a week are different risks.
 */
export type Activity = {
  present: boolean;
  /** Times per week. null = present but frequency unknown. */
  per_week: number | null;
};

export type LossType = 'property' | 'liability' | 'liquor' | 'assault_battery';

export type LossRecord = {
  type: LossType;
  date: string;
  description: string;
  paid: Usd | null;
  reserved: Usd | null;
  status: 'open' | 'closed';
};

export type LiquorViolation = {
  date: string;
  description: string;
  /** e.g. suspension, fine, warning. */
  disposition: string | null;
  /** What the venue did about it. A remediated violation prices differently. */
  remediation: string | null;
};

/** "1M/2M" = $1M per occurrence / $2M aggregate. */
export type LimitPair = string;

/** A monthly alcohol tax filing. The TX mixed-beverage record, normalised. */
export type ReceiptsMonth = {
  /** Obligation end date, ISO. */
  month: string;
  liquor: Usd;
  wine: Usd;
  beer: Usd;
  cover_charge: Usd;
  total: Usd;
};
