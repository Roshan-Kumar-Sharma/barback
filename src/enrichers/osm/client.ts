/**
 * OpenStreetMap access: Nominatim for geocoding, Overpass for tags.
 *
 * Both are donated capacity run by volunteers. Nominatim's usage policy caps us
 * at one request per second and requires an identifying User-Agent; the shared
 * fetcher enforces a 1.1s minimum interval per host and sends the UA, and every
 * response is cached. Set BARBACK_USER_AGENT to a real contact address before
 * running this at any volume.
 *
 * https://operations.osmfoundation.org/policies/nominatim/
 */
import type { Fetched, Fetcher } from '../../core/enricher.js';
import type { GeoPoint, PostalAddress } from '../../core/venue.js';

export const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

/** Geocodes change rarely; a fortnight of staleness costs nothing. */
const TTL_SECONDS = 60 * 60 * 24 * 14;

export type OsmElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  /** ISO timestamp of the element's last edit, from `out meta`. */
  timestamp?: string;
};

export type GeocodeResult = { point: GeoPoint; display_name: string; fetched: Fetched };

/** Structured geocode of a licence address. Structured beats free-text here:
 *  the address comes from a government record, so its parts are already clean. */
export async function geocode(
  fetcher: Fetcher,
  address: PostalAddress,
): Promise<GeocodeResult | null> {
  const u = new URL(NOMINATIM);
  u.searchParams.set('street', address.line1);
  u.searchParams.set('city', address.city);
  u.searchParams.set('state', address.state);
  u.searchParams.set('country', 'US');
  if (address.zip) u.searchParams.set('postalcode', address.zip);
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('limit', '1');

  const fetched = await fetcher.get({ url: u.toString(), ttl_seconds: TTL_SECONDS });
  if (fetched.status !== 200 || !Array.isArray(fetched.body)) return null;

  const first = (fetched.body as Array<Record<string, unknown>>)[0];
  if (!first) return null;

  const lat = Number(first['lat']);
  const lon = Number(first['lon']);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return { point: { lat, lon }, display_name: String(first['display_name'] ?? ''), fetched };
}

/**
 * Named features near a point.
 *
 * `out meta` is requested for the element timestamp, which becomes the field's
 * `as_of` — OSM tags are crowd-sourced and can be years old, and an underwriter
 * needs to know when someone last looked. The response also carries an editor's
 * username, which we never read or store: businesses, not people.
 */
export async function featuresNear(
  fetcher: Fetcher,
  point: GeoPoint,
  radiusMetres: number,
): Promise<{ elements: OsmElement[]; fetched: Fetched }> {
  const query =
    `[out:json][timeout:30];` +
    `nwr["name"](around:${radiusMetres},${point.lat},${point.lon});` +
    `out tags center meta;`;

  const fetched = await fetcher.get({
    url: OVERPASS,
    method: 'POST',
    body: new URLSearchParams({ data: query }).toString(),
    ttl_seconds: TTL_SECONDS,
  });

  if (fetched.status !== 200 || typeof fetched.body !== 'object' || fetched.body === null) {
    return { elements: [], fetched };
  }
  const elements = (fetched.body as { elements?: OsmElement[] }).elements ?? [];
  return { elements, fetched };
}

/** Stable reference for an element, e.g. "node/1481633321". */
export const osmRef = (e: OsmElement): string => `${e.type}/${e.id}`;

export const osmUrl = (e: OsmElement): string => `https://www.openstreetmap.org/${e.type}/${e.id}`;

/** Amenity values that put a feature in the hospitality class we care about. */
export const HOSPITALITY_AMENITIES = new Set(['bar', 'pub', 'nightclub', 'restaurant', 'cafe', 'fast_food']);
