/**
 * The RiskProfile — the union of what carriers writing this class ask.
 *
 * Grouped as in the underwriting data model (see docs/DATA-SOURCES.md and the
 * live carrier application it was extracted from). Every leaf is a Field<T>,
 * so there is no way to read a value without also seeing where it came from.
 */
import type { Field } from '../field.js';
import type { PostalAddress } from '../venue.js';
import type {
  Activity, BurglarAlarm, BusinessForm, ConstructionClass, CookingEquipment,
  LimitPair, LiquorViolation, LossRecord, PlumbingType, ProtectionClass,
  ReceiptsMonth, RoofType, SuppressionType, TimeOfDay, Usd, VenueClass,
} from './types.js';

export type Identity = {
  trade_name: Field<string>;
  /** Licensee legal name. Redacted from published output when it is a person. */
  legal_name: Field<string>;
  address: Field<PostalAddress>;
  business_form: Field<BusinessForm>;
  license_type: Field<string>;
  license_status: Field<string>;
  license_id: Field<string>;
  permit_number: Field<string>;
  /** NAICS. 722511 full-service restaurant, 722410 drinking places. */
  naics_code: Field<string>;
  locations_count: Field<number>;
  sole_occupancy_of_building: Field<boolean>;
  located_in_food_court: Field<boolean>;
  applicant_owns_building: Field<boolean>;
  leases_to_commercial_or_residential_tenants: Field<boolean>;
  seasonal_operation: Field<boolean>;
  months_closed_per_year: Field<number>;
};

export type Operations = {
  venue_class: Field<VenueClass>;
  /** Year the business started at THIS location under current ownership. */
  year_started_at_location: Field<number>;
  years_in_operation: Field<number>;
  years_under_current_owner: Field<number>;
  /** Owner's experience in this type of operation. Always human. */
  years_ownership_experience: Field<number>;
  /** When the doors actually close. Distinct from when alcohol sales must stop. */
  latest_closing_time: Field<TimeOfDay>;
  late_night: Field<boolean>;
  is_operating: Field<boolean>;
  seating_capacity: Field<number>;
  tables_present: Field<boolean>;
  table_service: Field<boolean>;
};

export type Revenue = {
  food_sales: Field<Usd>;
  alcohol_on_premise_sales: Field<Usd>;
  alcohol_retail_sales: Field<Usd>;
  alcohol_wholesale_sales: Field<Usd>;
  catering_sales: Field<Usd>;
  other_sales: Field<Usd>;
  total_sales: Field<Usd>;
  /** Door/cover charges. Non-zero is an entertainment signal in its own right. */
  cover_charge_sales: Field<Usd>;
  /**
   * Derived, never asked directly. Carriers collect the split in dollars and
   * compute this themselves — so must we, and we must show the working.
   */
  alcohol_pct: Field<number>;
  /** Monthly history, where a state publishes it. Drives trend and seasonality. */
  receipts_history: Field<ReceiptsMonth[]>;
};

export type LiquorProfile = {
  /** When alcohol sales must cease. In TX this is a permit fact, not an opinion. */
  alcohol_sales_cease_time: Field<TimeOfDay>;
  /** TX Late Hours permit: authorises service past the standard cutoff. */
  late_hours_permit: Field<boolean>;
  /** TX Food & Beverage certificate: marks a food-primary operation. */
  food_beverage_certificate: Field<boolean>;
  /** Max wine ABV the licence allows, where the state records it. */
  wine_percent_allowed: Field<string>;
  bar_with_seating: Field<boolean>;
  byob_permitted: Field<boolean>;
  /** Asked separately from the 11pm question — later is materially worse. */
  drink_specials_after_9pm: Field<boolean>;
  drink_specials_after_11pm: Field<boolean>;
  underage_patrons_permitted: Field<boolean>;
  non_profit_or_fraternal_club: Field<boolean>;
};

