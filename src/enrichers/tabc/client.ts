/**
 * Socrata client for the Texas Open Data Portal.
 *
 * Two datasets, both public, both free, neither requiring credentials:
 *   7hf9-qc9f  TABC License Information       — the licence record
 *   naix-2893  Mixed Beverage Gross Receipts  — monthly alcohol tax filings
 *
 * A Socrata app token is optional. Without one we share an anonymous
 * rate-limit pool, which is fine at our volume and is why the cache exists.
 */
import type { Fetched, Fetcher } from '../../core/enricher.js';

export const DATASETS = {
  license: { id: '7hf9-qc9f', name: 'TABC License Information' },
  receipts: { id: 'naix-2893', name: 'Mixed Beverage Gross Receipts' },
} as const;

const HOST = 'https://data.texas.gov';

export const datasetUrl = (id: string): string => `${HOST}/d/${id}`;

/** SoQL string literal escaping. Single quotes double. */
export function soqlLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export type SoqlQuery = {
  select?: string;
  where?: string;
  order?: string;
  limit?: number;
  offset?: number;
};

export function buildUrl(datasetId: string, q: SoqlQuery): string {
  const u = new URL(`${HOST}/resource/${datasetId}.json`);
  if (q.select) u.searchParams.set('$select', q.select);
  if (q.where) u.searchParams.set('$where', q.where);
  if (q.order) u.searchParams.set('$order', q.order);
  u.searchParams.set('$limit', String(q.limit ?? 100));
  if (q.offset) u.searchParams.set('$offset', String(q.offset));
  return u.toString();
}

export type SocrataRow = Record<string, string | undefined>;

export async function query(
  fetcher: Fetcher,
  datasetId: string,
  q: SoqlQuery,
  opts: { ttl_seconds?: number; appToken?: string } = {},
): Promise<{ rows: SocrataRow[]; fetched: Fetched }> {
  const url = buildUrl(datasetId, q);
  const fetched = await fetcher.get({
    url,
    ...(opts.appToken ? { headers: { 'x-app-token': opts.appToken } } : {}),
    ...(opts.ttl_seconds === undefined ? {} : { ttl_seconds: opts.ttl_seconds }),
  });
  if (fetched.status !== 200) {
    throw new Error(`Socrata ${datasetId} returned ${fetched.status}: ${JSON.stringify(fetched.body).slice(0, 200)}`);
  }
  if (!Array.isArray(fetched.body)) {
    throw new Error(`Socrata ${datasetId} returned a non-array body`);
  }
  return { rows: fetched.body as SocrataRow[], fetched };
}

/** Socrata dates arrive as "1987-12-11T00:00:00.000". Keep the date part only. */
export function isoDate(v: string | undefined): string | null {
  if (!v) return null;
  const d = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** Numeric ids arrive as "200097471.0". Strip the float tail. */
export function idString(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim().replace(/\.0+$/, '');
  return s.length > 0 ? s : null;
}

export function num(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Subordinate permit columns are counts. Any positive count means "held". */
export function flag(v: string | undefined): boolean {
  const n = num(v);
  return n !== null && n > 0;
}
