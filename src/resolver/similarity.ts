/** Dice coefficient over character bigrams. Boring, symmetric, no dependencies. */
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let hits = 0;
  let total = 0;
  for (const n of ga.values()) total += n;
  for (const n of gb.values()) total += n;
  for (const [g, n] of ga) hits += Math.min(n, gb.get(g) ?? 0);
  return (2 * hits) / total;
}

const NOISE = new Set([
  'LLC', 'INC', 'LP', 'LTD', 'CORP', 'CO', 'THE', 'DBA', 'LLP', 'PLLC', 'INCORPORATED', 'COMPANY',
]);

/** Uppercase, drop punctuation, drop entity-suffix noise. */
export function normalizeName(s: string): string {
  const cleaned = s
    .toUpperCase()
    .replace(/[&]/g, ' AND ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const kept = cleaned.split(' ').filter((t) => t.length > 0 && !NOISE.has(t));
  return kept.length > 0 ? kept.join(' ') : cleaned;
}

/** The longest meaningful token — used to widen a search that found nothing. */
export function anchorToken(s: string): string | null {
  const tokens = normalizeName(s).split(' ').filter((t) => t.length >= 4);
  if (tokens.length === 0) return null;
  return tokens.reduce((a, b) => (b.length > a.length ? b : a));
}

/**
 * Token containment, discounted by how much of the candidate the query covers.
 *
 * Plain intersection-over-minimum is wrong here: "Rio" is fully contained in
 * "Casa Rio Mexican Foods" and would score 1.0, which would let a two-letter
 * query auto-resolve onto an arbitrary venue. The coverage term keeps a query
 * that explains only a quarter of the candidate's name from looking certain.
 */
export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits++;
  if (hits === 0) return 0;
  const containment = hits / ta.size;
  const coverage = hits / tb.size;
  return containment * (0.6 + 0.4 * coverage);
}

/**
 * How much a query could possibly identify, independent of any candidate.
 *
 * "Rio" cannot identify a venue in a state with 124,000 licences no matter how
 * well it matches, so no candidate should ever clear the auto-resolve bar on
 * it. Capping by query specificity forces those to the human rather than
 * relying on a runner-up existing to trigger the ambiguity margin.
 */
export function specificity(query: string): number {
  const n = normalizeName(query);
  const tokens = n.split(' ').filter(Boolean);
  const chars = n.replace(/ /g, '').length;
  if (tokens.length >= 3 || chars >= 14) return 1;
  if (tokens.length === 2 && chars >= 8) return 0.98;
  if (tokens.length === 2) return 0.92;
  if (chars >= 8) return 0.9;
  if (chars >= 6) return 0.84;
  return 0.7;
}

/** Combined name match: the best of bigram similarity and token containment. */
export function nameScore(query: string, candidate: string): number {
  const nq = normalizeName(query);
  const nc = normalizeName(candidate);
  let best = Math.max(dice(nq, nc), tokenOverlap(query, candidate) * 0.95);

  // An exact contiguous phrase match is strong evidence, discounted by how
  // much of the candidate name it leaves unexplained.
  if (nc.includes(nq) && nq.length > 0) {
    best = Math.max(best, 0.75 + 0.25 * (nq.length / nc.length));
  }
  return Math.min(1, best * specificity(query));
}
