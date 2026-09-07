/**
 * A small, strict robots.txt reader.
 *
 * This is a stated guardrail, not a nicety: Barback fetches pages belonging to
 * real small businesses, and the only defensible position is to obey what they
 * publish. The bias throughout is toward NOT fetching — an unreadable or
 * malformed robots.txt is treated as a disallow, because guessing in the
 * permissive direction is the one mistake with an external victim.
 *
 * Deliberately not supported: crawl-delay (we use a fixed polite interval that
 * is slower than most sites would ask for) and sitemap (we do not crawl).
 *
 * https://www.rfc-editor.org/rfc/rfc9309.html
 */

export type RobotsRules = {
  /** Ordered longest-first, so the most specific rule is found first. */
  rules: Array<{ allow: boolean; path: string }>;
  /** True when no robots.txt exists — the site has stated no restriction. */
  absent: boolean;
};

/** Parse robots.txt, selecting the group that applies to our user-agent. */
export function parseRobots(body: string, userAgentToken: string): RobotsRules {
  const lines = body.split(/\r?\n/);
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let current: { agents: string[]; rules: Array<{ allow: boolean; path: string }> } | null = null;
  let lastWasAgent = false;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line.length === 0) continue;

    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group of rules.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow') current.rules.push({ allow: true, path: value });
    else if (field === 'disallow') current.rules.push({ allow: false, path: value });
  }

  const token = userAgentToken.toLowerCase();
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  const chosen = specific ?? wildcard;

  const rules = (chosen?.rules ?? [])
    .filter((r) => r.path.length > 0 || !r.allow)
    .sort((a, b) => b.path.length - a.path.length);

  return { rules, absent: false };
}

export const NO_ROBOTS: RobotsRules = { rules: [], absent: true };

/**
 * Is this path fetchable?
 *
 * Longest matching rule wins; a tie goes to Allow, per RFC 9309. An empty
 * `Disallow:` means "nothing is disallowed" and is skipped at parse time.
 */
export function isAllowed(robots: RobotsRules, pathname: string): boolean {
  if (robots.absent) return true;

  let best: { allow: boolean; path: string } | null = null;
  for (const rule of robots.rules) {
    if (!matches(rule.path, pathname)) continue;
    if (best === null || rule.path.length > best.path.length) best = rule;
    else if (rule.path.length === best.path.length && rule.allow) best = rule;
  }
  return best === null ? true : best.allow;
}

/** Path matching with `*` wildcards and `$` end-anchors. */
function matches(pattern: string, pathname: string): boolean {
  if (pattern === '') return false;
  if (pattern === '/') return true;

  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;

  if (!body.includes('*')) {
    return anchored ? pathname === body : pathname.startsWith(body);
  }

  const escaped = body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(pathname);
}
