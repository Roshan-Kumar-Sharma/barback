# Barback

**Risk intake and carrier appetite matching for restaurant & bar insurance.**

*A barback preps everything — ice, glasses, garnishes, kegs — so the bartender can serve. That's what this does for a broker.*

Give it a **venue name and a state**. It returns a structured underwriting risk profile assembled from public records, with provenance on every single field.

```bash
barback quote --name "Anywhere Social" --state TX
```

> ### ⚠️ Not insurance advice
> Barback does not rate, quote, or bind coverage, and it never contacts a carrier.
> It produces a **draft for a licensed producer to verify**. Public records go stale;
> every field carries an `as_of` date for exactly that reason. Placing coverage on
> unverified data is how you get an E&O claim.

---

## Why this exists

A commercial insurance intake call runs 30–90 minutes and covers 60+ underwriting questions. Then a senior broker guesses, from memory, which of ~100 carriers will want the risk. Those are the two biggest human bottlenecks in placing a bar or restaurant.

A surprising share of those questions are already answered in public government records — you just have to know which records, and be honest about which questions they *don't* answer.

## What it produces

Phase 1 (this release) produces the **`RiskProfile`**: ~100 underwriting fields, each carrying `value`, `source`, `confidence`, `as_of`, `method` and a link to the evidence. Never a bare value.

