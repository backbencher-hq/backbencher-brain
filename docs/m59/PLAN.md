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

Scala was the only language emitting a line, and it was wrong in **five** places, all one defect: the
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
| 4 | a definition with a **leading annotation** took the annotation's line (tree-sitter-scala starts the definition node at its annotation — measured, not assumed) | `@tailrec\n def loop` gave the symbol line 4 for a `def` on 5 | `declarationLineNode()` — start after the annotations and after any trailing **comment** between them (`@Param(…)\n // why\n var size` selected the comment node) |
| 5 | an **import** whose target is named by a RENAMED selector written below the `import` line took the statement's first line | cats-effect `TestInstances.scala`: `import cats.effect.kernel.testkit.{` opens on 21, the segment that names the edge's target is on 29 | `handleImport` records the line of the module's LAST segment |

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

**Filed as #850**, with the consequence that mattered most: at 6 files per lane the walk picked six
`.gradle` files first and the oracle's groovy row was **empty** — a whole language lane silently
unmeasured. The oracle now excludes extensions the product cannot parse **explicitly**, printing and
recording the count (`excluded N file(s) ... not in the product's language registry (#850)`) instead of
sampling files that cannot produce evidence.

### 3f. kotlin and groovy: the line contract reaches the last two JVM analyzers (2026-09-15, #825)

Both started where java did: **0 lines on every relationship** (kotlin 0 of 12,274 on a 60-file sample,
groovy 0 of 761 on 40 files). Both now carry a line on **every** relationship, from the node that NAMES
it, and both inherit scala's contract rather than inventing a dialect:

| language | before | after | what was missing |
|---|---|---|---|
| kotlin | 0 / 12,274 | **12,274 / 12,274** | calls (incl. `leading_dot_call`-shaped chains), instantiates, references (declared/return/import/object literal/callable/as/check), `uses`, `contains`, `overrides`, `extends`/`implements` |
| groovy | 0 / 761 | **761 / 761** | calls (`method_invocation`, `juxt_call`, `leading_dot_call`, ctor delegation), instantiates, declared-type refs, `uses` (field and array reads), `contains`, `overrides`, heritage, imports |

**kotlin's heritage exception, measured.** A kotlin supertype list wraps — the class header names only
the FIRST entry. kotlinx-coroutines `TestScope.kt` is the shape: `internal class TestScopeImpl(context:
CoroutineContext) :` (183) / `AbstractCoroutine<Unit>(context, …), TestScope {` (184). The parents now
take their own line from the `user_type` node inside each `delegation_specifier`; a header-line
implementation would open the class keyword for every wrapped parent. Verified on that real file
(`.as`-style source check: 5 heritage edges, 5 consistent, 0 failed) and pinned by
`kotlin/heritage-lines-825`, with two mutants (`kotlin/heritage-lines-dropped` = the exact pre-fix state,
`kotlin/heritage-class-header-line` = the wrap-blind naive port).

**groovy's symbol ranges carried the java defect.** The pinned grammar puts `modifiers` first, so
`@Deprecated\nclass Wrapped` started at 18 — every symbol line, and every `contains` edge naming it, sat
on the annotation. groovy now uses the same `declarationLineNode()` + `symbolRange()` pair as java
(`[modifiers@18, identifier@19, class_body@19]` → 19), so the member at 23 and its method at 26 are
named on their own lines, and the overriding declaration — not its `@Override` — carries the
`overrides` edge. Pinned by `groovy/lines-825` (11 pins, 7 forbid entries) with three mutants:
`groovy/lines-dropped` (the exact pre-fix state), `groovy/annotation-start-line`,
`groovy/chain-opening-line` (the scala mechanism re-checked on groovy's shape: `.configure(m)` written
on 30 must not be stamped with the chain-opening 29).

**Two shapes were found while probing and deliberately NOT pinned as expected** — both filed:

- **#851** — a newline-continued PROPERTY read (`this\n  .label`) is shaped as `leading_dot_call` and
the analyzer emits a **`calls` edge to the property**, losing the read. The line fixture avoids the
shape so its pins stay honest; the defect needs the oracle's `deriveGroovyEdges` to learn the same
rule (it has no `leading_dot_call` handling at all) before it can be fixed with the usual apparatus.
- **#852** — the same shape written dotted AND continued on the next line (`helper.build(2)` then
`.configure(3)`) turns the whole expression into a `juxt_function_call` and emits **both** a dotted
`calls` target (`f -> helper.build`, where the family contract is the bare leaf, and the same method is
already `-> build` from the line above) **and** a spurious `uses f -> build` — `collectFieldAccessUses`
has no callee-position guard, so the dotted callee leaks as a member READ. Edge-set change, same
apparatus required, so filed rather than half-fixed.

