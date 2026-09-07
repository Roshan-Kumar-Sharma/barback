# Adding a state

Two states done properly beats fifty done shallowly. This is the guide instead of the fifty.

## What a state needs

A state is viable for Barback when it publishes, as machine-readable open data:

1. **A liquor licence register** with venue name, address, licence type, status and issue date. This is non-negotiable: it's the resolver's candidate list and the profile's spine.
2. Ideally, **something beyond the register** — Texas publishes monthly mixed-beverage tax receipts, which is what makes the Texas build unusually strong.

## Steps

1. **Add the state code** to `StateCode` in [`src/core/venue.ts`](../src/core/venue.ts). The compiler will now point at every switch you need to extend.
2. **Write the resolver.** Mirror [`src/resolver/tx.ts`](../src/resolver/tx.ts). Start from the licence register, not a map provider — a venue in this class must hold a licence, so the register is authoritative, whereas a map search will happily return a food truck or a name collision three cities away. Return ranked candidates; never a bare venue.
3. **Map the licence codes.** Mirror [`codes.ts`](../src/enrichers/tabc/codes.ts). Take every meaning from the regulator's own published list and cite the URL — do not infer them from column names or memory. Mark which types are on-premise retail; everything else is out of class.
4. **Write the enrichers.** See [ADDING-A-SOURCE.md](ADDING-A-SOURCE.md).
5. **Register** in `enrichersFor()` and `derivationsFor()` in [`src/enrichers/index.ts`](../src/enrichers/index.ts).
6. **Document what the state does NOT publish** in [DATA-SOURCES.md](DATA-SOURCES.md). This is as important as documenting what it does: a field that is structurally unavailable in a state needs to reach the broker as a question, not as an unexplained blank.

## Before you claim a state works

- The resolver handles a chain venue with many locations (ambiguous, not a wrong pick)
- A short generic query cannot auto-resolve
- Licence type codes are cited to the regulator's own documentation
- Personal names in licensee records are flagged `sensitive`
- Rate limits are set below every publisher's documented ceiling
