/**
 * Field metadata: what each field is called, what a broker would ask to get it,
 * and roughly how long that question takes on a call.
 *
 * `ask_seconds` is what makes "broker-minutes saved" an honest number rather
 * than a slogan: it is summed over the fields Barback actually filled. The
 * values are estimates, and the README says so.
 *
 * A test asserts this registry and the RiskProfile type describe exactly the
 * same set of paths, so the two cannot drift.
 */
import { path, type FieldPath } from '../field.js';
import type { ProfileGroup } from './profile.js';

/** How a value should be shown. A year is not a quantity and must not be comma-grouped. */
export type FieldFormat = 'year' | 'usd' | 'percent' | 'count';

export type FieldMeta = {
  path: FieldPath;
  group: ProfileGroup;
  label: string;
  /** What a broker says out loud to fill this field. */
  question: string;
  /** Estimated seconds of call time to ask and record it. */
  ask_seconds: number;
  /**
   * No public source can fill this — it lives in a loss run, a policy document,
   * or the owner's head. Naming these clearly is the completeness engine's job.
   */
  human_only?: true;
  /** May contain personal data. Redacted from published output. */
  sensitive?: true;
  format?: FieldFormat;
};

type Row = [label: string, question: string, ask_seconds: number, opts?: { human_only?: true; sensitive?: true; format?: FieldFormat }];