export type Entertainment = {
  adult_entertainment: Field<Activity>;
  /** Carriers ask for bands of 3+ members and specifically exclude jazz. */
  band_3plus_excluding_jazz: Field<Activity>;
  banquet: Field<Activity>;
  dance_club_or_hall: Field<Activity>;
  dj_with_dancing: Field<Activity>;
  live_music: Field<Activity>;
  dancing_permitted: Field<boolean>;
  gaming_machines: Field<boolean>;
  mechanical_bull_or_riding_device: Field<boolean>;
  pyrotechnics: Field<boolean>;
  foam_machines: Field<boolean>;
  mosh_pits: Field<boolean>;
  trampolines_or_pools: Field<boolean>;
  /** Hookah or oxygen gas inhalation on premises. A common hard decline. */
  hookah_or_oxygen_inhalation: Field<boolean>;
  bottle_service: Field<boolean>;
};

export type SecurityControls = {
  bouncers_employed: Field<boolean>;
  /** Applied to ALL patrons regardless of apparent age. A real credit. */
  id_scanner_all_patrons: Field<boolean>;
  /** Voluntary (non-state-mandated) server training. TIPS, ServSafe Alcohol. */
  voluntary_server_training: Field<boolean>;
  security_cameras: Field<boolean>;
  minimum_age_21: Field<boolean>;
};

export type Property = {
  construction_class: Field<ConstructionClass>;
  protection_class: Field<ProtectionClass>;
  stories: Field<number>;
  year_built: Field<number>;
  square_footage: Field<number>;
  roof_type: Field<RoofType>;
  roof_age_years: Field<number>;
  plumbing_type: Field<PlumbingType>;
  sprinklered_100pct: Field<boolean>;
  burglar_alarm: Field<BurglarAlarm>;
  /** Pre-1978 buildings: aluminium or knob-and-tube wiring present? */
  pre1978_wiring_hazard: Field<boolean>;
  breakers_100pct: Field<boolean>;
  smoke_heat_detectors_operational: Field<boolean>;
  /** Deck elevated 8ft or more, or a rooftop with patron access. */
  elevated_deck_or_rooftop: Field<boolean>;
  outdoor_seating: Field<boolean>;
  multiple_public_levels: Field<boolean>;
  two_means_of_egress_per_floor: Field<boolean>;
  responsible_for_sidewalk_or_snow_removal: Field<boolean>;
};

export type FireProtection = {
  cooking_equipment: Field<CookingEquipment[]>;
  suppression_type: Field<SuppressionType>;
  nfpa96_compliant: Field<boolean>;
  hood_cleaning_contract_in_force: Field<boolean>;
  extinguishers_to_code: Field<boolean>;
};

export type LossHistory = {
  /** Past 5 years, by type. Comes from a loss run — always human. */
  losses: Field<LossRecord[]>;
  liquor_violations: Field<LiquorViolation[]>;
  cancelled_or_nonrenewed_past_3y: Field<boolean>;
  bankruptcy_foreclosure_or_tax_judgment: Field<boolean>;
};

export type CoverageRequested = {
  general_liability_limits: Field<LimitPair>;
  liquor_liability_limits: Field<LimitPair>;
  assault_battery_sublimit: Field<LimitPair>;
  property_limit: Field<Usd>;
  business_income_limit: Field<Usd>;
  /** The expiring policy's end date. The most valuable prospecting datapoint. */
  x_date: Field<string>;
  current_carrier: Field<string>;
};

export type RiskProfile = {
  identity: Identity;
  operations: Operations;
  revenue: Revenue;
  liquor_profile: LiquorProfile;
  entertainment: Entertainment;
  security_controls: SecurityControls;
  property: Property;
  fire_protection: FireProtection;
  loss_history: LossHistory;
  coverage_requested: CoverageRequested;
};

export type ProfileGroup = keyof RiskProfile;

export const PROFILE_GROUPS: readonly ProfileGroup[] = [
  'identity', 'operations', 'revenue', 'liquor_profile', 'entertainment',
  'security_controls', 'property', 'fire_protection', 'loss_history',
  'coverage_requested',
] as const;
