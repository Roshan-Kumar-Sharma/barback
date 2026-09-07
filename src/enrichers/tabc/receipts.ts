/**
 * Texas Mixed Beverage Gross Receipts enricher.
 *
 * Monthly alcohol tax filings, per permit, published by the Texas Comptroller.
 * This is the single highest-value source in the Texas build, because it turns
 * questions a broker normally has to ask into government records:
 *
 *   - On-premise alcohol sales. Carriers collect the revenue split in dollars
 *     and derive alcohol % themselves. In Texas the alcohol numerator is a tax
 *     record. Only food sales still need the insured — which turns a whole
 *     section of the intake call into one question.
 *   - Cover charge income. A venue taking money at the door is behaving like a
 *     nightclub, and it is filed under its own line on the return.
 *   - Tax responsibility begin date: when THIS taxpayer took over THIS
 *     location. Much closer to "years under current ownership" than a licence
 *     issue date, which survives ownership changes.
 *
 * What it does NOT give: total sales. These are alcohol receipts only, so
 * `revenue.alcohol_pct` stays unanswerable here by design.
 */
import type { Enricher, EnricherContext, EnrichResult } from '../../core/enricher.js';
import type { FieldCandidate } from '../../core/field.js';
import { path } from '../../core/field.js';
import type { ReceiptsMonth } from '../../core/schema/types.js';
import type { Venue } from '../../core/venue.js';
import { DATASETS, datasetUrl, isoDate, num, query, soqlLiteral } from './client.js';

const EVIDENCE = datasetUrl(DATASETS.receipts.id);
const TTL_SECONDS = 60 * 60 * 24;
/** Filings are monthly and lag by a month or two; three years is plenty of trend. */
const MONTHS = 36;
/** A venue that has not filed in this long is probably not trading. */
const DORMANT_AFTER_DAYS = 120;

export const PRODUCES = [
  'identity.permit_number',
  'revenue.alcohol_on_premise_sales',
  'revenue.cover_charge_sales',
  'revenue.receipts_history',
  'operations.year_started_at_location',
  'operations.years_under_current_owner',
  'operations.is_operating',
].map(path);

export class TabcReceiptsEnricher implements Enricher {
  readonly id = 'tabc_receipts' as const;
  readonly produces = PRODUCES;
  readonly requires = ['permit_candidates'] as const;
  readonly attribution = {
    name: 'Texas Comptroller — Mixed Beverage Gross Receipts',
    url: EVIDENCE,
    license: 'Public record, Texas Open Data Portal',
    notice: 'Contains information from the Texas Open Data Portal, published by the Texas Comptroller of Public Accounts.',
  };

  constructor(private readonly appToken?: string) {}

