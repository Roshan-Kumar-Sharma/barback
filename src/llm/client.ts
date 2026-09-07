import type { Fetcher } from '../core/enricher.js';

/**
 * OpenAI-compatible chat client.
 *
 * Points at any compatible endpoint — OpenRouter by default, so the project
 * runs at zero cost, and swappable to Anthropic or anything else with one
 * environment variable.
 *
 * The LLM has exactly one job in this codebase: reading a venue's own website
 * into structured fields. It never adjudicates eligibility, never resolves a
 * conflict, and everything it produces is marked `inferred`, which precedence
 * guarantees can never outrank a record. That is design rule #4, and keeping
 * the client this small is how it stays true.
 */

export type LlmConfig = {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  /** USD per million tokens. Omit for free models. */
  price?: { prompt_per_mtok: number; completion_per_mtok: number };
};

export type LlmUsage = { prompt_tokens: number; completion_tokens: number; usd: number };

export type LlmResult = { text: string; usage: LlmUsage };

export class LlmUnavailableError extends Error {}

export class LlmClient {
  constructor(private readonly config: LlmConfig) {}

  get available(): boolean {
    return typeof this.config.apiKey === 'string' && this.config.apiKey.length > 0;
  }

  get model(): string {
    return this.config.model;
  }

  /**
   * Complete a prompt, through the shared cache when one is supplied.
   *
   * Routing model calls through the same content-addressed cache as every other
   * fetch is what makes an eval run reproducible and free to repeat: the cache
   * key is a hash of method, URL and body, so the same prompt against the same
   * model replays byte-for-byte instead of being re-billed and re-sampled.
   * The API key travels in a header, which is deliberately not part of the key.
   */
  async complete(
    opts: {
      system: string;
      user: string;
      maxTokens?: number;
      signal?: AbortSignal;
      fetcher?: Fetcher;
    },
  ): Promise<LlmResult> {
    if (!this.available) {
      throw new LlmUnavailableError('No LLM API key configured (set LLM_API_KEY).');
    }

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const payload = JSON.stringify({
      model: this.config.model,
      temperature: 0,
      max_tokens: opts.maxTokens ?? 4000,
      // Requested, not relied upon: free models honour it inconsistently, so
      // the caller parses defensively either way.
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    });
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.config.apiKey ?? ''}`,
    };

    let body: {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };

    if (opts.fetcher) {
      const res = await opts.fetcher.get({ url, method: 'POST', headers, body: payload });
      if (res.status !== 200) {
        throw new Error(`LLM ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
      }
      body = res.body as typeof body;
    } else {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: payload,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
      body = (await res.json()) as typeof body;
    }

    if (body.error) throw new Error(`LLM error: ${body.error.message ?? 'unknown'}`);

    const text = body.choices?.[0]?.message?.content ?? '';
    const prompt_tokens = body.usage?.prompt_tokens ?? 0;
    const completion_tokens = body.usage?.completion_tokens ?? 0;
    const price = this.config.price;
    const usd = price
      ? (prompt_tokens / 1e6) * price.prompt_per_mtok + (completion_tokens / 1e6) * price.completion_per_mtok
      : 0;

    return { text, usage: { prompt_tokens, completion_tokens, usd } };
  }
}

/**
 * Pull the intended JSON object out of a model response.
 *
 * Taking the FIRST `{` is not good enough. Reasoning models narrate before they
 * answer — one real run began "Here's a thinking process: 1. Analyze User
 * Request..." and contained braces in the prose long before the payload. So
 * every candidate start is tried and the richest valid object wins, which is
 * reliably the answer rather than an aside.
 *
 * Brace counting beats a regex here, and quote/escape awareness stops a `{`
 * inside a string from throwing off the depth.
 */
export function extractJson(text: string): unknown {
  // Reasoning traces are often explicitly delimited; drop them when they are.
  const cleaned = text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, ' ');

  let best: { value: Record<string, unknown>; keys: number } | null = null;

  for (let start = cleaned.indexOf('{'); start >= 0; start = cleaned.indexOf('{', start + 1)) {
    const parsed = parseBalanced(cleaned, start);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

    const keys = Object.keys(parsed).length;
    if (best === null || keys > best.keys) best = { value: parsed as Record<string, unknown>, keys };
  }
  return best?.value ?? null;
}

/** Parse the balanced `{...}` beginning at `start`, or null if there isn't one. */
function parseBalanced(text: string, start: number): unknown {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}
