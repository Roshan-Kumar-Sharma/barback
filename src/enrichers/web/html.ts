/** Minimal HTML handling. No parser dependency: we need visible text and links. */

const STRIP_BLOCKS = /<(script|style|noscript|svg|template|head)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BLOCK_TAG = /<\/?(p|div|br|li|tr|h[1-6]|section|article|header|footer|nav|td)\b[^>]*>/gi;

/** Visible text, with block structure collapsed to newlines. */
export function htmlToText(html: string): string {
  return html
    .replace(STRIP_BLOCKS, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(BLOCK_TAG, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

/** Absolute, same-origin links found in the document. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }

  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const href = m[1];
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      if (u.host !== base.host) continue;
      u.hash = '';
      out.add(u.toString());
    } catch { /* malformed href, skip */ }
  }
  return [...out];
}

/**
 * Pages worth reading, beyond the homepage.
 *
 * A restaurant homepage is marketing; the underwriting signal lives on the menu
 * (fryers, woks), the events page (DJ, live music, dancing) and the private
 * hire page (bottle service, capacity).
 */
const PAGE_HINTS = [
  'menu', 'food', 'drink', 'kitchen',
  'event', 'calendar', 'entertainment', 'music', 'shows', 'lineup',
  'about', 'private', 'book', 'reserve', 'party', 'venue', 'hours',
];

export function rankCandidatePages(links: string[], limit: number): string[] {
  const scored = links
    .map((url) => {
      const lower = url.toLowerCase();
      const hits = PAGE_HINTS.filter((h) => lower.includes(h)).length;
      // Prefer shallow URLs: /menu beats /blog/2019/some-post-about-menus.
      const depth = new URL(url).pathname.split('/').filter(Boolean).length;
      return { url, score: hits * 10 - depth };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.url);
}
