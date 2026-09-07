/**
 * The venue's own website.
 *
 * The highest-signal free source there is: nothing in a liquor licence or a tax
 * filing tells you whether there is a deep fryer, a DJ, hookah, bottle service
 * or a rooftop, and those are exactly the questions carriers decline over.
 *
 * It is also the least authoritative source, and the code treats it that way —
 * everything is `inferred`, confidence stays modest, and every value must carry
 * a verbatim quote that is verified against the page text before it is kept.
 *
 * Politeness is not optional here. Unlike the government portals, these are
 * small businesses' own servers: robots.txt is obeyed, an identifying
 * User-Agent is sent, at most a handful of pages are read, and everything is
 * cached so a second run costs the venue nothing.
 */
import type { Enricher, EnricherContext, EnrichResult } from '../../core/enricher.js';
import { path, type FieldCandidate } from '../../core/field.js';
import type { Venue } from '../../core/venue.js';
import { LlmClient, LlmUnavailableError, extractJson } from '../../llm/client.js';
import { ExtractionSchema, PRODUCES as MAPPED_PATHS, SYSTEM_PROMPT, toCandidates } from './extract.js';
import { extractLinks, htmlToText, rankCandidatePages } from './html.js';
import { isAllowed, NO_ROBOTS, parseRobots, type RobotsRules } from './robots.js';

/** Homepage plus this many discovered pages. Enough for menu and events. */
const EXTRA_PAGES = 3;
/** Characters of page text sent to the model. Keeps cost and latency bounded. */
const MAX_TEXT_CHARS = 24_000;
const TTL_SECONDS = 60 * 60 * 24 * 7;

export const PRODUCES = MAPPED_PATHS.map(path);

export class WebEnricher implements Enricher {
  readonly id = 'web' as const;
  readonly produces = PRODUCES;
  readonly requires = ['website'] as const;
  readonly attribution = {
    name: "The venue's own website",
    url: 'https://www.rfc-editor.org/rfc/rfc9309.html',
    license: 'Fetched under robots.txt; content belongs to the venue and is not redistributed',
  };

  constructor(private readonly llm: LlmClient) {}

  async run(venue: Venue, ctx: EnricherContext): Promise<EnrichResult> {
    if (!this.llm.available) {
      ctx.log.warn('web: no LLM configured, skipping site reading', { venue: venue.id });
      return { fields: [] };
    }
    const site = venue.website;
    if (!site) return { fields: [] };

    const origin = new URL(site).origin;
    const robots = await this.loadRobots(origin, ctx);

    const pages = await this.readPages(site, robots, ctx);
    if (pages.length === 0) {
      ctx.log.debug('web: nothing readable', { site });
      return { fields: [] };
    }

    const sourceText = pages.map((p) => `## ${p.url}\n${p.text}`).join('\n\n').slice(0, MAX_TEXT_CHARS);

    let raw: string;
    let usage;
    try {
      const result = await this.llm.complete({
        system: SYSTEM_PROMPT,
        user:
          `Venue: ${venue.trade_name}\n` +
          `Location: ${venue.address.city}, ${venue.address.state}\n\n` +
          `Website text follows.\n\n${sourceText}`,
        signal: ctx.signal,
        // Through the cache: same prompt, same model, same answer, no re-billing.
        fetcher: ctx.fetch,
      });
      raw = result.text;
      usage = result.usage;
    } catch (err) {
      if (err instanceof LlmUnavailableError) return { fields: [] };
      throw err;
    }

    const parsed = ExtractionSchema.safeParse(extractJson(raw));
    if (!parsed.success) {
      // A malformed response is a miss, not a crash. Every other source's work
      // survives, and the fields simply stay null with a question attached.
      ctx.log.warn('web: model response did not match the extraction schema', {
        venue: venue.id,
        issue: parsed.error.issues[0]?.message,
        at: parsed.error.issues[0]?.path.join('.'),
        response: raw.slice(0, 240),
      });
      return { fields: [], cost: { usd: usage.usd, tokens: usage.prompt_tokens + usage.completion_tokens } };
    }

    const { candidates, unsupported } = toCandidates({
      extraction: parsed.data,
      sourceText,
      pageUrl: pages[0]!.url,
      evidenceRef: pages[0]!.ref,
      retrievedAt: pages[0]!.retrieved_at,
      model: this.llm.model,
    });

    if (unsupported.length > 0) {
      // Worth surfacing loudly: this is the anti-hallucination guard firing.
      ctx.log.warn('web: discarded values with no verifiable quote', {
        venue: venue.id,
        dropped: unsupported,
      });
    }

    return {
      fields: candidates as FieldCandidate[],
      cost: { usd: usage.usd, tokens: usage.prompt_tokens + usage.completion_tokens },
    };
  }

  private async loadRobots(origin: string, ctx: EnricherContext): Promise<RobotsRules> {
    try {
      const res = await ctx.fetch.get({ url: `${origin}/robots.txt`, ttl_seconds: TTL_SECONDS });
      if (res.status === 404 || res.status === 410) return NO_ROBOTS;
      if (res.status !== 200 || typeof res.body !== 'string') {
        // Unreadable robots.txt is treated as a block. Guessing permissively is
        // the one mistake here with somebody else on the receiving end.
        ctx.log.warn('web: robots.txt unreadable, declining to fetch', { origin, status: res.status });
        return { rules: [{ allow: false, path: '/' }], absent: false };
      }
      return parseRobots(res.body, 'barback');
    } catch (err) {
      ctx.log.warn('web: robots.txt fetch failed, declining to fetch', { origin, error: String(err) });
      return { rules: [{ allow: false, path: '/' }], absent: false };
    }
  }

  private async readPages(
    site: string,
    robots: RobotsRules,
    ctx: EnricherContext,
  ): Promise<Array<{ url: string; text: string; ref: string; retrieved_at: string }>> {
    const out: Array<{ url: string; text: string; ref: string; retrieved_at: string }> = [];

    // OSM website tags go stale — the tag for one venue tested during
    // development pointed at a deep link that now 404s while the site itself
    // was fine. Falling back to the origin recovers those without inventing a
    // URL: the origin is derived from the tag, not guessed.
    const origin = new URL(site).origin;
    let home = await this.readOne(site, robots, ctx);
    if (!home && origin !== site.replace(/\/$/, '')) {
      ctx.log.debug('web: falling back to site origin', { site, origin });
      home = await this.readOne(origin, robots, ctx);
    }
    if (!home) return out;
    out.push(home);

    const links = extractLinks(home.html, home.url);
    for (const url of rankCandidatePages(links, EXTRA_PAGES)) {
      const page = await this.readOne(url, robots, ctx);
      if (page) out.push(page);
    }
    return out;
  }

  private async readOne(
    url: string,
    robots: RobotsRules,
    ctx: EnricherContext,
  ): Promise<{ url: string; text: string; html: string; ref: string; retrieved_at: string } | null> {
    const pathname = new URL(url).pathname;
    if (!isAllowed(robots, pathname)) {
      ctx.log.debug('web: robots.txt disallows', { url });
      return null;
    }
    try {
      const res = await ctx.fetch.get({ url, ttl_seconds: TTL_SECONDS });
      if (res.status !== 200 || typeof res.body !== 'string') return null;
      const text = htmlToText(res.body);
      if (text.length < 100) return null;
      return { url, text, html: res.body, ref: res.ref, retrieved_at: res.retrieved_at };
    } catch (err) {
      ctx.log.debug('web: page fetch failed', { url, error: String(err) });
      return null;
    }
  }
}
