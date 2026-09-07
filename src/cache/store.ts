/**
 * Content-addressed response cache on disk.
 *
 * Three jobs, all of them load-bearing:
 *   1. Reproducible evals — the same run against the same cache gives the same
 *      profile, so a precision regression is a code change, not weather.
 *   2. Never re-bill or re-hammer a public data portal. Small city portals are
 *      run on someone's budget; we cache aggressively and say so.
 *   3. Honest `retrieved_at` — every value can name the byte-exact payload it
 *      came from, which is what makes `barback replay` work.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type CacheEntry = {
  ref: string;
  url: string;
  method: string;
  status: number;
  retrieved_at: string;
  /** Parsed JSON when the payload was JSON, otherwise the raw text. */
  body: unknown;
};

export function cacheKey(parts: { method: string; url: string; body?: string | undefined }): string {
  const canonical = `${parts.method.toUpperCase()} ${parts.url}\n${parts.body ?? ''}`;
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export class DiskCache {
  constructor(private readonly root: string) {}

  private file(source: string, ref: string): string {
    // Two-level fan-out keeps directory listings usable at 10k+ entries.
    return join(this.root, source, ref.slice(0, 2), `${ref}.json`);
  }

  async read(source: string, ref: string): Promise<CacheEntry | null> {
    try {
      const raw = await readFile(this.file(source, ref), 'utf8');
      return JSON.parse(raw) as CacheEntry;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(source: string, entry: CacheEntry): Promise<void> {
    const f = this.file(source, entry.ref);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  }

  /** Age of an entry in seconds. */
  static ageSeconds(entry: CacheEntry, now: Date): number {
    return (now.getTime() - new Date(entry.retrieved_at).getTime()) / 1000;
  }
}
