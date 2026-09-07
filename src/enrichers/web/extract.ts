/**
 * Reading a venue's own website into structured underwriting fields.
 *
 * This is the only place in Barback where a model touches the data, and the
 * design is built around two facts about what it is reading:
 *
 *   1. It is MARKETING COPY. A venue describes itself favourably and omits
 *      whatever is inconvenient. So nothing from here is ever authoritative —
 *      every field is `inferred`, which precedence guarantees cannot outrank a
 *      record, and confidence stays modest even when the page is explicit.
 *
 *   2. Silence is not a "no". A menu that never mentions hookah is not evidence
 *      that there is no hookah. Turning an omission into `false` would put a
 *      confident wrong answer in front of an underwriter on precisely the
 *      questions carriers decline over. Every field is therefore nullable, and
 *      the prompt says so more than once.
 *
 * The structural defence against hallucination is that **a value without a
 * verbatim supporting quote from the page is discarded**. A model that invents
 * a rooftop bar must also invent a quote that isn't in the text, and that is
 * checkable — so we check it.
 */
import { z } from 'zod';
import { path, type FieldCandidate } from '../../core/field.js';
import type { Activity, CookingEquipment } from '../../core/schema/types.js';

const Evidence = z.string().trim().min(1).nullable().catch(null).default(null);

/**
 * Tolerant reading of one observation.
 *
 * Models — free ones especially — express "nothing to report" in whatever shape
 * they feel like: `null`, a bare `false`, a missing key. Rejecting the whole
 * response over that would throw away every other field it got right, so the
 * shapes are normalised here instead.
 *
 * Being lenient costs nothing, because leniency is not what keeps this safe:
 * the quote requirement in toCandidates() is. A bare value arriving without an
 * observation wrapper has no quote, and is therefore discarded anyway.
 */
function observation<T extends z.ZodTypeAny>(value: T) {
  const shape = z.object({
    value: value.nullable().catch(null).default(null),
    per_week: z.number().min(0).max(7).nullable().catch(null).default(null),
    evidence: Evidence,
  });
  return z.preprocess((raw) => {
    if (raw === null || raw === undefined) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) return { value: raw };
    return raw;
  }, shape);
}

const boolObs = observation(z.boolean());
const activityObs = observation(z.boolean());

export const ExtractionSchema = z.object({
  cooking_equipment: observation(z.array(z.enum(['grill', 'deep_fryer', 'wok', 'open_flame']))),
  hookah_or_oxygen_inhalation: boolObs,
  bottle_service: boolObs,
  dancing_permitted: boolObs,
  gaming_machines: boolObs,
  mechanical_bull: boolObs,
  dj_with_dancing: activityObs,
  live_music: activityObs,
  adult_entertainment: activityObs,
  banquet: activityObs,
  minimum_age_21: boolObs,
  bar_with_seating: boolObs,
  byob_permitted: boolObs,
  drink_specials_after_9pm: boolObs,
  drink_specials_after_11pm: boolObs,
  outdoor_seating: boolObs,
  elevated_deck_or_rooftop: boolObs,
  table_service: boolObs,
  seating_capacity: observation(z.number().int().positive()),
  latest_closing_time: observation(z.string().regex(/^\d{2}:\d{2}$/)),
}).partial();

export type Extraction = z.infer<typeof ExtractionSchema>;

export const SYSTEM_PROMPT = `You read a restaurant or bar's own website and report only what it actually says.

You are preparing notes for an insurance underwriter. Two rules matter more than everything else:

1. NEVER turn silence into "no". If the pages do not address something, the value is null. A menu that does not mention hookah is NOT evidence that there is no hookah — it is no evidence at all. Use false ONLY when the page states the absence ("no cover charge", "21+ only, no exceptions", "we do not permit BYOB").

2. EVERY non-null value needs a verbatim quote from the supplied text in its "evidence" field. Copy the words exactly as they appear. If you cannot quote it, the value is null. Never paraphrase into the evidence field, and never quote text that is not in the input.

Guidance on particular fields:

- cooking_equipment: infer from menu items, which is the one place inference is expected. Fried items (fries, wings, fried pickles, tempura, fish and chips, calamari) imply "deep_fryer". Grilled, chargrilled or barbecued items imply "grill". Stir-fry, pad thai or wok dishes imply "wok". Quote the menu item itself as evidence.
- latest_closing_time: 24-hour "HH:MM". The LATEST closing time on any day of the week.
- per_week: how many nights a week the activity happens, when stated. Otherwise null.
- adult_entertainment means exotic dancing, not live music or a DJ.
- minimum_age_21: true only if the venue states an over-21 door policy.
- elevated_deck_or_rooftop: a rooftop bar or a raised deck patrons can access.

Reply with a single JSON object and nothing else.`;

/** Field mapping, and how much each is worth believing when the site states it. */
type Mapping = {
  key: keyof Extraction;
  path: string;
  confidence: number;
  /** Turn the model's shape into a profile value. */
  to?: (raw: unknown, per_week: number | null) => unknown;
};

