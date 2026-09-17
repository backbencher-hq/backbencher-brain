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

Scala was the only language emitting a line, and it was wrong in **six** places, all one defect: the
line belonged to the enclosing construct instead of to the name. Each was found by the oracle against
source, fixed, and pinned. (Five in this round; the sixth — mechanism 6 below — surfaced later, when the
oracle was re-run at HEAD for the G7 round and reported scala `INCONSISTENT` again. It is the same
defect with a different node shape, which is why the table is kept as one table.)

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
| 6 | an **extension method**'s receiver type took the METHOD's declaration line | scala3 `tests/warn/ext-override.scala`: `extension (\n  x: Bla\n)` names `Bla` on 11 while `def greet` starts on 13, so the claim pointed at the method signature. The single-line form is the same defect one line short: `extension (s: String)` names `String` on 3, not the method's 4 | the `uses` edge stamps the **receiver TYPE node** (`extensionReceiverTypeNode`), not the method |

Mechanism 6 is pinned by the existing `scala/extension-method-flag` fixture, extended with the multi-line
receiver case rather than given a new file — the one-line and multi-line shapes sit together so they cannot
diverge — with `forbidRelationships` naming each pre-fix stamp (line 13 for `Bla`, 4 for `String`) so a
revert fails the gate instead of passing silently, plus a revert mutant (`scala/extension-receiver-method-line`,
CAUGHT by that fixture alone).

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

**Two shapes were found while probing and deliberately NOT pinned here** — both filed and **both since
fixed and closed in M49 W20** (`reviews/m49-w20-groovy-continuation-shapes.md`):

- **#851** — a newline-continued PROPERTY read (`this\n  .label`) is shaped as `leading_dot_call` and
the analyzer emitted a **`calls` edge to the property**, losing the read. The line fixture avoids the
shape so its pins stay honest; the fix landed with the oracle's `deriveGroovyEdges` gaining the same
rule (its absence of any `leading_dot_call` branch is why the lane was green while blind — measured,
the mirror moved calls-truth 476 -> 865 on the identical groovy lane with `unexplained` 0 both times).
Pinned by `groovy/continuation-shapes-851` beside its one-line control, and by the mutant
`groovy/parenless-continuation-call`.
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

### 3h. The false certification, deleted (#824, 2026-09-15)

Two mechanisms let every gate stay green while 189,499 lines were wrong. Both are now gone, and the
replacement was proven able to fail before it was trusted.

**1. `script/verify-graph.ts` checked the FILE and never the LINE.** It certified call-site behaviour with
`callSite.file.length > 0`. The assertion now derives its expectation from the **fixture's own source**
(the M59 oracle's shape: the last line that writes `callee()` is the call, since the declaration comes
first), so a substituted caller-declaration line or a fabricated `0` cannot pass. Measured at HEAD on a
purpose-built 4-language index: `java: call site is the line the call is WRITTEN on (gammaJ at 8, betaJ
declared elsewhere)` · `scala: … (gammaS at 6, betaS declared elsewhere)`. The file assertion is kept but
relabelled as explicitly **not** a line claim. Two controls run over a **real index**, not a fixture:
control A corrupts a genuine stored line and is caught by the same predicate; control B sets the stored
line to `NULL` and refuses the tool's substituted `0` (a call written on 8 must not be reported as 0);
control C restores the real line and the predicate passes again. TypeScript still reports `0` for its
unlined edges — recorded in the run output as the #823/#825 observation, **not** certified.

**2. The multiplicity/line fixtures hand-supplied what the pipeline drops.**
`script/m44/verify-usages-groups.ts:139` passed `line_number` 3, `verify-legend.ts:147` passed 1,
`verify-hub-tree.ts:147` passed 1 — values production never produced for those languages. Deleted
(written as `NULL`, exactly what production stores where an analyzer emits no line). **All three gates
still pass unchanged** — `U1 20/20`, `U3 27/27`, `U4 25/25` — which is the proof that no law in those
batteries ever read a line, and therefore that the hand-supplied values were certifying nothing.

**Two holes in the evidence itself, found while removing the first.**

- The gates collected the failed checks' labels in memory and printed them to stdout, but persisted
  only **counts**. A `known-gap` snapshot therefore said *that* something failed and never *which law* —
  undiagnosable after the fact, since a failing run's stdout is exactly what nobody keeps. The evidence
  now carries `failures: ["<label>: <detail>", …]`.
- The wire leg emitted **2 checks when the session succeeded and 1 when it threw**, so the check *count*
  moved between runs at one commit — a 19-check snapshot was indistinguishable from a gate that never
  finished. Every wire law is now emitted on every path (clean, blocked-with-reason, or session-failed),
  so the set is invariant and a failed session fails each law **by name**.

