# Data sources

Every source Barback uses, what it gives, what it costs, and under what terms.

## Principles

1. **Official APIs and government open data only.** Nothing from a source with hostile terms.
2. **Attribute everything.** Each enricher declares an `attribution` block that names the publisher, links the dataset and states the licence. Those declarations are asserted in tests and compiled into [NOTICE](../NOTICE).
3. **Cache aggressively.** Public portals are run on someone else's budget. Every response is cached to disk, content-addressed, and reused.
4. **Rate-limit below the ceiling.** Where a publisher documents a limit, we go slower than it.

---

## Texas

### TABC License Information — `7hf9-qc9f`

<https://data.texas.gov/d/7hf9-qc9f> · Public record, Texas Open Data Portal · **No key required**

~124,000 licence records. The spine of a Texas profile, and the resolver's candidate list.

| Column | Underwriting use |
|---|---|
| `license_type` | Class eligibility and how alcohol-forward the venue is. `MB` mixed beverage (~32k), `BG` wine & malt on-premise (~22k), `BQ` off-premise (~30k, out of class) |
| `lh` | **Late Hours Certificate.** ~9,900 venues. A government record bearing on *"time alcohol sales cease"* |
| `fb` | **Food and Beverage Certificate.** ~12,800 MB holders. TABC's own marker of a food-primary operation |
| `primary_status` | Whether the venue is permitted to trade |
| `original_issue_date` | Years in operation — but see the caveat below |
| `current_issued_date` | Most recent issue of this licence |
| `trade_name`, `owner` | DBA and named insured. `owner` may be a natural person; treated as sensitive |
| `address`, `city`, `zip`, `county` | Location, and the input to geocoding |
| `tier` | Filters manufacturers, wholesalers and shippers out of the retail class |

**Caveat on `original_issue_date`:** this is the licence *lineage* date. Licences transfer between owners, so it is a **ceiling** on tenure under current ownership, not that figure. Barback emits it at reduced confidence with the caveat attached, and prefers the tax responsibility date where available.

Licence and permit code meanings are taken from TABC's published list:
<https://www.tabc.texas.gov/services/tabc-licenses-permits/tabc-license-permit-types/>

### Mixed Beverage Gross Receipts — `naix-2893`

<https://data.texas.gov/d/naix-2893> · Public record, Texas Open Data Portal · **No key required**

Monthly alcohol tax filings, per permit, joinable to the licence record on `tabc_permit_number` (which is `license_type` + `license_id`).

| Column | Underwriting use |
|---|---|
| `liquor_receipts`, `wine_receipts`, `beer_receipts` | On-premise alcohol sales — the numerator of alcohol % of sales, as a filed tax record rather than a recollection |
| `cover_charge_receipts` | Door income. A venue charging admission is behaving like a nightclub, and it is filed on its own line |
| `responsibility_begin_date_yyyymmdd` | When **this taxpayer** took over **this location**. Much closer to "years under current ownership" than a licence issue date |
| `obligation_end_date_yyyymmdd` | Filing recency — the strongest available evidence a venue is actually trading |

**What it does not give:** total sales. These are alcohol receipts only, which is why `revenue.alcohol_pct` cannot be completed from public data alone.

### Liquor violations — **not available**

Texas does **not** publish liquor violations or enforcement actions as open data. There is no such dataset in the Texas Open Data Portal catalogue.

TABC's Public Inquiry System does expose "licenses and permits with administrative violations" and public complaints, but it is an interactive application rather than a dataset, and `https://www.tabc.texas.gov/robots.txt` contains `Disallow: /search/`.

So under this project's guardrails the field stays `null` with a stated reason. Phase 2 evaluates two options: whether the AIMS Public Inquiry application exposes a stable endpoint whose use is within its terms, or whether an Open Records Request can seed a dated static dataset.

This is a downgrade from what the project was scoped to expect, and saying so is more useful than shipping an empty field with no explanation.

---

## Geography

### OpenStreetMap — Overpass API and Nominatim

<https://www.openstreetmap.org/copyright> · **ODbL 1.0** · No key required

Used for geocoding a licence address, locating the venue's OSM feature, and — most valuably — discovering the venue's **own website**, which is the input to the highest-signal free source.

