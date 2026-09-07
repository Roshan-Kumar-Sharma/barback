/**
 * Venue identity.
 *
 * Resolution is the one place where a confident wrong answer is catastrophic
 * rather than merely bad: if we resolve "Rio" in Texas to the wrong licence,
 * every downstream field is wrong AND carries an authoritative-looking
 * government citation. So resolution returns ranked candidates with scores,
 * never a bare Venue, and the caller must choose or accept an auto-pick that
 * cleared an explicit threshold.
 */

/** A US state, restricted to what Barback actually implements. */
export type StateCode = 'TX' | 'CA';

export type PostalAddress = {
  line1: string;
  line2?: string;
  city: string;
  state: StateCode;
  /** 5-digit. TABC stores ZIP+4 unseparated; we normalise to 5 and keep the rest. */
  zip: string;
  zip4?: string;
  county?: string;
};

export type GeoPoint = { lat: number; lon: number };

/**
 * A resolved venue. This is the input to every enricher, and the only thing
 * they are allowed to key off. An enricher that needs a field not present here
 * declares it in `requires` and is skipped when it is absent.
 */
export type Venue = {
  /** Stable id for this venue within a run: `${state}:${license_id}`. */
  id: string;
  state: StateCode;

  /** Doing-business-as name from the licence record. */
  trade_name: string;

  /**
   * Licensee legal name — the named insured on a submission.
   * MAY BE A NATURAL PERSON for sole proprietors. See redact.ts: this is never
   * emitted in published output. Guardrail: businesses, not people.
   */
  legal_name: string | null;

  address: PostalAddress;

  /** TABC AIMS licence id, e.g. 200097471. */
  license_id?: string;
  /** TABC permit number as it appears on tax filings, e.g. "MB200097471". */
  permit_number?: string;
  /**
   * Every permit number this venue might file tax returns under.
   *
   * Texas has two permit number formats in circulation. AIMS-era licences file
   * under licence type + licence id (MB200097471); licences predating AIMS file
   * under their legacy number (MB192342), which the register carries separately
   * as `legacy_clp`. Constructing only the modern form silently finds no tax
   * filings for long-established venues — which understates revenue for exactly
   * the venues most likely to have a long clean history.
   */
  permit_candidates?: string[];
  /** TABC licence type code, e.g. 'MB', 'BG'. See enrichers/tabc/codes.ts. */
  license_type?: string;

  /** Set once the OSM enricher geocodes the licence address. */
  geo?: GeoPoint;
  /** OSM element, e.g. 'node/1234567'. */
  osm_ref?: string;
  /** The venue's own website, discovered via OSM. Gates the `web` enricher. */
  website?: string;
};

export type VenueCandidate = {
  venue: Venue;
  /** 0..1. How well this candidate matches the requested name. */
  score: number;
  /** Human-readable scoring breakdown, so a wrong pick is diagnosable. */
  signals: string[];
};

export type VenueResolution =
  | { status: 'resolved'; venue: Venue; score: number; alternatives: VenueCandidate[] }
  /** Multiple plausible matches, or the best match was not clearly best. */
  | { status: 'ambiguous'; candidates: VenueCandidate[] }
  | { status: 'not_found'; searched: string; note: string };
