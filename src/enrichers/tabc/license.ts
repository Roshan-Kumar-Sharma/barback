/**
 * Texas TABC licence record enricher.
 *
 * The spine of a Texas profile. Needs no credentials, and it is the only
 * source in the build whose values are `record` — a government registry entry
 * someone filed under penalty of perjury.
 *
 * Split of responsibility: a derivation that needs only THIS source's payload
 * (years in operation from an issue date) belongs here, and cites the payload
 * it came from. A derivation spanning sources (alcohol % of total sales)
 * belongs to the reducer. That keeps enrichers independent without pushing
 * single-source arithmetic into a component that would then need to understand
 * every source's raw shape.
 */
import type { Enricher, EnricherContext, EnrichResult } from '../../core/enricher.js';
import type { FieldCandidate } from '../../core/field.js';
import { path } from '../../core/field.js';
import type { Venue } from '../../core/venue.js';
import { DATASETS, datasetUrl, flag, idString, isoDate, query, soqlLiteral } from './client.js';
import { TABC_TYPES_URL, typeInfo } from './codes.js';

const EVIDENCE = datasetUrl(DATASETS.license.id);

/** Licence records change slowly. A day of staleness is not an underwriting risk. */
const TTL_SECONDS = 60 * 60 * 24;

export const PRODUCES = [
  'identity.trade_name',
  'identity.legal_name',
  'identity.address',
  'identity.license_type',
  'identity.license_status',
  'identity.license_id',
  'identity.permit_number',
  'liquor_profile.late_hours_permit',
  'liquor_profile.food_beverage_certificate',
  'liquor_profile.wine_percent_allowed',
  'liquor_profile.alcohol_sales_cease_time',
  'operations.years_in_operation',
  'operations.is_operating',
].map(path);

export class TabcLicenseEnricher implements Enricher {
  readonly id = 'tabc_license' as const;
  readonly produces = PRODUCES;
  readonly requires = ['license_id'] as const;
  readonly attribution = {
    name: 'Texas Alcoholic Beverage Commission — License Information',
    url: EVIDENCE,
    license: 'Public record, Texas Open Data Portal',
    notice: 'Contains information from the Texas Open Data Portal, published by the Texas Alcoholic Beverage Commission.',
  };

  constructor(private readonly appToken?: string) {}