| Tag | Field |
|---|---|
| `opening_hours` | `operations.latest_closing_time` — **observed** hours, which is a different question from the permitted cutoff, and [precedence lets observation win](../src/core/reduce/precedence.ts) |
| `outdoor_seating` | `property.outdoor_seating` |
| `live_music` | `entertainment.live_music` (presence only; OSM records no frequency, and carriers ask for it) |
| `min_age` | `security_controls.minimum_age_21`, `liquor_profile.underage_patrons_permitted` |
| `website` / `contact:website` | Not a profile field — it unblocks the venue-website enricher |

**Attribution requires a name match.** A geocoded address lands on a building; one tested address has 31 named features within 80m, 14 of them bars. Tags are attached only to a feature whose name matches the licensed trade name, and the name must qualify on its own — an amenity type corroborates that we found a venue, never which one. Where nothing matches, the geocode is emitted and no attributes are.

**`as_of` comes from the element's last-edit timestamp** (`out meta`), or `check_date`/`survey:date` where a surveyor recorded one. OSM tags can be years stale and an underwriter needs to know when someone last looked. The same response carries the editor's username, which is never read or stored.

**`opening_hours` is read conservatively.** [The parser](../src/enrichers/osm/opening-hours.ts) returns `null` for anything it does not fully recognise, including a string where only *some* rules parsed — the unreadable rule could be the late one, and understating a closing time is the dangerous direction for underwriting.

**Coverage is thin and stated honestly.** Of 60 bars and restaurants sampled in central Austin: 57 had a name, 19 a website, 11 opening hours, 3 outdoor seating, 2 live music, 2 a minimum age. Useful tags exist (`opening_hours`, `outdoor_seating`, `live_music`, `min_age`, `smoking`, `microbrewery`) but cannot be relied on.

**Usage policy.** Nominatim permits at most 1 request/second and requires an identifying User-Agent. Barback sends one and rate-limits to a 1.1-second minimum interval per host, below the documented ceiling. Set `BARBACK_USER_AGENT` to a real contact address if you run this at any volume.

### The venue's own website

The highest-signal free source for cooking equipment, events, hookah, bottle service, rooftops and age policy — none of which appear in any government record. Also the least authoritative, because it is marketing copy.

**Politeness.** Unlike the government portals, these are small businesses' own servers. `robots.txt` is obeyed (and an unreadable or failed `robots.txt` is treated as a *disallow* — guessing permissively is the one mistake here with somebody else on the receiving end). An identifying User-Agent is sent, at most four pages are read (homepage plus up to three ranked by underwriting relevance — menu, events, private hire), and everything is cached so a repeat run costs the venue nothing.

**Stale website tags.** OSM `website` values go stale; one venue's tag pointed at a deep link that now 404s. The enricher falls back to the site origin, which is derived from the tag rather than guessed.

**Extraction rules.** Everything is `method: 'inferred'` and can never outrank a record. Values are nullable throughout, and the prompt insists that an omission is not a `false`. **Every value must carry a verbatim quote from the page, verified against the fetched text before the field is kept** — this is the structural defence against hallucination, and it fires in practice.

**Model calls are cached** through the same content-addressed store as HTTP fetches (keyed on model, prompt and parameters; the API key travels in a header and is never part of the key or the stored entry). A repeated run replays instead of re-sampling: ~8.5s cold, ~4ms warm.

**Model choice.** Any OpenAI-compatible endpoint; the default is a free OpenRouter model. Reasoning models work — the JSON extractor handles a narrated preamble by taking the richest valid object rather than the first brace — but are far slower for this task (~50s vs ~3s in testing).

---

## Not used, and why

| Source | Why not |
|---|---|
| **Yelp** | Hostile terms of service for this use |
| **Google Places** | Requires a billing account. Barback runs on free sources so anyone can clone and run it |
| **Carrier appetite guides** | Almost all sit behind broker portals. Phase 2 ships a BYO appetite format plus a small seed set built only from publicly available documents, every rule citing its source |
| **ACORD forms** | Copyrighted. Fields are modelled generically as the union of what carriers ask; documents are cited by URL, never vendored |
| **Review-derived risk signals** | Inferring "this bar has fights" from reviews and publishing it under a named real business is a reputational and legal hazard. Not built, and off by design |

