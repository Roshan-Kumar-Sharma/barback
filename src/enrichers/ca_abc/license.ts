/**
 * California ABC licence enricher.
 *
 * The California analogue of the Texas licence source, and a useful contrast:
 * Texas encodes food-primary operation as a separate certificate (FB) and
 * late trading as another (LH), while California encodes it in the licence type
 * itself — 47 is a restaurant, 48 is a bar whose licence forbids minors.
 *
 * What California does NOT have is anything like the Texas mixed-beverage tax
 * filings, so revenue and current-ownership tenure stay unknown here. Coverage
 * is materially thinner as a result, and the completeness engine says so.
 */
import type { Enricher, EnricherContext, EnrichResult } from '../../core/enricher.js';
import { path, type FieldCandidate } from '../../core/field.js';
import type { Venue } from '../../core/venue.js';
import { CA_TYPES_URL, caTypeInfo } from './codes.js';
import { CA_ABC_SOURCE_PAGE, caDate, loadCaIndex, type CaLicenceRow } from './dataset.js';

export const PRODUCES = [
  'identity.trade_name',
  'identity.legal_name',
  'identity.address',
  'identity.license_type',
  'identity.license_status',
  'identity.license_id',
  'operations.years_in_operation',
  'operations.is_operating',
  'liquor_profile.underage_patrons_permitted',
  'security_controls.minimum_age_21',
  'entertainment.live_music',
  'coverage_requested.x_date',
].map(path);

export class CaAbcEnricher implements Enricher {
  readonly id = 'ca_abc' as const;
  readonly produces = PRODUCES;
  readonly requires = ['license_id'] as const;
  readonly attribution = {
    name: 'California Department of Alcoholic Beverage Control — daily licence export',
    url: CA_ABC_SOURCE_PAGE,
    license: 'Public record, California ABC',
    notice: 'Contains information published by the California Department of Alcoholic Beverage Control.',
  };

  async run(venue: Venue, ctx: EnricherContext): Promise<EnrichResult> {
    const index = await loadCaIndex(ctx.fetch);
    const row = index.rows.find((r) => r.file_number === venue.license_id);
    if (!row) {
      ctx.log.warn('ca_abc: no row for licence', { license_id: venue.license_id });
      return { fields: [] };
    }

    const info = caTypeInfo(row.license_type);
    const base = {
      source: this.id,
      retrieved_at: index.retrieved_at,
      evidence_url: CA_ABC_SOURCE_PAGE,
    } as const;
    const rec = (p: string, value: unknown, confidence: number, extra: Partial<FieldCandidate> = {}): FieldCandidate => ({
      path: path(p), value, method: 'record', confidence, as_of: index.as_of, ...base, ...extra,
    });

    const out: FieldCandidate[] = [];
    const tradeName = row.dba_name || row.primary_name;
    if (tradeName) out.push(rec('identity.trade_name', tradeName, 0.95));
    if (row.primary_name) {
      out.push(rec('identity.legal_name', row.primary_name, 0.95, {
        notes: 'Licensee of record. May be a natural person; redacted from published output.',
      }));
    }
    if (row.addr1 && row.city) {
      const zip = row.zip.replace(/\D/g, '');
      out.push(rec('identity.address', {
        line1: row.addr1,
        ...(row.addr2 ? { line2: row.addr2 } : {}),
        city: row.city,
        state: 'CA' as const,
        zip: zip.slice(0, 5),
        ...(zip.length === 9 ? { zip4: zip.slice(5) } : {}),
        ...(row.county ? { county: row.county } : {}),
      }, 0.95));
    }
    if (row.license_type) {
      out.push(rec('identity.license_type', row.license_type, 0.99, {
        evidence_url: CA_TYPES_URL,
        notes: info ? `${info.label} (ABC type ${row.license_type})` : `Unrecognised ABC type ${row.license_type}`,
      }));
    }
    if (row.file_number) out.push(rec('identity.license_id', row.file_number, 0.99));
    if (row.status) {
      out.push(rec('identity.license_status', row.status, 0.97));
      out.push({
        path: path('operations.is_operating'),
        value: /active/i.test(row.status) && /lic/i.test(row.lic_or_app),
        method: 'derived',
        confidence: 0.7,
        as_of: index.as_of,
        inputs: [path('identity.license_status')],
        notes:
          'An active issued licence means the venue may trade, not that it is trading. California ' +
          'publishes no sales filings, so there is no corroborating signal as there is in Texas.',
        ...base,
      });
    }

    // "Public premises" is a licence condition, not an inference: ABC's own
    // text for these types says minors may not enter and remain.
    if (info?.public_premises) {
      out.push(rec('liquor_profile.underage_patrons_permitted', false, 0.9, {
        evidence_url: CA_TYPES_URL,
        notes: `${info.label}: ABC states minors are not allowed to enter and remain.`,
      }));
      out.push(rec('security_controls.minimum_age_21', true, 0.85, {
        evidence_url: CA_TYPES_URL,
        notes: `Follows from the public-premises licence condition on a type ${row.license_type}.`,
      }));
    } else if (info?.eating_place) {
      out.push(rec('liquor_profile.underage_patrons_permitted', true, 0.7, {
        evidence_url: CA_TYPES_URL,
        notes: `${info.label}: a bona fide eating place admits minors. Confirm any house door policy.`,
      }));
    }

    if (info?.music_venue) {
      out.push(rec('entertainment.live_music', { present: true, per_week: null }, 0.85, {
        evidence_url: CA_TYPES_URL,
        notes:
          'Type 90 is licensed specifically as a music entertainment facility, so live performance ' +
          'is a licence fact. Frequency still needs confirming.',
      }));
    }

    const issued = caDate(row.orig_issue_date);
    if (issued) {
      out.push({
        path: path('operations.years_in_operation'),
        value: yearsSince(issued, ctx.now()),
        method: 'derived',
        confidence: 0.6,
        as_of: issued,
        inputs: [path('identity.license_id')],
        notes:
          `Licence originally issued ${issued}. Licences transfer between owners, so this is a ` +
          'CEILING on tenure under current ownership. California publishes no tax-responsibility ' +
          'date, so unlike Texas there is no better figure available.',
        ...base,
      });
    }

    // Not the policy X-date an underwriter wants, and labelled as such.
    const expiry = caDate(row.expiry_date);
    if (expiry) {
      out.push(rec('coverage_requested.x_date', expiry, 0.2, {
        notes:
          'This is the LIQUOR LICENCE expiry, not the insurance policy expiry. Included because it ' +
          'is a useful contact date, but it must not be mistaken for the X-date; confirm with the insured.',
      }));
    }

    return { fields: out };
  }
}

function yearsSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(`${iso}T00:00:00Z`).getTime()) / (365.2425 * 864e5));
}