  async run(venue: Venue, ctx: EnricherContext): Promise<EnrichResult> {
    const { rows, fetched } = await query(
      ctx.fetch,
      DATASETS.license.id,
      { where: `license_id = ${soqlLiteral(`${venue.license_id}.0`)}`, limit: 5 },
      { ttl_seconds: TTL_SECONDS, ...(this.appToken ? { appToken: this.appToken } : {}) },
    );

    const row = rows[0];
    if (!row) {
      ctx.log.warn('tabc_license: no row for licence', { license_id: venue.license_id });
      return { fields: [] };
    }

    const retrieved_at = fetched.retrieved_at;
    const ref = fetched.ref;
    // The record's own date. status_change_date is when TABC last touched it;
    // fall back to issue date. This is `as_of` — when the fact was true.
    const asOf = isoDate(row['status_change_date']) ?? isoDate(row['current_issued_date']);

    const base = { source: this.id, retrieved_at, evidence_url: EVIDENCE, evidence_ref: ref } as const;
    const rec = (p: string, value: unknown, confidence: number, extra: Partial<FieldCandidate> = {}): FieldCandidate => ({
      path: path(p), value, method: 'record', confidence, as_of: asOf, ...base, ...extra,
    });

    const out: FieldCandidate[] = [];
    const licenseType = row['license_type']?.trim().toUpperCase();
    const info = typeInfo(licenseType);

    const tradeName = row['trade_name']?.trim();
    if (tradeName) out.push(rec('identity.trade_name', tradeName, 0.98));

    const owner = row['owner']?.trim();
    if (owner) {
      out.push(rec('identity.legal_name', owner, 0.95, {
        notes: 'Licensee of record. May be a natural person for sole proprietors; redacted from published output.',
      }));
    }

    const zipRaw = (row['zip'] ?? '').replace(/\D/g, '');
    const line1 = row['address']?.trim();
    if (line1 && row['city']) {
      out.push(rec('identity.address', {
        line1,
        ...(row['address_2']?.trim() ? { line2: row['address_2'].trim() } : {}),
        city: row['city'].trim(),
        state: 'TX' as const,
        zip: zipRaw.slice(0, 5),
        ...(zipRaw.length === 9 ? { zip4: zipRaw.slice(5) } : {}),
        ...(row['county']?.trim() ? { county: row['county'].trim() } : {}),
      }, 0.97));
    }

    if (licenseType) {
      out.push(rec('identity.license_type', licenseType, 0.99, {
        notes: info ? `${info.label} (TABC code ${licenseType})` : `Unrecognised TABC code ${licenseType}`,
      }));
      const licId = idString(row['license_id']);
      if (licId) {
        out.push(rec('identity.license_id', licId, 0.99));
        out.push(rec('identity.permit_number', `${licenseType}${licId}`, 0.6, {
          method: 'derived',
          inputs: [path('identity.license_type'), path('identity.license_id')],
          notes:
            'Assembled from licence type and id. Licences predating AIMS file under a different ' +
            'legacy number, so this is unconfirmed until tax filings corroborate it.',
        }));
      }
    }

    const status = row['primary_status']?.trim();
    if (status) {
      out.push(rec('identity.license_status', status, 0.99));
      out.push({
        path: path('operations.is_operating'),
        value: /^active$/i.test(status),
        method: 'derived',
        confidence: 0.75,
        as_of: asOf,
        inputs: [path('identity.license_status')],
        notes: 'An active licence means the venue is permitted to trade, not that it is trading. Receipts filings corroborate.',
        ...base,
      });
    }

    // The two subordinate certificates that carry underwriting meaning.
    const lateHours = flag(row['lh']);
    out.push(rec('liquor_profile.late_hours_permit', lateHours, 0.97, {
      evidence_url: TABC_TYPES_URL,
      notes: 'TABC Late Hours Certificate (LH): authorises alcohol sales past the standard cutoff.',
    }));

    const fb = flag(row['fb']);
    out.push(rec('liquor_profile.food_beverage_certificate', fb, 0.97, {
      evidence_url: TABC_TYPES_URL,
      notes: "TABC Food and Beverage Certificate (FB): TABC's own marker of a food-primary operation.",
    }));

    if (lateHours) {
      out.push({
        path: path('liquor_profile.alcohol_sales_cease_time'),
        value: '02:00',
        method: 'derived',
        confidence: 0.7,
        as_of: asOf,
        inputs: [path('liquor_profile.late_hours_permit')],
        notes: 'PERMITTED cutoff under a Late Hours Certificate, not observed behaviour. The venue may close earlier.',
        ...base,
        evidence_url: TABC_TYPES_URL,
      });
    }

    const winePct = row['wine_percent']?.trim();
    if (winePct) out.push(rec('liquor_profile.wine_percent_allowed', winePct, 0.9));

    const originalIssue = isoDate(row['original_issue_date']);
    if (originalIssue) {
      const years = yearsSince(originalIssue, ctx.now());
      out.push({
        path: path('operations.years_in_operation'),
        value: years,
        method: 'derived',
        confidence: 0.6,
        as_of: originalIssue,
        inputs: [path('identity.license_id')],
        notes:
          `Licence originally issued ${originalIssue}. This is the licence lineage, which survives ownership ` +
          'changes, so it is a CEILING on tenure under current ownership, not that figure. ' +
          'Tax responsibility dates give the better number where available.',
        ...base,
      });
    }

    return { fields: out };
  }
}

export function yearsSince(iso: string, now: Date): number {
  const then = new Date(`${iso}T00:00:00Z`).getTime();
  return Math.floor((now.getTime() - then) / (365.2425 * 24 * 3600 * 1000));
}
