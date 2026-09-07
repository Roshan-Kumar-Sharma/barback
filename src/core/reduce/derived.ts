/**
 * Cross-source derived fields.
 *
 * Split of responsibility: a derivation needing only one source's raw payload
 * belongs to that enricher (years in operation from a licence issue date). A
 * derivation spanning sources belongs here, because no single enricher can see
 * enough to compute it.
 *
 * Derived fields must show their working — every candidate emitted here carries
 * `inputs`, so the review UI can walk from a derived value back to the records
 * it rests on.
 *
 * A derivation that CANNOT complete still emits, with a null value and a note
 * naming the missing input. "We know your alcohol sales and need one more
 * number from you" is a far more useful answer than silence, and it is what
 * turns a section of the intake call into a single question.
 */
import { path, type FieldCandidate, type FieldPath } from '../field.js';
import { getField, type RiskProfile } from '../schema/index.js';
import type { VenueClass } from '../schema/types.js';

export type Ctx = { now: Date };

export type Derivation = {
  path: FieldPath;
  /** Emits zero or one candidate. Null means the derivation does not apply at all. */
  derive(profile: RiskProfile, ctx: Ctx): FieldCandidate | null;
};

export const val = <T>(profile: RiskProfile, p: string): T | null =>
  (getField(profile, path(p))?.value ?? null) as T | null;

export const asOfOf = (profile: RiskProfile, ...paths: string[]): string | null => {
  for (const p of paths) {
    const f = getField(profile, path(p));
    if (f?.as_of) return f.as_of;
  }
  return null;
};

export const base = (ctx: Ctx) => ({
  source: 'derived' as const,
  method: 'derived' as const,
  retrieved_at: ctx.now.toISOString(),
});

/**
 * Alcohol as a share of total sales.
 *
 * Carriers collect the revenue split in dollars and compute this themselves, so
 * we must too. In Texas the numerator is a public tax record; the denominator
 * needs food sales from the insured. When it is missing we say exactly that,
 * and show the number we already hold.
 */
const alcoholPct: Derivation = {
  path: path('revenue.alcohol_pct'),
  derive(profile, ctx) {
    const alcohol = val<number>(profile, 'revenue.alcohol_on_premise_sales');
    if (alcohol === null) return null;

    const food = val<number>(profile, 'revenue.food_sales');
    const other = (val<number>(profile, 'revenue.catering_sales') ?? 0)
      + (val<number>(profile, 'revenue.other_sales') ?? 0)
      + (val<number>(profile, 'revenue.alcohol_retail_sales') ?? 0);
    const cover = val<number>(profile, 'revenue.cover_charge_sales') ?? 0;

    const inputs = [
      path('revenue.alcohol_on_premise_sales'),
      path('revenue.food_sales'),
      path('revenue.cover_charge_sales'),
    ];

    if (food === null) {
      return {
        path: path('revenue.alcohol_pct'),
        value: null,
        confidence: 0,
        as_of: asOfOf(profile, 'revenue.alcohol_on_premise_sales'),
        inputs,
        notes:
          `Blocked on one input. On-premise alcohol sales are known ($${Math.round(alcohol).toLocaleString('en-US')} ` +
          `over the trailing 12 months, from state tax filings), but food sales are not published anywhere ` +
          'and must come from the insured. Ask for annual food sales and this resolves immediately.',
        ...base(ctx),
      };
    }

    const total = alcohol + food + other + cover;
    if (total <= 0) return null;

    return {
      path: path('revenue.alcohol_pct'),
      value: Number((alcohol / total).toFixed(3)),
      confidence: 0.85,
      as_of: asOfOf(profile, 'revenue.alcohol_on_premise_sales'),
      inputs,
      notes:
        `On-premise alcohol $${Math.round(alcohol).toLocaleString('en-US')} of $${Math.round(total).toLocaleString('en-US')} total. ` +
        'Alcohol figure is a state tax record; the remainder is as supplied.',
      ...base(ctx),
    };
  },
};

