# Barback

**Risk intake and carrier appetite matching for restaurant & bar insurance.**

*A barback preps everything — ice, glasses, garnishes, kegs — so the bartender can serve. That's what this does for a broker.*

Give it a **venue name and a state**. It returns a structured underwriting risk profile assembled from public records, with provenance on every single field.

```bash
barback quote --name "Anywhere Cantina" --state TX
```

> ### ⚠️ Not insurance advice
> Barback does not rate, quote, or bind coverage, and it never contacts a carrier.
> It produces a **draft for a licensed producer to verify**. Public records go stale;
> every field carries an `as_of` date for exactly that reason. Placing coverage on
> unverified data is how you get an E&O claim.

<p align="center">
  <img src="docs/demo.svg" width="862"
       alt="A real barback run: name and state in; a provenance-tracked profile, a ranked market shortlist, an ordered question list and a drafted submission out.">
</p>

<sub><b>A real run, replayed.</b> Every line is verbatim CLI output, in the order the CLI
printed it; only the venue name and its licence numbers are pseudonymised, as
<a href="#publishing-and-real-venues">Publishing</a> requires. Long lines are wrapped to fit
the frame. The pacing is the only synthetic part — regenerate the frame with
<a href="docs/demo.py"><code>docs/demo.py</code></a>.</sub>

---

## Why this exists

A commercial insurance intake call runs 30–90 minutes and covers 60+ underwriting questions. Then a senior broker guesses, from memory, which of ~100 carriers will want the risk. Those are the two biggest human bottlenecks in placing a bar or restaurant.

A surprising share of those questions are already answered in public government records — you just have to know which records, and be honest about which questions they *don't* answer.

## What it produces

1. **`RiskProfile`** — 103 underwriting fields, each carrying `value`, `source`, `confidence`, `as_of`, `method` and a link to the evidence. Never a bare value.
2. **`MarketShortlist`** — carriers ranked with a verdict and the reasons, naming the rules that fired.
3. **`CompletenessReport`** — the minimum ordered list of questions a human still needs to ask.
4. **`SubmissionDraft`** — a populated field map and a drafted underwriter email.

