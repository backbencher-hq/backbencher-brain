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

### 3. The landed lines checked against source (not against the index) — the 2026-09-14 baseline

At filing: 7,187 consistent / **330 inconsistent** of 7,517. The 330 were a real analyzer defect, not a
store one: scala recorded the enclosing expression's **start** line instead of the call node's line in
multi-line chains — e.g. `scalafix/rules/.../v3_0_0.scala:193` claims `dropRight` at line 193, but line
193 is `val toRemove = outerTokens`. Handed to #825, and it matters because scala is the pattern the
other 20 languages would otherwise copy.

### 3b. The scala reference implementation, corrected and completed (2026-09-15, #825)

Scala was the only language emitting a line, and it was wrong in **four** places, all one defect: the
line belonged to the enclosing construct instead of to the name. Each was found by the oracle against
source, fixed, and pinned.

**Coverage** — same instrument, same 300-file scala3 sample before and after
(`bun script/m59/oracle-callsite.ts --files-per-lang=300 --only=scala`), so this half IS an A/B:

| | before this round | after |
|---|---:|---:|
| relationships carrying a line | 2,949 of 9,320 (~32%) | **9,319 of 9,319 (100%)** |
| landed lines failing the source check | 20 of 2,949 (0.68%) | **0 of 9,010 checked** |
| not checkable (synthesised names) | counted as failures | 309, reported separately |

**Accuracy** — the 4.4% figure #825 was filed with (330 of 7,517 landed lines) came from the
store-landing run on cats-effect (404 files), a **different sample** to the one above, so it is not a
clean before/after ratio. What it measures is the same defect, and the answer on the current sample is
zero failures out of 9,010 checked — the 20 that survived the call-site fix are among the 102 below.

| # | mechanism | evidence on real source | fix |
|---|---|---|---|
| 1 | a `call_expression` starts at its **receiver**, so every call in a multi-line chain took the chain's opening line | cats-effect `Example.scala`: `.as(ExitCode(2))` written on 23 reported on 22 | line from the **callee leaf** |
| 2 | a **type request** took the enclosing type expression's line | `type Shape[T] = Shape.Cases[(\n …Cons…]` put Cons/Lst/Unit on the `type` line | `collectTypeNames` returns `{name, line}` pairs |
| 3 | an **inheritance list** took the line the `extends` clause opened on | `trait IterableLike[+A]\n extends FromIterable\n with IterableOps[A] …` put all three on 106 | `extractSupertypes` returns `{name, line}` pairs |
| 4 | a definition with a **leading annotation** took the annotation's line (tree-sitter-scala starts the definition node at its annotation — measured, not assumed) | `@tailrec\n def loop` gave the symbol line 4 for a `def` on 5 | `declarationLineNode()` — start after the annotations |

Mechanism 4 is a **contract decision**, not a bug fix: an annotation is a modifier, so the declaration
line is where the declaration is written. The symbol range and the `contains` edge move together so
they cannot disagree. java/kotlin/groovy have no annotation-aware start line either, so this is the
shape they will inherit — which is why it was settled here first, before three analyzers copied it.

### 3c. Two oracle defects found while measuring (the instrument, not the analyzers)

Both would have hidden real defects, so both are fixed in `script/m59/oracle-callsite.ts` and pinned by
a boundary self-test that runs on every invocation (the run exits non-zero if it cannot fail):

1. The Tier A boundary excluded `$` on both sides, so a `$`-introduced name was **unmatchable**. Scala's
   string interpolation is everywhere: `s"… got $v"` reported the use of `v` as inconsistent (19 false
   accusations on a 60-file sample; also php `$var`, js `$el`). Fixed, with the remaining weakening
   (token `b` now matches inside `a$b`) recorded as an accepted limitation rather than asserted away.
2. **Of the 102 claims the first pass flagged on the 60-file sample, 89 were not analyzer defects at all**
   — 70 named synthesised nodes (`constructor` ×40, `anonymous_*`, `given_N`) that are never written in
   source, so no line could ever satisfy them, and 19 were the `$` false accusations above. The
   synthesised names are now a **third state** (`notCheckable`), never a pass and never a failure — the
   same tier discipline the oracle's own header demands. The 13 that were real were mechanisms 2 and 3
   of §3b, plus 4 annotation cases. Had the oracle been trusted as-is, it would have reported ~8× its
   true failure rate and sent the fix chasing its own instrument.

### 3d. Adjacent finding, filed not fixed: `.gradle` files have no analyzer

516 `*.gradle` files exist in the corpus and **zero** can be analyzed: `src/ast/language-detection.ts`
maps `groovy` and `gsp` but not `gradle`, so `ASTEngine.parseFile` throws `Unsupported file type` for
every `build.gradle`. That is what caps the oracle's groovy row at 20 files where other languages get
40. Out of scope for #825 (path detection, not line attribution) but it is the single most common
Groovy file in the world and the whole sample silently depended on it.

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
| #825 analyzer lane emission | **partly done** — scala is now the *correct and complete* reference (0 of 9,010 landed lines fail the source check; 100% of its 9,319 relationships carry one; 4 mechanisms fixed, each fixture- and mutant-pinned). Still open: java/kotlin/groovy/xml emit **0 lines across 86,257 relationships** (21-language sweep, 820 files) |
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