Negative controls for both, run before the fix was trusted: a planted law failure persisted
`"R2: fixture stored set is the authored 8 rows: got 8: …"` with `exit=1`; a forced session failure
(initialize caps made unmatchable) produced **20 checks / 2 named failures** where the old code produced
19/1, with the caps error text inside the label's detail.

**One observation left unexplained, deliberately.** An early run at `36b83b89` recorded
`known-gap 19/18/1`; the next runs at the same commit recorded `20/20/0` with nothing changed on disk
between them. The mechanism is bounded (a throw inside the wire leg collapsed the check set) and its
**direction is safe** — it can only under-report, never certify — but the triggering condition was not
reproduced under deliberate full-core CPU saturation, so it is recorded as an unexplained transient
rather than attributed to a cause. The `failures` field above is what makes the next occurrence
attributable instead of another anonymous count.

**Adjacent, pre-existing, not caused by this round:** `script/m42/verify-governance.ts` and the M29 bar
inside it are at `known-gap` because their evidence is pinned to an older commit
(`validation/m42/results/H3.json` → `7777dd53`, HEAD `36b83b89`). The three M44 evidence files re-run by
this round now pin to the current HEAD instead.

### 3i. Call-site multiplicity: identity that keeps every site (#822, 2026-09-16)

`bb_graph` could only ever answer with ONE site per callee. This document had assumed the analyzers
deduped the rest away (`relationshipKeys` sets indexed by `(source,target,type)`), so the analyzers were
measured FIRST — the fix depends on which layer is losing the sites.

**Measured at the analyzer seam** (`script/m59/probe-multiplicity.ts`; controlled fixtures — one caller,
one callee, 4 calls on 4 known lines, expected count asserted against the fixture text):

| language | analyzer emits | carries lines |
|---|---|---|
| java · kotlin · scala | **4 edges, 4 distinct lines** | yes |
| typescript · javascript | 4 edges | **0 lines** at this HEAD |
| python · go | **1 edge** | 0 lines |

So for the JVM family the sites were NOT deduped by the analyzer — they were collapsed by the STORE:
`relId = ${projectId}:rel:${sourceId}:${targetName}:${relType}` has no line component, and
`INSERT OR IGNORE` kept the first row and silently dropped the rest. **This document's earlier claim that
"analyzers also dedupe per (source,target,type)" was wrong for `calls`** — it came from grepping the
`uses`/`contains` dedupe paths. Measured, not argued.

**RED, in the database** (`script/m59/verify-rel-multiplicity.ts`, before the fix — the gate turns on a
predicate that is separately aimed at a collapsed world to prove it can fail):

```
java-per-call-site   FAIL   1 row / 1 distinct line for 4 true call sites
```

**The fix** — identity includes the site line when the analyzer derived one, and keeps the previous
identity when it did not (so line-less languages are bit-for-bit unchanged):

```ts
const relLine = typeof rel.line_number === "number" && rel.line_number > 0 ? rel.line_number : null
const relId = `${projectId}:rel:${sourceId}:${targetName}:${relType}:${relLine ?? "?"}`
```

**GREEN, through the real tool path** (same gate: index → store → `graphTraversal`, the engine behind
`bb_graph`):

```
java-per-call-site                PASS   4 rows / 4 distinct lines for 4 true call sites
tool-reports-every-call-site      PASS   4 caller edges, 4 distinct lines — caller:3 at lines 4,5,6,7
```

**Magnitude on a real repo** — cats-effect, 404 files, identical corpus, before vs after:

| | before #822 | after |
|---|---:|---:|
| relationship rows | 28,186 | **33,133** (+4,947, +17.6%) |
| carrying a real line | 26,906 | 31,849 |
| `line_number = 0` | 0 | **0** |
| landed lines vs source (Tier A) | 25,810 consistent / 0 inconsistent | **30,270 consistent / 0 inconsistent** |

3,021 `(source,target,type)` groups that held 1 row now hold 8,063. Spot-checked against source:
`IOFiber.scala`'s `runLoop` at **48** lines — every one a real `runLoop(...)` call; `tag` overrides at
26; `JSRunner.register` at 17. The extra rows are real sites, and the source check did not weaken
(0 inconsistent before and after).

