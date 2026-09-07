/**
 * Texas venue resolution: name + state -> a licensed venue.
 *
 * The candidate list is the TABC licence register rather than a map provider,
 * because in Texas every venue in this class must hold a licence. Starting from
 * the regulatory record means a resolved venue is by construction a real,
 * licensed, in-class business — a map search can happily return a food truck,
 * a closed venue or a name collision in another city.
 *
 * Resolution NEVER returns a bare venue. A wrong pick here is the worst failure
 * mode in Barback: every downstream field would be wrong AND would carry an
 * authoritative-looking government citation.
 */
import type { Fetcher } from '../core/enricher.js';
import type { StateCode, Venue, VenueCandidate, VenueResolution } from '../core/venue.js';
import { DATASETS, idString, isoDate, query, soqlLiteral, type SocrataRow } from '../enrichers/tabc/client.js';
import { isInClass, typeInfo } from '../enrichers/tabc/codes.js';
import { anchorToken, nameScore, normalizeName } from '../core/text/similarity.js';

export type ResolveOptions = {
  name: string;
  state: StateCode;
  city?: string | undefined;
  /** Include licences that are not currently active. Off by default. */
  includeInactive?: boolean;
  limit?: number;
  appToken?: string | undefined;
};

/** Auto-resolve only above this score. Below it, the human picks. */
export const AUTO_RESOLVE_SCORE = 0.85;
/** ...and only when the runner-up is clearly behind. */
export const AUTO_RESOLVE_MARGIN = 0.08;

export async function resolveTexas(fetcher: Fetcher, opts: ResolveOptions): Promise<VenueResolution> {
  const normalized = normalizeName(opts.name);
  const rows = await search(fetcher, normalized, opts);

  if (rows.length === 0) {
    return {
      status: 'not_found',
      searched: normalized,
      note: 'No TABC licence matched that trade name. The venue may be unlicensed, closed, trading under a different name, or outside Texas.',
    };
  }

  const candidates = rows
    .map((row) => score(row, opts))
    .filter((c): c is VenueCandidate => c !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 10);

  if (candidates.length === 0) {
    return {
      status: 'not_found',
      searched: normalized,
      note: 'Licences matched the name but none were on-premise retail permits, so none are in class.',
    };
  }

  const [best, runnerUp] = candidates;
  if (!best) {
    return { status: 'not_found', searched: normalized, note: 'No scorable candidates.' };
  }

  const clearlyBest = runnerUp === undefined || best.score - runnerUp.score >= AUTO_RESOLVE_MARGIN;
  if (best.score >= AUTO_RESOLVE_SCORE && clearlyBest) {
    return { status: 'resolved', venue: best.venue, score: best.score, alternatives: candidates.slice(1) };
  }
  return { status: 'ambiguous', candidates };
}

async function search(fetcher: Fetcher, normalized: string, opts: ResolveOptions): Promise<SocrataRow[]> {
  const clauses: string[] = [`upper(trade_name) like ${soqlLiteral(`%${normalized}%`)}`];
  if (opts.city) clauses.push(`upper(city) = ${soqlLiteral(opts.city.toUpperCase())}`);
  if (!opts.includeInactive) clauses.push(`upper(primary_status) like 'ACTIVE%'`);

  const first = await query(fetcher, DATASETS.license.id, {
    where: clauses.join(' AND '),
    limit: 200,
  }, { ttl_seconds: 3600, ...(opts.appToken ? { appToken: opts.appToken } : {}) });

  if (first.rows.length > 0) return first.rows;

  // Nothing on the full name. Widen to the longest distinctive token before
  // giving up — "Blue Light Social" should still find "BLUE LIGHT".
  const anchor = anchorToken(opts.name);
  if (!anchor || anchor === normalized) return [];

  const wide = [...clauses];
  wide[0] = `upper(trade_name) like ${soqlLiteral(`%${anchor}%`)}`;
  const second = await query(fetcher, DATASETS.license.id, {
    where: wide.join(' AND '),
    limit: 200,
  }, { ttl_seconds: 3600, ...(opts.appToken ? { appToken: opts.appToken } : {}) });
  return second.rows;
}

/**
 * Permit numbers this venue could file under, most likely first.
 *
 * The legacy number is listed first because a venue that has one has been
 * trading long enough to have filing history under it, and the register stores
 * it with inconsistent spacing ("Q 189591" as well as "BG227874").
 */
export function permitCandidates(
  licenseType: string | undefined,
  licenseId: string,
  legacyClp: string | undefined,
): string[] {
  const out: string[] = [];
  const legacy = legacyClp?.replace(/\s+/g, '').toUpperCase();
  if (legacy) out.push(legacy);
  if (licenseType) {
    const modern = `${licenseType}${licenseId}`;
    if (!out.includes(modern)) out.push(modern);
  }
  return out;
}

function score(row: SocrataRow, opts: ResolveOptions): VenueCandidate | null {
  const tradeName = row['trade_name']?.trim();
  const licenseType = row['license_type']?.trim().toUpperCase();
  const licenseId = idString(row['license_id']);
  const city = row['city']?.trim();
  const line1 = row['address']?.trim();
  if (!tradeName || !licenseId || !city || !line1) return null;

  // Out-of-class licences are excluded outright rather than down-weighted:
  // a package store is not a bar with a low score, it is a different business.
  if (!isInClass(licenseType)) return null;

  const signals: string[] = [];
  const nameMatch = nameScore(opts.name, tradeName);
  signals.push(`name similarity ${nameMatch.toFixed(2)}`);

  let s = nameMatch * 0.8;

  const status = row['primary_status']?.trim() ?? '';
  if (/^active$/i.test(status)) {
    s += 0.1;
    signals.push('licence active');
  } else {
    signals.push(`licence status: ${status || 'unknown'}`);
  }

  if (opts.city && city.toUpperCase() === opts.city.toUpperCase()) {
    s += 0.08;
    signals.push(`city matches ${city}`);
  }

  const info = typeInfo(licenseType);
  if (info) signals.push(info.label);
  if (info?.spirits) {
    s += 0.02;
    signals.push('full liquor permit');
  }

  const zipRaw = (row['zip'] ?? '').replace(/\D/g, '');
  const permits = permitCandidates(licenseType, licenseId, row['legacy_clp']);
  const venue: Venue = {
    id: `TX:${licenseId}`,
    state: 'TX',
    trade_name: tradeName,
    legal_name: row['owner']?.trim() ?? null,
    address: {
      line1,
      ...(row['address_2']?.trim() ? { line2: row['address_2'].trim() } : {}),
      city,
      state: 'TX',
      zip: zipRaw.slice(0, 5),
      ...(zipRaw.length === 9 ? { zip4: zipRaw.slice(5) } : {}),
      ...(row['county']?.trim() ? { county: row['county'].trim() } : {}),
    },
    license_id: licenseId,
    ...(licenseType ? { license_type: licenseType } : {}),
    ...(permits.length > 0 ? { permit_number: permits[0]!, permit_candidates: permits } : {}),
  };

  const issued = isoDate(row['original_issue_date']);
  if (issued) signals.push(`licence originally issued ${issued}`);

  return { venue, score: Math.min(1, s), signals };
}
