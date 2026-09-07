/**
 * The California ABC daily export.
 *
 * A different source SHAPE from everything else in Barback: not an API but a
 * 7MB zip containing a 27MB CSV of every licence in the state. Worth having
 * anyway — it is the authoritative register, and it is the only free way to
 * resolve a California venue.
 *
 * Handled by downloading through the fetcher's bulk-file path (so caching,
 * rate limiting and the User-Agent still apply in one place), then building an
 * in-memory index once per process. 129k rows is about 30MB resident, which is
 * cheap next to re-reading the file for every lookup.
 */
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import type { Fetcher } from '../../core/enricher.js';
import { normalizeName } from '../../core/text/similarity.js';

export const CA_ABC_EXPORT_URL = 'https://www.abc.ca.gov/wp-content/uploads/DailyExport-CSV.zip';
export const CA_ABC_SOURCE_PAGE = 'https://www.abc.ca.gov/licensing/licensing-reports/';

/** Published daily; a day of staleness is not an underwriting risk. */
const TTL_SECONDS = 60 * 60 * 20;

export type CaLicenceRow = {
  license_type: string;
  file_number: string;
  /** 'LIC' for issued, 'APP' for pending. */
  lic_or_app: string;
  status: string;
  orig_issue_date: string;
  expiry_date: string;
  primary_name: string;
  dba_name: string;
  addr1: string;
  addr2: string;
  city: string;
  state: string;
  zip: string;
  county: string;
};

export type CaIndex = {
  rows: CaLicenceRow[];
  /** Normalised trade name -> row indices. */
  byName: Map<string, number[]>;
  retrieved_at: string;
  /** The export's own "Updated ..." banner line — the record date. */
  as_of: string;
};

let cached: CaIndex | null = null;

/** Build (or reuse) the index. One download and one parse per process. */
export async function loadCaIndex(fetcher: Fetcher): Promise<CaIndex> {
  if (cached) return cached;

  const file = await fetcher.getFile({
    url: CA_ABC_EXPORT_URL,
    ttl_seconds: TTL_SECONDS,
    extension: 'zip',
  });

  const zipped = await readFile(file.path);
  const entries = unzipSync(new Uint8Array(zipped));
  const csvName = Object.keys(entries).find((n) => /\.csv$/i.test(n));
  if (!csvName) throw new Error('California ABC export contained no CSV');

  const csv = strFromU8(entries[csvName]!);
  cached = parseExport(csv, file.retrieved_at);
  return cached;
}

/** Reset between tests, and whenever a fresh download is forced. */
export function clearCaIndex(): void {
  cached = null;
}

export function parseExport(csv: string, retrievedAt: string): CaIndex {
  const lines = splitLines(csv);
  // Line 1 is a banner ("Updated Monday 7th of September 2026 ..."), line 2 is
  // the header. Assuming line 1 is the header would silently produce one
  // garbage row and shift nothing else, which is the sort of bug that survives
  // a long time.
  const banner = lines[0] ?? '';
  const header = parseCsvLine(lines[1] ?? '').map((h) => h.trim().toLowerCase());
  const col = (name: string): number => header.indexOf(name.toLowerCase());

  const idx = {
    license_type: col('license type'),
    file_number: col('file number'),
    lic_or_app: col('lic or app'),
    status: col('type status'),
    orig: col('type orig iss date'),
    expiry: col('expir date'),
    primary: col('primary name'),
    dba: col('dba name'),
    addr1: col('prem addr 1'),
    addr2: col('prem addr 2'),
    city: col('prem city'),
    state: col('prem state'),
    zip: col('prem zip'),
    county: col('prem county'),
  };
  if (idx.license_type < 0 || idx.primary < 0) {
    throw new Error(`California ABC export header not recognised: ${header.slice(0, 6).join(', ')}`);
  }

  const rows: CaLicenceRow[] = [];
  const byName = new Map<string, number[]>();

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;
    const f = parseCsvLine(line);
    const at = (n: number): string => (n >= 0 ? (f[n] ?? '').trim() : '');

    const row: CaLicenceRow = {
      license_type: at(idx.license_type),
      file_number: at(idx.file_number),
      lic_or_app: at(idx.lic_or_app),
      status: at(idx.status),
      orig_issue_date: at(idx.orig),
      expiry_date: at(idx.expiry),
      primary_name: at(idx.primary),
      dba_name: at(idx.dba),
      addr1: at(idx.addr1),
      addr2: at(idx.addr2),
      city: at(idx.city),
      state: at(idx.state),
      zip: at(idx.zip),
      county: at(idx.county),
    };
    if (row.primary_name.length === 0 && row.dba_name.length === 0) continue;

    const at_index = rows.push(row) - 1;
    // Index on both names: a venue trades under its DBA, but the export often
    // repeats the corporate name there, and either may be what a broker types.
    for (const name of new Set([row.dba_name, row.primary_name].filter(Boolean))) {
      const key = normalizeName(name);
      if (key.length === 0) continue;
      const list = byName.get(key);
      if (list) list.push(at_index);
      else byName.set(key, [at_index]);
    }
  }

  return {
    rows,
    byName,
    retrieved_at: retrievedAt,
    as_of: parseBannerDate(banner) ?? retrievedAt.slice(0, 10),
  };
}

/** "Updated Monday 7th of September 2026 03:50:24 AM" -> "2026-09-07". */
export function parseBannerDate(banner: string): string | null {
  const m = /(\d{1,2})(?:st|nd|rd|th)?\s+of\s+([A-Za-z]+)\s+(\d{4})/.exec(banner);
  if (!m) return null;
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];
  const mi = months.indexOf((m[2] ?? '').toLowerCase());
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}

function splitLines(csv: string): string[] {
  return csv.replace(/^﻿/, '').split(/\r?\n/);
}

/** CSV field splitter handling quoted fields and doubled quotes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(field); field = ''; }
    else field += ch;
  }
  out.push(field);
  return out;
}

/** CA dates arrive as "MM/DD/YYYY" or blank/space-filled. */
export function caDate(v: string | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  if (!m) return null;
  return `${m[3]}-${String(Number(m[1])).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}
