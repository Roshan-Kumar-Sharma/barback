#!/usr/bin/env python3
"""Generate docs/demo.svg — an animated replay of a real `barback quote` run.

Every line is verbatim output of

    barback quote --name "Iron Cactus" --state TX --city Austin \
                  --redact --include-illustrative --draft

in the order the CLI printed it, with two changes and no others:
  * the venue is pseudonymised exactly as the README does, and the licence and
    permit numbers are masked (see "Publishing and real venues");
  * long lines are wrapped to fit the frame.
Only the pacing is synthetic.
"""
import html, io, os, re

FS, CW, LH = 13.5, 13.5 * 0.6, 19.0
PAD_X, PAD_TOP, PAD_BOT = 18, 44, 16
PROV_COL = 64

S = [
# 1 — invocation, the discarded-value warning, the resolved venue
("""@g$ @nbarback quote --name "Anywhere Cantina" --state TX --city Austin \\
      --redact --include-illustrative --draft

@y! web: discarded values with no verifiable quote
@y  dropped: property.outdoor_seating (quote not found in page text)

@cAnywhere Cantina
@n606 TRINITY ST, Austin, TX 78701
@nlicence MB 1001XXXXX
""", 7.0),

# 2 — profile: identity + operations
("""@hIdentity
    Trade name                     ANYWHERE CANTINA             government record · 98%
    Named insured                  [redacted — personal data]   government record · 95%
    Location address               606 TRINITY ST, Austin, TX,  government record · 97%
    Licence type                   MB                           government record · 99%
    Licence status                 Active                       government record · 99%
    Licence number                 1001XXXXX                    government record · 99%
    Permit number                  MB1XXXXX                     government record · 98%
    Class code                     722410                       derived · 70%

@hOperations
    Operating class                tavern                       derived · 60%
    Year started here              1993                         government record · 85%
    Years in operation             39                           derived from government record · 60%
    Years under current owner      32                           derived from government record · 80%
    Latest closing time            23:00                        official API · 70%
    Late night operation           yes                          derived · 75%
    Currently operating            yes                          derived from government record · 85%
    Health inspection score        82                           government record · 90%
    Health inspection history      4 record(s)                  government record · 90%
""", 10.0),

# 3 — profile: revenue, liquor, property
("""@hRevenue
    On-premise alcohol sales       $896,581                     government record · 95%
    Cover charge income            $0                           government record · 95%
    Alcohol receipts history       36 record(s)                 government record · 95%

@hLiquor profile
    Alcohol service cutoff         02:00                        derived from government record · 70%
    Late hours permit              yes                          government record · 97%
    Food & beverage certificate    yes                          government record · 97%

@hProperty
    Elevated deck or rooftop       yes                          inferred from venue's own site · 60%
    Outdoor seating                yes                          official API · 65%
""", 9.0),

# 4 — market shortlist
("""@hMarket shortlist

  @wNeeds review — Amwins Access — Bars & Restaurants (binding authority)
     @gClass "tavern" is written by this program.
     @q? Unknown: whether entertainment.adult_entertainment is yes — Adult
       @qentertainment is written by this program, but the page lists it as a
       @qdistinct class rather than part of the standard bar/restaurant
       @qappetite, so expect it to be underwritten separately.
     @ySubmission incomplete: 3 required item(s) still needed.
     @nBlocked on 1 unknown field(s); see the question list.
     @dBasis: Public program page (classes, coverages, limits and submission
     @d       requirements only). No published underwriting eligibility guide;
     @d       no hard declines are encoded because none are public.
     @dSource: https://www.amwins.com/products/bars-taverns (as of 2026-09-07)

  @wNeeds review — Example Specialty E&S (ILLUSTRATIVE)
     @gClass "tavern" is written by this program.
     @wA rooftop or deck elevated 8ft or more refers for the fall exposure. (yes)
     @q? Unknown: whether revenue.alcohol_pct is over 0.85
     @q? Unknown: whether entertainment.mosh_pits is yes
     @q? Unknown: whether entertainment.hookah_or_oxygen_inhalation is yes
     @q? Unknown: whether entertainment.dj_with_dancing is yes
     @ySubmission incomplete: 4 required item(s) still needed.
     @dBasis: ILLUSTRATIVE — demonstrates the rule format. Not a real appetite.

  @hNot considered:
     @dMainstreet Mutual — Restaurant BOP (ILLUSTRATIVE) — Does not write
     @dclass "tavern" (writes restaurant).
""", 12.0),

# 5 — the question list
("""@hStill to ask — 78 question(s), about 26 minutes
  @dRanked for: Amwins Access — Bars & Restaurants (binding authority), Late
  @dNight Hospitality Program (ILLUSTRATIVE), Example Specialty E&S (ILLUSTRATIVE)

   @c1. Can you provide loss runs for the last five years?
      @dLosses (5 years) · ~180s
      @a→ Amwins Access — Bars & Restaurants will not review the submission
        @awithout it: Five years of currently valued loss runs are required
        @awith every submission.

   @c2. What liquor liability limits are required?
      @dLiquor limits · ~25s
      @a→ Amwins Access — Bars & Restaurants will not review the submission
        @awithout it: A liquor liability application is required where liquor
        @aliability is requested.

   @c3. What share of sales is alcohol?
      @dAlcohol % of sales · ~20s
      @a→ Example Specialty E&S declines on this. Unknown, so eligibility
        @acannot be confirmed: Alcohol above 85% of sales exceeds the
        @aprogram's concentration limit.

  @d…and 74 more. Use --questions <n> to see them.
""", 12.0),

# 6 — the completeness summary
("""@hIntake       25/103 fields filled without a human
             ~9 of ~35 minutes of questions answered (estimate; per-question
             times are declared in the field registry)
             0 conflict(s) · 0 low-confidence · 58 that no public source can
             ever fill
             0 missing field(s) no target carrier asked about
""", 7.0),

# 7 — the draft: header and identity
("""@d────────────────────────────────────────────────────────────────────────
@hDraft submission — Amwins Access — Bars & Restaurants (binding authority)
@d────────────────────────────────────────────────────────────────────────
  @wThis is a DRAFT. Nothing has been sent. A licensed producer must
      verify every field before it goes to a carrier.
  @w3 required submission item(s) are missing. Underwriters routinely
      ignore incomplete submissions.

  @cTo:      @d[underwriter email — not populated; Barback never sends]
  @cSubject: @nSubmission — ANYWHERE CANTINA, Austin TX — tavern

  @nPlease consider the following tavern risk for Amwins Access — Bars &
  Restaurants (binding authority).

  ANYWHERE CANTINA
  606 TRINITY ST, Austin, TX 78701

  @hIdentity
    @nTrade name: ANYWHERE CANTINA
    Named insured: [redacted — personal data]
    Location address: 606 TRINITY ST, Austin, TX, 78701
    Licence type: MB
    Licence status: Active
    Licence number: 1001XXXXX
    Permit number: MB1XXXXX
    Class code: 722410
""", 10.0),

# 8 — the draft: the rest of the populated fields
("""  @hOperations
    @nOperating class: tavern
    Year started here: 1993
    Years in operation: 39
    Years under current owner: 32
    Latest closing time: 23:00
    Late night operation: Yes
    Currently operating: Yes
    Health inspection score: 82
    Health inspection history: 4 record(s) attached separately

  @hRevenue
    @nOn-premise alcohol sales: $896,581
    Cover charge income: $0
    Alcohol receipts history: 36 record(s) attached separately

  @hLiquor profile
    @nAlcohol service cutoff: 02:00
    Late hours permit: Yes
    Food & beverage certificate: Yes

  @hProperty
    @nElevated deck or rooftop: Yes
    Outdoor seating: Yes
""", 9.0),

# 9 — the draft: what it admits it does not have
("""  @hStill being confirmed with the insured:
    @nLosses (5 years)
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
    @d…and 66 further items

  @dData provenance: figures above are drawn from state licence and tax
  records, OpenStreetMap and the venue's own website. Every field carries a
  source and a record date, available on request.

  [Producer name] · [licence number] · [contact]

  @h25 field(s) populated · 78 still outstanding
""", 10.0),

# 10 — accounting and the standing warnings
("""@hSources
  @g✓ tabc_license     12 field(s) in 4ms
  ✓ tabc_receipts     7 field(s) in 4ms
  ✓ osm               2 field(s) in 6ms
  ✓ health_austin     2 field(s) in 5ms
  ✓ web               1 field(s) in 7ms · 7,445 tokens

@hRun           0.0s · $0.0000 · 7,445 tokens · local

@wCarriers marked ILLUSTRATIVE are demonstrations of the rule format, not
@w   real appetite. Never place business on them. See carriers/illustrative/.

@dNot insurance advice. Barback does not rate, quote or bind coverage. Every
@dfield must be verified by a licensed producer before it reaches an
@dunderwriter.
""", 9.0),
]