Example output, on a real Texas venue (name changed — see [Publishing](#publishing-and-real-venues)):

```
$ barback quote --name "Anywhere Cantina" --state TX --city Austin --redact

! web: discarded values with no verifiable quote
  dropped: property.outdoor_seating (quote not found in page text)

Anywhere Cantina
606 TRINITY ST, Austin, TX 78701
licence MB 1001XXXXX

Identity
    Trade name                     ANYWHERE CANTINA             government record · 98%
    Named insured                  [redacted — personal data]   government record · 95%
    Location address               606 TRINITY ST, Austin, TX,  government record · 97%
    Licence type                   MB                           government record · 99%
    Licence status                 Active                       government record · 99%
    Licence number                 1001XXXXX                    government record · 99%
    Permit number                  MB1XXXXX                     government record · 98%
    Class code                     722410                       derived · 70%

Operations
    Operating class                tavern                       derived · 60%
    Year started here              1993                         government record · 85%
    Years in operation             39                           derived from government record · 60%
    Years under current owner      32                           derived from government record · 80%
    Latest closing time            23:00                        official API · 70%
    Late night operation           yes                          derived · 75%
    Currently operating            yes                          derived from government record · 85%
    Health inspection score        82                           government record · 90%
    Health inspection history      4 record(s)                  government record · 90%

Revenue
    On-premise alcohol sales       $896,581                     government record · 95%
    Cover charge income            $0                           government record · 95%
    Alcohol receipts history       36 record(s)                 government record · 95%

Liquor profile
    Alcohol service cutoff         02:00                        derived from government record · 70%
    Late hours permit              yes                          government record · 97%
    Food & beverage certificate    yes                          government record · 97%

Property
    Elevated deck or rooftop       yes                          inferred from venue's own site · 60%
    Outdoor seating                yes                          official API · 65%

Sources
  ✓ tabc_license     12 field(s)      ✓ health_austin     2 field(s)
  ✓ tabc_receipts     7 field(s)      ✓ web               1 field(s)
  ✓ osm               2 field(s)

Intake       25/103 fields filled without a human
             ~9 of ~35 minutes of questions answered
             0 conflict(s) · 0 low-confidence · 58 that no public source can ever fill
Run          0.0s · $0.0000 · 7,445 tokens · local
```

Everything above came from five free public sources, with no credentials. That run is **warm** from the
content-addressed cache, which is why it reports `0.0s` — a cold run is dominated by the website fetch
and the single model call. The first line is the point as much as anything below it: the model proposed
`outdoor_seating` without a quote from the page to back it, so the value was thrown away, and OpenStreetMap
supplied it from a record instead.

**Look at the three time fields, because they are the whole idea.** The venue is *permitted* to serve until 02:00 (it holds a Late Hours Certificate — a government record). It is *observed* to close at 23:00 (OpenStreetMap). And it counts as late-night because the authority to trade late is what a carrier is actually underwriting, whether or not the venue uses it. Those are three different questions, and a carrier application asks them separately. Collapsing them into one "closing time" field would lose the distinction that matters.

Note also what the classifier did: it called an earlier test venue a **nightclub** without reading its name, website or a single review — reasoning from a full liquor permit, no Food and Beverage Certificate, a Late Hours Certificate, and 12% of receipts arriving as cover charges. That reasoning is attached to the field and can be argued with.

### The shortlist names the rule that fired

Market selection is the other half of the bottleneck: a senior broker deciding, from memory, which of
roughly a hundred carriers will want this risk. The same run continues:

```
Market shortlist

  ⚠️  Needs review — Amwins Access — Bars & Restaurants (binding authority)
     ✅ Class "tavern" is written by this program.
     ? Unknown: whether entertainment.adult_entertainment is yes — Adult
       entertainment is written by this program, but the page lists it as a
       distinct class rather than part of the standard bar/restaurant appetite,
       so expect it to be underwritten separately.
     📋 Submission incomplete: 3 required item(s) still needed.
     Blocked on 1 unknown field(s); see the question list.
     Basis: Public program page (classes, coverages, limits and submission
       requirements only). No published underwriting eligibility guide; no hard
       declines are encoded because none are public.
     Source: https://www.amwins.com/products/bars-taverns (as of 2026-09-07)

  ⚠️  Needs review — Late Night Hospitality Program (ILLUSTRATIVE)
     ✅ Class "tavern" is written by this program.
     ? Unknown: whether entertainment.pyrotechnics is yes — Pyrotechnics are
       excluded.
     ? Unknown: whether entertainment.adult_entertainment is yes — Adult
       entertainment refers to a senior underwriter.
     ? Unknown: whether liquor_profile.underage_patrons_permitted is yes —
       Admitting under-21 patrons to a late-night venue refers.
     📋 Submission incomplete: 3 required item(s) still needed.
     Blocked on 3 unknown field(s); see the question list.
     Basis: ILLUSTRATIVE — demonstrates the rule format. Not a real appetite.

  ⚠️  Needs review — Example Specialty E&S (ILLUSTRATIVE)
     ✅ Class "tavern" is written by this program.
     ⚠️ A rooftop or deck elevated 8ft or more refers for the fall exposure. (yes)
     ? Unknown: whether revenue.alcohol_pct is over 0.85 — Alcohol above 85% of
       sales exceeds the program's concentration limit.
     ? Unknown: whether entertainment.mosh_pits is yes — Mosh pits are excluded.
     ? Unknown: whether entertainment.hookah_or_oxygen_inhalation is yes —
       Hookah or oxygen inhalation on premises requires referral.
     ? Unknown: whether entertainment.dj_with_dancing is yes — A DJ with dancing
       refers for the crowd-management exposure.
     📋 Submission incomplete: 4 required item(s) still needed.
     Blocked on 5 unknown field(s); see the question list.
     Basis: ILLUSTRATIVE — demonstrates the rule format. Not a real appetite.

  Not considered:
     Mainstreet Mutual — Restaurant BOP (ILLUSTRATIVE) — Does not write class
       "tavern" (writes restaurant).
```

Four things in there are deliberate.

**Nothing is "eligible".** Every verdict is *needs review*, because every carrier has at least one
unknown that bears on its own rules. A shortlist that said "eligible" here would be asserting facts
about mosh pits and hookah that nobody has established.

**The one ⚠️ that fired on a positive value came from the weakest source.** The rooftop refers under
Example Specialty's fall-exposure rule — and that value is `inferred from venue's own site · 60%`,
carried through from a quote on the venue's own page. It is shown as a referral to look at, not a
fact to act on, and a broker can click straight back to the sentence that produced it.

**"Not considered" is a first-class output.** Mainstreet Mutual writes restaurants, not taverns, so it
is excluded *with the reason*, rather than quietly ranked last. A broker needs to know a market was
ruled out and why, otherwise they re-check it by hand.

**Every entry carries its basis and its date.** The one real carrier file says plainly that it encodes
a public program page and no hard declines, because no eligibility guide is public. The other three
are labelled `ILLUSTRATIVE` in the name, in the basis line, and again in a banner at the end of the
run — see [the limitations](#honest-limitations).

### The question list is the product

Ranking is the whole thing. This ordering is a claim about what actually moves a placement:

1. **Submission requirements.** An incomplete submission is the commonest reason an underwriter ignores a broker. Nothing else matters if the file cannot be reviewed at all.
2. **Unknowns on hard declines.** One answer can remove a carrier from the list entirely — worth knowing before spending days of calendar time.
3. Then referral unknowns, then conflicts, then questions that unblock a derived field, then merely weak values. Cheap questions break ties.

```
Still to ask — 78 question(s), about 26 minutes
  Ranked for: Amwins Access — Bars & Restaurants (binding authority), Late Night
  Hospitality Program (ILLUSTRATIVE), Example Specialty E&S (ILLUSTRATIVE)

   1. Can you provide loss runs for the last five years?
      Losses (5 years) · ~180s
      → Amwins Access will not review the submission without it: Five years of
        currently valued loss runs are required with every submission.
      → Late Night Hospitality Program will not review the submission without
        it: Five years of loss runs, with assault and battery detail.

   2. What liquor liability limits are required?
      Liquor limits · ~25s
      → Amwins Access will not review the submission without it: A liquor
        liability application is required where liquor liability is requested.
      → Example Specialty E&S will not review the submission without it:
        Requested liquor limits must be stated.

   3. What share of sales is alcohol?
      Alcohol % of sales · ~20s
      → Example Specialty E&S will not review the submission without it: The
        revenue split is needed to rate liquor liability.
      → Example Specialty E&S declines on this. Unknown, so eligibility cannot
        be confirmed: Alcohol above 85% of sales exceeds the concentration limit.

   4. Is there adult entertainment or exotic dancing, and how often?
      Adult entertainment · ~20s
      → Example Specialty E&S declines on this. Unknown, so eligibility cannot
        be confirmed: Adult entertainment is outside this program's appetite.
      → Amwins Access refers on this: Adult entertainment is written by this
        program, but the page lists it as a distinct class, so expect it to be
        underwritten separately.

  …and 74 more. Use --questions <n> to see them.
```

That third one is the pattern worth noticing. Barback already knows this venue's alcohol sales to the dollar, from state tax filings. It is asking for the one number that completes the ratio — and it says which carrier's decline turns on it.

**An unknown is never a pass.** If a carrier hard-declines venues with adult entertainment and nobody knows whether this venue has it, the verdict is "needs review", never "eligible". Treating silence as compliance is how a submission gets declined after a week of calendar time. In practice that turns appetite matching into a question generator, which is what a broker actually wants: not "yes", but "yes, once you confirm these three things".

### The draft is a draft

`--draft` assembles the submission for the best-ranked market. It is the last thing Barback does, and
the thing it is most careful about.

```
────────────────────────────────────────────────────────────────────────
Draft submission — Amwins Access — Bars & Restaurants (binding authority)
────────────────────────────────────────────────────────────────────────
  ⚠️  This is a DRAFT. Nothing has been sent. A licensed producer must verify
      every field before it goes to a carrier.
  ⚠️  3 required submission item(s) are missing. Underwriters routinely ignore
      incomplete submissions.

  To:      [underwriter email — not populated; Barback never sends]
  Subject: Submission — ANYWHERE CANTINA, Austin TX — tavern

  Please consider the following tavern risk for Amwins Access — Bars &
  Restaurants (binding authority).

  ANYWHERE CANTINA
  606 TRINITY ST, Austin, TX 78701

  Identity
    Trade name: ANYWHERE CANTINA
    Named insured: [redacted — personal data]
    Location address: 606 TRINITY ST, Austin, TX, 78701
    Licence type: MB
    Licence status: Active
    Licence number: 1001XXXXX
    Permit number: MB1XXXXX
    Class code: 722410

  Operations
    Operating class: tavern
    Year started here: 1993
    Years in operation: 39
    Years under current owner: 32
    Latest closing time: 23:00
    Late night operation: Yes
    Currently operating: Yes
    Health inspection score: 82
    Health inspection history: 4 record(s) attached separately

  Revenue
    On-premise alcohol sales: $896,581
    Cover charge income: $0
    Alcohol receipts history: 36 record(s) attached separately

  Liquor profile
    Alcohol service cutoff: 02:00
    Late hours permit: Yes
    Food & beverage certificate: Yes

  Property
    Elevated deck or rooftop: Yes
    Outdoor seating: Yes

  Still being confirmed with the insured:
    Losses (5 years)
    Liquor limits
    Alcohol % of sales
    Adult entertainment
    Bouncers employed
    A&B sublimit
    GL limits
    NFPA 96 compliant
    Mosh pits
    Pyrotechnics
    Hookah or oxygen
    Underage patrons
    …and 66 further items

  Data provenance: figures above are drawn from state licence and tax records,
  OpenStreetMap and the venue's own website. Every field carries a source and a
  record date, available on request.

  [Producer name] · [licence number] · [contact]

  25 field(s) populated · 78 still outstanding
```

**The `To:` line is empty on purpose, and there is no code path that fills it.** Barback has no mail
client, no SMTP configuration and no carrier contact list. The draft is text on a terminal; a licensed
producer moves it.

**The draft states its own gaps in the body.** "Still being confirmed with the insured" is not padding
— sending an underwriter a submission that looks complete but silently omits loss runs is how a broker
loses a market. Naming the gaps is what an experienced broker does by hand, and it is why the two
banners at the top count the missing *required* items rather than just warning in general.

**The producer block is left as placeholders.** Binding is legally gated to a licensed producer, so the
signature is something a human fills in, never something the tool asserts.

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

Enrichment is many slow, flaky, rate-limited calls, which is a durable-execution problem. **Temporal** is the right tool — but a repo that can't run without a cluster is a repo nobody runs, and an eval suite that needs one is an eval suite CI won't keep green.

So durable execution sits behind [a port](src/pipeline/port.ts). `LocalOrchestrator` runs in-process and is the default; `TemporalOrchestrator` runs the same activities under a real event history, with per-activity retry, failure isolation and replay across worker restarts.

**Both pass [the identical conformance suite](test/orchestrator-conformance.ts)** — failure isolation, wave scheduling on declared requirements, bounded concurrency, idempotency, cost accounting. That suite runs against a real Temporal server (via its test environment, so no Docker in CI), and it is what makes the port an honest boundary rather than a convenient fiction. It has already earned its keep: it caught that Temporal wraps activity errors in a generic `ActivityFailure`, so the durable path was reporting `"Activity task failed"` where the local one reported the actual cause. That divergence would never have surfaced against live sources.

```bash
docker compose up -d                 # Temporal + UI on :8233
pnpm barback worker                  # in one terminal
pnpm barback quote --durable --name "..." --state TX
```

The workflow itself is deliberately dull: it takes enricher *specs* rather than instances, so it stays deterministic and free of Node APIs, and every side effect lives in an activity. Activities are safe to retry aggressively because enrichers are pure given their fetcher and the fetcher is content-addressed — a retry replays from cache instead of re-billing an API or re-hammering a public portal.

## Data sources

All public, all free, all official APIs or open data. Full detail and attribution in [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

| Source | Gives | Cost |
|---|---|---|
| **TABC License Information** | Licence type & status, **Late Hours Certificate**, **Food & Beverage Certificate**, issue dates, licensee | Free, no key |
| **TX Mixed Beverage Gross Receipts** | Monthly liquor/wine/beer/**cover charge** receipts per permit, tax responsibility dates | Free, no key |
| **OpenStreetMap** (Overpass + Nominatim) | Observed opening hours, outdoor seating, live music, age policy — and the venue's **website URL** | Free, no key |
| **The venue's own website** | Cooking equipment, events, hookah, bottle service, 21+, rooftop | Free (LLM optional) |
| **California ABC** daily export | Licence type, status, issue date — type 48 states minors may not enter | Free, no key |
| **City of Austin** food inspections | Inspection scores and trend | Free, no key |

### The find worth calling out

Texas publishes **monthly alcohol tax filings per venue**. Most descriptions of this problem list "actual revenue split" as something only the insured can tell you. In Texas the alcohol numerator is a public record, filed monthly, itemised into liquor, wine, beer and **cover charges**.

That changes the intake conversation from *"walk me through your revenue"* to *"your alcohol sales were \$5.2M last year — what were your food sales?"* One question instead of six.

Cover charge income is the sleeper. A venue taking money at the door is behaving like a nightclub, and it's filed on its own line of the tax return.

## Honest limitations

The point of this project is being right about what it doesn't know.

- **Two states, and they are not equal.** Texas yields ~22–25 fields per venue; California yields ~13. Texas publishes monthly alcohol tax filings and California publishes nothing comparable, so revenue, cover-charge income and ownership tenure are simply unavailable there. Two states done properly beats fifty done shallowly, but "properly" still means different things in each.
- **Liquor violations are not available.** This is the field with the highest underwriting value, and the research this was built from expected Texas to publish it. **It does not.** There is no TABC enforcement dataset on the Texas Open Data Portal — I searched the catalogue. TABC's Public Inquiry System does expose licences with administrative violations, but it's an interactive application, and `tabc.texas.gov/robots.txt` disallows `/search/`. So under this project's own guardrails the field stays `null` with a stated reason. The realistic routes are an Open Records Request seeding a dated static dataset, or a broker supplying it. It stays `null` until one of those happens.
- **`years_in_operation` is a ceiling, not a fact.** It comes from the licence *lineage*, which survives ownership changes. The tax responsibility date gives a better number and is used where available — but a taxpayer entity can change without the business really changing hands.
- **`alcohol_pct` can't be completed from public data.** The numerator is a tax record; food sales are published nowhere. Rather than guess, the field reports the numerator it holds and names the missing input.
- **Loss runs, X-dates, current carrier, required limits and fire-suppression compliance are structurally human.** No public source will ever fill them. The completeness engine computes this from what the configured sources declare they can produce, rather than from a hardcoded list that would rot — and reports them as "no public source can provide this" rather than letting them look merely missing. On a typical Texas venue that is 58 of the 78 unfilled fields.
- **The appetite seed set is one real carrier and three illustrative ones.** This is the honest state of the world, not a shortcut. Public carrier documents publish classes, limits and submission requirements; they do not publish eligibility rules, which live in gated broker portals. The one real file encodes exactly what its public program page states and no hard declines, because none are public. The demonstration files live in `carriers/illustrative/`, are excluded unless you pass `--include-illustrative`, are labelled in every output, and are refused by the loader if they forget to declare themselves. **Do not place business on them.**
- **Health inspection data is thinner than intended.** Austin publishes inspection scores but no violation text, so the grease and hood citations that would bear directly on the fire questions are not available. What is left is a score trend, which is a real signal about operational discipline but a weaker one than the source was chosen for. Chicago and NYC publish violation text but are outside both implemented states.
- **The `02:00` alcohol cutoff is the *permitted* time, not observed behaviour.** A Late Hours Certificate says what a venue *may* do. Observed closing hours are a separate field, and [precedence deliberately lets observation win](src/core/reduce/precedence.ts).
- **Website extraction is not deterministic across cold runs.** Even at temperature 0, two cold runs on the same venue returned different subsets of fields. The cache makes any *given* run reproducible, but coverage from this source varies. Quantifying that is a Phase 3 eval job, and until then treat the web enricher's contribution as indicative.
- **No eval numbers yet.** Coverage figures in this README come from single runs, not a golden set. The eval harness, the hand-labelled golden set, calibration and silent-error rate land in Phase 3. Until then, treat every accuracy claim here as unmeasured.
- **OpenStreetMap coverage is thin, and the enricher often returns nothing.** Of 60 central-Austin venues sampled, 11 had opening hours and 3 had outdoor seating. Three of the four venues tested during development were not mapped at all, and got zero OSM fields. That is the enricher working correctly — see below.

## Guardrails

- Official APIs and government open data only. Nothing is scraped from a hostile-ToS source.
- `robots.txt` is respected, an identifying User-Agent is sent, requests are rate-limited **below** the documented ceiling, and everything is cached aggressively. Nominatim and Overpass are donated capacity.
- **No ACORD form or carrier document is reproduced.** Fields are modelled generically as the union of what carriers ask; source documents are cited by URL.
- **Businesses, not people.** Licensee records sometimes name individuals for sole proprietors. Those fields are flagged `sensitive` in the schema and are redacted from published output.
- Review-derived risk signals about named real businesses are a reputational and legal hazard. That enricher is **not built and is off by design**; if it is ever added it will be opt-in and documented.

### The one place a model is used

The venue's own website is the only source a model touches, and the only place `method: 'inferred'` appears. Nothing in a liquor licence or a tax filing tells you whether there is a deep fryer, a DJ, hookah, bottle service or a rooftop — and those are exactly the questions carriers decline over.

It is also the least authoritative source, because it is **marketing copy**: a venue describes itself favourably and omits what is inconvenient. Three things follow, and they are the whole design:

1. **Silence is never a "no".** A menu that does not mention hookah is not evidence that there is no hookah. `false` is recorded only when the page states an absence ("no BYOB", "21+ only"). Turning an omission into `false` would put a confident wrong answer in front of an underwriter on precisely the questions that get a risk declined.
2. **A value without a verbatim quote is discarded.** The model must return the sentence supporting each field, and that sentence is checked against the page text before the field is kept. A model that invents a rooftop bar must also invent a quote that isn't there — which is checkable, so it gets checked. On a live run this fired and dropped an `adult_entertainment` claim that had no quote behind it.
3. **It can never outrank a record.** `inferred` is the weakest method, so precedence guarantees a government record or an official API wins wherever they overlap.

The quote survives into the field's notes, so a broker reads *why*:

```
Entertainment
    Live music                     yes         inferred from venue's own site · 60%
      "live reggae, ska, latin and worldbeat music, as well as rock, hip hop, alternative"

Security controls
    21+ venue                      yes         inferred from venue's own site · 60%
      "*ALL FLAMINGO CANTINA EVENTS ARE 21+ *"
```

Model calls go through the same content-addressed cache as every HTTP fetch, so a repeated run replays byte-for-byte instead of being re-sampled and re-billed — 8.5s cold, 4ms warm. That is what makes an eval run reproducible rather than a fresh roll of the dice each time.

It runs on any OpenAI-compatible endpoint and defaults to a free model, so it costs nothing. With no `LLM_API_KEY` set it simply contributes no fields.

### Why the OSM enricher usually returns nothing

Geocoding a licence address lands you on a building, and a building is not a venue. The address of one venue tested during development has **31 named OpenStreetMap features within 80 metres, 14 of them bars.** Attaching any of their opening hours to the licensed venue would produce a field that is plausible, precisely sourced, linked to a real OSM node — and wrong. That is the worst failure this system can produce, because nothing downstream would flag it.

So tags are only ever attributed to a feature whose **name** matches the licensed trade name, and the name has to qualify on its own — a "this is a bar" signal corroborates that we found a venue, never *which* venue. When nothing matches, the enricher emits the geocode (an address is safe) and no attributes at all.

The result is that it frequently contributes zero fields. That is the design holding, not the design failing. [Tested against the real block.](test/osm.test.ts)

### Publishing and real venues

The golden set commits real venues with real record-derived values, because evals nobody can reproduce aren't evals. Published material — this README, screenshots, the demo — uses a pseudonymised venue. Personal names are redacted everywhere.

## Status

- [x] **Phase 1 — the spine, complete.** Schema + provenance types · resolver · TABC licence and receipts enrichers · OSM enricher · venue-website enricher (LLM) · precedence reducer · derivations · orchestration port with **both** local and Temporal runners against one conformance suite · content-addressed cache (HTTP *and* model calls) · OpenTelemetry + cost accounting · CLI

- [x] **Phase 2 — the judgment.** Appetite engine + cited carrier files · ranked shortlist with reasons · completeness engine + ordered question list · submission drafter · California ABC · Austin health inspections
- [ ] **Phase 3 — the proof.** Hand-labelled golden set · eval harness (coverage, precision, calibration, silent-error rate) · CI regression gate · review UI with correction capture
- [ ] **Phase 4 — compliance.** Diligent-effort affidavits · per-state surplus-lines tax

## Development

```bash
pnpm check          # typecheck + layering + all 175 tests
pnpm test:fast      # skips the Temporal suite (which starts a real server, ~16s)
pnpm lint:layers    # enforces the core-is-source-agnostic rule
```

`pnpm test` includes the Temporal conformance suite, which downloads and runs Temporal's local dev server on first use. No Docker required.

Adding a source: [docs/ADDING-A-SOURCE.md](docs/ADDING-A-SOURCE.md). Adding a state: [docs/ADDING-A-STATE.md](docs/ADDING-A-STATE.md).

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