---

## California

### ABC daily licence export

<https://www.abc.ca.gov/licensing/licensing-reports/> · Public record, California ABC · **No key required**

A different source SHAPE from everything else here: not an API but a ~7MB zip containing a ~27MB CSV of all ~129,000 California licences, republished daily. Barback downloads it through the fetcher's bulk-file path (so caching, rate limiting and the User-Agent still apply in one place) and indexes it in memory once per process.

The export's own "Updated ..." banner line supplies `as_of`, so the record date is the publisher's, not our download time.

| Column | Underwriting use |
|---|---|
| `License Type` | Class and much else. See below |
| `Type Status`, `Lic or App` | Whether the licence is issued and active |
| `Type Orig Iss Date` | Years in operation — a ceiling, as in Texas |
| `Primary Name`, `DBA Name` | Named insured and trading name. `Primary Name` may be a natural person |
| `Prem Addr 1/2`, `Prem City`, `Prem Zip`, `Prem County` | Location |
| `Expir Date` | **Licence** expiry, not the policy X-date. Emitted at low confidence with that stated |

**The licence type does unusual work in California.** Where Texas encodes food-primary operation as a separate certificate (FB), California encodes it in the licence type itself. Meanings are taken from [ABC's published list](https://www.abc.ca.gov/licensing/license-types/):

| Type | Meaning | What it tells an underwriter |
|---|---|---|
| 41 / 47 | On-Sale Beer & Wine / General — **Eating Place** | Licence requires a bona fide eating place: food-primary |
| 42 / 48 / 61 | On-Sale — **Public Premises** | ABC's own text: *"Minors are not allowed to enter and remain"*. A 21+ bar, from a record |
| 75 | Brewpub-Restaurant | Brewpub class |
| 90 | On-Sale General — **Music Venue** | Licensed as a music entertainment facility: live performance is a licence fact |
| 20 / 21 | Off-Sale | Out of class |

**What California does not have:** any equivalent of the Texas mixed-beverage tax filings. There is no public revenue figure, no cover-charge line and no tax-responsibility date, so alcohol sales, ownership tenure and the operating-status corroboration that Texas gets for free are all unavailable. Coverage is materially thinner as a result, and the completeness engine reports the difference rather than hiding it.

---

## Health inspections

### City of Austin — Food Establishment Inspection Scores

<https://datahub.austintexas.gov/d/ecmv-9xxi> · Public record, City of Austin open data · **No key required**

A proxy for operational discipline. Not a question on any carrier application, and presented as such.

**What it does not give, and why that matters.** Health data is usually worth having for the violation TEXT — grease accumulation and hood citations bear directly on the fire questions carriers ask. Austin publishes only a numeric score with no violation detail, so that signal is absent. What remains is a score trend, which is real but weaker than the source was chosen for. Chicago (`4ijn-s7e5`) and NYC (`43nn-pn8j`) publish violation text and are both live, but neither is in an implemented state.

**Matching** carries the same misattribution risk as OpenStreetMap and is handled the same way: the street address must agree AND the name must match. A strip mall's tenants share an address, and a bad inspection score attached to the wrong venue would be a confidently-sourced lie. Street suffixes are canonicalised rather than stripped — deleting them would collapse "100 Main St" and "100 Main Ave" onto one key.

---

## Carrier appetite

Appetite files live in `carriers/`, one YAML per carrier program, every rule carrying a `source` and an `as_of`.

**Public carrier documents publish classes, limits and submission requirements. They do not publish eligibility rules.** Real appetite lives in gated broker portals and in underwriters' heads, and it changes without notice. So the seed set is deliberately small and honest:

- `carriers/amwins_access_bar_restaurant.yaml` — real, built from a public program page. Encodes classes, limits and submission requirements, and **no hard declines, because none are public**. Its `basis` field says exactly that.
- `carriers/illustrative/` — demonstration files exercising the full rule vocabulary. Excluded unless `--include-illustrative` is passed, labelled in every output that shows them, and rejected by the loader if a file in that directory forgets to declare `illustrative: true`.

Every file must declare a `basis` describing what it was actually built from. A marketing page is not an appetite guide, and the schema will not let you pretend otherwise.
