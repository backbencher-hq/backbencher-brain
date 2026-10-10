# XML — the residual record

> The analyzer's contract lives in [`real-xml-analyzer.md`](./real-xml-analyzer.md) (not this
> lane's file to edit this wave). This page is the **residual** record: what is not yet real about
> the edges xml emits, which population each number is over, and what has been ruled.
> Machine-readable companions: [`residual-baseline.json`](../../validation/m14/fixtures/xml/residual-baseline.json)
> (the first measurement) and [`residual-true-population.json`](../../validation/m14/fixtures/xml/residual-true-population.json)
> (the re-run after two fleet fixes this lane's findings produced).

## State, 2026-10-10 00:45

Run on the lane's true population — **11,562 files** across its seven admitted spellings, 0
degraded, `extFAIL 0 · bindFAIL 0 · causeFAIL 0`:

| type | edges | resolved | ambiguous | unresolved | residual | unresolved before §3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| contains | 189,310 | 189,310 | 0 | 0 | **0.0%** | 0 |
| calls | 402 | 123 | 279 | 0 | 69.4% | 0 |
| overrides | 3 | 1 | 2 | 0 | 66.7% | 0 |
| references | 11,108 | 997 | 7,582 | **12** | 68.4% | 2,529 |
| imports | 473 | 2 | 0 | **265** | 56.0% | 471 |
| extends | 1,429 | 84 | 991 | **0** | **69.3%** | 354 |
| **TOTAL** | **202,725** | **190,517 (94.0%)** | 8,854 | **277** | **4.5%** | 3,354 |

Raw: [`residual-extends.txt`](../../validation/m14/fixtures/xml/residual-extends.txt) (after the
`extends` claim mapping), [`residual-after-claims.txt`](../../validation/m14/fixtures/xml/residual-after-claims.txt),
[`residual-true-population.txt`](../../validation/m14/fixtures/xml/residual-true-population.txt)
(the 6.0% state before any claim mapping).

The claim mapping of §3 is the last column's delta: **unresolved 3,354 → 631 (−81%)** and the
lane's residual **6.0% → 4.7%**, with `extFAIL` 0 at every step. What is left is `extends` (94.1%)
and the ambiguity of `references`/`calls`/`extends`.

> `contains` is 189,310 resolved of which **183,888 (97.1%) are resolved AMONG A COLLISION** — the
> gate's upper bound, because both resolvers put the edge's own file second. **The exact test has
> now been run** ([`contains-intent.json`](../../validation/m14/fixtures/xml/contains-intent.json)):
> of 189,310 containment edges, **189,305 are `intended`** — a declaration in the edge's OWN FILE,
> ON the edge's own line — with **`twin` 0** (no wrong-file binding) and **`noDecl` 0**; 5 are
> same-file but off-line. `contains`'s 0.0% residual is therefore genuine and quotable at 99.997%
> determinate. One caveat is kept rather than closed: `twin` means "nothing in the own file
> answers", which is weaker than "the store bound it elsewhere" — on libxslt the store probe
> measured 8.5% `boundOtherFile` (3,320 rows), and that disagreement is not resolvable from this
> lane (candidates: the disclosed 1.83× row-count anomaly, the eager insert-time resolver, and row
> duplication — none of them tested here).

The board carried `93.9%` earlier the same night. Both halves of that number were wrong, and each
became a fleet fix:

### 1. It was measured over 18% of the lane — FIXED

`incoming-gate.ts xml xml 0` admitted only paths ending `.xml` (`population.corpusTotal = 2081`),
while the router maps six extensions to `xml` and this lane's declared corpus is 11,552 files. The
instrument's own `LANES_B` table already recorded this exact defect and its fix for yaml
(`yaml,yml`: *"one language does not become a different population by being spelled .yml"*) and
still read `xml: "xml"` — the lesson was written as a value rather than as a rule.

Fixed in `68138a1c8`. Population now **11,562 files across 126 repos** (2,081 → 11,562), against
this lane's declared 11,552 — the two agree to 0.1% where they differed by 5.6×. The lane's share
of the board's number went from 18.0% of its files, 16.1% of its `contains` edges, 3.0% of its
`references` and 29.1% of its `imports`, to all of it.

### 2. `contains` was classified by a resolver production does not use — FIXED

This lane measured it two ways on the same edges:

| | edges | resolved | ambiguous | residual |
| --- | ---: | ---: | ---: | ---: |
| the gate's count model (2,081 `.xml`) | 30,205 | 1,792 | 28,413 | **94.1%** |
| the real store (`store-binding-truth-120`, production indexer) | 3,097 | 3,048 bound | — | **1.6% unbound** |

Production resolves a `contains` edge **at insert time** by (leaf name, the edge's OWN FILE first,
then line) — `resolveContainsTargetStmt`, kept eager for `contains` where every other type defers.
`classifyEdge` received only a project-wide declaration count and has no file parameter and no line
parameter, so an edge production binds to its own file's declaration read as ambiguous whenever a
bare local name (`path`, `name`, `item`, `template`) occurs more than once in the repository.

Fixed in `fa2dc27e8`, whose message cites this lane's measurement and whose rule now takes a
`containsLike` arm. The lane's share of the residual fell from 94.1% to **0.0%**.

**Same-project confirmation** (one repository, both instruments; raw:
[`gate-libxslt-same-project.txt`](../../validation/m14/fixtures/xml/gate-libxslt-same-project.txt),
[`store-truth-libxslt.json`](../../validation/m14/fixtures/xml/store-truth-libxslt.json)):

| libxslt, 1,143 files, one project | edges | result |
| --- | ---: | --- |
| gate model (before the rule fix) | 21,486 | 96.1% ambiguous |
| real store (`indexProjectParallel`) | 39,293 | **95.4% bound**, **87.0% same-file**, 4.6% unbound, 8.5% cross-file |

Two things follow. The mechanism is confirmed at a whole repository's scale, not only on a pooled
draw. And the honest next question is the **8.5% cross-file** — an eager `LIMIT 1` that prefers the
own file still falls back to another file's declaration when the name is not declared in the edge's
own file.

*Disclosed, not smoothed over:* on that run the store holds 39,293 `contains` rows while the same
files through `parseFile` emitted 21,486 (1.83×; the other four types agree within 2%, and the
earlier 120-file draw showed 1.006×). Unexplained here, in an instrument this lane does not own, so
the percentages are quoted as **ratios over the stored set** and the absolute counts are flagged.

### 3. What is actually left, and the cause now being worked

Residual 12,208 edges: `references` 91.0%, `extends` 94.1%, `imports` 99.6%, `calls` 69.4%. The
unresolved column is 3,354 (references 2,529 + imports 471 + extends 354) and it is the approved
next cause.

The analyzer already publishes the classification the gate needs — `metadata.resolvable` ∈
`in-document | builtin | external | unresolved` (references) and `in-document | file | external`
(imports) — and carries **none** of the gate's claim keys, so a target it knows is a built-in
reaches the gate unmarked and is counted as the lane's defect. The gate's rule: *"an unmarked
external edge is indistinguishable from a broken one."*

Which claim each class earns was decided from counts, not from the wish to shrink a number
(`validation/m14/fixtures/xml/resolvable-class-census.mts` cross-tabulates the analyzer's classes
against the gate's own `classifyEdge`) — **and it has now landed**, measured before and after on the
identical 2,081-file draw (`claim-mapping-before-after.txt`, `claim-mapping.json`):

| | references unresolved | imports unresolved | extOK | ext? | **extFAIL** | residual edges |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| before | 198 | 134 | 0 | 0 | 0 | 396 |
| after | **15** | **108** | **175** | 34 | **0** | **187** |

Four sites carry `isExternalTarget` (`attribute_qname_reference` and `entity_reference` for the
analyzer's `builtin`/`external` classes; `processing_instruction_href` and `doctype_external_id`
for remote import targets). Fixtures unchanged at **31 pass / 0 fail**.

The routing the counts chose, and the two refusals that keep it honest:

| class | targets measured | claim that can verify it | why not another |
| --- | --- | --- | --- |
| references `builtin` / `external` | identifiers (`string`, `attribute-name`, …) | `isExternalTarget` → owner claim | verified when undeclared; **never refuted** for a non-identifier spelling |
| references `unresolved` (X13) | the file does not satisfy them | **none proposed** | calling it "not in the population" asserts a fact the analyzer did not measure |
| imports `external` (URIs) | `http(s)://…dtd` | `isExternalTarget` → externalUnverified | a URI is path-like, and `verifyExternalClaim` checks `pathLikeTarget` first |
| imports `file` | relative paths | **priced only** | a file claim REFUTES when no candidate is admitted, and `extFAIL` must stay 0 |

A PASS needs `bad === 0` **and** `externalUnverified === 0`, so a marker that moves an edge from
`unresolved` to `externalUnverified` lowers the residual column and still does not buy a green row.
That is the point: it is a true classification, not a short-cut. The 34 unverifiable claims the
after-run reports are in the verdict line, not hidden behind the smaller residual.

## A fleet-level finding: store binding is order-dependent

The `contains` note above keeps one caveat open — the store probe's 8.5% `boundOtherFile` on libxslt
against the gate's `twin 0`. One of the three candidates for that gap was the **eager insert-time
resolver being only as good as the table's state when its batch runs**, and that is testable:
index the same files twice in different orders and compare the bindings row by row
(`store-determinism.mts`, two preserved runs in `store-determinism-run2/3.json`).

**It is confirmed.** 300 libxslt files, three arms (sorted, reversed, sorted + eager-forced):

| comparison | run 2 | run 3 | by type |
| --- | ---: | ---: | --- |
| sorted vs reversed order | **96 differing** of 7,825 | **96** | all `contains` |
| eager vs deferred | 26 | 29 | `contains` + **`calls`** |
| reversed vs eager | 111 | 112 | `contains` + `calls` |

- **Order-dependent.** Reversing the file order changes 96 bindings (1.23%) — same edge key, a
  different target file. Example: `tests/REC/test-10-1.xsl | li | contains | xsl:text | 15` binds to
  `doc/EXSLT/devhelp/devhelp2.xsl` sorted, `tests/REC2/svg.xsl` reversed.
- **Also run-dependent.** Eager-vs-deferred printed 26 differing in run 2 and 29 in run 3 — same
  probe, same arms. Worker scheduling contributes; the outcome is not a function of (file set,
  order) alone.
- **Eager vs deferred changes the graph**, falsifying the in-code claim on
  `BB_TEST_FORCE_EDGE_RESOLVE` that it "changes nothing about the final graph". `calls` is 17 of
  those rows in both runs.
- **Invisible to rate metrics.** `bound 7,109 / unbound 716 / storedRows 7,825` are identical in
  every arm of every run. Only a per-row comparison sees any of it.
- **Row duplication is ruled out**: `duplicateIds 0`, `storedRows == joined rows` — candidate (c)
  of the earlier disclosure does not hold for this draw.

**Mechanism.** `contains` is resolved at INSERT time against the symbol table as it stands when that
batch runs, and never revisited (the resolution pass skips rows that already have a target). The
documented tie-break is deterministic over a *complete* table; it is not complete when the row is
written. That also reconciles the two numbers that started this: the gate asks whether a same-file
declaration **exists** (it does — `twin 0`), while the eager resolver binds whichever row was
**visible at insert time** (sometimes another file's).

**Scope stated, not implied:** one repository, 300 files, three arms, two runs. This falsifies
determinism in this configuration; it does not measure how far it reaches.

*A probe artifact worth recording:* the first version of this instrument joined `brain_symbol` twice
to read endpoints, and that join fanned out on duplicated symbol rows — 482 phantom "differences",
every one of them the same relationship id repeated. The join is gone; the artifact is kept in the
finding because a probe that manufactures its own finding is the failure this measurement had to
survive.

## The completion package (four-clause bar) — verdict: NOT YET, by three named shortfalls

Whole population, current revision, every number from the per-type rows
([`verification-package.json`](../../validation/m14/fixtures/xml/verification-package.json),
raw [`verify-chain.txt`](../../validation/m14/fixtures/xml/verify-chain.txt)):

| type | edges | resolved | ambiguous | unresolved | residual | cause |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| contains | 189,310 | 189,310 | 0 | 0 | 0.0% | fixed (`fa2dc27e8`); 99.997% determinate |
| references | 11,108 | 997 | 7,582 | 12 | 68.4% | collisions; twins ruled fix-size-zero; 12 = X13 |
| extends | 1,429 | 84 | 991 | 0 | 69.3% | unresolved fixed (`76d8aef3c`); collisions remain |
| calls | 402 | 123 | 279 | 0 | 69.4% | name collisions only — **no ruling yet** |
| imports | 473 | 2 | 0 | 265 | 56.0% | file-class refused with evidence; URIs claimed |
| overrides | 3 | 1 | 2 | 0 | 66.7% | collisions on a 3-edge type |

**Clause 2 met in full**: `extFAIL` = `bindFAIL` = `causeFAIL` = 0, per type and in TOTAL.
**Clause 4**: `contains` determinate (189,305 intended / 0 twin / 0 noDecl); `exports` is
**not applicable** (0 edges — excluded as grammar-absence); for the types where the line test is
*not* applicable the gate can only say `sameFileUnproven`, which is **4,072 edges**
(references 3,445 + extends 346 + calls 279 + overrides 2).

**The three shortfalls, by size:**

1. **Clause 1 — 279 edges (`calls`).** The cause is named and counted (pure name collision; `twin`
   0, `noDecl` 0, so nothing wrong-file and nothing dangling) but there is no ruling with a
   falsifier yet. It is enumerable edge by edge.
2. **Clause 4 — 4,072 edges.** For references/extends/calls/overrides the line test is N/A by
   construction (`twin` there is a *risk*, not proven wrongness — the corrected legend), so
   determinacy is unproven and would need a store probe of the same shape as the `contains` one.
3. **Clause 3 — 12 edges.** The imports-265 refusal **is** evidence-backed: a blanket file claim
   would REFUTE **59** times (`fileClaimProbe`: 205 candidates admitted, 59 absent). The
   references-12 refusal is **not** at that standard: a claim would *verify* (they name nothing in
   the project), so the refusal rests on the analyzer's X13 label — the value may not be a reference
   at all — and its falsifier (a probe showing all 12 are real external references) is **not run**.

**The 1.83× `contains` factor — RESOLVED, and it is a shared-indexer defect, not an instrument
artifact** ([`insert-hook-finding.json`](../../validation/m14/fixtures/xml/insert-hook-finding.json),
[`emitted-vs-stored.mts`](../../validation/m14/fixtures/xml/emitted-vs-stored.mts)): reproduced at
**4,375 emitted vs 7,649 stored = 1.748×** (`calls`/`imports` 1.0, `references` 0.91).

The indexer synthesizes one owner→owned `contains` row per owned symbol (`parallel-indexer.ts`
#756/M51.A1, `:3955-3984`, flushed `:4208-4213`) and guards it against double-writing with a
`containsPairs` set — **but the set is built with BOTH ends leaf-reduced**
(`containsPairs.add(`${srcLeaf} ${tgtLeaf}`)`, regex at `:3651-3659`) **while the lookup reduces only
the owner and leaves the child raw** (`containsPairs.has(`${ownerLeaf} ${symbol.name}`)`, `:3971`).
For any name containing a colon the two keys differ by construction, the guard never fires, and a
containment edge the analyzer already emitted is written a second time. XML is the extreme case
because prefixed names (`xsl:template`, `doc:reference`) are the norm.

Proven to the edge on one file — `tests/docbook/common/common.xsl`: analyzer **294** contains edges,
store **511**, difference **217**, and replaying the indexer's own two regexes over the symbol table
predicts **217** owned symbols whose lookup key is missing from the leaf-reduced set, **all 217
colon-named**. Prediction == measurement, exactly
([`insert-hook.json`](../../validation/m14/fixtures/xml/insert-hook.json) `counts.synthesizedPredicted`
vs `counts.storedContainsMinusAnalyzer`).

*Why the hook itself recorded nothing:* the store runs in **worker threads**, where a main-thread
`better-sqlite3` patch is invisible (`insertedTotal: 0` while 511 rows appeared). That is worth
keeping — any probe that patches the driver in the main thread sees no inserts. The answer came from
the store side plus the indexer's own regexes.

**Impact, stated both ways.** This lane's four clauses do not move: the gate is a key-space model
over analyzer output and never reads the store, and a duplicated row repeats the same (owner, child)
pair, so no binding verdict changes. Fleet-wide, **every lane whose symbols carry a colon gets
duplicate containment edges** — the condition is mechanical, so it can be checked per lane by
counting colon-named owned symbols. The fix belongs in `src/ast/parallel-indexer.ts` (make the two
key shapes agree, or key the pair set on resolved ids); that file is not this lane's to edit, so it is
**reported, not fixed**.

**Single-run dependence:** the gate rows were reproduced identically by two whole-population runs at
this revision, so clauses 1/2/4 do not rest on one run. Every **store**-derived figure does — the
store is order- and run-dependent (§ the fleet-level finding) — and those are labelled as one run in
their artifacts.

## Method notes

- One cause per turn, one commit per verdict; a cause is closed by a before/after over a named
  population or by a ruling with evidence.
- Corpus-scale runs are guarded with `( flock … ) 9>.bb-heavy-v2.lock` (the original lock was found
  stuck with no visible holder). A run that exits 9 on a lock timeout is reported **KILLED** with no
  output, never as a measurement about the lane.
- The store instrument writes `~/.bb/projects/<id>`; under this sandbox `/` is read-only outside the
  workspace, so it must run with `HOME` relocated into the workspace. Without that it dies `ENOENT`
  in a way that reads like a code error.

---

## The `twin` class is NOT 4,782 wrong edges — it is a name-collision artifact. Fix size: 0.

**APPENDED, not woven in** (the state table, §1–§3 and the `uses` gap note above are another writer's
records and are left untouched).

The residual gate's `twin` column reads **references 4,137 · extends 645 = 4,782**, and its own column
header calls that *"ONLY another file answers (a wrong edge)"*. Both numbers reproduce exactly
(`measurements/residual-gate-xml.txt`). The class is not what the header says.

**WHAT THE CLASSIFIER ACTUALLY TESTS.** `classifyIntent` (`incoming-gate.ts:433-445`):

```
decls = declarations of the target NAME in the project
if none                      -> noDeclaration
if none in the EDGE'S FILE   -> arbitraryTwin        <-- the twin column
```

It is a **NAME test that does not read claims**. For `contains`/`exports` that is a defect by
construction — those must name an identity their own file minted. For `references`/`extends` it is what
a cross-document reference *is*, and the same function's own docstring is weaker than the column
header: it calls the class *"exactly when the store's `s.id` tie-break picks a foreign declaration"* —
a RISK, and it says so for the sibling class in the same paragraph.

**MEASURED, 600-file even stride of the 11,552-file population** (`probe-twin-class.ts`, raw in
`measurements/twin-class-size.txt`): 476 `references`+`extends` edges, **236 twins**. Bucketed by the
analyzer's OWN class, which the gate's name test never consults:

| analyzer class | claim | twins |
|---|---|---:|
| `builtin` | `isExternalTarget` | **233** |
| `external` | `isExternalTarget` | **3** |
| `in-document` | — | **0** |

**Every twin already carries the correct external claim, and not one is in-document.** The
owner-qualification ceiling asked for is also measured, and it is **0**: of the 236, none has an
own-file declaration of the same leaf (`CEILING 0`), and none has an own file that names the declaring
file (`REFERENCED 0`) — so no spelling change reaches any of them either.

**VERIFIED ON THE FLAGGED CASE, the rule this lane applies to every instrument:**
`phpunit/schema/10.2.xsd` emits `restrictDeprecations -references-> boolean`, and line 27 of that file
is

```xml
<xs:attribute name="restrictDeprecations" type="xs:boolean" default="false"/>
```

`boolean` is the **XSD builtin**; the file declares it zero times, correctly. It is "in the corpus"
only because four unrelated files declare a symbol of that name —
`libxslt/tests/exslt/common/object-type.1.xsl`, `otp/lib/xmerl/test/xmerl_xsd_SUITE_data/{mim,mim2,sis/mim}.xsd`,
`Aporia/share/gtksourceview-2.0/language-specs/language.rng` — none of which the phpunit schema has any
relationship to. The edge is right, the analyzer's claim is right, and the column counts it as wrong
because the corpus is a union.

**RULING: the fix is 0 analyzer edges.** There is nothing to repair — the edges name what the source
writes (`xs:boolean`), the lane already classifies and claims them, and the 4,782 is a property of a
name test over an 11,552-file union. Reporting this as a 4,782-edge defect would have attributed a
`references`-shaped column to a lane whose analyzer is correct on every sampled instance. **The column
header, not the lane, is what needs the wider fix** — `references`/`extends` twins are cross-document
references, and the header's *"a wrong edge"* is only true of `contains`/`exports`.

**FALSIFIER.** This ruling holds only while the twins are all claimed external. The probe counts
`in-document` twins explicitly and prints them; **that count is 0**. If a future run shows an
`in-document` twin, the ruling is refuted for that edge and the lane has a real defect there. The
sample is 236 twins from a 600-file stride; the whole-population split is the next measurement if a
reader needs the absolute count, and the class is uniform enough in this draw that the conclusion is
unlikely to move.

### Whole-population confirmation, and the falsifier printed as a number

The 236-twin result above was a 600-file stride, and a ruling whose falsifier is *"every twin is
claimed"* should not rest on a sample. Run over the WHOLE admitted population — **11,552 files, even
stride 1**, `measurements/twin-class-whole-population.txt`:

| | whole population |
|---|---:|
| `references`+`extends` edges | 12,537 |
| **TWINS** | **4,782** (references 4,137 · extends 645) |
| REFERENCED — the own file names the declaring file | 993 (20.8%) |
| CEILING — own file declares the same leaf | **0 (0.0%)** |
| NEITHER — unexplained by this probe | 3,789 (79.2%) |

**The probe reproduces the gate's own twin column EXACTLY — 4,137 and 645, to the edge** — which is
the cross-check that it is measuring the same class the gate measures, not a neighbouring one.

**FALSIFIER COUNT, printed as a number rather than left to the absence of a row:**

```
twins the analyzer calls in-document:      0
twins already carrying isExternalTarget: 4,767 of 4,782   (99.7%)
```

By the analyzer's own class: `builtin | isExternalTarget` **3,856** · `external | isExternalTarget`
**911** · `unresolved | ambiguousWithBuiltin` **9** · `unresolved | danglingEntityReference` **6**.

**The 15 twins that are not externally claimed are the only residue, and they are named and already
classified**: 9 `ambiguousWithBuiltin` and 6 `danglingEntityReference`, both the analyzer's own labels
for targets it declines to claim. None is `in-document`, so the ruling stands at whole-population
scale — and if a later reader wants a real cause on this type, **those 15 are where it would start**,
not the 4,782.

**ONE NUMBER FROM THE SAMPLE DID NOT SURVIVE SCALE, recorded because the class is what travels and the
rate is not.** `REFERENCED` read **0.0%** on the 600-file stride and reads **993 (20.8%)** at whole
population: a stride of 19 misses the sibling files that make a schema name the document it depends on
(an `.xsd` beside the `.xsd` that extends it). The ruling did not depend on it — the falsifier was
always the `in-document` count, which is 0 at both scales — but the rate was a draw artifact and is
stated as such. **The ceiling being 0 at BOTH scales is the number that decides the fix question**: no
spelling change reaches any twin, at 600 files or at 11,552.

### The 15 unclaimed twins — RULED, with counts, and the claim is measurably unavailable

Whole population, printed in full by `probe-twin-class.ts` (`measurements/twin-unclaimed.txt`). They
are two groups, and both are **the analyzer's own labels for targets it declines to claim** — named
causes, not unexplained edges:

| group | count | role | target | sites |
|---|---:|---|---|---|
| `ambiguousWithBuiltin` | **9** | `attribute_qname_reference` (`<data type="string">`) | `string` | `Aporia/share/gtksourceview-2.0/{language-specs/language2,language-specs/styles,styles/styles}.rng` |
| `danglingEntityReference` | **6** | `entity_reference` (`&mdash;`, `&copy;`) | `mdash` ×3, `copy` ×3 | `libxslt/tests/docbook/test/{book,book2,condition,gdp-handbook,table,verbtest}.xml` |

**CAN THEY BE CLAIMED? NO, AND THAT IS MEASURED RATHER THAN ASSERTED.** An external claim verifies at
the arbiter's PROJECT scope only when the project does not publish the target. Both names ARE published
in their own project:

- `string` is declared under **Aporia** — `share/gtksourceview-2.0/styles/{eggshell,obsidian}.xml`,
  `share/gtksourceview-2.0/language-specs/language.rng` — the same repository as all nine edges.
- `mdash` is declared under **libxslt** — `tests/general/bug-24-.xml`,
  `tests/xmlspec/xmlspec-v21.dtd`, `tests/xmlspec/REC-xml-20001006.xml`,
  `tests/docbook/html/html.xsl` — the same repository as all six.

So a claim would be adjudicated against a key space that publishes the name and would be refuted,
taking `extFAIL` off its 0 — the lane's red line, and one that §3 already established as the reason two
other classes were priced rather than marked. **The analyzer's refusal is the correct answer, not a
gap.** The nine are ambiguous by construction (`<data type="string">` names a datatype in the RELAX NG
datatype library while the same repository declares a `string` symbol), and the six name entities a
DocBook/HTML DTD defines outside the document — a fact the analyzer cannot see from one file, which is
exactly what the label `danglingEntityReference` records.

**THE BAR'S SECOND ARM FOR xml's `references`, COMPLETE:**

```
4,767  twins carrying isExternalTarget        (correctly claimed)
   15  twins declined by the analyzer's own label  (9 ambiguousWithBuiltin + 6 danglingEntityReference)
    0  twins the analyzer calls in-document
-----
4,782  the gate's twin column, reproduced to the edge
```

**No unexplained remainder.** Every edge in the class is either claimed-verified or declined under a
label that names its own cause.

**FALSIFIER.** The ruling is that these 15 cannot be claimed *because their names are published in
their own project*. If a later run shows one of the 15 names absent from its own project — the
publication list above is the check — then a claim becomes available for that edge and the count moves
down. The same run should print the class counts; a fifteenth-class twin or a shrinking
`ambiguousWithBuiltin`/`danglingEntityReference` split is the signal.