**Edits are safe — proven, not assumed** (`script/m59/verify-line-key-idempotency.ts`, 6/6): a full index
stores 4 rows at lines 3-6; editing the CALLEE (the caller's lines unchanged) leaves exactly 4 rows /
4 distinct ids, carried through the repair path's `m40` ids with **no rel/m40 duplication**; editing the
CALLER so the calls move to 5-8 leaves exactly 4 rows at 5-8 — **no stale row survives at the old
lines**, which is the failure mode a line-keyed identity invites.

**Not a pass, declared:** typescript and javascript emit 4 edges with no line, so their sites still
collapse to 1 row — the sites exist but cannot be told apart until the analyzer emits a line (#825).
python/go emit 1 edge (analyzer-side). The gate prints those states and never counts them as passing.

**New finding, filed not smuggled:** #854 — the id keys on the raw target spelling, so `Reference` and
`java.lang.ref.Reference` resolving to one symbol at one line store **two** rows (116 groups / 223 rows
on the cats-effect index, 28 of them line-bearing; 0 rows share a primary-key id, so this is identity by
spelling, not a broken PK).

### 3j. The standing tool-layer acceptance harness (M59.ACC, 2026-09-16)

The instrument that makes every future analyzer wave measurable in one command, instead of every tool
question becoming a fresh investigation. `script/m59/acceptance-tool-callsites.ts` runs four parts:

| part | what it establishes | how it can fail |
|---|---|---|
| **A** fixture, 4 line-emitting languages | the TOOL (`graphTraversal`, bb_graph's engine) returns all 4 call sites at the 4 lines the fixture writes | tool returned fewer/other lines |
| **B** fixture, 2 line-less languages | the tool reports `line: null` — a number here is the #823 substitution returning | any numeric line |
| **C** real corpus | every site the tool reports is the line its OWN row stores (no fabrication), the token is written on that source line (Tier A), and the site count is not below a conservative source lower bound | fabricated / wrong line / missing |
| **D** mutation, in-run RED-GREEN | one audited row's line is corrupted → the SAME audit must turn red; one audited row is deleted → it must leave the answer; both restored → clean | a mutation that does not change the verdict |

**Fresh full run at this HEAD** (404-file cats-effect index built inside the run, 173s, 32,956
relationships):

```
A  java · kotlin · scala · groovy      PASS  4 sites at the 4 fixture lines, each
B  typescript · python                 PASS  line: null, no substituted number
C  1037 sites / 12 callees      fabricated 0   wrong-line 0   missing-from-tool 0
   missing-from-index 1  -> filed as #855 (analyzer lane, scala, TimeT.scala:148)
D  corrupt an audited line            PASS  clean (0+0) -> red (0+1) -> clean (0+0)
D  delete an audited row              PASS  present -> absent -> present (sites 21 -> 20 -> 21)
All checks passed (13).
```

**The five instrument defects this cost, recorded so they are not repeated** — every one produced a
FALSE verdict against correct product behaviour, which is the failure mode that makes a harness worse
than no harness:

1. **`.` excluded from the token boundary** — accused **2,552 of 2,698 real sites** of being on the
   wrong line, because `.unsafeRunSync()`, `IO.raiseError(...)` and `.as(ExitCode.Success)` are
   qualified calls. Same class as the oracle's `$` defect (§3c), found the same way: by reading the
   accused lines instead of the number.
2. **Transitive callers audited as direct claims** — `callers` deliberately carries depth ≥ 1 (callers
   of the caller); auditing `main → run` against the name `as` produced **1,559 false wrong-line
   verdicts**. Now filtered to `to === root.id && depth === 0`, and each row is checked against **its
   own** target name (a cascade member edge names a member, not the root).
3. **One callee name shared by all language fixtures** — `resolveGraphRoot` picks one symbol per name,
   so the typescript/python assertions read the **java** caller's edges and "failed" two languages that
   were behaving correctly. Each fixture now uses a unique callee name.
4. **Block comments not tracked** — `/* … F.pure(a)) <-> F.pure(Right(a))*/` and a commented-out
   benchmark body were counted as call sites, producing 3 false "missing" verdicts. Comment state is
   now carried across lines with inline `/* … */` stripped.
5. **Mutations aimed at rows the audit never read** (and a saturated `LIMIT 200` answer) — the first
   version corrupted an arbitrary row for the symbol and "passed" 200 → 200 → 200 while proving
   nothing. Mutations now act on rows taken from the audit's own row list, and the mutation candidate
   is chosen with headroom below the LIMIT.

One more, caught before it ran: the first draft contained `check(..., corruptedDetected || true, ...)` —
a tautology in the mutation check. A gate that cannot fail is decoration; it was removed, not softened.

**What the harness caught about the product in the same run:** deleting one site row left the site still
visible in the answer, because that site has a **duplicate row** under a different target spelling
(#854) — the count-based assertion was replaced by a rowId-based one, and #854 got a second independent
confirmation of its impact on real answers.

**Scope, declared by the run itself:** Part C's lower bound undercounts on purpose, so a *mismatch* is
proof of a missing site while a *match* is not proof of completeness; languages whose analyzer emits no
line are reported separately and never counted as passing. The harness mutates rows (Part D), so it
**refuses to run against a non-temp data dir** unless explicitly overridden — a real index must never be
the subject of a mutation test.

**Not wired into `npm run verify` on purpose:** it indexes a real repo (~3 min). It is the on-demand
acceptance instrument, run before and after each analyzer wave.

### 3k. Independent re-measurement at `2ef3523e`, and two stale controls (2026-09-17)

Re-run by hand at HEAD `2ef3523e` (`git status` showed only `script/m14/tmp` scratch uncommitted, so the
measurement is of committed source), not read from the previous artifact — which is how a stale artifact
was caught: `validation/m59/results/oracle-callsite.json` claimed `at: 2026-09-16T04:20Z` while its mtime
was 8.5 h later, i.e. it had been **restored, not re-run**. `at` is generated at run time
(`oracle-callsite.ts:570`), so a file whose timestamp precedes its mtime is a copy. Re-ran it fresh:

| lane | rels | with line | INCONSISTENT |
|---|---|---|---|
| java · kotlin · scala · groovy | 6,406 · 2,254 · 423 · 865 | **all** | 0 |
| typescript · javascript · vue · svelte | 2,074 · 2,057 · 1,051 · 110 | **all** | 0 |
| xml | 266 | **all** | 0 |
| the other 13 lanes | 79,649 | **0** | — |

`TOTAL 880 files · 95,155 relationships · 15,506 with a line · 0 INCONSISTENT`, boundary self-test 11/11,
mutation caught. So the real line-emitting set is **9 lanes** (java, kotlin, scala, groovy, typescript,
javascript, vue, svelte, xml) and the analyzer lane's remaining work is **13 lanes / 79,649 relationships**.

**Two reds were then found to be stale controls, not defects** — both caused by the very progress the
lane landed, and both fixed rather than excused:

1. `verify-honest-callsite.ts` **aborted** on its own shape check: its unknown-line world was a
   **typescript** fixture, and #825 gave typescript real lines, so the fixture no longer contained a
   non-emitting language. Control moved to **python** (still 0 lines of 4,524). Gate green again:
   1 unknown edge audited, **0 fabricated**; 2 known edges, 0 misreported; LSP ranges finite; mutation
   visible. (Same class of staleness the acceptance harness had already documented for its own
   `UNLINED` list.)
2. `acceptance-tool-callsites.ts` went **14/14 → 13/14** on `scala-anon-initializer`. Cause established
   layer by layer with `probe-anon-init-regression.ts` (`f80b23ce`, #866): analyzer emits both calls,
   store persists both at lines 6/8, the **tool returns both** — but attributed to the anonymous body's
   field members (`a`, `b`), which are stored with `owner_symbol_id = NULL`. The site is not lost; the
   **identity** is a dead end. Fixture membership is now "the caller, or a symbol lexically inside the
   caller", and the missing link is its own check — see **#879** below.

**The harness now reports 14/15 with one declared red**, deliberately: `nested-site-source-reaches-the-caller`
(`2 nested-source site(s); 0 reach the caller by owner chain, 2 dead-end at a NULL owner`). It was not
deleted and the site check was not weakened to hide it. Filed as **#879** (M59.A10, lane: JVM/analyzer,
#866 lineage) with the scale measured on a fresh cats-effect index (404 files, 33,314 rels): **126**
ownerless constants/variables lexically nested inside another symbol in scala/kt files, and **70** call
edges whose source symbol is ownerless and ≤3 characters. Write-up: `reviews/m59-nested-source-owner-dead-end.md`.

My four gates at this HEAD, all green: `verify-honest-callsite` (5/5) · `verify-rel-multiplicity` (4/4) ·
`verify-legacy-zero-heal` (2/2) · `verify-line-key-idempotency` (6/6). Corpus half of the acceptance
harness: **1,083 sites, 0 fabricated, 0 wrong lines, 0 sites the tool dropped**, both in-run mutations
behaving (21 → 20 → 21 on delete; clean → red → clean on a corrupted line).

### 3l. The per-language tool-answer matrix, and three product findings it produced (2026-09-17)

`script/m59/matrix-tool-language.ts` — the instrument this milestone was missing: for each language, index a
real corpus slice, then ask `bb_graph` **through the real MCP handler** and audit every returned site against
the source file it names, plus grep as the baseline. Merged evidence:
`validation/m59/results/matrix-tool-language.json` (built by `merge-matrix-halves.ts` from the half-runs, and
recording `mergedFrom` so a partial sweep can never masquerade as a complete one).

**Result so far — 2 of 9 languages, 16 cells, `consistent=2,284`, `WRONG=0`, `unknown=0`, `notCheckable=0`,
`mutationsCaught=2/2`:**

| language | repo | slice | rels | cells | consistent | WRONG | mutation |
|---|---|---|---|---|---|---|---|
| scala | cats-effect | 150 files, fp `60b339f9…` | 19,082 (0 zeros) | 8 | 705 | 0 | caught (65→64, wrong 0→1, restore 65) |
| java | clojure | 150 files | — | 8 | 1,579 | 0 | caught (200→199, wrong 0→1, restore 200) |

**Seven defects in this instrument were found and fixed before any of its numbers were reported** — the same
pattern the acceptance harness set, because an instrument that accuses correct code is worse than none:

1. **type-applied calls read as wrong lines.** `MapRef.scala:230` is `delay[F[Option[B]]] {` — a real call;
   the predicate only knew `token(`/`token {`. One WRONG was purely this. Self-tests added.
2. **a mutation that could not fail.** The first mutation compared SQL row counts at two lines and printed
   `caught:false` for every cell (`clean=1, corrupted=1, restored=1`). Replaced by re-running the **real
   audit**: corrupt a row's line past EOF, require `consistent` to drop by exactly one and recover.
3. **a green over an empty world.** Files under a `test/` directory are excluded by the indexer's own
   `skipPatterns` (`/\/test\//`, project-relative), so a 60-file slice landed entirely inside
   `src/test/**`, discovery returned **0 files**, and the sweep printed `WRONG=0`. The instrument now mirrors
   the product's directory exclusions and **refuses to print a verdict** if the slice or the index is empty.
4. **`missed` was always the whole set.** The scan used `path.relative(proj, f)` with `f` an absolute *corpus*
   path (strings like `../../home/…`), so `reported` and `realCallLines` could never intersect: `liftF`
   showed `missed=117` of `realCalls=117` — exact equality is the tell. Fixed, and `missed` for `liftF`
   collapsed **117 → 1**, which matches the already-filed analyzer gap #855.
5. **the tool's truncation flag was read from the wrong depth.** The engine nests it
   (`summary.truncated`); reading the top level made every capped cell look complete.
6. **the mutation could be skipped entirely** when every cell sat at the 200-row cap (`mutation:{"ran":false}`
   on java). Now it falls back to a capped cell rather than proving nothing.
7. **`bb_analyze callers` was unbounded** in the sweep: `maxDepth=3` on a common name exceeded 7 minutes of
   a 500 s budget. Bounded to 20 s and recorded as "NO ANSWER within 20s" — never as slow success.

Three product findings, all filed, none papered over:

- **[#888](https://github.com/backbencher-hq/backbencher-brain/issues/888) — `bb_graph` silently returns ≤200 callers.**
  `graph-engine.ts:160` carries a hard `LIMIT 200`; `truncated` is set only on budget exhaustion, so a symbol
  with **3,437** real call sites answers with 200 and `truncated: false`. 7 of 8 java cells sat exactly at the
  cap. The 200 it does return are correct (`200/200` consistent, 0 fabricated) — that is the point: the tool
  is not wrong, it is **silent about the rest**, which is the exact shape of "bb_analyze found fewer than grep".
- **[#885](https://github.com/ishaq2321/mcp/backbencher-brain/issues/885) — the same slice indexed twice binds
  755 edges to different targets.** Identical slice fingerprint, identical 19,082 rows, identical zero count —
  and 146 of 3,473 gravity scores (4.2%) plus 755 relationship endpoints differ. Extraction is provably
  deterministic (`(source,type,line)` sets identical, 12,927); **100% of the differing edges are pure binding
  differences**, dominated by duplicated short names (`F` 62, `all` 31, `flatMap` 23, `raiseError` 20, `C` 10).
  Consequence measured across four builds of one slice: `map` sites = 199 / 161 / 160 / 144. The tool is exactly
  reproducible *on one index* (3 rounds × 2 processes, identical hashes) and different *between indexes of
  identical input*. Write-up: `reviews/m59-index-binding-nondeterminism.md`.
- **[#887](https://github.com/backbencher-hq/backbencher-brain/issues/887) — tool calls block for minutes when
  queried in the process that just finished indexing.** The kotlin sweep indexed 150 files in 7 s, printed 2 of
  8 cells, then made no progress: `real 8m20s, user 1.0s` — blocked, not computing. The *same* calls on the
  *same* index in a fresh process answer in **≤67 ms** (`probe-name-latency.ts`). This is why the sweep is
  currently 2 of 9 languages: kotlin is blocked by #887, not skipped.

**Declared honestly:** the matrix is not a certification. Its predicate is a *necessary* condition (a lower
bound on call lines), `missed` is reported only for names that map to exactly one symbol (ambiguous names
print `AMBIG(k)`), and cells at the 200 cap carry `truncated`. #888 and #885 mean two of the numbers above are
floors and one class of answer is not reproducible — both stated in the evidence file itself.

### 3m. `bb_edit` refused every edit whose file changed since indexing — and the user's own fix, verified (2026-09-17, #890)

The user reported "the bb edit tool is not working at all". Instead of arguing, the tool was exercised through the **real wire path** (`validateToolArguments` → handler, exactly as `src/mcp/server.ts` does) on an isolated indexed fixture: `script/m59/probe-bb-edit-modes.ts`, 18 cases covering all five modes.

**13 of 14 five-mode paths already worked** — update (full declaration, and body fragment), insert (all four positions), delete, write, refactor, ambiguity refusal with an actionable message, dry-run, per-mode argument rejection (`bb_edit update mode does not accept: position` — the documented behaviour, confirmed on the wire). Two instrument facts were established first, because both had already produced false verdicts in this round: the handler path bypasses parameter validation (calling `createToolHandlers()` alone is *not* the tool), and `allowStaleIndex` is deliberately absent from the registry schema, so the engine's own escape hatch is unreachable from a client.

The real defect was the stale gate: **any** named-symbol edit on a file that changed after indexing was refused — `stale index bounds for helper; reindex before editing` — even when the change was a comment appended at the END of the file, which cannot move the symbol. This is the *normal* agent state (another tool wrote, a pull landed, the human edited), and every read tool refreshes in that state (`BB_NO_AUTO_REFRESH`), so the first symbol edit after any external change was a hard stop and the agent fell back to native edit tools.

**Fix (landed):** on a stale declaration file the tool refreshes **that one file** and re-resolves the symbol, so bounds always come from the bytes on disk — strictly safer than trusting the old span. If the symbol was renamed or removed by that change, it refuses by name (`symbol X not found after refreshing <file> — it was renamed or removed since it was indexed`) instead of editing a guessed span; if the refresh itself fails (index lock held), the refusal names the remediation. The refresh is reported in `warnings`, so it is never silent. Caller freshness is untouched (that is the safety property `verify-edit-freshness` pins).

**Measured, before → after:** fixture gate **16/18 → 18/18 expectations met, 0 unmet**; real repo slice (graphql-js, 46 files: `script/m59/probe-edit-refresh-cost.ts`) — edit after an external change now answers in **3,413 ms with the refresh reported**, an untouched file answers in **41 ms with no refresh**, and `dryRun` wrote no source. Regression gates unchanged: E5 freshness 14/14 · E8 integration 17/17 · m15 crossfile E4/E5/E8 VERIFIED · E7 18/20 (pre-existing known gap).

The user's uncommitted `declaresSelf` change was verified with a controlled revert: **without it** the full-declaration method update (case 01) fails `validation failed … Syntax ERROR` and is rolled back — the pre-fix engine nested the declaration inside the old declaration; **with it** the case passes. That is why their fix was necessary, measured rather than assumed.

## Why every previous gate passed while this was true

Because the two instruments that could have contradicted it were not measuring: one certified the file
and called it the call site, and the other handed the gate a line the pipeline never produced. Section
3h records both mechanisms being deleted, and the negative controls that proved their replacements can
fail. The answer to "why did 189,499 wrong lines pass 189,499 green checks" is that the checks were
asking a different question.

## Open at filing — the milestone is NOT closed

| Issue | State |
|---|---|
| #819 oracle | delivered, mutation-proven |
| #820 store write | landed, measured on a real index |
| #821 remaining hardcoded `0` | **closed** — the buffered `contains` insert and both cross-language persister sites write the analyzer's line or `NULL`; measured 62 → **0** rows storing 0 on a real index, and the store probe fails the run if one reappears |
| #822 call-site multiplicity | **closed** — the analyzers were measured first (`probe-multiplicity.ts`): java/kotlin/scala emit 4 edges on 4 lines for 4 calls, so the collapse was the STORE's id, not the analyzers'. Identity now carries the site line; the DB gate went 1 row → 4 rows and the TOOL path (`graphTraversal`) returns all 4 sites at lines 4,5,6,7. Real repo: 28,186 → 33,133 rows, 3,021 groups now hold 8,063 sites, source check still 0 inconsistent (30,270 consistent). Edits proven non-staling and non-duplicating (`verify-line-key-idempotency.ts` 6/6). Line-less languages unchanged by construction; #854 filed for target-spelling duplicates |
| #823 stop fabricating in the tool | **closed** — `graph-engine.ts:177/264` no longer substitute `node.line`/`0`; the contracts type `line: number \| null`; the LSP emits NO range for an unknown line (`null - 1` → NaN and a wrong highlight before). Gate `verify-honest-callsite.ts` was run RED at HEAD first (`db=NULL engine=5`), then GREEN (`0 fabricated`), with the mutation proven by stashing the fix and re-running. Coordinated with the LSP/hub lane by landing the change additively |
| #824 delete false certification | **closed** — `script/verify-graph.ts` no longer accepts a file as a call site: the expectation is derived from the fixture's own source (java 8, scala 6 at HEAD) and two controls over a **real index** corrupt and `NULL` the stored line and are caught/refused. The three M44 fixtures that hand-supplied `line_number` (3, 4, 2, 5, 6, 1) now write `NULL` and every law still passes (U1 20/20 · U3 27/27 · U4 25/25), which is what proves they never read it. The same round fixed the evidence: `failures` is persisted, and the wire-leg check set is invariant, so a run that cannot establish a law fails it by name instead of shrinking the count |
| #825 analyzer lane emission — synthesised members | **JVM family done** — a synthesised member (`metadata.isPhantom`: kotlin's data-class `componentN`/`copy`/`equals`/`hashCode`/`toString`, java's lombok accessors and Spring-Data repository methods) carries NO line; a declared member keeps its real one. Both analyzers used to take the ENCLOSING declaration's range, so `contains DataHolder.component1` claimed the class line and no source check could ever satisfy it. kotlin's injector also set `ownerName` for `componentN` but not for the other four, so those members had no containment edge at all. Fixtures `kotlin/data-class-phantoms` (extended) and `java/phantom-contains-lines` (new), mutants `kotlin/phantom-containment-line`, `java/phantom-containment-line`, `kotlin/phantom-uncontained` (all CAUGHT), and the runner gained the `line_number: null` assertion the gate was missing. The oracle now flags a phantom target that CLAIMS a line as inconsistent (it previously classified the whole class `notCheckable` by name shape, which is how 32 wrong-line kotlin edges passed a 6,787/6,787 "carries a line, 0 inconsistent" claim) |
| #825 analyzer lane emission | **JVM family done, others open** — at the 840-file oracle sweep, scala **1,989/1,989** · java **1,920/1,920** · kotlin **6,787/6,787** · groovy **761/761** carry a line on **every** relationship, **0 inconsistent** (groovy also 2,864/2,864 at a 150-file sample). Every mechanism is fixture- and mutant-pinned (scala 5 mutants, java 3, kotlin 2, groovy 3). Still open: the other 17 languages emit **0 lines across 77,170 relationships**. xml is now closed too — added to the oracle (569/569 consistent, 0 inconsistent at 40 files) and given the fixture lane it never had (`xml/lines-825`, 22 lanes / 429 fixtures) |
| #825 analyzer lane emission — **web family** | **web family done** — typescript · javascript · vue · svelte carried **0 lines on all 5,293 relationships** of the pinned 40-file sample (measured at HEAD in a worktree with the same instrument and the same sample pins, so the baseline is a real baseline). Now **5,292/5,293** carry one with **0 INCONSISTENT** (typescript 2,074/2,074 · javascript 2,057/2,057 · vue 1,051/1,051 · svelte 110/111; the one absent line is the honest unknown, never `0`). Three defect classes beyond the silence: the **SFC seam** (a delegated relationship kept the js/ts analyzer's SCRIPT-relative line — 562 of 585 line-bearing vue edges and 19 of 58 svelte ones INCONSISTENT once the delegate began emitting lines; the wrapper now shifts and **records** the offset it applied), the **name-vs-construct** rule (chain callee leaf, import specifier, base name, `new` class name), and **vue's props** (every prop/emit symbol stamped with the `props: { … }` pair's line — `Account.vue:17` for a key written on 18). Pinned by four new fixtures (`typescript/callsite-lines-825`, `javascript/callsite-lines-825`, `vue/template-lines-825`, `svelte/template-lines-825` — the vue/svelte `forbid` values MEASURED by running the same fixture at HEAD) and **eight mutants, all CAUGHT** (per-lane drop, seam-not-shifted for vue and svelte, props-pair, and `typescript/line-zero-based` — the off-by-one that proves the fixtures pin the arithmetic). Two instrument defects had to be fixed first: the callee token for a TS/JS import target was the whole `module:item` (22 of 24 typescript INCONSISTENT verdicts were that, every one on a CORRECT line) and the `default` export sentinel was checked as a written name. Fixtures **440/440** across 22 languages, mutants **591/591**, typecheck clean. Registered as `reviews/m59-web-lines-round` |
| #890 `bb_edit` stale-file refusal | **fixed and verified** — refresh-one-file instead of refusing; fixture gate 18/18 · real-repo slice measured · four edit gates re-run unchanged · docs regenerated (`npm run docs:generate`, TOOL DOCS: PASS) |
| #826 closure gate | **open** |

**Tracking gap, stated:** this table's `closed` rows (#821–#824) are closed *in substance* — each was delivered, measured and pinned — but their GitHub issues were never transitioned, so the milestone still reports 10 open / 1 closed. Closing them is bookkeeping, not work, and it is the last honest step before #826 X1 can run.

## Evidence

- `validation/m59/results/oracle-callsite.json` — oracle run, tiers, mutation, per-file detail
- `validation/m59/results/store-line-landing.json` — before/after on a real index + per-line source check
- `validation/m59/results/multiplicity.json` — #822: what each analyzer emits per call site (7 languages)
- `validation/m59/results/rel-multiplicity.json` — #822: the DB and the tool, before/after, with the
  predicate aimed at a collapsed world to prove it can fail
- `validation/m59/results/line-key-idempotency.json` — #822: edits leave no stale rows, no duplicates
- `validation/m59/results/honest-callsite.json` · `legacy-zero-heal.json` — #823 / #821 gates
- `validation/m59/results/acceptance-tool-callsites.json` — the standing harness: fixtures, corpus
  audit, both mutations, and the lower-bound self-test, all in one run-authored file
- `validation/m44/results/U1.json` · `U3.json` · `U4.json` — the three gates re-run at HEAD with the
  hand-supplied lines deleted; each now carries `failures: []` and pins to the current commit
- `reviews/m49-callsite-line-gap.md` — the contract handoff to the analyzer lane
- `reviews/m59-nested-source-owner-dead-end.md` — #879, with the layer-by-layer fixture evidence
- `script/m59/probe-anon-init-regression.ts` — the probe that classified the #866 red (analyzer vs store
  vs tool), so the verdict came from measurement rather than from the failing check's name
- `validation/m59/results/probe-bb-edit-modes.json` — #890: all five `bb_edit` modes through the real
  wire, the stale refusal reproduced, the rename-outside refusal, and the declared `allowStaleIndex` gap
- `validation/m59/results/probe-edit-refresh-cost.json` — #890: the same path on a real repo slice,
  with the refresh cost and the no-refresh cost separated

## Reproduce

```bash
npx tsx script/m59/oracle-callsite.ts --files-per-lang=4
npx tsx script/m59/verify-store-line-landing.ts
# #822 — multiplicity: what the analyzers emit, what the store keeps, what the tool answers
npx tsx script/m59/probe-multiplicity.ts
npx tsx script/m59/verify-rel-multiplicity.ts
npx tsx script/m59/verify-line-key-idempotency.ts
# M59.ACC — the standing tool-layer acceptance harness (fresh index, ~3 min)
npx tsx script/m59/acceptance-tool-callsites.ts
# #879 — why a nested-source site answers with an ownerless symbol (analyzer / store / tool, separately)
npx tsx script/m59/probe-anon-init-regression.ts
# #823 / #821 — the tool stops fabricating; legacy zeros cannot return
npx tsx script/m59/verify-honest-callsite.ts
npx tsx script/m59/verify-legacy-zero-heal.ts
# #890 — bb_edit per mode through the real wire, plus the stale-file refresh cost on a real repo
npx tsx script/m59/probe-bb-edit-modes.ts          # 18 cases, expects 18/18 met
npx tsx script/m59/probe-edit-refresh-cost.ts --files=150
# #824 — the certification that can fail (A6)
bun run script/verify-graph.ts
npx tsx script/m44/verify-usages-groups.ts   # U1 20/20
npx tsx script/m44/verify-hub-tree.ts        # U3 27/27
npx tsx script/m44/verify-legend.ts          # U4 25/25
```
