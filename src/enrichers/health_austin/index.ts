/**
 * City of Austin food establishment inspection scores.
 *
 * A proxy for operational discipline. Not a question on any carrier
 * application, and presented as such — but a venue with a falling inspection
 * score is a venue where something is slipping, and loss control notices.
 *
 * BE CLEAR ABOUT WHAT THIS IS NOT. The reason health data is usually worth
 * having is the violation TEXT: grease accumulation and hood citations bear
 * directly on the fire questions carriers ask. Austin publishes only a numeric
 * score, with no violation detail, so that signal is not available here. What
 * is left is a trend, which is real but weaker than the source promised.
 *
 * Matching carries the same misattribution risk as OpenStreetMap and is handled
 * the same way: the street address must agree AND the name must match, because
 * a strip mall's neighbours share an address and a bad score attached to the
 * wrong venue would be a confidently-sourced lie.
 */
import type { Enricher, EnricherContext, EnrichResult } from '../../core/enricher.js';
import { path, type FieldCandidate } from '../../core/field.js';
import type { HealthInspection } from '../../core/schema/types.js';
import { nameScore } from '../../core/text/similarity.js';
import type { Venue } from '../../core/venue.js';

const DATASET = 'ecmv-9xxi';
const HOST = 'https://datahub.austintexas.gov';
export const EVIDENCE_URL = `${HOST}/d/${DATASET}`;

const TTL_SECONDS = 60 * 60 * 24 * 7;
/** Inspection records only attach to a venue whose name matches this well. */
const NAME_MATCH_THRESHOLD = 0.62;
/** Austin-area ZIP prefixes; the dataset covers Travis County and neighbours. */
const SERVED_ZIP_PREFIX = '78';

export const PRODUCES = [
  'operations.health_inspection_score',
  'operations.health_inspection_history',
].map(path);

type Row = {
  restaurant_name?: string;
  address?: string;
  zip_code?: string;
  inspection_date?: string;
  score?: string;
  process_description?: string;
};

export class AustinHealthEnricher implements Enricher {
  readonly id = 'health_austin' as const;
  readonly produces = PRODUCES;
  readonly requires = ['address'] as const;
  readonly attribution = {
    name: 'City of Austin — Food Establishment Inspection Scores',
    url: EVIDENCE_URL,
    license: 'Public record, City of Austin open data',
    notice: 'Contains information published by the City of Austin.',
  };

  async run(venue: Venue, ctx: EnricherContext): Promise<EnrichResult> {
    // Cheap guard: the dataset is Austin-area only, so skip the request
    // entirely rather than asking a city portal about a venue in Houston.
    if (!venue.address.zip.startsWith(SERVED_ZIP_PREFIX)) {
      ctx.log.debug('health_austin: outside the dataset footprint', { zip: venue.address.zip });
      return { fields: [] };
    }

    const url = new URL(`${HOST}/resource/${DATASET}.json`);
    url.searchParams.set('$where', `starts_with(zip_code, '${venue.address.zip.slice(0, 5)}')`);
    url.searchParams.set('$order', 'inspection_date DESC');
    url.searchParams.set('$limit', '2000');

    const fetched = await ctx.fetch.get({ url: url.toString(), ttl_seconds: TTL_SECONDS });
    if (fetched.status !== 200 || !Array.isArray(fetched.body)) return { fields: [] };

    const street = streetKey(venue.address.line1);
    const matches = (fetched.body as Row[]).filter((r) => {
      if (!r.restaurant_name || !r.address) return false;
      if (streetKey(r.address) !== street) return false;
      return nameScore(venue.trade_name, r.restaurant_name) >= NAME_MATCH_THRESHOLD;
    });

    if (matches.length === 0) {
      ctx.log.debug('health_austin: no inspection matched name and address', { venue: venue.trade_name });
      return { fields: [] };
    }

    const history: HealthInspection[] = matches
      .map((r) => ({
        date: (r.inspection_date ?? '').slice(0, 10),
        score: Number(r.score),
        kind: r.process_description ?? 'Inspection',
      }))
      .filter((h) => h.date.length === 10 && Number.isFinite(h.score))
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    const latest = history[0];
    if (!latest) return { fields: [] };

    const base = {
      source: this.id,
      method: 'record' as const,
      retrieved_at: fetched.retrieved_at,
      evidence_url: EVIDENCE_URL,
      evidence_ref: fetched.ref,
    };

    const trend = describeTrend(history);
    const out: FieldCandidate[] = [
      {
        path: path('operations.health_inspection_score'),
        value: latest.score,
        confidence: 0.9,
        as_of: latest.date,
        notes:
          `${latest.kind} on ${latest.date}. ${trend} Austin publishes scores only, with no violation ` +
          'detail, so this says nothing about hood or grease citations specifically.',
        ...base,
      },
      {
        path: path('operations.health_inspection_history'),
        value: history,
        confidence: 0.9,
        as_of: latest.date,
        notes: `${history.length} published inspection(s), newest first.`,
        ...base,
      },
    ];
    return { fields: out };
  }
}

/**
 * Canonical street suffixes.
 *
 * These are NORMALISED rather than stripped. Deleting them looks tidier and is
 * wrong: "100 Main St" and "100 Main Ave" are different buildings, and a city
 * that has both would hand one venue's inspection history to the other. The
 * variance we actually need to absorb is spelling ("Street" vs "St"), not the
 * suffix itself.
 */
const SUFFIX: Readonly<Record<string, string>> = {
  STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', BOULEVARD: 'BLVD', DRIVE: 'DR',
  LANE: 'LN', COURT: 'CT', PLACE: 'PL', PARKWAY: 'PKWY', HIGHWAY: 'HWY',
  TRAIL: 'TRL', CIRCLE: 'CIR', TERRACE: 'TER', SQUARE: 'SQ',
};

/** Normalised street portion of an address, for exact matching. */
export function streetKey(address: string): string {
  const cleaned = address
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\b(STE|SUITE|UNIT|APT|BLDG|FL|FLOOR)\b.*$/, '')
    // The health dataset appends the city to the street line; licence records
    // keep it separate.
    .replace(/\b(AUSTIN|PFLUGERVILLE|DEL VALLE|MANOR|ROLLINGWOOD|WEST LAKE HILLS)\b\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned
    .split(' ')
    .map((tok) => SUFFIX[tok] ?? tok)
    .join(' ');
}

/** A falling score is the signal; a single number is nearly meaningless. */
export function describeTrend(history: HealthInspection[]): string {
  if (history.length < 2) return 'Only one published inspection, so there is no trend to read.';
  const recent = history.slice(0, 3);
  const older = history.slice(3, 6);
  if (older.length === 0) return `Scores: ${recent.map((h) => h.score).join(', ')}.`;

  const avg = (xs: HealthInspection[]): number => xs.reduce((n, h) => n + h.score, 0) / xs.length;
  const delta = avg(recent) - avg(older);
  const direction = delta <= -3 ? 'declining' : delta >= 3 ? 'improving' : 'stable';
  return `Recent scores ${recent.map((h) => h.score).join(', ')} — ${direction} against earlier inspections.`;
}
