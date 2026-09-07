/**
 * Closing-time arithmetic.
 *
 * A bar's day does not end at midnight. "02:00" is later than "23:00" in every
 * sense an underwriter cares about, but earlier by naive string or clock
 * comparison — and that inversion is exactly the sort of bug that would let a
 * 2am venue pass a "closes before 01:00" rule. So closing times are compared on
 * a 30-hour clock, in one place, used by both the reducer and the appetite
 * rules.
 */

/** Hours strictly before this are treated as belonging to the previous day. */
const SMALL_HOURS_CUTOFF = 6;

/** Minutes since opening-day midnight, with the small hours pushed past 24:00. */
export function closingMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 24 || min > 59) return null;
  if (h === 24) return 24 * 60;
  return h < SMALL_HOURS_CUTOFF ? (h + 24) * 60 + min : h * 60 + min;
}

/** True when `time` is at or after `threshold`, on the 30-hour clock. */
export function isAtOrAfter(time: string, threshold: string): boolean {
  const a = closingMinutes(time);
  const b = closingMinutes(threshold);
  return a !== null && b !== null && a >= b;
}

/** True when `time` is strictly before `threshold`, on the 30-hour clock. */
export function isBefore(time: string, threshold: string): boolean {
  const a = closingMinutes(time);
  const b = closingMinutes(threshold);
  return a !== null && b !== null && a < b;
}