C = {'n':'#c9d1d9','d':'#6e7681','h':'#79c0ff','g':'#7ee787','w':'#e3b341',
     'y':'#d29922','c':'#e6edf3','q':'#8b949e','a':'#a5a5f5'}

def esc(t): return html.escape(t, quote=False)
def plain(ln): return re.sub(r'@[ndhgwycqa]', '', ln)

def spans(line):
    cls, cur = 'n', line
    while True:
        s2 = cur.lstrip(' '); lead = len(cur) - len(s2)
        if len(s2) >= 2 and s2[0] == '@' and s2[1] in C:
            cls = s2[1]; cur = ' ' * lead + s2[2:]; continue
        break
    parts, buf, i = [], '', 0
    while i < len(cur):
        if cur[i] == '@' and i + 1 < len(cur) and cur[i+1] in C:
            parts.append((buf, cls)); cls = cur[i+1]; buf = ''; i += 2; continue
        buf += cur[i]; i += 1
    parts.append((buf, cls))
    out, col = [], 0
    for txt, k in parts:
        if not txt: continue
        if k == 'n' and col == 0 and len(txt) > PROV_COL and txt.startswith('    '):
            out.append((col, txt[:PROV_COL], 'n'))
            out.append((col + PROV_COL, txt[PROV_COL:], 'd'))
        else:
            out.append((col, txt, k))
        col += len(txt)
    return ''.join('<tspan x="%.1f" class="%s">%s</tspan>' % (PAD_X + c * CW, k, esc(t))
                   for c, t, k in out if t.strip())

