# M59: Call-Site Truth — no relationship without a real line

> GitHub milestone [#59](https://github.com/backbencher-hq/backbencher-brain/milestone/59) (not `M58` — that slot is
> the analyzer-lane review reservation at milestone #58, and reusing the name would collide the moment its
> docs land).
> Issues: #819 (A1), #820 (A2), #821 (A3), #822 (A4), #823 (A5), #824 (A6), #825 (A7), #826 (X1).

## The milestone invariant (verbatim, enforced by X1)

> **Every relationship that corresponds to a source construct carries the real 1-based line of that
> construct; where a line cannot be derived the field is NULL and every consumer says "unknown" —
> nothing ever substitutes a different line. Where a relationship has multiple call sites, each is
> enumerable.**

Every acceptance criterion below traces to that sentence.

## Why this milestone exists

`bb_graph` reports `callSite: { file, line }` for every edge. Measured on the real backbencher index
(189,499 relationships) before this milestone:

| | value |
|---|---|
| `line_number > 0` | **0** |
| `line_number = 0` | 189,499 |
| `line_number IS NULL` | 0 |
| `calls` edges with a line | **0 of 27,555** |

`src/intelligence/graph/graph-engine.ts:177` turns that 0 into a *plausible* number:

```ts
callSite: { file: row.srcFileRel || node.file, line: row.lineNumber || node.line },
```

`row.lineNumber` is falsy → the **caller symbol's declaration line** is emitted as the call site. A user
asked for call sites, received declaration lines with full confidence, checked with grep — grep was
right — and stopped trusting the tool. That is the failure this milestone removes.

## Two layers, one contract — and the order matters

| Layer | State before | Owner |
|---|---|---|
| Analyzer emits `line_number` on a relationship | only `real-scala-analyzer.ts` (7 sites) + `real-xml-analyzer.ts` (1) — **20 of 21 onboarded languages never do** | analyzer lane (#825) |
| Store writes it | `src/ast/parallel-indexer.ts:2559` passed a **literal `0`** on every insert | this milestone (#820) |

**The store came first because it is the gate on visibility:** until `:2559` stopped writing 0, no
analyzer line could reach the database, so the analyzer lane could not measure its own work. It also
explains why scala — which *does* emit lines — showed 0 lines in every index.

## What was measured, and how

### 1. The oracle (#819) — `script/m59/oracle-callsite.ts`

Expected values derived from **source**, comparing against what the analyzers actually emitted
(`ASTEngine.parseFile`, i.e. read as the thing under test, not as the oracle).

```
npx tsx script/m59/oracle-callsite.ts --files-per-lang=4
```

21 onboarded languages, 80 files (4/lang) from `$HOME/fixtures/repositories`:

```
lang         files    rels  withLine  noLine
java             4    1627         0    1627
kotlin           4      77         0      77
scala            4      66         7      59
groovy           0       0         0       0   (no .groovy/.gradle found in sample walk)
typescript       4      59         0      59
javascript       4    1144         0    1144
vue/svelte       8     251         0     251
c/cpp/rust       12    532         0     532
go/zig/csharp    12    903         0     903
dart/swift/objc  12   2527         0    2527
php/ruby/python  12   3524         0    3524
haskell          4     348         0     348
TOTAL           80   11058         7   11051     <-- 99.94% carry no line
```

Mutation self-test: a verified line shifted by +7 was **caught** (§ the predicate can fail). Tiers are
declared in the script header and never conflated — Tier A is a *necessary* condition (a pass is
"consistent", not "correct"); Tier B (exact AST call-node lines) is **not implemented** and is reported
absent rather than counted as a pass.

### 2. The store fix (#820) — `src/ast/parallel-indexer.ts:2559`

```ts
typeof rel.line_number === "number" && rel.line_number > 0 ? rel.line_number : null,
```

Verified by indexing a real corpus repo from source into a throwaway data dir
(`script/m59/verify-store-line-landing.ts`, cats-effect, 404 files, 139s):

| | before (every pre-existing index) | after |
|---|---|---|
| relationships | 189,499 | 28,327 |
| `line_number > 0` | **0** | **7,585** |
| `line_number IS NULL` | 0 | 20,680 |
| `line_number = 0` | 189,499 | 62 (all `contains` — #821) |

Lines landed: `calls` 5,628 · `instantiates` 1,273 · `extends` 630 · `implements` 54 — all scala, the
only language whose analyzer emits them today.

### 3. The landed lines checked against source (not against the index)

7,187 consistent / **330 inconsistent** of 7,517. The 330 are a real analyzer defect, not a store one:
scala records the enclosing expression's **start** line instead of the call node's line in multi-line
chains — e.g. `scalafix/rules/.../v3_0_0.scala:193` claims `dropRight` at line 193, but line 193 is
`val toRemove = outerTokens`. Handed to #825, and it matters because scala is the pattern the other 20
languages would otherwise copy.

## Why every previous gate passed while this was true

Two mechanisms, both removed by #824:

1. `script/verify-graph.ts` certifies call-site behavior with `callSite.file.length > 0` — it checks the
   **file, never the line**. Green for 189,499 wrong lines.
2. The multiplicity/line fixtures **hand-supply** what the pipeline drops:
   `script/m44/verify-usages-groups.ts:139` passes `line_number` 3, `verify-legend.ts:147` passes 1,
   `verify-hub-tree.ts:147` passes 1. The gate could never observe the defect because the test provided
   the value production never did.

## Open at filing — the milestone is NOT closed

| Issue | State |
|---|---|
| #819 oracle | delivered, mutation-proven |
| #820 store write | landed, measured on a real index |
| #821 remaining hardcoded `0` | **open** — 62 `contains` rows (buffered path + `repairInEdges` + cross-language persister) |
| #822 call-site multiplicity | **open** — row id at `:2547` has no line; analyzers also dedupe per `(source,target,type)` |
| #823 stop fabricating in the tool | **open** — needs `number \| null` end-to-end and coordinates with the LSP/hub lane |
| #824 delete false certification | **open** |
| #825 analyzer lane emission | **open** — 20 languages + the 330 wrong scala lines |
| #826 closure gate | **open** |

## Evidence

- `validation/m59/results/oracle-callsite.json` — oracle run, tiers, mutation, per-file detail
- `validation/m59/results/store-line-landing.json` — before/after on a real index + per-line source check
- `reviews/m49-callsite-line-gap.md` — the contract handoff to the analyzer lane

## Reproduce

```bash
npx tsx script/m59/oracle-callsite.ts --files-per-lang=4
npx tsx script/m59/verify-store-line-landing.ts
```
