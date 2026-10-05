# The highest-value work available: fix B, then A, then C

## Start here

```bash
npx tsx script/m14/diagnose-incoming.mts <yourlang> <ext> 80 $HOME/fixtures/repositories
```

That prints YOUR lane's split. "Ambiguous and unresolved are high" is not actionable —
it is three different defects that look identical, and their costs differ by two orders of
magnitude.

## B — FORMAT MISMATCH. Do this first. It is nearly free.

**The symptom:** a large `unresolved` count, most targets containing a `.`, and almost all
of them having their FINAL SEGMENT as a published name.

**The cause:** the edge target and the published symbol name are built by different code
and spell the same symbol differently.

**graphql, measured:** 6,451 unresolved targets, 99% dotted, and **100% of those had their
final segment published**. So **8,637 edges** (contains 6,531, overrides 1,941, uses 165)
were resolvable the whole time and failed only on a string convention.

The concrete bug in graphql, for reference:

```ts
const ownerSymbol = `${owner.name}.${fieldName}`      // qualified
symbols.push({ name: fieldName, ... })               // published BARE  <-- mismatch
addRelationship(owner.name, ownerSymbol /* qualified */, Contains, ...)
```

**Verified fix:** publish the same string you target. Publishing `ownerSymbol` took
graphql from 6,451 unresolved to 1,608 — **a 75% reduction**, `tsc` clean.

**It was then reverted** because it broke 3 of graphql's 4 fixtures: they encode the
bare-name contract (`expectSymbols: ["field"]` vs published `Doc.field`). That is a naming
CONTRACT decision and it is yours. Two ways, both legitimate:

1. **Target the bare name** — publish `field`, emit `contains` → `field`. `source` already
   carries the owner, so containment survives. Smallest blast radius; fixtures keep passing.
2. **Publish the qualified name** — publish `Doc.field`. Also fixes cause A below, because
   the name becomes unique. Requires updating your fixtures and telling whoever consumes
   your name surface.

Pick one, say which and why in the commit, and re-measure. **If your lane's fixtures fail,
that is information about your contract, not an obstacle to route around.**

## A — NAME IS NOT AN IDENTIFIER. The real work.

**The symptom:** `ambiguous` is high, and nearly every ambiguous target has NO distinct
`qualifiedName`.

**Measured:** sql 118/118 (100%), python 61/61, graphql 67/67, lua 266/300 (89%).

**The cause:** the published name carries no file or owner identity, so N files declaring
`version` collapse into one node and every edge to it is ambiguous. Distribution is mostly
2-way — it is not deep shadowing, it is simply "two unrelated files both define `version`".

graphql's worst: 22 files declare `Query`, 15 declare `f`, 10 declare `name`.

**Fix:** publish an identifier that includes the owner or module — the qualified path, or
`file::name`. This is per-language design work and it is why this column moves slowly. It
is also the only thing that makes an edge mean one specific thing.

## C — EXTERNAL. Bookkeeping, but it stops the number lying.

`os:*`, `re:*`, `getcwd`, `join`, `sqlite_master`, `pg_trigger_depth` — stdlib, BCL and
database catalogs. Legitimately outside the corpus, but emitted indistinguishably from a
local reference, so they inflate `unresolved` and make the column unreadable.

Emit them with an explicit external marker so they are countable and excluded, instead of
silently unresolved.

## What to report

Per cause, before and after, from the same command and the same file count:

```
B: unresolved before N -> after M      (edges recovered)
A: ambiguous  before N -> after M      (names that became unique)
C: targets now marked external         (previously counted as failures)
```

If a number does not move, say so. A rule whose overturn condition you cannot meet is
decorative rather than falsifiable, and two of this programme's lanes shipped exactly that.

## The bar

Outgoing coverage is close to finished and is the shallow half. **A lane emitting all ten
types while 46,944 of its edges resolve to nothing is worse than a lane emitting five that
all resolve** — it looks finished and is not usable for refactoring, navigation or impact
analysis. Optimise resolution, not counts.