Both languages' corpus lanes were re-run at this HEAD and are unchanged (kotlin 8/300 = 2.7%, groovy
29/400 = 7.2% parse-error files), so none of this touched parsing.

Full evidence at this HEAD — the oracle sweep at **880 files** (40 per language over 22 lanes, 89,196
relationships): **11,799 consistent, 0 inconsistent, 227 not-checkable**, of which the JVM family is
java **1,920/1,920** · kotlin **6,787/6,787** · scala **1,989/1,989** · groovy **761/761** — every
relationship the four analyzers emit now carries a line, and every claim survives the source check.
(The other 17 languages account for the remaining 77,170 relationships, none of which carry a line:
that is #825's remaining scope, not a JVM-family gap.) Plus xml **569/569**. Fixtures **429/429** across
22 lanes ·
mutants **565/565 caught, 0 survived** · `tsc` clean.

### 3g. xml: the second emitter, checked and pinned at last (2026-09-15, #825)

xml was the only analyzer besides scala that ALREADY emitted a line — and it was invisible to the
milestone's own oracle, because `LANGUAGES` in `script/m59/oracle-callsite.ts` lists the 21 onboarded
language lanes and xml is not one of them. Measured before it was added: **27 of 27 xml relationships
carried a line and nothing had ever checked one against source**.

Added to the oracle, 40 files, 569 relationships, and it produced **7 inconsistent claims** — every one
the same shape:

```
contains project -> default   claimedLine 2   sourceLine: <project xmlns="http://maven.apache.org/POM/4.0.0"
```

The target `default` is a **synthesised element name**: the DEFAULT namespace has no written prefix, so
for `xmlns="…"` the analyzer names the namespace `default`, which appears nowhere in the source. Tier A
could neither pass nor fail it, so it was being counted as a failure — the same tier-conflation the
oracle's header forbids (kotlin's `component1` had already been moved to `notCheckable` for exactly
this reason). The fix is NOT an allowlist entry for the string `default` (that would let a real,
wrongly-lined `default` claim hide behind it): the analyzer's namespace edge now carries
`attributeName` — the name AS WRITTEN (`xmlns`, `xmlns:sec`) — and the oracle checks **that** token when
the edge's metadata says `role: "xml_namespace"`. Narrowed by a metadata marker, never by a name.

After: xml **569 of 569 consistent, 0 inconsistent, 0 not-checkable**, with four new boundary
self-tests asserting both directions (the synthesised name must still fail, the attribute name must
match, `xmlns:pfx` must match, and a wrong line must still fail).

**xml had no fixture lane at all** — no `validation/m14/fixtures/xml/` directory, no entry in
`run-fixtures.ts`, so nothing could have caught a regression in the one emitter that already worked.
The lane and `xml/lines-825` now exist (22 lanes, 429 fixtures), pinning every element line, every
attribute line (an attribute takes the line it is WRITTEN on, never the enclosing element's — the start
tag in the fixture is split across four lines precisely to make that falsifiable), the synthesised
default-namespace edge and a prefixed one, with `xml/lines-dropped` as its mutant.

### 3e. java's call-site lines, and the last stored `0` (2026-09-15, #821 + #825)

**The java half of #825 — complete.** java emitted a line on **none** of its 1,920 relationships on the
40-file sample. Every class now takes its line from the node that NAMES it:

| class | node the line comes from |
|---|---|
| `calls` (in a method, and in initializers/field initialisers) | the `method_invocation`'s `name` field — java starts the node at its RECEIVER, so `base\n .trim()\n .toUpperCase()` was three calls on one line |
| `instantiates` | the type node that names the constructed type |
| `references` (declared types) | the type node that carries the name — `collectJavaTypeNames` now returns `{name, line}`, as scala's does |
| `extends` / `implements` / `permits` | the parent's OWN line; a long heritage list names one parent per line |
| `overrides` | the OVERRIDING declaration's line, captured from the node when the task is created |
| `contains` | the member's own declaration line, from the symbol, so the edge and the symbol cannot disagree |
| `uses` (field reads, array reads, bare reads) | the name node (`field`, the array expression, the identifier) — never the field_access, which starts at its receiver |
| annotation-derived edges (mapped table/column, `@Value` key, `@FeignClient` service, route) | the ANNOTATION that contains the name — the declaration's line would fail the source check this milestone exists for |
| imports | the module node |

