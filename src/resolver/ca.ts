/**
 * California venue resolution.
 *
 * Same principle as Texas — start from the licence register, because every
 * venue in this class must hold one — but a different mechanism. There is no
 * queryable API, so the whole state's export is downloaded once and indexed in
 * memory, and the search runs locally.
 *
 * That difference is confined to this file and the dataset loader. The resolver
 * contract, the scoring and the ambiguity rules are shared, which is the point:
 * a new state should change how rows are fetched, not what "resolved" means.
 */
import type { Fetcher } from '../core/enricher.js';
import { anchorToken, nameScore, normalizeName } from '../core/text/similarity.js';
import type { Venue, VenueCandidate, VenueResolution } from '../core/venue.js';
import { caTypeInfo, isCaInClass } from '../enrichers/ca_abc/codes.js';
import { caDate, loadCaIndex, type CaIndex, type CaLicenceRow } from '../enrichers/ca_abc/dataset.js';
import { AUTO_RESOLVE_MARGIN, AUTO_RESOLVE_SCORE, type ResolveOptions } from './tx.js';

export async function resolveCalifornia(fetcher: Fetcher, opts: ResolveOptions): Promise<VenueResolution> {
  const index = await loadCaIndex(fetcher);
  const normalized = normalizeName(opts.name);
  const rows = search(index, opts);

  if (rows.length === 0) {
    return {
      status: 'not_found',
      searched: normalized,
      note: 'No California ABC licence matched that trade name. The venue may be unlicensed, closed, trading under a different name, or outside California.',
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
      note: 'Licences matched the name but none were on-premise retail types, so none are in class.',
    };
  }

  const [best, runnerUp] = candidates;
  if (!best) return { status: 'not_found', searched: normalized, note: 'No scorable candidates.' };

  const clearlyBest = runnerUp === undefined || best.score - runnerUp.score >= AUTO_RESOLVE_MARGIN;
  if (best.score >= AUTO_RESOLVE_SCORE && clearlyBest) {
    return { status: 'resolved', venue: best.venue, score: best.score, alternatives: candidates.slice(1) };
  }
  return { status: 'ambiguous', candidates };
}

/**
 * Exact-key lookup first, then a scan.
 *
 * The name index answers the common case in constant time. Only when it misses
 * do we fall back to scanning 129k rows for a substring, which is the cost of
 * having no server-side query — and is still a few milliseconds.
 */
function search(index: CaIndex, opts: ResolveOptions): CaLicenceRow[] {
  const wantCity = opts.city?.toUpperCase();
  const cityOk = (r: CaLicenceRow): boolean => wantCity === undefined || r.city.toUpperCase() === wantCity;
  const statusOk = (r: CaLicenceRow): boolean =>
    opts.includeInactive === true || /active/i.test(r.status);

  const exact = index.byName.get(normalizeName(opts.name)) ?? [];
  const hits = exact.map((i) => index.rows[i]!).filter((r) => cityOk(r) && statusOk(r));
  if (hits.length > 0) return hits;

  const needle = normalizeName(opts.name);
  const anchor = anchorToken(opts.name);
  const out: CaLicenceRow[] = [];
  for (const r of index.rows) {
    if (!cityOk(r) || !statusOk(r)) continue;
    const dba = normalizeName(r.dba_name);
    const primary = normalizeName(r.primary_name);
    if (dba.includes(needle) || primary.includes(needle)
      || (anchor !== null && (dba.includes(anchor) || primary.includes(anchor)))) {
      out.push(r);
      if (out.length >= 200) break;
    }
  }
  return out;
}

function score(row: CaLicenceRow, opts: ResolveOptions): VenueCandidate | null {
  const tradeName = row.dba_name || row.primary_name;
  if (!tradeName || !row.file_number || !row.city || !row.addr1) return null;
  // Out-of-class licences are excluded outright: an off-sale package store is
  // not a low-scoring bar, it is a different business.
  if (!isCaInClass(row.license_type)) return null;

  const signals: string[] = [];
  const nameMatch = Math.max(
    nameScore(opts.name, tradeName),
    row.primary_name ? nameScore(opts.name, row.primary_name) : 0,
  );
  signals.push(`name similarity ${nameMatch.toFixed(2)}`);
  let s = nameMatch * 0.8;

  if (/active/i.test(row.status)) { s += 0.1; signals.push('licence active'); }
  else signals.push(`licence status: ${row.status || 'unknown'}`);

  if (/lic/i.test(row.lic_or_app)) { s += 0.02; signals.push('issued (not an application)'); }
  if (opts.city && row.city.toUpperCase() === opts.city.toUpperCase()) {
    s += 0.08;
    signals.push(`city matches ${row.city}`);
  }

  const info = caTypeInfo(row.license_type);
  if (info) signals.push(info.label);
  const issued = caDate(row.orig_issue_date);
  if (issued) signals.push(`licence originally issued ${issued}`);

  const zip = row.zip.replace(/\D/g, '');
  const venue: Venue = {
    id: `CA:${row.file_number}`,
    state: 'CA',
    trade_name: tradeName,
    legal_name: row.primary_name || null,
    address: {
      line1: row.addr1,
      ...(row.addr2 ? { line2: row.addr2 } : {}),
      city: row.city,
      state: 'CA',
      zip: zip.slice(0, 5),
      ...(zip.length === 9 ? { zip4: zip.slice(5) } : {}),
      ...(row.county ? { county: row.county } : {}),
    },
    license_id: row.file_number,
    license_type: row.license_type,
  };

  return { venue, score: Math.min(1, s), signals };
}