/**
 * Late-night trading.
 *
 * True when the venue is observed closing at or after 02:00, OR holds a Late
 * Hours Certificate. The permit alone is enough: a carrier that declines
 * late-night risk is declining the authority to trade late, not just the habit.
 */
const lateNight: Derivation = {
  path: path('operations.late_night'),
  derive(profile, ctx) {
    const closing = val<string>(profile, 'operations.latest_closing_time');
    const lh = val<boolean>(profile, 'liquor_profile.late_hours_permit');
    if (closing === null && lh === null) return null;

    const inputs = [path('operations.latest_closing_time'), path('liquor_profile.late_hours_permit')];
    const closesLate = closing !== null && isAtOrAfter2am(closing);

    if (closesLate) {
      return {
        path: path('operations.late_night'),
        value: true,
        confidence: 0.9,
        as_of: asOfOf(profile, 'operations.latest_closing_time'),
        inputs,
        notes: `Observed closing time ${closing}.`,
        ...base(ctx),
      };
    }
    if (lh === true) {
      return {
        path: path('operations.late_night'),
        value: true,
        confidence: 0.75,
        as_of: asOfOf(profile, 'liquor_profile.late_hours_permit'),
        inputs,
        notes:
          'Holds a Late Hours Certificate' +
          (closing !== null
            ? `, though observed hours end at ${closing}. The venue is authorised to trade late whether or not it does.`
            : '. Observed closing time unknown.'),
        ...base(ctx),
      };
    }
    if (closing !== null && lh === false) {
      return {
        path: path('operations.late_night'),
        value: false,
        confidence: 0.85,
        as_of: asOfOf(profile, 'operations.latest_closing_time'),
        inputs,
        notes: `Closes ${closing} and holds no Late Hours Certificate.`,
        ...base(ctx),
      };
    }
    return null;
  },
};

/** Hours after midnight sort before hours before it, so compare on a 26-hour clock. */
function isAtOrAfter2am(hhmm: string): boolean {
  const [h, m] = hhmm.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h)) return false;
  // 00:00–05:59 are the small hours of the following day.
  const minutes = h < 6 ? (h + 24) * 60 + m : h * 60 + m;
  return minutes >= 26 * 60;
}

/** NAICS follows from the operating class. 722511 full-service, 722410 drinking places. */
const naics: Derivation = {
  path: path('identity.naics_code'),
  derive(profile, ctx) {
    const cls = val<VenueClass>(profile, 'operations.venue_class');
    if (cls === null) return null;
    const drinking: VenueClass[] = ['bar', 'tavern', 'lounge', 'nightclub'];
    const code = drinking.includes(cls) ? '722410' : '722511';
    return {
      path: path('identity.naics_code'),
      value: code,
      confidence: 0.7,
      as_of: asOfOf(profile, 'operations.venue_class'),
      inputs: [path('operations.venue_class')],
      notes:
        `${code} (${code === '722410' ? 'Drinking Places (Alcoholic Beverages)' : 'Full-Service Restaurants'}) ` +
        `from operating class "${cls}". Carriers may class this differently; confirm before submission.`,
      ...base(ctx),
    };
  },
};

/**
 * Derivations that hold in any state, because they rest only on schema fields
 * rather than on any source's vocabulary.
 *
 * State-specific derivations (operating class from Texas licence codes, say)
 * are contributed by that state's source set and run BEFORE these — see
 * `derivationsFor` in enrichers/index.ts. That keeps the core ignorant of every
 * source, which is what makes "adding a source must not touch the core" a
 * property of the build graph rather than a promise in a README.
 *
 * Order matters within a list: each derivation reads the profile as it stands
 * after the previous ones, so venue_class must be in place before naics runs.
 */
export const CORE_DERIVATIONS: readonly Derivation[] = [alcoholPct, lateNight, naics];