  async run(venue: Venue, ctx: EnricherContext): Promise<EnrichResult> {
    // Query every permit number the venue might file under, in one request.
    // Which one it actually uses is a fact the filings tell us, not something
    // we should guess from the shape of the licence id.
    const candidates = venue.permit_candidates ?? [];
    const { rows, fetched } = await query(
      ctx.fetch,
      DATASETS.receipts.id,
      {
        where: `tabc_permit_number in (${candidates.map(soqlLiteral).join(', ')})`,
        order: 'obligation_end_date_yyyymmdd DESC',
        limit: MONTHS,
      },
      { ttl_seconds: TTL_SECONDS, ...(this.appToken ? { appToken: this.appToken } : {}) },
    );

    if (rows.length === 0) {
      ctx.log.debug('tabc_receipts: no filings', { permits: candidates });
      return { fields: [] };
    }

    // Filings may span a permit renumbering; keep only the number actually in
    // use most recently, so a stale permit's history cannot inflate a total.
    const activePermit = rows[0]?.['tabc_permit_number']?.trim();
    const filings = activePermit
      ? rows.filter((r) => r['tabc_permit_number']?.trim() === activePermit)
      : rows;

    const history: ReceiptsMonth[] = filings
      .map((r) => {
        const month = isoDate(r['obligation_end_date_yyyymmdd']);
        if (!month) return null;
        return {
          month,
          liquor: num(r['liquor_receipts']) ?? 0,
          wine: num(r['wine_receipts']) ?? 0,
          beer: num(r['beer_receipts']) ?? 0,
          cover_charge: num(r['cover_charge_receipts']) ?? 0,
          total: num(r['total_receipts']) ?? 0,
        };
      })
      .filter((m): m is ReceiptsMonth => m !== null)
      .sort((a, b) => (a.month < b.month ? 1 : -1));

    const latest = history[0];
    if (!latest) return { fields: [] };

    const base = {
      source: this.id,
      retrieved_at: fetched.retrieved_at,
      evidence_url: EVIDENCE,
      evidence_ref: fetched.ref,
    } as const;
    const out: FieldCandidate[] = [];

    if (activePermit) {
      out.push({
        path: path('identity.permit_number'),
        value: activePermit,
        method: 'record',
        confidence: 0.98,
        as_of: latest.month,
        notes: 'Confirmed by mixed-beverage tax filings, which is stronger evidence than a permit number assembled from licence fields.',
        ...base,
      });
    }

    const window = history.slice(0, 12);
    const complete = window.length === 12;
    // A partial window understates the annual figure, so it must not be
    // presented with the same confidence as a full one.
    const confidence = complete ? 0.95 : 0.7;
    const coverageNote = complete
      ? `Trailing 12 months of filings through ${latest.month}.`
      : `Only ${window.length} month(s) of filings available (through ${latest.month}); this UNDERSTATES an annual figure.`;

    const alcohol = window.reduce((n, m) => n + m.liquor + m.wine + m.beer, 0);
    out.push({
      path: path('revenue.alcohol_on_premise_sales'),
      value: Math.round(alcohol),
      method: 'record',
      confidence,
      as_of: latest.month,
      notes: `${coverageNote} Liquor + wine + beer receipts as filed with the Texas Comptroller.`,
      ...base,
    });

    const cover = window.reduce((n, m) => n + m.cover_charge, 0);
    out.push({
      path: path('revenue.cover_charge_sales'),
      value: Math.round(cover),
      method: 'record',
      confidence,
      as_of: latest.month,
      notes: `${coverageNote} Cover charges are filed on their own line of the mixed-beverage return.`,
      ...base,
    });

    out.push({
      path: path('revenue.receipts_history'),
      value: history,
      method: 'record',
      confidence: 0.95,
      as_of: latest.month,
      notes: `${history.length} monthly filings, newest first.`,
      ...base,
    });

    // Tax responsibility began when this taxpayer took over this location.
    const began = isoDate(filings[0]?.['responsibility_begin_date_yyyymmdd']);
    if (began) {
      const year = Number(began.slice(0, 4));
      out.push({
        path: path('operations.year_started_at_location'),
        value: year,
        method: 'record',
        confidence: 0.85,
        as_of: began,
        notes: `Mixed-beverage tax responsibility for this location began ${began}.`,
        ...base,
      });
      out.push({
        path: path('operations.years_under_current_owner'),
        value: Math.floor((ctx.now().getTime() - new Date(`${began}T00:00:00Z`).getTime()) / (365.2425 * 864e5)),
        method: 'derived',
        confidence: 0.8,
        as_of: began,
        inputs: [path('operations.year_started_at_location')],
        notes:
          'Derived from the date this taxpayer became responsible for mixed-beverage tax at this location. ' +
          'Closer to tenure under current ownership than the licence issue date, but a taxpayer entity can ' +
          'change without the business really changing hands.',
        ...base,
      });
    }

    const daysSinceFiling = (ctx.now().getTime() - new Date(`${latest.month}T00:00:00Z`).getTime()) / 864e5;
    out.push({
      path: path('operations.is_operating'),
      value: daysSinceFiling <= DORMANT_AFTER_DAYS,
      method: 'derived',
      confidence: 0.85,
      as_of: latest.month,
      inputs: [path('revenue.receipts_history')],
      notes:
        `Most recent alcohol tax filing covers the period ending ${latest.month} ` +
        `(${Math.round(daysSinceFiling)} days ago). Filings are the strongest available evidence that a venue is trading.`,
      ...base,
    });

    return { fields: out };
  }
}