Measured after: **1,920 of 1,920 java relationships carry a line, 0 inconsistent** — java is at parity
with scala, on a real 40-file sample, with the whole class list covered rather than the two the tools
layer asked for first.

**The annotation contract, applied to java (measured, not assumed).** java's declarations start at their
`modifiers` (which is where tree-sitter-java nests annotations), so a symbol line could land on
`@SuppressWarnings`. On a 300-file real java sample **25 of 93 symbols (27%)** did. After the contract:
**1 of 4,024**. The symbol range and its `contains`/`overrides` lines move together, exactly as in scala,
so a symbol and the edges that name it can never disagree. This is a **contract decision** — an
annotation is a modifier, it is not where the declaration is written — taken once for the family in
scala and applied to java's node shape so kotlin and groovy inherit one rule, not two.

**#821, closed and proven on a real index.** 62 rows still stored `line_number = 0` on cats-effect
(markdown 35, yaml 12, scala 15). Three writers produced them, all the same mistake — writing `0` for
"unknown", a number every downstream reader believes:

| site | was | now |
|---|---|---|
| `parallel-indexer.ts` buffered universal `contains` (owner→member) | literal `0` | the member's own declaration line (`symbolStartLine`), the same contract the scala `contains` edges use |
| `cross-language-intelligence-persister.ts` relationship insert | `relationship.source.range?.startLine \|\| 0` | the range's line when positive, else `NULL` |
| same file, synthesised cross-service data flows | literal `0` | `NULL` — a synthesised flow has no source line |

On the real index: **62 → 0** rows storing 0, `line_number > 0` 26,779 → **26,868**. The store probe now
**fails the run** if any row stores `0`, so the class cannot return silently.

**Two instrument defects in the store probe**, the same pair the oracle had (§3c), plus two of its own:

1. The Tier A boundary excluded `$` on both sides, so `s"$to.interruptibleMany"`, `s"$word, $name"`,
   `${Bracket…}($a)($b)` were reported as failures when the name is written right there. With the
   synthesised-name state this took the probe's own verdict on the cats-effect index from **535
   inconsistent to 1** — 534 of its 535 "analyzer failures" were the instrument.
2. It fell back to the **source** symbol's name when the target was internal, checking the wrong claim
   entirely (now the target symbol is joined in); and it read index stats from fields that do not exist
   (`stats.totalSymbols` on a `ParallelIndexingStats`), so every run printed `symbols=undefined`.

The last real defect it found, now fixed and pinned: an import edge whose target is named by a RENAMED
selector written below the `import` line (`cats.effect.kernel.testkit.{ … TestInstances => … }`,
cats-effect `TestInstances.scala`: the module opens on 21, the segment that names the target is on 29).
`handleImport` now records the line of the module's LAST segment and the edge uses it.

**End-to-end on cats-effect (404 files, real worker pool, real DB, throwaway data dir):**
28,340 relationships, **27,056 carrying a line** (scala 26,564 · java 214 · markdown 35 · yaml 12),
0 storing 0, 1,284 `NULL`; checked against source: **25,960 consistent, 0 inconsistent**, 865 not
checkable (synthesised names).

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
| #821 remaining hardcoded `0` | **closed** — the buffered `contains` insert and both cross-language persister sites write the analyzer's line or `NULL`; measured 62 → **0** rows storing 0 on a real index, and the store probe fails the run if one reappears |
| #822 call-site multiplicity | **open** — row id at `:2547` has no line; analyzers also dedupe per `(source,target,type)` |
| #823 stop fabricating in the tool | **open** — needs `number \| null` end-to-end and coordinates with the LSP/hub lane |
| #824 delete false certification | **open** |
| #825 analyzer lane emission | **JVM family done, others open** — at the 840-file oracle sweep, scala **1,989/1,989** · java **1,920/1,920** · kotlin **6,787/6,787** · groovy **761/761** carry a line on **every** relationship, **0 inconsistent** (groovy also 2,864/2,864 at a 150-file sample). Every mechanism is fixture- and mutant-pinned (scala 5 mutants, java 3, kotlin 2, groovy 3). Still open: the other 17 languages emit **0 lines across 77,170 relationships**. xml is now closed too — added to the oracle (569/569 consistent, 0 inconsistent at 40 files) and given the fixture lane it never had (`xml/lines-825`, 22 lanes / 429 fixtures) |
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