lines = [s.strip('\n').split('\n') for s, _ in S]
durs  = [d for _, d in S]
TOTAL = sum(durs)
COLS  = max(len(plain(l)) for ls in lines for l in ls) + 2
ROWS  = max(len(ls) for ls in lines)
W, H  = int(PAD_X * 2 + COLS * CW), int(PAD_TOP + ROWS * LH + PAD_BOT)

css = ['.%s{fill:%s}' % (k, v) for k, v in C.items()]
css.append('text{font-family:"SF Mono",SFMono-Regular,Menlo,Consolas,'
           '"DejaVu Sans Mono",monospace;font-size:%.1fpx;white-space:pre}' % FS)
css.append('.scene{opacity:0}')
body, t0 = [], 0.0
for i, (ls, d) in enumerate(zip(lines, durs)):
    a, b = t0 / TOTAL * 100, (t0 + d) / TOTAL * 100
    f    = 0.45 / TOTAL * 100
    css.append('@keyframes s%d{0%%,%.3f%%{opacity:0}%.3f%%,%.3f%%{opacity:1}%.3f%%,100%%{opacity:0}}'
               % (i, max(0.001, a - f), a + f * 0.01, max(a + f, b - f), b))
    css.append('.s%d{animation:s%d %.2fs steps(1,end) infinite;animation-timing-function:ease}'
               % (i, i, TOTAL))
    body.append('<g class="scene s%d">%s</g>' % (i, ''.join(
        '<text y="%.1f">%s</text>' % (PAD_TOP + (j + 1) * LH, spans(l))
        for j, l in enumerate(ls) if l.strip())))
    t0 += d

svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" '
       'role="img" aria-label="Animated replay of a real barback quote run">'
       '<title>barback quote — replay of a real run</title>'
       '<style>%s</style>'
       '<rect width="%d" height="%d" rx="10" fill="#0d1117"/>'
       '<rect width="%d" height="30" rx="10" fill="#161b22"/>'
       '<rect y="20" width="%d" height="10" fill="#161b22"/>'
       '<circle cx="19" cy="15" r="5" fill="#ff5f56"/>'
       '<circle cx="37" cy="15" r="5" fill="#ffbd2e"/>'
       '<circle cx="55" cy="15" r="5" fill="#27c93f"/>'
       '<text x="%.1f" y="19.5" text-anchor="middle" class="d" style="font-size:11.5px">'
       'barback — quote</text>%s</svg>'
       % (W, H, W, H, ''.join(css), W, H, W, W, W / 2, ''.join(body)))

os.makedirs('docs', exist_ok=True)
io.open('docs/demo.svg', 'w', encoding='utf-8').write(svg)
print('docs/demo.svg  %d bytes  %dx%d  %d scenes  %.0fs loop  (%d cols x %d rows)'
      % (len(svg), W, H, len(S), TOTAL, COLS, ROWS))
