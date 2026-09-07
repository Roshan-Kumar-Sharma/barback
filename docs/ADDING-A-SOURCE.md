# Adding a source

Adding a source must not require touching `src/core`. That is [enforced by the build](../.dependency-cruiser.cjs), so if you get it wrong `pnpm lint:layers` will tell you.

## 1. Write the enricher

Implement `Enricher` from [`src/core/enricher.ts`](../src/core/enricher.ts):

```ts
export class MySourceEnricher implements Enricher {
  readonly id = 'my_source' as const;
  readonly produces = ['property.year_built', 'property.square_footage'].map(path);
  readonly requires = ['address'] as const;
  readonly attribution = {
    name: 'Publisher — Dataset',
    url: 'https://example.gov/dataset',
    license: 'Public record',
  };

  async run(venue: Venue, ctx: EnricherContext): Promise<EnrichResult> {
    const res = await ctx.fetch.get({ url, ttl_seconds: 86400 });
    return { fields: [ /* FieldCandidate[] */ ] };
  }
}
```

Four things matter:

- **`produces` is a contract.** It's how the completeness engine works out that no source in the build can ever fill a field, rather than hardcoding a list of "human" fields that silently rots. A test asserts every declared path is a real schema field.
- **`requires` is how you get scheduled.** The orchestrator runs enrichers in waves and merges `venue_patch` between them, so a source needing a website will run once another supplies one. Never order enrichers by hand.
- **Use `ctx.fetch`, never global `fetch`.** All I/O goes through the injected cache-backed port. That's what makes evals reproducible, CI offline and free, and `evidence_ref` replayable.
- **Use `ctx.now()`, never `Date.now()`.** Enrichers must stay deterministic under replay.

## 2. Add the SourceId

Add your id to `SourceId` in [`src/core/field.ts`](../src/core/field.ts) and give it a rank in `SOURCE_RANK` in [`precedence.ts`](../src/core/reduce/precedence.ts). The ranking is a claim about evidence quality — a government record outranks an API, which outranks a venue describing itself, which outranks a model's guess.

## 3. Register it

Add it to `enrichersFor()` in [`src/enrichers/index.ts`](../src/enrichers/index.ts). That's the only file outside your own directory you should need to change.

## 4. If it needs a derivation

A derivation using only your source's raw payload belongs in your enricher. A derivation spanning sources belongs in a `derivations.ts` beside your enricher, contributed through `derivationsFor()`. **Do not put it in `src/core`** — the core must not know your source's vocabulary.

## 5. Set a per-host rate limit

Add your host to `HOST_MIN_INTERVAL_MS` in [`src/cache/fetcher.ts`](../src/cache/fetcher.ts). Go slower than the publisher's documented ceiling.

## Checklist

- [ ] `produces` lists only real schema paths, and everything the enricher emits
- [ ] `requires` lists every `Venue` key the enricher reads
- [ ] `attribution` names the publisher, links the dataset and states the licence
- [ ] All I/O through `ctx.fetch`; all time through `ctx.now()`
- [ ] Values that are guesses are marked `method: 'inferred'`
- [ ] Personal data is flagged `sensitive` in the field registry
- [ ] Documented in [DATA-SOURCES.md](DATA-SOURCES.md), including what it *doesn't* give
- [ ] `pnpm test && pnpm lint:layers` pass