const TABLE: Record<ProfileGroup, Record<string, Row>> = {
  identity: {
    trade_name: ['Trade name', 'What name does the business operate under?', 10],
    legal_name: ['Named insured', 'What is the full legal entity name on the licence?', 20, { sensitive: true }],
    address: ['Location address', 'What is the physical address of the location?', 25],
    business_form: ['Form of business', 'Is the business an individual, partnership, corporation, LLC or trust?', 15],
    license_type: ['Licence type', 'What alcohol licence or permit does the location hold?', 20],
    license_status: ['Licence status', 'Is the alcohol licence currently active?', 10],
    license_id: ['Licence number', 'What is the licence or permit number?', 15],
    permit_number: ['Permit number', 'What is the permit number used on tax filings?', 15],
    naics_code: ['Class code', 'How would you describe the operation for classification?', 20],
    locations_count: ['Number of locations', 'How many locations does the applicant operate?', 15],
    sole_occupancy_of_building: ['Sole occupancy', 'Does the applicant solely occupy the building?', 15],
    located_in_food_court: ['In a food court', 'Is the location inside a food court?', 10],
    applicant_owns_building: ['Owns the building', 'Does the applicant own the building?', 10],
    leases_to_commercial_or_residential_tenants: ['Leases to tenants', 'Does the applicant lease space to commercial tenants or apartments?', 20],
    seasonal_operation: ['Seasonal', 'Is the operation seasonal?', 10],
    months_closed_per_year: ['Months closed', 'How many months a year is the location closed?', 10],
  },
  operations: {
    venue_class: ['Operating class', 'Is this a restaurant, bar, tavern, lounge or nightclub?', 20],
    year_started_at_location: ['Year started here', 'What year did the business start at this location under current ownership?', 20, { format: 'year' }],
    years_in_operation: ['Years in operation', 'How long has the business been operating?', 15, { format: 'count' }],
    years_under_current_owner: ['Years under current owner', 'How long has the current owner run this location?', 20, { format: 'count' }],
    years_ownership_experience: ['Ownership experience', 'How many years of experience does the owner have in this type of operation?', 25, { human_only: true, format: 'count' }],
    latest_closing_time: ['Latest closing time', 'What is the latest the doors close on any night?', 20],
    late_night: ['Late night operation', 'Does the venue operate past 1am?', 10],
    is_operating: ['Currently operating', 'Is the location currently open for business?', 10],
    seating_capacity: ['Seating capacity', 'What is the seating or occupancy capacity?', 20],
    tables_present: ['Tables', 'Are there tables for patrons?', 10],
    table_service: ['Table service', 'Is there table service?', 10],
    health_inspection_score: ['Health inspection score', 'What was your most recent health inspection score?', 20],
    health_inspection_history: ['Health inspection history', 'Have there been any failed or repeat health inspections?', 45],
  },
  revenue: {
    food_sales: ['Food sales', 'What were annual food sales?', 30, { human_only: true, format: 'usd' }],
    alcohol_on_premise_sales: ['On-premise alcohol sales', 'What were annual on-premise alcohol sales?', 30, { format: 'usd' }],
    alcohol_retail_sales: ['Retail alcohol sales', 'What were annual retail (to-go) alcohol sales?', 25, { human_only: true, format: 'usd' }],
    alcohol_wholesale_sales: ['Wholesale alcohol sales', 'What were annual wholesale alcohol sales?', 20, { human_only: true, format: 'usd' }],
    catering_sales: ['Catering sales', 'What were annual catering sales?', 25, { human_only: true, format: 'usd' }],
    other_sales: ['Other sales', 'What were annual sales from any other source?', 20, { human_only: true, format: 'usd' }],
    total_sales: ['Total sales', 'What were total annual sales?', 20, { format: 'usd' }],
    cover_charge_sales: ['Cover charge income', 'What did the venue take in cover charges?', 20, { format: 'usd' }],
    alcohol_pct: ['Alcohol % of sales', 'What share of sales is alcohol?', 20, { format: 'percent' }],
    receipts_history: ['Alcohol receipts history', 'Can you share monthly alcohol sales for the last year?', 60],
  },
  liquor_profile: {
    alcohol_sales_cease_time: ['Alcohol service cutoff', 'What time do alcohol sales stop?', 20],
    late_hours_permit: ['Late hours permit', 'Does the location hold a late-hours permit?', 15],
    food_beverage_certificate: ['Food & beverage certificate', 'Does the location hold a food and beverage certificate?', 15],
    wine_percent_allowed: ['Wine ABV allowed', 'What wine strength does the licence allow?', 15],
    bar_with_seating: ['Bar with seating', 'Is there a bar with seating at it?', 10],
    byob_permitted: ['BYOB', 'Are patrons permitted to bring their own alcohol?', 10],
    drink_specials_after_9pm: ['Drink specials after 9pm', 'Are drink specials or happy hour offered after 9pm?', 15],
    drink_specials_after_11pm: ['Drink specials after 11pm', 'Are drink specials offered after 11pm?', 15],
    underage_patrons_permitted: ['Underage patrons', 'Are patrons under 21 admitted?', 15],
    non_profit_or_fraternal_club: ['Club status', 'Is this a non-profit, fraternal or social club?', 10],
  },
  entertainment: {
    adult_entertainment: ['Adult entertainment', 'Is there adult entertainment or exotic dancing, and how often?', 20],
    band_3plus_excluding_jazz: ['Band of 3+ (excl. jazz)', 'Are there bands of three or more members, excluding jazz, and how often?', 25],
    banquet: ['Banquets', 'Are banquets held, and how often?', 15],
    dance_club_or_hall: ['Dance club or hall', 'Does the venue operate as a dance club or hall, and how often?', 20],
    dj_with_dancing: ['DJ with dancing', 'Is there a DJ with dancing, and how many nights a week?', 20],
    live_music: ['Live music', 'Is there live music, and how often?', 15],
    dancing_permitted: ['Dancing permitted', 'Is dancing permitted on the premises?', 10],
    gaming_machines: ['Gaming machines', 'Are there gaming or amusement machines?', 10],
    mechanical_bull_or_riding_device: ['Mechanical bull', 'Is there a mechanical bull or other riding device?', 10],
    pyrotechnics: ['Pyrotechnics', 'Are pyrotechnics used?', 10],
    foam_machines: ['Foam machines', 'Are foam machines used?', 10],
    mosh_pits: ['Mosh pits', 'Do events involve mosh pits?', 10],
    trampolines_or_pools: ['Trampolines or pools', 'Are there trampolines or pools on the premises?', 10],
    hookah_or_oxygen_inhalation: ['Hookah or oxygen', 'Is hookah smoking or oxygen gas inhalation offered on premises?', 15],
    bottle_service: ['Bottle service', 'Is bottle service offered?', 10],
  },
  security_controls: {
    bouncers_employed: ['Bouncers employed', 'Are bouncers, security or door staff employed?', 15],
    id_scanner_all_patrons: ['ID scanner on all patrons', 'Is an ID scanner used on all patrons regardless of apparent age?', 20],
    voluntary_server_training: ['Voluntary server training', 'Are all alcohol-serving staff certified in voluntary alcohol training?', 25],
    security_cameras: ['Security cameras', 'Are security cameras installed and recording?', 15],
    minimum_age_21: ['21+ venue', 'Is entry restricted to 21 and over?', 10],
  },
  property: {
    construction_class: ['Construction class', 'What is the building construction type?', 25],
    protection_class: ['Protection class', 'What is the fire protection class?', 20],
    stories: ['Stories', 'How many stories does the building have?', 10],
    year_built: ['Year built', 'What year was the building built?', 15, { format: 'year' }],
    square_footage: ['Square footage', 'What is the square footage occupied?', 15],
    roof_type: ['Roof type', 'What type of roof does the building have?', 15],
    roof_age_years: ['Roof age', 'How old is the roof?', 15, { format: 'count' }],
    plumbing_type: ['Plumbing type', 'What type of plumbing is installed?', 15],
    sprinklered_100pct: ['Fully sprinklered', 'Is the building 100% sprinklered?', 15],
    burglar_alarm: ['Burglar alarm', 'Is there a burglar alarm, and is it local or central station?', 20],
    pre1978_wiring_hazard: ['Pre-1978 wiring', 'For pre-1978 buildings, is there aluminium or knob-and-tube wiring?', 25],
    breakers_100pct: ['Circuit breakers', 'Is the building 100% on circuit breakers?', 15],
    smoke_heat_detectors_operational: ['Smoke/heat detectors', 'Are smoke and heat detectors installed and operational?', 15],
    elevated_deck_or_rooftop: ['Elevated deck or rooftop', 'Is there a deck elevated 8 feet or more, or a rooftop with patron access?', 20],
    outdoor_seating: ['Outdoor seating', 'Is there outdoor or patio seating?', 10],
    multiple_public_levels: ['Multiple public levels', 'Are there multiple levels open to the public?', 15],
    two_means_of_egress_per_floor: ['Two means of egress', 'Are there two means of egress on every floor?', 20],
    responsible_for_sidewalk_or_snow_removal: ['Sidewalk/snow responsibility', 'Is the applicant responsible for the sidewalk, parking or snow and ice removal?', 20],
  },
  fire_protection: {
    cooking_equipment: ['Cooking equipment', 'Are there grills, deep fat fryers or woks?', 20],
    suppression_type: ['Suppression type', 'Is the extinguishing system wet or dry?', 20],
    nfpa96_compliant: ['NFPA 96 compliant', 'Is the hood and duct system NFPA 96 compliant?', 25, { human_only: true }],
    hood_cleaning_contract_in_force: ['Hood cleaning contract', 'Is there a hood cleaning contract currently in force?', 25, { human_only: true }],
    extinguishers_to_code: ['Extinguishers to code', 'Are fire extinguishers installed to code and inspected?', 20, { human_only: true }],
  },
  loss_history: {
    losses: ['Losses (5 years)', 'Can you provide loss runs for the last five years?', 180, { human_only: true }],
    liquor_violations: ['Liquor violations', 'Have there been any liquor violations, citations or enforcement actions?', 60],
    cancelled_or_nonrenewed_past_3y: ['Cancelled or non-renewed', 'Has coverage been cancelled or non-renewed in the past three years?', 30, { human_only: true }],
    bankruptcy_foreclosure_or_tax_judgment: ['Bankruptcy or judgment', 'Has any owner or officer had a bankruptcy, foreclosure or unpaid tax judgment?', 30, { human_only: true, sensitive: true }],
  },
  coverage_requested: {
    general_liability_limits: ['GL limits', 'What general liability limits are required?', 25, { human_only: true }],
    liquor_liability_limits: ['Liquor limits', 'What liquor liability limits are required?', 25, { human_only: true }],
    assault_battery_sublimit: ['A&B sublimit', 'Is an assault and battery sublimit required, and at what limit?', 25, { human_only: true }],
    property_limit: ['Property limit', 'What property limit is required?', 25, { human_only: true, format: 'usd' }],
    business_income_limit: ['Business income limit', 'What business income limit is required?', 25, { human_only: true, format: 'usd' }],
    x_date: ['X-date', 'When does the current policy expire?', 20, { human_only: true }],
    current_carrier: ['Current carrier', 'Who is the current carrier?', 20, { human_only: true }],
  },
};

function build(): Map<FieldPath, FieldMeta> {
  const out = new Map<FieldPath, FieldMeta>();
  for (const [group, rows] of Object.entries(TABLE) as Array<[ProfileGroup, Record<string, Row>]>) {
    for (const [leaf, row] of Object.entries(rows)) {
      const [label, question, ask_seconds, opts] = row;
      out.set(path(`${group}.${leaf}`), {
        path: path(`${group}.${leaf}`),
        group,
        label,
        question,
        ask_seconds,
        ...(opts ?? {}),
      });
    }
  }
  return out;
}

export const FIELD_REGISTRY: ReadonlyMap<FieldPath, FieldMeta> = build();

export const ALL_FIELD_PATHS: readonly FieldPath[] = [...FIELD_REGISTRY.keys()];

export function meta(p: FieldPath): FieldMeta {
  const m = FIELD_REGISTRY.get(p);
  if (!m) throw new Error(`Unknown field path: ${p}`);
  return m;
}

/** Total call time to ask every question in the schema. The denominator for time saved. */
export const TOTAL_ASK_SECONDS: number =
  [...FIELD_REGISTRY.values()].reduce((n, m) => n + m.ask_seconds, 0);