Example output, on a real Texas venue (name changed — see [Publishing](#publishing-and-real-venues)):

```
Anywhere Social
422 E 6th St, Austin, TX 78701
licence MB 2000XXXXX

Identity
    Trade name                     Anywhere Social              government record · 98%
    Licence type                   MB                           government record · 99%
    Licence status                 Active                       government record · 99%
    Class code                     722410                       derived · 70%

Operations
    Operating class                nightclub                    derived · 80%
    Year started here              2023                         government record · 85%
    Years under current owner      3                            derived from government record · 80%
    Late night operation           yes                          derived · 75%
    Currently operating            yes                          derived from government record · 85%

Revenue
    On-premise alcohol sales       $5,211,768                   government record · 95%
    Cover charge income            $689,501                     government record · 95%
    Alcohol receipts history       36 record(s)                 government record · 95%

Liquor profile
    Alcohol service cutoff         02:00                        derived from government record · 70%
    Late hours permit              yes                          government record · 97%
    Food & beverage certificate    no                           government record · 97%

Coverage      20/101 fields populated without a human
Est. time     7 of 33 minutes of intake questions answered
Still to ask  81 questions
Run           2207ms · $0.0000
```

Every number above came from two government datasets, in about two seconds, for nothing.

Note what the classifier did: it called this a **nightclub** without reading the venue's name, website or a single review. It reasoned from records — a full liquor permit, no Food and Beverage Certificate, a Late Hours Certificate, and 12% of receipts arriving as cover charges. That reasoning is attached to the field and can be argued with.

Phases 2 and 3 add the completeness engine, the appetite engine, the submission drafter and the eval harness. See [Status](#status).

## Quickstart

Phase 1 needs **no API keys, no billing account and no credentials.** Both Texas sources are free public open data.

```bash
pnpm install
pnpm barback quote --name "Luna Rooftop Bar" --state TX
```

Useful flags:

```bash
pnpm barback resolve --name "Whataburger" --state TX      # see how a name resolves
pnpm barback quote --name "..." --state TX --all          # include empty fields
pnpm barback quote --name "..." --state TX --json         # full profile with provenance
pnpm barback quote --name "..." --state TX --city Austin  # disambiguate
```

## The five design rules

These are the parts that make the output usable by someone with professional liability.

**1. Every field carries provenance.** No value without a source, a timestamp and a confidence. `as_of` is the date of the *underlying record*; `retrieved_at` is when we fetched it. Conflating those two makes staleness unauditable.

**2. Enrichers are pure and independent.** Each takes a `Venue` and returns `FieldCandidate[]`. No shared state, no knowledge of each other. Adding a source must not touch the core — and that's [enforced by the build](.dependency-cruiser.cjs), not by a promise here.

**3. Conflicts resolve by explicit precedence, never by a model.** `human correction > government record > official API > venue's own site > inferred`. Ties between equally-trustworthy sources are **not broken** — they surface to a person, with each source's claim attached. See [`precedence.ts`](src/core/reduce/precedence.ts).

**4. Rules decide; models only read.** Classification and eligibility are deterministic and auditable. An LLM's only job in this codebase is reading a venue's own website into structured fields, and anything it produces is marked `inferred` and can never outrank a record.

**5. Nothing auto-submits.** Output is a draft. Barback has no code path that emails an underwriter.

There's a sixth rule that follows from all of them: **never silently guess a field an underwriter prices on.** A null plus a question is worth more than a confident wrong answer. Where a derivation can't complete, it says so and shows what it *does* have — see `revenue.alcohol_pct` below.

## Architecture

```
name + state
     │
     ▼  resolver          TABC licence register is the candidate list, because in
     │                    Texas every venue in this class must hold a licence.
     │                    Returns ranked candidates — never a bare venue.
     ▼
  Venue { license_id, permit_number, address }
     │
     ▼  enrichment (durable, parallel, resumable)
     │  ┌───────────────┬────────────────┬──────────┬────────┐
     │  │ tabc_license  │ tabc_receipts  │   osm    │  web   │
     │  │   (record)    │    (record)    │  (api)   │(inferred)
     │  └───────────────┴────────────────┴──────────┴────────┘
     │  each: fetch → cache → extract → emit FieldCandidate(+provenance)
     ▼
  reducer   phase 1: precedence   phase 2: derivation
     │      (a derived value can never displace a record, structurally:
     │       derivations only run against fields precedence left empty)
     ▼
  RiskProfile
```

**Resolution is the highest-stakes step.** A wrong pick means every downstream field is wrong *and* carries an authoritative-looking government citation. So the resolver returns ranked candidates with scores and reasons, auto-selecting only above an explicit threshold *and* a clear margin over the runner-up. A short generic query like `"Rio"` can never auto-resolve, no matter how well it matches, because it cannot identify a venue among 124,000 licences.

### The workflow choice

Enrichment is many slow, flaky, rate-limited calls, which is a durable-execution problem. **Temporal** is the right tool, and it lands in slice 6 — but a repo that can't run without a cluster is a repo nobody runs, and an eval suite that needs one is an eval suite CI won't keep green.

So durable execution sits behind [a port](src/pipeline/port.ts). `LocalOrchestrator` runs in-process and is the default; `TemporalOrchestrator` runs the same activities under a real event history. **Both must pass [the identical conformance suite](test/orchestrator-conformance.ts)** — failure isolation, wave scheduling on declared requirements, bounded concurrency, idempotency. A fallback that quietly behaved differently would make the local path a toy and the abstraction a lie.

## Data sources

All public, all free, all official APIs or open data. Full detail and attribution in [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

| Source | Gives | Cost |
|---|---|---|
| **TABC License Information** | Licence type & status, **Late Hours Certificate**, **Food & Beverage Certificate**, issue dates, licensee | Free, no key |
| **TX Mixed Beverage Gross Receipts** | Monthly liquor/wine/beer/**cover charge** receipts per permit, tax responsibility dates | Free, no key |
| **OpenStreetMap** (Overpass + Nominatim) | Geocoding, venue website URL, sparse attributes | Free, no key |
| **The venue's own website** | Cooking equipment, events, hookah, bottle service, 21+ | Free |

### The find worth calling out

Texas publishes **monthly alcohol tax filings per venue**. Most descriptions of this problem list "actual revenue split" as something only the insured can tell you. In Texas the alcohol numerator is a public record, filed monthly, itemised into liquor, wine, beer and **cover charges**.

That changes the intake conversation from *"walk me through your revenue"* to *"your alcohol sales were \$5.2M last year — what were your food sales?"* One question instead of six.

Cover charge income is the sleeper. A venue taking money at the door is behaving like a nightclub, and it's filed on its own line of the tax return.

## Honest limitations

The point of this project is being right about what it doesn't know.

- **Texas only, so far.** California lands in Phase 2. Two states done properly beats fifty done shallowly.
- **Liquor violations are not available.** This is the field with the highest underwriting value, and the research this was built from expected Texas to publish it. **It does not.** There is no TABC enforcement dataset on the Texas Open Data Portal — I searched the catalogue. TABC's Public Inquiry System does expose licences with administrative violations, but it's an interactive application, and `tabc.texas.gov/robots.txt` disallows `/search/`. So under this project's own guardrails the field stays `null` with a stated reason. Phase 2 spikes whether a stable, in-ToS endpoint exists, or whether an Open Records Request can seed a dated static dataset.
- **`years_in_operation` is a ceiling, not a fact.** It comes from the licence *lineage*, which survives ownership changes. The tax responsibility date gives a better number and is used where available — but a taxpayer entity can change without the business really changing hands.
- **`alcohol_pct` can't be completed from public data.** The numerator is a tax record; food sales are published nowhere. Rather than guess, the field reports the numerator it holds and names the missing input.
- **Loss runs, X-dates, current carrier, required limits and fire-suppression compliance are structurally human.** No public source will ever fill them. The completeness engine's job (Phase 2) is to name them clearly rather than let them look merely "missing".
- **The `02:00` alcohol cutoff is the *permitted* time, not observed behaviour.** A Late Hours Certificate says what a venue *may* do. Observed closing hours are a separate field, and [precedence deliberately lets observation win](src/core/reduce/precedence.ts).
- **No eval numbers yet.** Coverage figures in this README come from single runs, not a golden set. The eval harness, the hand-labelled golden set, calibration and silent-error rate land in Phase 3. Until then, treat every accuracy claim here as unmeasured.
- **OpenStreetMap coverage is thin.** Of 60 central-Austin venues, 11 had opening hours and 3 had outdoor seating. OSM's real job here is geocoding and finding the venue's website.

## Guardrails

- Official APIs and government open data only. Nothing is scraped from a hostile-ToS source.
- `robots.txt` is respected, an identifying User-Agent is sent, requests are rate-limited **below** the documented ceiling, and everything is cached aggressively. Nominatim and Overpass are donated capacity.
- **No ACORD form or carrier document is reproduced.** Fields are modelled generically as the union of what carriers ask; source documents are cited by URL.
- **Businesses, not people.** Licensee records sometimes name individuals for sole proprietors. Those fields are flagged `sensitive` in the schema and are redacted from published output.
- Review-derived risk signals about named real businesses are a reputational and legal hazard. That enricher is **not built and is off by design**; if it is ever added it will be opt-in and documented.

### Publishing and real venues

The golden set commits real venues with real record-derived values, because evals nobody can reproduce aren't evals. Published material — this README, screenshots, the demo — uses a pseudonymised venue. Personal names are redacted everywhere.

## Status

- [x] **Phase 1 — the spine.** Schema + provenance types · resolver · TABC licence and receipts enrichers · precedence reducer · derivations · orchestration port + local runner · content-addressed cache · CLI
- [ ] Phase 1 remaining: OSM enricher · venue-website enricher · Temporal orchestrator · OpenTelemetry + cost accounting
- [ ] **Phase 2 — the judgment.** Completeness engine · appetite engine + cited carrier files · ranked shortlist · submission drafter · California ABC · health inspections
- [ ] **Phase 3 — the proof.** Hand-labelled golden set · eval harness (coverage, precision, calibration, silent-error rate) · CI regression gate · review UI with correction capture
- [ ] **Phase 4 — compliance.** Diligent-effort affidavits · per-state surplus-lines tax

## Development

```bash
pnpm test           # 44 tests
pnpm typecheck
pnpm lint:layers    # enforces the core-is-source-agnostic rule
```

Adding a source: [docs/ADDING-A-SOURCE.md](docs/ADDING-A-SOURCE.md). Adding a state: [docs/ADDING-A-STATE.md](docs/ADDING-A-STATE.md).

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
