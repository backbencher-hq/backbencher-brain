# Round N+1 brief — the ruling table is now the critical path

## What changed underneath you

A 26-lane production `parseFile` sweep just landed on the aggregate
(`validation/m14/measurements/firing-sweep-26-lanes.ndjson`). Read your lane's row
in it. The shape that matters:

    lane        fired ruled  appl     edges   files      corpus
    haskell        10      0    10     5,987  120/120      3,702
    fsharp          9      1    10    12,517  120/120     11,809
    toml            1      1     2     1,729  104/120      1,339

Only haskell fires all ten outright. fsharp is 10/10 APPLICABLE because 9 fired
plus 1 has a written ruling.

## The thing to understand

For the 17 lanes with no ruling table, the `appl` column is a **lower bound**. The
types your analyzer does not emit are **unadjudicated, not inapplicable**. `toml`
at `1 fired + 1 ruled = 2/10 applicable` is not a claim — it is an absence of
adjudication wearing a claim's clothes.

So the highest-value work in the programme right now is not another edge type. It
is a ruling for every type your lane does not emit.

## What to deliver

1. `script/m14/<lang>-ruled.ts` exporting `export const <LANG>_RULED`, typed
   against the same shape as `script/m14/zig-ruled.ts` / `julia-ruled.ts`. Read
   both first — they are the two the arbiter already accepts.
2. One entry per type you do NOT emit, and each must carry:
   - the **structural** reason (what the grammar does or lacks), not "we chose not to";
   - the **corpus evidence** — the node types or the counts you measured;
   - a named **overturn condition**: what a future measurement would have to show to
     reverse it.
3. Register it in `script/m14/ontology-coverage-gate.ts` `RULED_BY_LANG`, and run
   `npx tsx script/m14/ontology-coverage-gate.ts <lang>`. It must exit 0 and print
   `FALSIFIED 0`.

## Two rules the arbiter now enforces — both learned the hard way

**A ruling whose overturn condition cannot be satisfied by a correct implementation
is decorative, not falsifiable.** Julia shipped two rulings whose conditions were
unmeetable — one demanded "a count above the ExportInfo count for the same corpus"
from a path that emits one row per ExportInfo, so only a WRONG edge could satisfy
it. Check your own condition: could a correct, complete implementation meet it? If
not, it is not a falsifiability claim.

**A blocker drawn from a convention other lanes already write through is not a
blocker.** The same lane named `RelationshipType.Imports` serializing to
`"brain_import"` as a blocker — the same string every other lane writes through.
It blocked nobody. Julia later overturned that ruling and shipped the edges.

Related and live: `src/ast/types.ts` and `src/ast/engine.ts` disagree on the VALUE
of `RelationshipType.Imports` (`brain_import` vs `imports`). `engine.ts` is what
analyzers actually use. If you cite either as a blocker, cite which file you mean.

## Reporting

State per type: emitted or ruled, with the evidence for the ruling. No adjectives.
If a ruling is thin, say so and say what would make it solid — a thin ruling
labelled confident is worse than no ruling, because it moves the arbiter's verdict
without moving the evidence.

---

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

---

## PROVEN RECIPE — copy this for cause B

`graphql` is fixed and the fix is verified. It took two edges' target strings.

**The defect:** the edge target was built as `${owner.name}.${fieldName}` (qualified)
while the symbol published `name: fieldName` (bare). Same symbol, two spellings, so the
edge resolved to nothing.

**The fix — change the TARGET, not the published name:**

```ts
// before — targets a string nothing publishes
addRelationship(owner.name, ownerSymbol /* `${owner.name}.${fieldName}` */, Contains, ...)

// after — targets exactly what symbols.push({ name: fieldName }) published
addRelationship(owner.name, fieldName, Contains, ...)
```

Result on 60 files: **unresolved 6,451 → 1,016 (-84%)**, tsc clean, lane fixtures
unchanged (3/4 before and after), name surface unchanged, containment unchanged because
`source` already carries the owner.

**Why target the bare name rather than publishing the qualified one.** Publishing the
qualified path also worked (-75%) but broke 3 of the lane's 4 fixtures and changes the
name surface every downstream consumer sees. Retargeting has no blast radius. Same
defect, one-line-per-edge, no contract change.

**So for your lane:** find edges whose target string does not equal a published
`name`, and make the target equal the published name. `diagnose-incoming.mts` tells you
how many edges that is worth before you touch anything:

```
EDGES RECOVERABLE by fixing the name function: N
by edge type: {"contains":..., "overrides":..., "uses":...}
```

Do the largest type first. Re-run the same command with the same file count and report
before and after. If the number does not move, say so and say why.
