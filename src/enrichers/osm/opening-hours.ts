/**
 * A deliberately conservative reader for the OSM `opening_hours` syntax.
 *
 * We want one fact out of this string: the latest the venue closes on any day.
 * That means the day selectors can be ignored — but only once we are satisfied
 * we UNDERSTOOD them, because a rule we silently skipped might be the late one.
 *
 * So the failure mode is chosen deliberately: anything this parser does not
 * fully recognise yields `null`, never a best guess. Understating a closing
 * time is the dangerous direction here — a venue that trades until 02:00 and is
 * reported as closing at 22:00 is a materially different risk, and an
 * underwriter would price it wrongly. A null plus a question is safe; a
 * confident 22:00 is not.
 *
 * Syntax reference: https://wiki.openstreetmap.org/wiki/Key:opening_hours
 */
import type { TimeOfDay } from '../../core/schema/types.js';

export type OpeningHours = {
  /** Latest closing time across all rules, or null if anything was unclear. */
  latest_close: TimeOfDay | null;
  /** True when the venue is described as trading 24 hours. */
  always_open: boolean;
  /** False when any rule was not fully understood; latest_close is then null. */
  understood: boolean;
  /** Human-readable explanation, attached to the field's notes. */
  note: string;
};

/** Day names, week/holiday selectors and month names we can safely skip over. */
const SELECTOR_TOKEN =
  /^(mo|tu|we|th|fr|sa|su|ph|sh|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|week|easter|day|open)$/i;

const TIME_RANGE = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g;

/**
 * Minutes since midnight on a 30-hour clock, so that closing times in the small
 * hours sort AFTER evening ones. 02:00 must rank later than 23:00, not earlier.
 */
function closeMinutes(h: number, m: number): number {
  if (h === 24) return 24 * 60;
  return h < 6 ? (h + 24) * 60 + m : h * 60 + m;
}

function toTimeOfDay(minutes: number): TimeOfDay {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parseOpeningHours(raw: string): OpeningHours {
  const input = raw.trim();
  if (input.length === 0) {
    return { latest_close: null, always_open: false, understood: false, note: 'empty opening_hours tag' };
  }

  if (/^(24\/7|24 ?hours?)$/i.test(input)) {
    return {
      latest_close: null,
      always_open: true,
      understood: true,
      note: 'Tagged as open 24/7, so there is no closing time.',
    };
  }

  let latest: number | null = null;
  const unparsed: string[] = [];

  for (const rule of input.split(';')) {
    const trimmed = rule.trim();
    if (trimmed.length === 0) continue;

    // A closed-day rule contributes no closing time, but must still be
    // recognised rather than skipped blindly.
    if (/\b(off|closed)\b/i.test(trimmed)) {
      const beforeKeyword = trimmed.replace(/\b(off|closed)\b.*/i, '');
      if (isRecognisableSelector(beforeKeyword)) continue;
      unparsed.push(trimmed);
      continue;
    }

    TIME_RANGE.lastIndex = 0;
    const ranges = [...trimmed.matchAll(TIME_RANGE)];
    if (ranges.length === 0) {
      unparsed.push(trimmed);
      continue;
    }

    // Whatever precedes the first time range must look like a day selector. If
    // it does not, the rule means something we have not accounted for.
    const firstAt = trimmed.indexOf(ranges[0]![0]);
    if (!isRecognisableSelector(trimmed.slice(0, firstAt))) {
      unparsed.push(trimmed);
      continue;
    }

    for (const r of ranges) {
      const h = Number(r[3]);
      const m = Number(r[4]);
      if (!Number.isFinite(h) || !Number.isFinite(m) || h > 24 || m > 59) {
        unparsed.push(trimmed);
        continue;
      }
      const mins = closeMinutes(h, m);
      latest = latest === null ? mins : Math.max(latest, mins);
    }
  }

  if (unparsed.length > 0) {
    return {
      latest_close: null,
      always_open: false,
      understood: false,
      note:
        `Could not fully read the opening_hours tag ${JSON.stringify(raw)} ` +
        `(unrecognised: ${unparsed.map((u) => JSON.stringify(u)).join(', ')}). ` +
        'Reporting no closing time rather than risk understating one.',
    };
  }

  if (latest === null) {
    return {
      latest_close: null,
      always_open: false,
      understood: false,
      note: `No closing time found in opening_hours tag ${JSON.stringify(raw)}.`,
    };
  }

  return {
    latest_close: toTimeOfDay(latest),
    always_open: false,
    understood: true,
    note: `Latest closing time across all days, from the OpenStreetMap opening_hours tag ${JSON.stringify(raw)}.`,
  };
}

/** True when a fragment contains only day/week/month selector tokens. */
function isRecognisableSelector(fragment: string): boolean {
  const cleaned = fragment.replace(/[,\-:[\]+\d]/g, ' ').trim();
  if (cleaned.length === 0) return true;
  return cleaned.split(/\s+/).every((tok) => SELECTOR_TOKEN.test(tok));
}