const activity = (raw: unknown, per_week: number | null): Activity => ({
  present: raw === true,
  per_week,
});

const MAPPINGS: readonly Mapping[] = [
  // Inferred from menu items rather than stated outright, so a notch lower.
  { key: 'cooking_equipment', path: 'fire_protection.cooking_equipment', confidence: 0.55,
    to: (raw) => (Array.isArray(raw) && raw.length > 0 ? (raw as CookingEquipment[]) : null) },

  { key: 'hookah_or_oxygen_inhalation', path: 'entertainment.hookah_or_oxygen_inhalation', confidence: 0.6 },
  { key: 'bottle_service', path: 'entertainment.bottle_service', confidence: 0.6 },
  { key: 'dancing_permitted', path: 'entertainment.dancing_permitted', confidence: 0.55 },
  { key: 'gaming_machines', path: 'entertainment.gaming_machines', confidence: 0.55 },
  { key: 'mechanical_bull', path: 'entertainment.mechanical_bull_or_riding_device', confidence: 0.6 },
  { key: 'dj_with_dancing', path: 'entertainment.dj_with_dancing', confidence: 0.55, to: activity },
  { key: 'live_music', path: 'entertainment.live_music', confidence: 0.6, to: activity },
  { key: 'adult_entertainment', path: 'entertainment.adult_entertainment', confidence: 0.6, to: activity },
  { key: 'banquet', path: 'entertainment.banquet', confidence: 0.55, to: activity },
  { key: 'minimum_age_21', path: 'security_controls.minimum_age_21', confidence: 0.6 },
  { key: 'bar_with_seating', path: 'liquor_profile.bar_with_seating', confidence: 0.55 },
  { key: 'byob_permitted', path: 'liquor_profile.byob_permitted', confidence: 0.55 },
  { key: 'drink_specials_after_9pm', path: 'liquor_profile.drink_specials_after_9pm', confidence: 0.5 },
  { key: 'drink_specials_after_11pm', path: 'liquor_profile.drink_specials_after_11pm', confidence: 0.5 },
  { key: 'outdoor_seating', path: 'property.outdoor_seating', confidence: 0.6 },
  { key: 'elevated_deck_or_rooftop', path: 'property.elevated_deck_or_rooftop', confidence: 0.6 },
  { key: 'table_service', path: 'operations.table_service', confidence: 0.55 },
  { key: 'seating_capacity', path: 'operations.seating_capacity', confidence: 0.5 },
  { key: 'latest_closing_time', path: 'operations.latest_closing_time', confidence: 0.5 },
];

export const PRODUCES: readonly string[] = MAPPINGS.map((m) => m.path);

export type ToCandidatesInput = {
  extraction: Extraction;
  /** Concatenated page text, used to verify every quote actually appears. */
  sourceText: string;
  pageUrl: string;
  evidenceRef: string;
  retrievedAt: string;
  model: string;
};

export type ToCandidatesResult = {
  candidates: FieldCandidate[];
  /** Values dropped because their quote was not in the page. */
  unsupported: string[];
};

export function toCandidates(input: ToCandidatesInput): ToCandidatesResult {
  const haystack = normaliseForQuoteCheck(input.sourceText);
  const candidates: FieldCandidate[] = [];
  const unsupported: string[] = [];

  for (const m of MAPPINGS) {
    const obs = input.extraction[m.key] as { value: unknown; evidence: string | null; per_week?: number | null } | undefined;
    if (obs === undefined || obs.value === null || obs.value === undefined) continue;

    // No quote, no field. This is the whole anti-hallucination story.
    if (obs.evidence === null || obs.evidence.trim().length === 0) {
      unsupported.push(`${m.path} (no supporting quote)`);
      continue;
    }
    if (!haystack.includes(normaliseForQuoteCheck(obs.evidence))) {
      unsupported.push(`${m.path} (quote not found in page text)`);
      continue;
    }

    const value = m.to ? m.to(obs.value, obs.per_week ?? null) : obs.value;
    if (value === null) continue;

    candidates.push({
      path: path(m.path),
      value,
      source: 'web',
      method: 'inferred',
      confidence: m.confidence,
      // A website has no record date. Its `as_of` is when we read it, and
      // pretending otherwise would overstate how current the fact is.
      as_of: input.retrievedAt.slice(0, 10),
      retrieved_at: input.retrievedAt,
      evidence_url: input.pageUrl,
      evidence_ref: input.evidenceRef,
      notes:
        `Read from the venue's own website by ${input.model}. Supporting text: ` +
        `"${truncate(obs.evidence.trim(), 180)}". Self-described marketing copy — confirm before submission.`,
    });
  }

  return { candidates, unsupported };
}

/** Quote checking must survive whitespace and punctuation drift, not meaning drift. */
function normaliseForQuoteCheck(s: string): string {
  return s.toLowerCase().replace(/[\s ]+/g, ' ').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').trim();
}

const truncate = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
