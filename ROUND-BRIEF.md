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
