/**
 * OpenStreetMap enricher.
 *
 * Two jobs, and the second is the more valuable one:
 *
 *   1. A handful of observed attributes — actual opening hours, outdoor
 *      seating, live music, age policy.
 *   2. The venue's own WEBSITE, which unblocks the highest-signal free source
 *      there is. Nothing in a government record tells you whether there is a
 *      deep fryer, a DJ, hookah or bottle service; the venue's own site does.
 *
 * The risk here is misattribution. A geocoded licence address lands on a
 * building, and city blocks contain many venues — the probe that shaped this
 * code found seven bars within 70 metres of one address. Hanging a neighbour's
 * opening hours on this venue would be a silent error of the worst kind:
 * plausible, sourced, and wrong. So tags are only ever attached to a feature
 * whose NAME matches the licensed trade name. Failing that we still emit the
 * geocode, because an address is safe, and emit no attributes at all.
 */
import type { Enricher, EnricherContext, EnrichResult } from '../../core/enricher.js';
import { path, type FieldCandidate } from '../../core/field.js';
import { nameScore } from '../../core/text/similarity.js';
import type { Activity } from '../../core/schema/types.js';
import type { Venue } from '../../core/venue.js';
import {
  featuresNear, geocode, HOSPITALITY_AMENITIES, OSM_COPYRIGHT, osmRef, osmUrl, type OsmElement,
} from './client.js';
import { parseOpeningHours } from './opening-hours.js';

/** Metres around the geocoded address to look for the venue. */
const SEARCH_RADIUS_M = 80;

/**
 * How well a feature's name must match the licensed trade name before we will
 * attribute its tags to this venue. Set high on purpose: the cost of a wrong
 * match is a confidently-sourced false attribute, and the cost of no match is
 * a null and a question.
 */
const NAME_MATCH_THRESHOLD = 0.62;

export const PRODUCES = [
  'operations.latest_closing_time',
  'property.outdoor_seating',
  'entertainment.live_music',
  'security_controls.minimum_age_21',
  'liquor_profile.underage_patrons_permitted',
].map(path);

export class OsmEnricher implements Enricher {
  readonly id = 'osm' as const;
  readonly produces = PRODUCES;
  readonly requires = ['address'] as const;
  readonly attribution = {
    name: 'OpenStreetMap contributors',
    url: OSM_COPYRIGHT,
    license: 'Open Database License (ODbL) v1.0',
    notice: '© OpenStreetMap contributors, licensed under ODbL.',
  };

  async run(venue: Venue, ctx: EnricherContext): Promise<EnrichResult> {
    const geo = await geocode(ctx.fetch, venue.address);
    if (!geo) {
      ctx.log.debug('osm: address did not geocode', { venue: venue.id });
      return { fields: [] };
    }

    const patch: Partial<Venue> = { geo: geo.point };

    const { elements, fetched } = await featuresNear(ctx.fetch, geo.point, SEARCH_RADIUS_M);
    const match = bestMatch(elements, venue.trade_name);

    if (!match) {
      // The geocode is trustworthy; the attributes are not attributable.
      ctx.log.debug('osm: no feature near the address matched the trade name', {
        venue: venue.trade_name,
        nearby: elements.length,
      });
      return { fields: [], venue_patch: patch };
    }

    patch.osm_ref = osmRef(match.element);
    const tags = match.element.tags ?? {};
    const website = tags['website'] ?? tags['contact:website'];
    if (website && /^https?:\/\//i.test(website)) patch.website = website;

    const evidence_url = osmUrl(match.element);
    // The element's last-edit timestamp. Crowd-sourced tags can be years stale,
    // and an underwriter needs to know when someone last looked.
    const as_of = tags['check_date'] ?? tags['survey:date'] ?? match.element.timestamp?.slice(0, 10) ?? null;

    const base = {
      source: this.id,
      method: 'api' as const,
      as_of,
      retrieved_at: fetched.retrieved_at,
      evidence_url,
      evidence_ref: fetched.ref,
    };

    const out: FieldCandidate[] = [];
    const matchNote =
      `Matched OpenStreetMap ${osmRef(match.element)} "${tags['name'] ?? ''}" ` +
      `(name similarity ${match.score.toFixed(2)}) within ${SEARCH_RADIUS_M}m of the licensed address.`;

    const rawHours = tags['opening_hours'];
    if (rawHours) {
      const hours = parseOpeningHours(rawHours);
      if (hours.latest_close !== null) {
        out.push({
          path: path('operations.latest_closing_time'),
          value: hours.latest_close,
          confidence: 0.7,
          notes: `${hours.note} ${matchNote}`,
          ...base,
        });
      } else if (!hours.understood) {
        ctx.log.debug('osm: unreadable opening_hours', { raw: rawHours });
      }
    }

    const outdoor = yesNo(tags['outdoor_seating']);
    if (outdoor !== null) {
      out.push({
        path: path('property.outdoor_seating'),
        value: outdoor,
        confidence: 0.65,
        notes: `OpenStreetMap outdoor_seating=${tags['outdoor_seating']}. ${matchNote}`,
        ...base,
      });
    }

    const live = yesNo(tags['live_music']);
    if (live !== null) {
      const activity: Activity = { present: live, per_week: null };
      out.push({
        path: path('entertainment.live_music'),
        value: activity,
        confidence: 0.55,
        notes:
          `OpenStreetMap live_music=${tags['live_music']}. Frequency is not recorded in OSM and ` +
          `carriers ask for it, so this still needs confirming. ${matchNote}`,
        ...base,
      });
    }

    const minAge = Number(tags['min_age']);
    if (Number.isFinite(minAge) && minAge > 0) {
      out.push({
        path: path('security_controls.minimum_age_21'),
        value: minAge >= 21,
        confidence: 0.6,
        notes: `OpenStreetMap min_age=${minAge}. ${matchNote}`,
        ...base,
      });
      out.push({
        path: path('liquor_profile.underage_patrons_permitted'),
        value: minAge < 21,
        confidence: 0.5,
        notes:
          `Inverse of OpenStreetMap min_age=${minAge}. A door policy is not the same question a ` +
          `carrier asks about underage patrons, so confirm this one. ${matchNote}`,
        ...base,
      });
    }

    return { fields: out, venue_patch: patch };
  }
}

function yesNo(v: string | undefined): boolean | null {
  if (v === undefined) return null;
  const s = v.trim().toLowerCase();
  if (s === 'yes' || s === 'true') return true;
  if (s === 'no' || s === 'false') return false;
  // "seasonal", "designated", "outside" and friends are real values that do not
  // reduce to a boolean. Leave them alone rather than forcing a reading.
  return null;
}

/** The nearby feature that is actually this venue, or nothing. */
export function bestMatch(
  elements: OsmElement[],
  tradeName: string,
): { element: OsmElement; score: number } | null {
  let best: { element: OsmElement; score: number } | null = null;

  for (const e of elements) {
    const name = e.tags?.['name'];
    if (!name) continue;

    // The name must qualify on its own. The amenity bonus below is corroboration
    // that we found a VENUE, not evidence about WHICH venue, so it must never
    // rescue a weak name match — that is how "Pig" ends up attached to a
    // neighbouring "Blind Pig" with a government-looking citation on it.
    const name_score = nameScore(tradeName, name);
    if (name_score < NAME_MATCH_THRESHOLD) continue;

    const amenity = e.tags?.['amenity'];
    const ranked = amenity && HOSPITALITY_AMENITIES.has(amenity) ? name_score + 0.05 : name_score;

    if (best === null || ranked > best.score) {
      best = { element: e, score: Math.min(1, ranked) };
    }
  }
  return best;
}
