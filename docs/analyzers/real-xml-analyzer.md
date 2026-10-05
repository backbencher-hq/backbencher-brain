# real-xml-analyzer.md

## Language and wiring

- Analyzer: `src/ast/real-xml-analyzer.ts`
- Parser: vendored `wasm/tree-sitter-xml.wasm`
- Grammar vocabulary verified against the production WASM: `document`,
  `element`, `STag`, `EmptyElemTag`, `Name`, `Attribute`, `AttValue`, `PI`,
  `PITarget`, `doctypedecl`, `ExternalID`, `SystemLiteral`, `elementdecl`,
  `AttlistDecl`, `AttDef`, `DefaultDecl`, `StringType`, and `PubidLiteral`.
- Wiring: `ASTEngine.parseFile` → `RealXmlAnalyzer`
- Detection: `.xml`, `.xsd`, and `.dtd` map to the XML analyzer; the parallel
  indexer includes all three extensions. `.xsd` is treated as XML because XML
  Schema is an XML vocabulary, not a separate parser.

The analyzer performs one iterative AST traversal. It never scans source text
for tags, names, attributes, DTD declarations, or processing instructions.
Values are read only from their grammar nodes (`AttValue`, `SystemLiteral`,
`PubidLiteral`) and normalized with bounded string operations.

## Symbol contract

| Construct | Symbol kind | AST extraction |
| --- | --- | --- |
| XML element | `class` | `element` → direct `STag`/`EmptyElemTag` → `Name` |
| XML attribute | `property` | `Attribute` → direct `Name` and `AttValue` |
| namespace declaration | `namespace` | `Attribute` whose `Name` is `xmlns` or starts with `xmlns:` |
| processing instruction | `module` | `PI` → `PITarget` (the XML declaration is skipped) |
| DOCTYPE declaration | `type` | `doctypedecl` → direct `Name` |
| DTD element declaration | `type` | `elementdecl` → direct `Name` |
| DTD attribute declaration | `property` | `AttlistDecl` → `AttDef` → `Name` |
| XML Schema construct | `class` | ordinary `element` symbol, with `isSchemaConstruct` metadata for known XSD vocabulary names |

Every symbol has an exact AST range, visibility, metadata node type, and stable
owner identity where an element is nested. XML has no function parameters,
return types, decorators, or exports, so those fields are intentionally absent
rather than synthesized.

### Declared names, not written prefixes

Qualified element names **do not** keep their prefix. An element in a namespace
the analyzer knows a declaration vocabulary for is published under the name it
**declares**, and the written `prefix:local` form is kept in metadata:

| written | declared name | namespace |
| --- | --- | --- |
| `xsd:element name="catalog"` | `catalog` | `…/2001/XMLSchema` |
| `xsl:template name="render"` | `render` | `…/1999/XSL/Transform` |
| `book:book` | `book` (a declaration) or the local name (not one) | `…/2001/XMLSchema-instance` is a known-vocabulary namespace; an ordinary `book:` prefix is not, and the local name is used |

This is not a rename for tidiness. The question the index has to answer is
"which component does this name refer to", and in a 2,439-file XSD corpus the
prefix is a property of the *file*, while the declared name is a property of the
*component*. `xs:element` is the same 30 times in `spring-context.xsd` and
`hibernate-mapping.xsd` and refers to a different component in each. Publishing
the prefix collapsed two components onto one identity.

`metadata.tagName` keeps the source form, `metadata.namespaceUri` the resolved
URI, and `metadata.isVocabDeclaration` together with `metadata.declaredName` and
`metadata.declarationKind` mark the symbols whose name came from a declaration
attribute. **Those key names are corrected here from measurement, and the first version
of this sentence named three keys the analyzer never emits.** It said
`metadata.writtenName`, `metadata.namespace` and `metadata.vocabNamespace`; the analyzer
emits `tagName` and `namespaceUri`, and has no `vocabNamespace` at all. A doc claim with no
code behind it is the same defect class this document already records for a `calls` edge
that was never emitted (§Integrity of the census, finding 2), and it survived here for the
same reason: nothing diffed the prose against the metadata object.

**And all three of the real keys are dropped before anything can consume them.** Measured
on `declaration-range-contains-its-members.xml`, same 15 symbols through both entries:

| `metadata` key | analyzer `analyze()` | production `parseFile()` |
| --- | ---: | ---: |
| `nodeType` | 15 | **15** |
| `namespaceUri` | 13 | 0 |
| `attributeName` | 9 | 0 |
| `isXmlAttribute` / `isXmlNamespace` / `namespacePrefix` / `value` | 9 each | 0 each |
| `isXmlElement` | 6 | 0 |
| `isSchemaConstruct` | 6 | 0 |
| `declaredName` / `declarationKind` / `declaredByAttribute` / `isVocabDeclaration` / `elementRange` | 4 each | 0 each |

`src/ast/pool-worker.ts:1020-1067` copies a closed list of metadata keys, and every key on
it was added by a CSS or markdown wave. `return Object.keys(out).length > 0 ? out : undefined`
means a lane with nothing on the list gets no metadata object at all. So the declared-name
mechanism this section describes is real in the analyzer and **invisible in the index**, and
`elementRange` — the field the M19 fix added "precisely so the structural span stays
available after the anchor moves to the name" — is one of the fourteen. Recorded as §8 item
7; it is not this lane's file.

Namespaces that are **not** declaration vocabularies are left alone: `book:book` with an
unrecognised prefix keeps `book:book`, because there is no declaration attribute to read a
better name from and inventing one would be a guess.

Namespaces are resolved ONCE per element and inherited through a scoped stack, so
a prefix bound on the root is visible to every descendant. Resolving per text node
loses root-level bindings for the majority of a real schema.

Syntax errors are retained by the engine as warning `ParseError` records. The
negative fixture demonstrates that malformed XML is not silently accepted or
turned into phantom recovery symbols.

## Relationship ontology

**A RULED-SOUND row is only worth the walk behind it, so the walk is now a number.**
The arbiter runs every instrument-B `countOnTree` over the admitted files and reports
only `occurrences` and `files`. A probe that visited nothing therefore reports 0
occurrences and is graded RULED-SOUND on a walk that never happened — and 0 is exactly
what a correct probe over an empty construct looks like, so the two are the same
number. `validation/m14/fixtures/xml/ruled-gate.ts` now patches the copied gate's B
loop to print, per probe, how many files the probe was actually invoked on, and
refuses to present any instrument-B verdict when that line is absent:

```
XML_B_PROBE_WALK uses    instrument=B:parse-tree-count walked=11464 unparsed=0 occurrences=0  hitFiles=0
XML_B_PROBE_WALK extends instrument=B:parse-tree-count walked=11464 unparsed=0 occurrences=1652 hitFiles=113
```

11,464 of 11,464 walked, 0 unparsed, so the `uses` 0 is a walked-and-empty 0 on the
whole admitted population and not a probe that failed to run. The block that used to
carry this check was worse than none: it was named `XML_OVERRIDES_EXAMINED`, it
described `XML_RULED`'s `overrides` entry, and **that entry had been deleted** when
the arbiter falsified the ruling — so it asserted a measurement of an object that did
not exist, and printed no number with which to make it. It is replaced by the line
above, which is emitted by the loop it describes. Two instrumentation defects were
found while building it and are recorded because both produced a confident wrong
number: the counters were globals that were never reset, so the second of two probes
over 1,143 files reported `walked=2286`; and `String.replace` reports nothing when
its needle is absent, so a patch that silently failed to apply would have left the
walk unmeasured and the run reporting verdicts it had not earned — the patch now
asserts its own effect on the staged copy and exits 2 if the instrumentation is not
in it.

Ten types, one verdict each. **The verdict column below is the ARBITER's, not this
lane's** — `script/m14/ontology-coverage-gate.ts` run against this lane's ruling
table over the **full admitted population — 11,464 files at the time of this round's
run, up from 11,456 earlier in the same round and 11,066 at the start of it**, every
git-tracked file the router hands to the XML analyzer, not a sample:

```
emitted 6/10   ruled-sound 4   FALSIFIED 0   ruled-without-justification 0
```

That gate exits 2 for `xml` because its `RULED_BY_LANG` is a literal with no
extension point, so these verdicts were uncheckable until
`script/m14/xml-ruled.ts` existed.
`validation/m14/fixtures/xml/ruled-gate.ts` applies the two-line wiring to a COPY
of the arbiter under `/tmp` and runs it, so the table is proven rather than
asserted. Resolution rates come from the census draw described below; the edge
counts come from the arbiter's own `parseFile` pass.

**Those counts are only quotable from a run that printed no `[BB-HANG]`, and that is
not a formality.** `src/ast/engine.ts:1442` calls `process.exit(1)` after 120 s on one
file. Over four runs of this corpus it named four different files, each preceded by a
`[BB-PARSE-ERR] … memory access out of bounds` on the same path. Where it fires
decides what a run is worth, and both positions occur:

| Where the hang fired | What printed | Measured |
| --- | --- | --- |
| before the verdict loop | no table at all | 4 workers |
| after the verdict loop | a **complete** table, **undercounted** | 2 workers |

The second row is the one to fear. `observed` accumulates from the worker pool, so a
worker killed mid-file contributes none of its edges while every other row still
prints — same corpus, same ten rows, same summary line:

```
contains     185,919   run that reported [BB-HANG]
contains     185,979   clean run of the same corpus          -60
references    10,405   run that reported [BB-HANG]
references    10,411   clean run of the same corpus           -6
```

The `references` figure in that block is the **pre-re-base** count. A clean
`BB_XML_WORKERS=1` run of the same 11,456-file corpus after the re-base prints
`references 11,094`, and this round's own run at the same worker count printed
`contains 185,957` against the 185,979 above — a corpus that grew while the round was
open, so the two columns are not comparable and neither is quoted as the current one.
What the block still establishes is unchanged and is the point of it: the hang costs
tens of edges on the two largest rows and marks nothing in the table.

### `countsAreDeterministic: true` was false, and the mechanism is named

The section above leaves three candidates for the `contains` drift and calls the cause
"not established". It is established now, and the candidate list is closed.

The census artifact carried `reproducibility.countsAreDeterministic: true`, measured over
four runs at the default worker count. Those four runs agreed. They could not have found
the fault, because four runs at ONE setting cannot detect a dependence on concurrency.
Two probes vary the thing four same-setting runs hold fixed.

**`validation/m14/fixtures/xml/worker-determinism-probe.mts`** — one fixed 600-file draw,
fingerprint `6ad7d4ddf1656e6f`, production `parseFile`, per-file counts comparable:

| workers | symbols | relationships | `contains` |
| ---: | ---: | ---: | ---: |
| 1 | 126,486 | 15,479 | 15,239 |
| 8 | 126,430 | 15,438 | 15,198 |
| **8**, re-run | **126,486** | **15,479** | **15,239** |
| 16 | 126,447 | 15,450 | 15,210 |
| **16**, re-run | **126,486** | **15,479** | **15,239** |
| 1 vs 8, on a 1,200-file draw | 230,021 both | — | 0 per-file differences |

The worker count is **not** the variable: the same worker count produced both outcomes, in
consecutive runs. What the worker count does is change how OFTEN the fault fires.

**`validation/m14/fixtures/xml/shared-parser-probe.mts`** — the same 48 files, 20 rounds,
sequential against 8-in-flight, in one process:

| schedule | symbols over all rounds | files that ever varied |
| --- | ---: | ---: |
| sequential | 223,400 | **0** |
| concurrent (8) | 221,087 | **5 of 48** |

Each losing result object, captured in full rather than inferred:

```
LOST Exposed/.idea/icon.svg:            success=true fallback=true errors=0 rels=0 size=2997
LOST Exposed/.idea/vcs.xml:             success=true fallback=true errors=0 rels=0 size=509
LOST Exposed/.idea/detekt.xml:          success=true fallback=true errors=0 rels=0 size=769
LOST Documenter.jl/docs/src/assets/logo.svg:  success=true fallback=true errors=0 rels=0 size=13463
LOST Documenter.jl/test/examples/images/big.svg: success=true fallback=true errors=0 rels=0 size=113087
```

`success: true`, `fallback: true`, `errors: 0`, **zero symbols**. `pool-worker.parseFile`'s
catch substituted `extractFallback` after the grammar load failed under WASM memory
pressure, and the structural extractor cannot read these files. The loss is silent by
construction: `filesFailed` does not move, `filesWithErrors` does not move, and the file
reads as one that simply declares nothing.

**Three properties of the fault that change how every number in this document is read.**

1. **The unit of loss is a FILE, not an edge.** So the error does not shrink as the sample
   grows — it grows with it. A 2,500-file draw does not make the counts more trustworthy;
   it is more exposure. `Documenter.jl/…/big.svg` alone is 2,209 symbols.
2. **Neither error marker detects it.** `[BB-PARSE-ERR]` and `[BB-HANG]` are both
   orthogonal to it: the run above printed `filesFailed 0`, `filesWithErrors 7`, and no
   marker of either kind. The `n=8` row in the table above is a *different* failure — it
   self-destructs and prints nothing — and this one prints a full, confident table.
3. **It is in shared code, so every lane's census on this machine is a lower bound.**
   `src/ast/engine.ts` `getParser` returns ONE cached `TSParser` per language to every
   concurrent caller and deletes it in two places (`cleanupParsers()` at
   `MAX_CONCURRENT_PARSERS = 20`, and the `currentCount >= 500` recreate).
   `web-tree-sitter`'s `parser.parse()` is async, so N holders of one instance interleave
   inside the WASM module. §8 item 3 carries the report; this lane does not edit that file.

**What the census does about it, rather than describing it.** Every run now records
`drawFingerprint` and `workers`, so a moved draw is separable from a moved count — the
conflation that let a stale artifact be published as current. Every run counts
`fallbackFiles` / `fallbackSymbols` / `fallbackRelationships` and prints the degraded
rows: the 2,500-file run published here lost **1** file,
`phpmyadmin/public/themes/bootstrap/img/dark/col-minus.svg`, 359 bytes, 0 symbols,
0 relationships. The claim a reader may make is narrowed to `instrumentA` and
`instrumentB`, which are byte-identical at workers 1, 8 and 16 — 78 distinct node types
over 981,491 nodes on the 600-file draw, and every probe's occurrence and file count
identical — and which are what the four RULED verdicts actually rest on. **No ruling in
§The five not emitted is affected by this withdrawal.**

**And the specific candidate this section could not previously choose between is chosen.**
`84970cf3d`'s 185,957 was published from a run that lost whole files to this fault. The
corpus-growth candidate is ruled out directly: `find $HOME/fixtures/repositories
-type f -newermt '2026-10-04 11:00'` returns **0 files**, so no corpus file content changed
between the publishing run and the re-measures, and `git diff 84970cf3d HEAD -- src/ast/`
is **empty**, so no analyzer state differs either. What differed was the run.

**And the arbiter's own runs vary, which is the strongest form of this evidence because
nobody chose the worker count there.** `script/m14/ontology-coverage-gate.ts xml` at its
built-in 8 workers, same commit, same corpus, five runs across this pass and the last:

| instrument | worker count | `contains` | `references` | `imports` | `extends` | `calls` | `overrides` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shared arbiter | 8 | 185,957 (published, `84970cf3d`) | 11,094 | 465 | 1,429 | 402 | 3 |
| shared arbiter | 8 | 186,149 | 11,094 | 465 | 1,429 | 402 | 3 |
| shared arbiter | 8 | **186,233** | 11,094 | 465 | 1,429 | 402 | 3 |
| `ruled-gate.ts` | 1 | 186,270 | 11,094 | 465 | 1,429 | 402 | 3 |
| `ruled-gate.ts` | 1 | 186,270 | 11,094 | 465 | 1,429 | 402 | 3 |

**Every other row is byte-identical across all five runs.** `contains` is the only one that
moves, and it is the only row whose per-file contribution is large enough for one lost file
to be visible in it — `contains` averages 16 edges per file across the admitted population,
so a single degraded file in a run of 11,464 moves it by tens, and a degraded SVG moves it
by hundreds. The 186,233 run also printed `[BB-HANG] parser stuck 120s on
…/fontawesome-free-5.15.2-web/svgs/solid/grip-vertical.svg` **after** the table, which is
the `bulma` vendor directory the 186,149 run named — the same family of large generated
SVGs, and the ones `shared-parser-probe.mts` caught losing 2,209 symbols in a single round.
`186,270` is quoted as this lane's number because it is the value two clean
single-worker runs agree on, and it is a **lower bound**, not a measurement of the corpus.

### `contains 185,957` did not reproduce, and the number published here is now 186,270

Commit `84970cf3d` published `contains 185,957` in four places. Re-measured on this
commit with the same instrument — `ruled-gate.ts`, `BB_XML_WORKERS=1`, the full admitted
population, exit 0, **0 `[BB-PARSE-ERR]`, 0 `[BB-HANG]`** — **two consecutive runs both
printed 186,270**, and every other row was byte-identical between them:

| run | admitted files | `contains` | `references` | `imports` | `extends` | `calls` | `overrides` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `84970cf3d`, as published | 11,464 | ~~185,957~~ | 11,094 | 465 | 1,429 | 402 | 3 |
| re-measure 1 | 11,464 | **186,270** | 11,094 | 465 | 1,429 | 402 | 3 |
| re-measure 2 | 11,473 | **186,270** | 11,094 | 465 | 1,429 | 402 | 3 |

The corpus grew by 9 files between re-measure 1 and re-measure 2 — another lane added a
repository to the shared corpus root mid-afternoon — and **no row moved**, so the two runs
are not measuring the same population and are still not interchangeable. They agree, and
the number they agree on is 313 higher than the published one.

**Why 185,957 was wrong is not established, and that is the honest limit of this
correction.** Three candidates, none measured:

- a partially-completed corpus walk on the publishing run that raised no `[BB-HANG]` and
  no `[BB-PARSE-ERR]` — the failure mode §Relationship ontology documents above is a
  SILENT undercount, and neither marker distinguishes it;
- an analyzer state between the two commits that differ in `contains` — `84970cf3d` is
  the `references` re-base and the diff touches owner-minting, so this is possible and
  was not checked;
- a third run, never recorded, that 185,957 was copied from.

What IS established: at this commit, on this corpus, with this instrument and no error
marker set, `contains` is 186,270 on two consecutive runs and 185,957 on none. The
struck-through figure is left in the table rather than deleted so a reader who has seen
it published can tell which number it was.

Nothing else in this document depends on the difference. `contains` was already
decomposed rather than quoted: the payload argument at §The payload argument below uses
it only as the reason the project graph is unchanged to the third digit, and 186,270 is
larger than 185,957, so the argument is unaffected.

Nothing inside the table marks the run as short. The table above is from a run at
`BB_XML_WORKERS=1` that exited 0 with no `[BB-HANG]`, and the runner now prints
`RUN WAS SHORT, COUNTS UNDERCOUNTED` beside the rows whenever one fires, so the
distinction cannot be read off a green-looking table.

**Re-measured this pass, the trigger is the worker count and not the file, which
retracts the grammar attribution in §8 item 3.** Two runs of the same runner over the
same 11,456-file corpus, differing only in `BB_XML_WORKERS`:

| `BB_XML_WORKERS` | `[BB-PARSE-ERR]` | `[BB-HANG]` | exit | table | `contains` | `references` |
| ---: | ---: | ---: | ---: | --- | ---: | ---: |
| **1** | 0 | 0 | 0 | full | 185,979 | 10,411 |
| **1**, re-run after the re-base on a grown corpus | 0 | 0 | 0 | full | ~~185,957~~ → **186,270** | **11,094** |
| **8** | 8 | 3 | 1 | **none** | — | — |

The middle row's `contains` cell carries two numbers because the first did not reproduce;
the section immediately above measures that. The n=1 row reproduces the committed table
exactly, so the numbers below stand. The
n=8 row is why: not one verdict is quotable from it. Every failing path is 459–1,254
bytes and the fault is unresolved between reentrancy on the engine's single cached
`TSParser` and host memory exhaustion — §8 item 3 carries both candidate mechanisms,
the 603-file probe that came back INCONCLUSIVE, and what would separate them.

| Type | Emitted? | Edges | Files | Both ends resolve | `confidence` < 0.7 |
| --- | --- | ---: | ---: | ---: | ---: |
| `contains` | yes — EMITTED | **186,270** | 10,847+ | **100.0 %** | 0 |
| `references` | yes — EMITTED | **11,094** | 391+ | **48.4 %** target / **100.0 %** source; **93.9 % of sources are names the file writes** (was 84.2 %) | 0 |
| `imports` | yes — EMITTED | **468** | 332 | 0.0 %, target is a file, by design; **468 of 468 edges have a site on the tree and 0 sites have no edge** (was 186 of 469 — the ledger's parser had died at document 8,513) | 0 |
| `calls` | yes — EMITTED (was GAP) | **402** | 76+ | **100 %**, and **100 % of sources are declared callers** | 0 |
| `extends` | yes — EMITTED (was GAP) | **1,429** | 113 | **31.3 %** both ends / **100.0 %** source | 0 |
| `overrides` | yes — EMITTED (was RULED — the corpus overturned it) | **3** | 3 | **100 %** | 0 |
| `uses` | no — not emitted. RULED-SOUND, instrument B, probe count **0** | 0 | 0 | — | — |
| `exports` | no — not emitted. RULED-SOUND, instrument A, 611 sites adjudicated | 0 | 0 | — | — |
| `implements` | no — not emitted. RULED-SOUND, instrument A, 5 sites adjudicated | 0 | 0 | — | — |
| `instantiates` | no — not emitted. RULED-SOUND, instrument A, probe counts **0** and **0** | 0 | 0 | — | — |

Per-type integrity and resolution detail, on a 2,500-file family-stratified draw,
114 repositories: `validation/m14/fixtures/xml/ontology-census.mts`, artifact
`validation/m14/fixtures/xml/ontology-census.json` — `contains` **77,882**,
`references` 7,415, `extends` 852, `imports` 261, `calls` 2, `overrides` 0 on this
draw, 86 distinct node types over 2,829,074 nodes, 1 file silently degraded.
The PRE-FIX artifact for the same draw is kept at
`…/ontology-census-overrides-gap.json` (`references` 6,750 before the source re-base,
`contains` 77,887) and carries a `superseded` block saying so; it also predates the
fallback accounting, so its totals are a lower bound of unknown depth.

**The second column is headed `Emitted?` so `script/m14/verify-doc-truth-emissions.ts`
can grade these claims, and doing so exposed a defect in that gate.** It reports
`UNDOCUMENTED [xml] contains (relationship)` — "analyzer emits `contains` and the
ontology table makes no checkable claim about it". That claim is false: the row is
line 94 of this file, directly under the header. The gate's `parseClaimTable`
skips the `---` rule with `if (isRuleRow(cs)) continue` and then *also* discards
the next row through `if (!started) { started = true; continue }`, so the first
data row of every claim table is silently dropped. Minimal repro, no repo needed:

```
| Relationship | Emitted? |
| --- | --- |
| `calls` | yes |
| `contains` | yes |
| `imports` | no |
```
`parseClaimTable` returns **2 rows, not 3**, and the missing one is `calls`.

**32 of the 48 analyzer docs lose their first claim row to this**, including xml's
`contains` — the most-emitted type in the lane. The gate is shared machinery
(§8), so this is reported rather than patched here. `contains` was deliberately
left in first position: reordering the table would move the defect onto a
different type and make this lane's table look clean while hiding the bug. The
other **9 rows are graded, and all 9 agree with the analyzer** — the 6 `yes` rows
against the 6 `RelationshipType.*` references in the source
(`Contains` 8, `References` 5, `Imports` 3, `Overrides` 1, `Extends` 1, `Calls` 1)
and the 4 `no` rows against the absence of `Uses`, `Exports`, `Implements` and
`Instantiates`.

Re-measured 2026-10-04 with `bun run script/m14/verify-doc-truth-emissions.ts` (it is
CJS and `__dirname` throws under `tsx`, so `bun` is the invocation): **42 UNDOCUMENTED
rows across 26 lanes**, and `UNDOCUMENTED [xml] contains` is still among them —
the defect is unchanged and the row it drops is unchanged. The 43 the earlier run
reported was 42 on the same day; the aggregate moves as other lanes land and is not this
lane's number to hold steady. Neither aggregate is 32, and the two counts are not the
same measurement: 32 is the number of DOCS whose first row this parser drops, and 42 is
the number of rows the gate currently reports, which also carries the
`import-site`/`export-site` payload-channel findings (csharp, elixir, erlang, …) that
are a different check.

What each type means **in this language**, which is not what it means in general:

| Relationship | Rule |
| --- | --- |
| `contains` | element → nested element; element → attribute/namespace; element → processing instruction when nested; DTD declaration → declaration |
| `imports` | DOCTYPE `ExternalID` system/public literal → external DTD path; `xsl:import`/`xsl:include` `href`; an XSD `schemaLocation` URI. **The target is a FILE**, which is the one case where a value is the right target |
| `references` | a QName-valued attribute resolved through a declared prefix → the component it names (`type`, `ref`, `itemType`, `substitutionGroup`, `xsi:type`, …); a RELAX NG `ref` `name`; an `xsl:apply-templates name=` dispatch; an `&entity;` use. The target is the LOCAL name |
| `calls` | `xsl:call-template name="T"` → the `xsl:template` that declares `T` |
| `extends` | XSD **type derivation**: `xs:extension base="T"` and `xs:restriction base="T"` → `T` |
| `overrides` | XSLT 1.0 **§5.5 competing template rules**: two `xsl:template` in one stylesheet carrying the same `match`, `mode` and `priority`, where the LATER declaration replaces the earlier. Source is the declaration that wins |
| `uses` | not emitted — see the ruling below |
| `implements`, `instantiates`, `exports` | not emitted — see the rulings below |
| imports array | external DTD `ExternalID` becomes an `ImportInfo` with `importType: xml-doctype` |

Every `contains` target is a symbol published by this analyzer — that is a hard
invariant, checked by a gate, because a `contains` edge pointing at a name that
is not a symbol is a graph that cannot be walked.

### `calls`: what the ontology was missing, and what it says

XSLT 1.0 §6 Named Templates, quoted: *"An xsl:call-template element **invokes a
template by name**; it has a required name attribute that identifies the template
to be invoked."* A named template is the only procedure the XML family has: it
takes parameters (§11.6), is invoked by name, and returns a result tree
fragment. The lane emitted this edge as `references`, on the written reasoning
that a call-template "names a template DECLARATION" — and that reasoning is wrong
about the word *invokes*. `calls` sat at **0 edges** over 191,251 relationships
while the language wrote the construct in one sentence of its own specification.

The census probe counted **1,528 `xsl:call-template` sites across 282 files**, of
which **754 name a template declared in the same stylesheet**. Those became 548
`calls` edges in 76 files, all `resolvable: in-document`, all resolving at both
ends, all `confidence: 1`.

Three numbers explain why 548 edges come from 754 sites and why that is more than
what was there before rather than fewer:

- **548 > 442.** Before the change the edge was `references xsl:call-template ->
  T`: the SOURCE was the instruction, so every call site in a stylesheet collapsed
  onto one edge per template name. Attributing the edge to the CALLER — the
  enclosing `xsl:template` — splits those apart, which is why the count rose by
  106 on a re-label. Those 106 edges were in the file and in neither the graph nor
  any count.
- **754 sites → 548 edges.** Edge identity is `source|type|target`, so a template
  that calls `inner` from three places writes one edge carrying
  `meta.occurrences: 3`.
- **774 sites refused.** Their target is declared in an `xsl:include`d or
  `xsl:import`ed stylesheet, which a per-file analyzer cannot read. The refusal
  costs a real edge and is recorded as declared debt rather than being papered
  over with a phantom symbol; the sites are countable in the census artifact.

Two rules around it, each pinned by fixture `xml/xslt-named-template-calls`:

- **A call's source is the caller, never the call site.** The first implementation
  emitted `calls xsl:call-template -> inner`, which names an instruction and
  answers "what does this template call" with nothing.
- **`xsl:apply-templates` is NOT a call and stays a `references` edge.** XSLT 1.0
  §5.4 gives `xsl:apply-templates` no `name` attribute at all, and §6 says the
  template's name "does not affect whether the template is invoked by an
  `xsl:apply-templates` element". A dispatch by pattern and mode is a reference.
  4,166 `apply-templates` sites in the corpus, of which 69 carry a `name` and
  produce an edge.

### `extends`: XSD type derivation, relabelled from `references`

XSD 1.0 Part 1 §3.4.2 defines both `<extension base = xs:QName>` and
`<restriction base = xs:QName>`, and documents `base` as **the qualified name of
the base type**. Part 1 calls the mechanism type DERIVATION throughout, and both
alternatives produce a subtype: `extension` keeps everything the base admits and
adds to it, `restriction` narrows the content model to a subset.

The lane's written ruling said the opposite — *"A `complexType` is not a subclass
of another, it REFERENCES one by `base` — and publishing that as `extends` would
be a category error"* (`script/m14/spec/xml-completeness.json`, `notApplicable`) —
and the measurement is what settled it. The construct the ruling assumed absent
is written by the specification, in the vocabulary's own name, in **111 corpus
files**: 1,114 `xs:extension` and 534 `xs:restriction` with a `base`, of which
1,240 carry a prefixed base and 408 a bare one. On the full admitted population
**1,615 of 1,652 derivation sites emit and 37 are refused**, all of the same class: a
prefixed base bound to a namespace the file neither declares nor imports, which points
at a name no file supports. An earlier version of this paragraph claimed "434 emit;
1,212 are refused"; both halves were wrong, and they were wrong in the direction that
hid a fabricated source — see the `extends` section below.

| `extends` | meaning | edges |
| --- | --- | ---: |
| `in-document` | the base is declared in this file; a target symbol is published | 185 |
| `builtin` | the base is an XSD built-in — `xs:string`, `xs:int`, … — so the derivation is true and publishes **no** symbol | 240 |
| `external` | the base is declared in a namespace this document imports, recorded in `importedFrom` | 9 |

`metadata.derivation` carries `"extension"` or `"restriction"` on every edge,
because the two narrow in opposite directions and a consumer asking "what does
`Code` extend" needs to know which. Resolution is 48.2 % at both ends, and that
is the correct figure rather than a defect: 240 of the 434 targets are
specification built-ins, which by the lane's existing ruling are never published
as local symbols.

`type=` was NOT relabelled. §3.4.2 defines `base` as the base *type*; `type` names
the type an element's **value** has, which is a different relation, and labelling
it `extends` would invent a supertype where the document states a value type.
Pinned by a forbid row.

**`extends` is the one emitted type with an independent oracle, and it agrees exactly.**
The `extends` entry in `script/m14/xml-ruled.ts` carries a `countOnTree` that counts
XSD derivation sites — an `<xs:extension>`/`<xs:restriction>` in the XSD namespace
carrying a non-empty `base` — without consulting the analyzer. Two measurements:

| Corpus | probe sites / files | analyzer edges / files |
| --- | --- | --- |
| FSharp.Data only, 29 admitted files | 4 sites / 2 files | 4 edges / 2 files |
| full admitted population, 11,464 files | 1,652 sites / 113 files | **1,429 edges / 113 files** |

The file counts match to the file at both scales (2 = 2, 113 = 113). **The edge counts do
not match, and 1,429 against 1,652 is now explained by measurement rather than by
argument.** `validation/m14/fixtures/xml/derivation-accounting.mts` classifies every
derivation site on the tree and matches it against the edges production `parseFile`
actually emitted:

| class | sites | what it is |
| --- | ---: | --- |
| `A-covered` | **1,615** | the site's own `(owner, derivation, base)` triple is in the graph |
| `I-anonymous-owner` | 0 | no named ancestor to be the source |
| `E-bare-nonvocabulary` | 0 | — |
| `F-prefixed-unimported` | **37** | `base="j2ee:string"`, prefix bound to a namespace this file never imports |
| `G-prefixed-unbound` | 0 | — |
| `H-bare-undeclared` | 0 | — |

1,615 sites are covered and **37 are refused, all one class**, so 1,652 − 37 = 1,615 and
the residual against 1,429 published edges is 186 collapses: sites in one file that share
a `(source, kind, target)` triple, which `addRelationship` folds and counts in
`metadata.occurrences`. **Edges with no derivation site behind them: 0.**

The previous version of this section explained the same gap the other way — "1,212 of the
1,652 sites are refused by the binding rules". That was wrong, and it was wrong in the
direction that flattered the analyzer: only 37 sites are refused. The real reason 438
edges covered 1,615 sites was the defect below.

**The probe was added to close a false verdict, not to find one.** Running the arbiter
with the corpus root pointed at a single repository (`BB_CORPUS_ROOT`, libxslt, 1,143
admitted files) drops `extends` to 0 emitted edges, and the gate then ruled it on the
wrong decision:

```
extends  RULED-SOUND  NOT EMITTED; the construct occurs 0x on the parse tree.
                    Written ruling: …/script/m14/spec/xml-completeness.json#XML-ONTOLOGY-IMPLEMENTS
```

`XML-ONTOLOGY-IMPLEMENTS` is the decision about `implements`. The gate's spec fallback
(`rulingFor`) picks a ruling by testing whether a decision's prose **mentions** the
type — ``new RegExp(`\\b${t}\\b`)`` over `dec.resolution` — and that resolution
describes "an implements/extends clause", so the word `extends` is in it. A 0 was
graded RULED-SOUND on a decision written about a different type, citing that other
decision, so the citation cannot be checked. The `extends` entry now sits in the
lane's own table, which `rulingFor` consults **first** and matches by exact type, so
the verdict on the same corpus reads `script/m14/xml-ruled.ts (RULED_BY_LANG.xml)`.
Measured exposure of the same mechanism across the types this lane emits, by testing
every RULED decision's prose for each type name:

| Emitted type | Prose-matched by | Verdict it would get with 0 emitted edges |
| --- | --- | --- |
| `contains` | EXTENDS, EXPORTS, INSTANTIATES | wrong decision, 3 candidates |
| `references` | USES, INSTANTIATES | wrong decision, 2 candidates |
| `imports` | USES | wrong decision |
| `extends` | EXTENDS (now exact), IMPLEMENTS | now correct |
| `calls` | nothing | RULED-UNJUSTIFIED (correct) |
| `overrides` | nothing | RULED-UNJUSTIFIED (correct) |

Four of six were reachable. `calls` and `overrides` are correct only because no ruling
in this lane happens to use their names — luck, not design. The gate's mechanism is
supervisor-owned and is reported, not patched; the one-line shape of the fix is in §8.

### `extends` had a fabricated source on 100 % of its edges, and the fix is 3.26× more edges

`extends` relates two **types**. XSD writes type derivation as a `base=` attribute on an
inline `<xs:extension>`/`<xs:restriction>` (XSD 1.0 Part 1 §3.4.2), and that element
carries no `name` of its own — it is a type **constructor**, not a named entity.

The analyzer took an attribute's owner to be the element the attribute sits on, which is
right for `type=` (`<xs:element name="x" type="T">` really does give `x` the type `T`) and
wrong for `base=`. `symbolName = declaredName ?? name` therefore fell back to the **tag
text**, and every derivation edge came out named after the schema vocabulary's own word
for a constructor. From `FSharp.Data/docs/data/po.xsd`:

```xml
<xs:simpleType name="SKU">
 <xs:restriction base="xs:string">              emitted:  "xs:restriction" -> "string"
<xs:element name="quantity">
 <xs:simpleType>
  <xs:restriction base="xs:positiveInteger">    emitted:  "xs:restriction" -> "positiveInteger"
```

Measured over the full admitted corpus by
`validation/m14/fixtures/xml/derivation-accounting.mts`:

| | before | after |
| --- | ---: | ---: |
| `extends` edges | 438 | **1,429** |
| sources that are a name the document **declares** | **0** | **1,429** |
| sources that are an XSD constructor tag | **438 (100 %)** | **0** |
| sites with their own edge triple (`A-covered`) | 0 | **1,615** |
| edges with no derivation site behind them | 0 | 0 |

A symbol named `xs:restriction` was published so the edges would have somewhere to hang,
and every one of the 438 edges shared it. This is the fabrication the lane brief calls the
most expensive mistake available: `bb_graph`, `bb_impact` and `bb_migrate` presented one
invented type as the source of the lane's entire subtype relation. The previous fixture
asserted it — `from: "xs:extension"` was a pinned expectation, annotated as "the extends
edge's source is an anonymous inline element" with the real type "reachable via `bb_graph`
owner-cascade". Owner-cascade attributes **member** rows to an owner class; `xs:restriction`
is not a member of `Derived` in that sense, so the annotation described a recovery path
rather than a correct endpoint.

**The fix.** The walk now threads `nearestNamedSchemaOwner` — the nearest ancestor in a
declaration vocabulary that carries a `name` — and `base=` uses it. There is deliberately
no fallback to the old owner: both fallbacks can hold a vocabulary tag, and `undefined` is
the honest value because `addRelationship` already refuses a falsy source. Corpus
measurement: **0 sites fall in `I-anonymous-owner`**, so that fallback is never wanted.

Two implementation facts are recorded because both produced a *silent* wrong answer rather
than a visible failure:

- The thread must be propagated at the **generic** `work.push` (the tail every non-`element`
  node takes), not only at the element branch. An XSD element's children live under a
  `content` node, so threading only the element branch left every real derivation with
  `owner=""` and silently dropped **all 438 edges** rather than mislabelling them. A fix
  that turns a wrong answer into no answer is quieter, not safer.
- Reading the edge endpoints needs `relationship.source` / `relationship.target`. The
  fields are not `from`/`to`, and reading the absent names yields `undefined -> undefined`
  on every edge — a fabricated-looking result produced purely by reading fields that do
  not exist.

#### Both-ends resolution went DOWN, and that is the correct outcome

| | before | after |
| --- | ---: | ---: |
| source resolves | **0 %** | **100.0 %** |
| both ends resolve | 40.1 % | 31.3 % |

Split by the analyzer's own `resolvable` class, over 1,429 edges:

| `resolvable` | edges | source declared in file | target declared in file |
| --- | ---: | ---: | ---: |
| `in-document` | 623 | **100.0 %** | **100.0 %** |
| `builtin` | 622 | **100.0 %** | 5.8 % |
| `external` | 184 | **100.0 %** | 0.0 % |

Every class resolves its source at 100 %. The both-ends figure falls because **56.4 % of
derivations target a type this document cannot declare** — 622 bases are XSD Part 2
built-ins and 184 arrive from an imported namespace. Those are real, declared types; the
analyzer publishes no symbol for them, because inventing `string` as a declaration of this
document is the M60.R10 fabrication the reference pass already refuses. Before the fix the
source "resolved" only because the analyzer had minted a symbol for its own fabrication.

**This is a case where a naive metric got worse while the graph got better**, recorded as
such because the pull is to revert a fix that a dashboard punishes. The `in-document`
class — the only one where both ends can name a declaration in the same file — resolves
at 100.0 % / 100.0 %.

**Regression coverage.** The wrong edge is pinned as a `forbidRelationships` row in
`xml/declared-name-xsd` and `xml/xsd-type-derivation`, because the wrong edge is the one
that must never return; a forbid catches a revert that an expectation row rewritten to the
new value would not. `xml/extends-source-is-the-derivation-constructor` in
`validation/m14/fixtures/xml/ontology-mutants.mts` rewrites each `extends` source back to
its constructor and is caught. Verified by reverting the fix in the analyzer: 23/23
fixtures pass with it, 21/23 without, and the failure is the forbidden edge.

#### The same fabrication was in `calls`, on 90.3 % of its edges, and `calls` hid it at 100 % resolution

Having found the `extends` defect by asking whether an edge's **source** is a name the
document declares, the obvious next move was to ask the same question of every other
emitted type. `calls` was the one to ask first: it is the type the lane brief holds up as
the counterexample to "a high firing score is correctness" (powershell published a
wildcard as a symbol name), and it resolves at **100 % at both ends** on every corpus
draw.

| | before | after |
| --- | ---: | ---: |
| `calls` edges | 548 | **402** |
| source is a name the stylesheet **declares** | 53 (9.7 %) | **402 (100 %)** |
| source is an XSLT vocabulary tag | 201 | **0** |
| source is an unrelated bare tag (`p`, `pre`, `td`) | 294 | **0** |

The mechanism was `elementOwnerName`, documented as "the owner of the element carrying
the attribute — one level further out". One level out is not far enough: a
`<xsl:call-template>` inside `<xsl:for-each>` made the **caller** `xsl:for-each`, and
inside `<xsl:if>` it made it `xsl:if`. From `libxslt/doc/EXSLT/devhelp/html.xsl`:

```
"xsl:template" -> "dumptext"      "xsl:for-each" -> "dumptext"      "p" -> "dumptext"
```

**Why 100 % resolution could not see it.** The analyzer mints a symbol for whatever name
an edge needs, so `xsl:for-each` resolved perfectly — to a symbol it had invented for the
purpose. A resolution metric measures whether a name is in the symbol table; it cannot
measure whether the name was *earned*. This is the sharpest instance on this lane of the
brief's warning that firing is necessary and not sufficient: `calls` looked like the
healthiest type in the table on every metric available and 90.3 % of it was fiction.

**The fix** is the same mechanism `extends` was given: `calls` now uses
`nearestNamedDeclaration`, the nearest ancestor that declares a name in a vocabulary. A
`<xsl:variable name="seed">` body is an instruction sequence and §6 makes the sequence the
caller, so a variable **is** a legitimate caller and is published as `seed`; a call at
stylesheet top level is not executable per §2.4 and yields **no edge**. The 146 dropped
edges are exactly those with no named enclosing declaration.

**A fixture that passed unchanged against this defect is why the fixture exists.**
`xml/xslt-named-template-calls` pins three `calls` sources — `outer`, `inner`, `loop` —
and it passed before and after the fix, because all three calls sit **directly** inside
`<xsl:template name=...>`, the one shape where "one level out" already gave the right
answer. Reverting the fix fails only the new
`xml/xslt-call-source-through-inline-body` (23/24) while the older fixture still passes,
which is the proof that the older one could not see the defect. The new fixture pins five
callers: through `xsl:for-each`, through `xsl:if`, inside a variable body, directly in a
named template, and at top level where no edge may exist. Each of the five fails a
different over-correction, and the variable row is the one that stops the fix collapsing
into "nearest enclosing **template** only".

`xml/calls-source-is-a-vocabulary-tag` is the mutant, and it is labelled a **proxy**: a
transform over the analyzer's output cannot recover which enclosing element the old code
would have picked. The exact replay is the analyzer-level revert above. The shared
harness is supervisor-owned (§8), so both new mutants live in this lane's
`ontology-mutants.mts` — **14/14 caught, 0 survivors**.

**The 146 dropped edges are counted, not argued.** A rationale for a drop is not a count,
so the same site ledger `extends` was given is run over `calls`: every
`xsl:call-template` carrying a `name` on the parse tree, classified by the two refusals
that fail independently.

| class | sites | why |
| --- | ---: | --- |
| `no-named-caller` | **791** | no named template/variable above it. XSLT 1.0 §2.4 puts no instruction sequence at stylesheet top level, so there is no caller to name. |
| `covered-callee-undeclared` | **256** | the callee is not an `xsl:template` this file declares (`src/ast/real-xml-analyzer.ts:1700`). An `xsl:include` could supply it, which from inside one file is indistinguishable from a missing declaration. |
| `covered-callee-declared` | **481** | accepted |
| **total sites** | **1,528** | |

**481 accepted sites against 402 published edges and `sum(metadata.occurrences)` = 481 —
0 unrepresented.** The 79-edge difference is same-file collapse on the `(source, type,
target)` triple, counted rather than lost. This closes the `calls` ledger the way
`edgesWithNoSiteBehindThem = 0` closes the `extends` one.

Three probe defects were found and fixed while building that ledger, each of which had
produced a confident wrong number, and each recorded at the point of the fix:

- `nearestCaller` was a **closure variable mutated inside the element branch**, so a named
  template leaked its name to its **siblings**. That reported 1,509 covered sites against
  481 occurrences — a 1,028-site "shortfall" that was entirely the probe's own scoping.
- Template names were pooled with `variable`/`param`/`function` names, but the analyzer's
  test is `declaredTemplateNames.has(name)` and that set holds only `xsl:template` names.
  The off-by-one it produced was the probe calling a **variable** a declared callee.
- Two temporal-dead-zone crashes, `declaredByFile` and `callsByFile` declared below the
  phases that write them. A probe that dies on its own plumbing teaches nothing about the
  language.

### `references` had the same defect on 1,066 of 10,411 edges, and it is now FIXED

The source-authenticity question was put to all three types that resolve below 100 %.
`references` had it too, at a third the rate:

| class | before | after | change |
| --- | ---: | ---: | ---: |
| source is a name the file writes on some `name=` | 8,771 | 10,413 | +1,642 |
| source is a **vocabulary tag** | **1,066** | **111** | **−955 (−89.6 %)** |
| undeclared (reported, not judged) | 574 | 570 | −4 |
| total `references` edges | 10,411 | 11,094 | +683 |

Both columns are `validation/m14/fixtures/xml/derivation-accounting.mts` over the same
draw, one with the fix and one with `src/ast/real-xml-analyzer.ts` stashed. From
`FSharp.Data/docs/data/po.xsd`, the edge that was wrong:

```
BEFORE  "xs:element"           -> "comment"   (role=attribute_qname_reference)
AFTER   "PurchaseOrderType"    -> "comment"   (role=attribute_qname_reference)
```

`<xs:element ref="comment" minOccurs="0"/>` sits inside `<xs:complexType
name="PurchaseOrderType">`. The `ref` is a reference made **by that type's content model**,
so the source is `PurchaseOrderType`; the analyzer published `xs:element`, the anonymous
constructor's own tag. Same mechanism, third type: `438/438` for `extends`, `495/548` for
`calls`, `1,066/10,411` for `references`.

#### The round that reported this without fixing it, and what it got wrong

The previous round left it unfixed on a stated ground: *"is this `name` a declaration or a
reference?" has no general answer in XML*, because for `references` the carrier can be any
element in any vocabulary. That question was never the one to ask. `DECLARATION_VOCABULARIES`
already answers it — it is what makes `<xs:element name="e">` a declaration and
`<xs:element ref="c">` a reference — and the walk already computed the answer that was
missing, `nearestNamedDeclaration`, for `base=`. The question that had no general answer
was *"who is the source when the carrier has no name"*, and there the answer had been
computed and discarded.

It also rejected a shortcut correctly. "The owner is the nearest ancestor-or-self carrying
a `name`" is wrong for exactly the constructs that make `references` interesting, and
wrong in the direction that fabricates: `<xsl:with-param name="select">` carries a
**parameter** name, so an unconditional walk-up attributes the reference to whatever
ancestor is named `select`. That reasoning stands, and it is why the rule is two branches
rather than one:

```
self declared      the carrier HAS a name of its own, so the reference belongs to THAT
                   declaration. `<xs:element name="e" type="T"/>` is `e -> T`, and this
                   branch leaves those edges exactly as they were.
nearest, else tag  the carrier has NO name, so the declarer is the nearest named
                   ancestor. Falls back to the enclosing element when there is none.
```

The fallback is the difference between this and the `extends` fix, which has **no**
fallback and refuses instead. `references` is emitted for carriers in every vocabulary —
Spring, SVG, WSDL, DocBook, arbitrary application XML — and most have no named schema
ancestor, so refusing would delete real edges rather than re-base them. The fallback
cannot fabricate: it is the value that was there before, so the most it can do is preserve
the old defect class. `xml/references-source-is-the-declarer` pins all three arms.

#### The residual 111 are sites the language gives no name to

They are not 111 more of the same bug, and the difference is measurable rather than
asserted. Broken down by the role that carried the edge:

| role | edges |
| --- | ---: |
| `entity_reference` | 85 |
| `xslt_named_template_reference` | 22 |
| `attribute_qname_reference` | 4 |

Every one of them is a site with **no named declaration in scope**, so there is no declarer
to name. XSLT 1.0 §5.4 gives a template dispatched by `match=` no `name` attribute at all,
so `<xsl:if>&gt;</xsl:if>` inside `<xsl:template match="/">` — verbatim from
`dbeaver/…/siteTemplate/web/site.xsl:12` — has nothing above it that any document declares.
The fix raised the fraction of correctly-sourced edges from 89.8 % to 99.0 % and the
remainder is a property of the language at those sites, not of the rule.

#### Payload

`references` grew 10,411 → 11,094 (+683, **+6.6 %**), and it is the highest-volume type in
the lane, so the delta is a payload claim and not a rounding remark. The growth is
**un-collapsing**, not invention: edge identity is `(source, type, target)`, so before the
fix every `<xs:element ref="comment"/>` in a file was one edge from the single source
`xs:element`, and a hundred `ref=` sites across a schema set could only produce as many
edges as it had distinct targets. After the fix each declaring type contributes its own
edge. Every added edge has a source the file writes down — `declared-in-file` rose by
1,642 while `vocabulary-tag` fell by 955 and `undeclared` by 4, so nothing new appeared
that no file supports.

Resolution went **down** as a ratio and that is the arithmetic of the same change, not a
regression: `resolvedSource` was 6,750 of 6,750 before and 7,415 of 7,415 after — the
fabricated sources resolved perfectly, which is why the probe asks the source directly
rather than trusting a resolution rate. `resolvedTarget` rose 3,312 → 3,591, and the
denominator rose further, so both-ends went 49.1 % → 48.4 %. The `external` resolvability
class nearly doubled (375 → 738) for the same reason: distinct declarers make distinct
edges to the same imported names. No budgeted lane regressed; the lane's share of a
project graph is unchanged to the third digit because `contains` (186,270 edges) is two
orders of magnitude larger.

### The five not emitted, each with its instrument, probe and overturn condition

`contains` is the only type whose target is guaranteed to be a symbol. For the
rest, the resolution rate above is the honest one: a `references` target may be a
built-in, a name in another file, or a name this file does not satisfy, and
`metadata.resolvable` tells the three apart.

| `resolvable` on `references` | meaning | edges | share |
| --- | --- | ---: | ---: |
| `in-document` | declared in this file; the target is a symbol this analyzer published | 4,666 | 45.2 % |
| `builtin` | an XML/XSD built-in type | 5,266 | 51.0 % |
| `external` | declared in a file this document imports; the edge records WHICH file in `importedFrom` | 375 | 3.6 % |
| `unresolved` | a **real** reference this file does not satisfy — satisfied only by an `xs:include`, which a per-file analyzer cannot see | 24 | 0.2 % |

#### `uses` — RULED, instrument B, probe count **0**

The only construct in the XML family that adopts a named definition without
merely naming it is XSLT `xsl:use-attribute-sets` (§7.1.4) and, in XSLT 2.0,
`xsl:use-package`. **Probe: count `element` nodes whose local name is
`use-attribute-sets` or `use-package` in the XSLT namespace. Result: 0
occurrences across 0 files, over 11,066 files including all 583 XSL/XSLT files of
libxslt.** A non-zero count overturns the ruling. Instrument A agrees: the
grammar produced 95 distinct node types (64 named, 31 anonymous tokens) over
5,444,635 nodes and none of them is a use-construct.

Every other candidate is already an edge under its own label, which is why a `uses`
edge would be a duplicate rather than a gain: `type="T"` on an element, `&e;` on an
entity use, `rng:ref name="P"`, and `xsl:apply-templates name="T"` are all
`references`, and the lane's X13 ruling records why a bare value whose owner is in
a declaration vocabulary is emitted as `unresolved` rather than dropped.

#### `instantiates` — RULED, instruments A and B, probe counts **0** and **0**

Instantiation is the construction of an instance of a declared construct, and XML
has no constructor syntax: every construct in the vocabulary is a declaration or a
reference to one. **Instrument A: node types that would express it —
`new_expression`, `object_creation_expression`, `constructor_invocation`,
`constructor_declaration` — are all absent from the 64 named types the grammar
produced. Instrument B: probe for `element` nodes named `new`, `instantiate`,
`newinstance` or `create`. Result: 0 occurrences across 0 files.** A non-zero
count on either probe overturns the ruling.

The closest real construct is `<xs:element name="x" type="tns:T"/>`, which names
the type of a value and is a `references` edge — measured at 9,527
`attribute_qname_reference` edges after the relabel.

#### `implements` — RULED, instruments A and B, probe count **307 adjudicated to 0**

`implements` requires a declared interface and a type that obliges itself to it.
No XML vocabulary has either. **Instrument A: node types expressing an
interface or supertype obligation — `implements_clause`, `interface_declaration`,
`superclass`, `abstract_class` — are absent from the 64 named types.**

**Instrument B: probe for `element` nodes named `implements`, `extends`,
`interface`, `implementsinterface` or `abstract`. Result: 307 occurrences in 20
files. Every one is adjudicated, and the adjudication is the finding rather than a
dismissal:**

| local name | occurrences | files | what it is |
| --- | ---: | ---: | --- |
| `interface` | 261 | 2 | **Wayland protocol XML** (`ghostty/src/apprt/gtk/winproto/wayland/protocols/*.xml`) — `<interface name="…">` **declarations** produced by `wayland-scanner` |
| `abstract` | 46 | 18 | **DocBook prose sections** in libxslt's tutorial and test documents |

So: 307 hits, **0 of which is an implementation clause**. A Wayland `<interface>`
*declares* an interface and nothing implements it; a DocBook `<abstract>` is a
paragraph of documentation. A non-zero count of an element carrying an
implementation clause — not a declaration of one — overturns the ruling.

**Second finding from the same 261 sites, owed and not fixed here:** the Wayland
protocol vocabulary is not in `DECLARATION_VOCABULARIES`, so 261 interface
declarations are published under their tag name rather than the `name` attribute
they carry. That is the declared-name recall gap X1 fixed for XSD, in a vocabulary
nobody had listed. It is a recall gap, not a correctness one, and adding the
vocabulary is a change to a shared table with 261 corpus sites of blast radius —
recorded as owed rather than done in passing.

#### `overrides` — was RULED, the corpus overturned it, and the type is EMITTED

**This section previously ruled the type inapplicable per file. That ruling was
wrong, and the arbiter said so.** It is kept below in the form it took, because a
reader comparing this doc against an older one needs to see the claim change and
why — and because the reasoning error is the interesting part.

**The old ruling.** "A same-file template pair with equal match/mode/priority is
an **error with a defined recovery**, and §6 makes the same statement for names.
Emitting `overrides` here would label a conformance error as an inheritance
relation."

**Why that is wrong.** §5.5 does not merely permit a processor to recover — it
says what the recovery *is*: *"if it does not signal the error, it must recover by
choosing … the one that occurs last in the stylesheet."* Choosing the last rule
**is** the later declaration replacing the earlier one. That is the definition of
`overrides` in every other lane's terms (the gate's own bash ruling: "a SECOND
declaration of a name already declared in the same file — it replaces the prior
one"). Calling the recovery "not an inheritance relation" while emitting nothing
drew the graph's conclusion from the word *error* rather than from the semantics
the spec gives the error.

**What the measurement said.**
`script/m14/ontology-coverage-gate.ts`, run against this lane's table over the
full 11,456-file admitted population:

```
overrides  FALSIFIED  NOT EMITTED, but the construct occurs 3x across 3 file(s)
                       on the PARSE TREE — it is derivable, so the ruling is wrong.
                       e.g. libxslt/tests/docbook/fo/toc.xsl: 2 xsl:template
                       competing at match|*|toc.for.section| (lines 180,190)
```

`libxslt/tests/docbook/fo/toc.xsl` declares
`<xsl:template match="*" mode="toc.for.section">` at line 180 and again at line
190. Same pattern, same mode, same (absent) priority, one stylesheet. The second
runs. Three sites in three files:
`libxslt/tests/docbook/fo/toc.xsl`, `libxslt/tests/docbook/html/toc.xsl` and one
more the gate counts but does not name.

**What is emitted.** Role `xslt_competing_template_rule`, `confidence: 1`,
`evidenceClass: structural`, `metadata.derivation:
"xslt-5.5-later-template-replaces-earlier"`, plus `templateMatch` /
`templateMode` / `templatePriority` so a consumer can re-derive the collision
instead of trusting the edge. **Source is the declaration that wins.**

**The endpoint problem, and why the derived names are safe.** A match-based
template has no `name`, so this analyzer gives it the TAG name `xsl:template` —
which means every match-based template in a stylesheet is one symbol, and two
declarations that replace one another cannot be told apart. A colliding template
therefore publishes a derived identity:

```
xsl:template[match=<pattern>|mode=<mode>|priority=<priority>]#<n>
```

Two properties make that safe rather than inventive. **It is disjoint from every
name a document can declare**: `[`, `]`, `|`, `=` and `@` are not NCName
characters (XML 1.0 §2.3 — `NameChar` excludes all of them), so no
`xsl:template name="…"` and no declared name in any vocabulary can equal it, and a
derived identity can never shadow or merge with a real one. **It is published only
for templates that actually collide**, so the corpus cost is 4 rows in 11,456
files rather than one per match-based template. The `#<n>` occurrence index is
required and not decoration: the triple is by construction IDENTICAL for the two
declarations, so an identity built from it alone would make both endpoints one
name and the edge a self-edge.

**Direction.** Source = later declaration, target = the one it replaced. The
reverse edge would say the first rule took the second's place, which is the
opposite of what a processor does; a graph carrying both directions would make
every override look mutual. Both directions are pinned as forbids in
`xml/xslt-competing-template-overrides`.

**Cross-file overrides remain out of reach, and that is a boundary rather than an
absence.** §2.6.2 is explicit that an importing stylesheet's definitions "take
precedence over template rules and definitions in the imported stylesheet", and
§5.6 exists so the overridden rule stays reachable via `xsl:apply-imports`. Those
endpoints live in two different files: 234 include/import/redeclare elements over
94 files in the census draw (128 `xs:include`, 105 `xsl:import`, 1 `xsl:redefine`),
each already an `imports` edge carrying the file it pulls in, so the stylesheet
that brings the overriding rule is recorded as the dependency that brings it.
Emitting the override itself needs a project-level pass. **Declared, not ruled.**

**A defect this lane's own instrument had, which the arbiter exposed.** The
ruling above stood on a probe named `same-file-template-override`, and when the
arbiter asked the same question the probe was found to be wrong. It keyed on
`match|mode|priority` and **ignored `name`**, so every name-only template reduced
to the key `||`: 9 legal named templates read as collisions —
`name="dumptext"` (l.26), `name="generate_general"` (l.498), `name="generate_index"`
(l.539) in each of libxslt's two `html.xsl`, and `name='transformCALSCell'`
(l.121), `name='findInheritedAttribute'` (l.216),
`name='transformInheritedAttribute'` (l.310) in powershell's
`Maml_HTML_Style.xsl`. Verified by hand; none has a `match`, because a named
template is INVOKED by `xsl:call-template` and never competes for a node. The
probe also held `templateKeys` at module scope and reassigned it per file inside
4 concurrent workers, so one worker's reset can land inside another's file — a
race that can both invent collisions and lose them.

Both defects are fixed in `validation/m14/fixtures/xml/ontology-census.mts`, which
now reports the two keys **side by side** so the size of the error is a number in
the artifact rather than a claim in a commit message:

| probe | occurrences | files |
| --- | ---: | ---: |
| `competing-template-rule` (corrected) | **0** | 0 |
| `name-only-template-key-artifact` (the defect, kept) | **3** | 3 |

and the corrected standalone probe is
`validation/m14/fixtures/xml/overrides-probe.mts`, which measures 128
`xsl:template` in the draw — 119 carrying a `match` and therefore able to
compete, 9 name-only — and **0** competing groups. The 3 real sites are outside
this draw, which is why only the full-population arbiter sees them.

#### `exports` — RULED, probe count **620 adjudicated to 0**

**Probe: `element` nodes whose local name contains `export`, or equals `expose` or
`publish`. Result: 620 occurrences in 8 files.** All 620 are named:

| local name | occurrences | files | what it is |
| --- | ---: | ---: | --- |
| `exports` | 610 | 2 | **gtk-doc API descriptions** — `libxslt/doc/libxslt-api.xml` and `libxslt/doc/EXSLT/libexslt-api.xml`, each spelling `<exports symbol='xsltApplyAttributeSet' type='function'/>` for a **C** library |
| `exportFormat` | 5 | 1 | an Eclipse `plugin.xml` extension declaration |
| `pma_xml_export` | 4 | 3 | an attribute name on other Eclipse plugins |
| `exportedmodules` | 1 | 1 | a Doxygen configuration file |

**0 of them is an XML-family vocabulary element.** No XML, XSD, XSLT, RELAX NG,
WSDL or DTD specification defines an element that publishes a name as part of a
document's public interface, and the 610 that look closest are a **documentation
convention for a C library**, in a dialect with no namespace to key a vocabulary
on and a source element (`<file name='attributes'>`) whose name would be published
under its tag — so every edge from it would collapse onto one source name.

The refusal is recorded as visible debt rather than as absence, and the project
precedent points the same way: the json lane's `exports` ruling was **removed**
from the gate's table because a grammar cannot see a convention, and the type was
implemented instead. **Overturn condition:** a corpus file in an XML vocabulary
whose specification defines an export or public-interface meaning for an element,
other than a documentation dialect for another language. That is a semantic
judgement about a dialect, so it is stated as one and not dressed as a count.

### Are these five rulings actually falsifiable? A self-audit against the bar

The standard applied here is the one the round brief sets: **a ruling whose overturn
condition cannot be satisfied by a correct implementation is decorative.** A condition
that only a WRONG implementation could meet is the worst case — it can never fire, so it
never tests anything while appearing to. Each of the five entries in
`script/m14/xml-ruled.ts` was re-read against that bar, and the result is not uniform, so
it is reported per entry rather than as one verdict.

| type | instrument | what would satisfy the overturn condition | verdict |
| --- | --- | --- | --- |
| `uses` | B | a non-zero count of `xsl:use-attribute-sets` / `xsl:use-package` on the parse tree | **falsifiable, and reachable by analyzer work** — a complete implementation emits `uses` for these, `observed.n > 0`, and the entry is never consulted |
| `extends` | B | a derivation site on the tree in a corpus where the analyzer emits 0 `extends` | **falsifiable** — and the entry exists to catch exactly this, which is how it caught the real misattribution |
| `exports` | A | one of 7 named node types, or any node type containing `export`, at non-zero count | **falsifiable but NOT reachable by analyzer work** — see below |
| `implements` | A | one of 5 named node types, or a vocabulary element whose semantics are interface satisfaction | **falsifiable, partly** — the count clause is mechanical, the semantics clause is a human judgement |
| `instantiates` | A | one of 5 named node types, or any node type containing `new` / `instantiat` | **falsifiable but NOT reachable by analyzer work** |

**The limitation this exposes, stated rather than smoothed over: the three
instrument-A conditions cannot be met by improving this analyzer at all.** They are
conditions on the GRAMMAR, not on the code. No correct, complete XML analyzer can make
`tree-sitter-xml` emit an `export_list` node, so those three conditions are only reachable
by a grammar change or by a corpus that exercises a node type the wired grammar does not
yet produce. That is a real difference from `uses` and `extends`, whose conditions a
better analyzer could genuinely trip, and it is the honest reason instrument A is the
weaker instrument here rather than a matter of taste.

**The substring clauses were tested rather than assumed.** Every one of them was run
against the grammar inventory the census already measured — **86 distinct node types over
2,829,074 nodes**, listed in `ontology-census.json` → `instrumentA.nodeTypes`, and re-run
against `ontology-census-overrides-gap.json`'s earlier inventory of 2,787,237 nodes over
the same 86 types with the same result:

```
export -> []      implement -> []     instantiat -> []    new -> []
override -> []    extend -> []        use -> []           call -> []      class -> []
```

All nine are empty, so no overturn clause in this table is already violated by the
grammar in use. `use -> []` is worth its own line: the wired grammar has **no node type
containing `use` at all**, which is independent support for the `uses` ruling from the
instrument-A side that the B probe was preferred over.

**One clause is weaker than a count and is labelled as one.** `implements`'s second
overturn clause asks for "an element in a vocabulary namespace whose defined semantics
are interface satisfaction". No probe can decide that; it is a judgement about a
specification, and `exports`'s own overturn condition is likewise semantic ("a
specification defines an export or public-interface meaning"). Both are stated as
semantic conditions in the ruling table rather than dressed as counts, because a count
that stood in for them would be a number with nothing behind it — the same defect as the
gate's prose-matching `rulingFor`, in the opposite direction.

### `contains` had 474 edges whose containment no byte range could express, and `imports` had no ledger at all

`extends`, `calls` and `references` each had a site ledger by the time this section was
written. `contains` — the highest-volume type in the lane, 186,270 edges on the arbiter's
full-population pass — and `imports` had none, so their row 3 read `unmeasured`. The
instrument is `validation/m14/fixtures/xml/containment-ledger.mts`, and it is built to
avoid the trap every other oracle in this repo walks into: it re-derives **none** of the
seven places `real-xml-analyzer.ts` builds `declaredNames`. It takes the analyzer's symbol
**ranges** (parse facts) and its **edges**, and asks the tree whether the ranges nest.

```
A. every emitted edge      target's span strictly inside some symbol named source
B. every real nesting      the IMMEDIATE enclosing symbol, and whether an edge carries it
C. every imports site      ExternalID literals, PI href, schemaLocation tokens
```

Direction B is the recall half and its denominator is stated, because the obvious version
of it is wrong. A span-nested symbol three levels up is an **ancestor**, not an owner:
`contains` here is parent-to-child by construction (`ownerName` is threaded one level down
at a time). The first version of the probe counted every enclosing ancestor as a candidate
and printed **45,179 "misses" on 300 files** — a recall gap manufactured out of correct
behaviour, in a probe whose purpose is to find gaps. Restricting to the immediate owner
gives 29,306 candidates on the same 300 files.

#### What it found

A vocabulary **declaration**'s range was anchored to the `name=` Attribute node whenever the
value shared the attribute's line. That is the right LINE — it is M19, and M19's fixture
exists because the line was wrong once — and the wrong SPAN, and `contains` is made of spans:

```
<define name="boolean">      symbol `boolean` @ name="boolean"    <- INSIDE its own element
  <choice>                   symbol `choice`  @ <choice>…</choice>
```

`boolean -contains-> choice` is **true** and its target is not inside its source, and the
attribute symbol `name` occupies the identical byte range as the declaration itself. Over
400 corpus files, before the fix:

| | edges | share |
| --- | ---: | ---: |
| `A-confirmed` — target's span inside source's | 3,909 | 89.2 % |
| `G-spans-explainable-by-a-collision` — true, invisible, two names on one range | 194 | 4.4 % |
| `D-spans-disjoint` — source's span does not enclose a child it contains | 280 | 6.4 % |
| byte ranges held by two or more distinct names | **253** | in 299 of 400 files |
| direction B: 29,306 immediate-owner pairs, pairs with no edge | 524 | 1.8 % |

`G` exists as its own class because a containment that is not visible in the spans is not
automatically a false containment, and merging the two would have produced a count that
reads as 474 wrong edges when the truth is 194 unverifiable plus 280 mis-anchored. Both are
real, and they have different fixes.

**At the full admitted population the same instrument finds 5 residual edges in 186,270,
and every one of them is adjudicated rather than rounded into the rate:**

| class | edges | what it is |
| --- | ---: | --- |
| `C-source-symbol-absent` | 1 | `libxslt/tests/general/bug-110.xml` `elem -contains-> id` — `<!ATTLIST elem id ID #IMPLIED>` names an element the document never declares. Already documented below as correct |
| `D-spans-disjoint` | 3 | 2 are the `NDATA` notation edges, whose target is declared **earlier** in the DTD and therefore cannot be nested — fixed this round by moving the tier off `structural`; 1 is `special -contains-> decimal-separator` in `libxslt/tests/numbers/format-number.xsl`, a shape-3 declaration whose `name` value sits on its own line |
| `G`-collision | 1 | `special -contains-> name`, same file and same cause |

and the 9 byte ranges still held by two names, in 5 files:

| names sharing one range | count | what it is |
| --- | ---: | --- |
| `match` + `xsl:template[match=\|mode=\|priority=]#0` / `#1` | 6 | the `overrides` pass's **derived** identity, which is built to be disjoint from every declarable name and is published only for templates that actually collide — it shares the `match` attribute's range by construction |
| `name` + `special`, `duration` + `name`, `endTime` + `name` | 3 | the declared residual of anchoring shapes 2 and 3 to the name node |

So 6 of 9 are a deliberate trade and 3 of 9 are this fix's known cost. Neither is a
fabricated edge.

**Neither class is visible to any instrument the lane already had.** `contains` resolves
**100.0 % at both ends**, it carries `confidence: 1` and tier `structural`, and
`run-fixtures` asserts targets and lines. A range that cannot express the claim it makes is
invisible to all four.

#### The fix, and why it is partial

Anchor to the **element** when the tag, the `name=` attribute and its value all share one
line — the only shape in which the element's row and the attribute's row are the same row,
so the reported line cannot move. The two split shapes keep the Attribute / AttValue anchor
and M19 exactly as measured.

Each half of that condition is separately wrong, and `xml/xsd-declared-name-lines` fails on
each in turn, which is the fixture doing the job it was written for:

| condition | what it got wrong | fixture row that caught it |
| --- | --- | --- |
| "value shares the attribute's line" | `<xsd:attribute` on 27, `name="X"` on 28 → element anchor reports 27 | `AttrOnNextLine`, expected 28 |
| "attribute shares the tag's line" | `<xsd:element name=` on 23, `"X"` on 24 → element anchor reports 23 | `SplitKeywordAndValue`, expected 24 |

After, same 400 files:

| | edges | share |
| --- | ---: | ---: |
| `A-confirmed` | **5,856** | **100.0 %** |
| `G` / `D` | **0 / 0** | |
| byte ranges held by two or more distinct names | **0** | in 0 of 400 files |
| direction B: 36,319 immediate-owner pairs, pairs with no edge | **0** | 0.0 % |

The edge count moved 4,383 → 5,856 only because this draw is 400 files and the `before`
column was taken at 300. Both columns are the same instrument over the same corpus. **At the
full 11,464-file admitted population** the figure is 186,265 of 186,270 confirmed, and the
5 that are not are the table above — every one adjudicated, none dismissed.

**The fix is partial and the residual is pinned, not rounded away.** Shapes 2 and 3 keep the
old anchor, so their containment stays unverifiable, and on shape 3 the order is inverted
rather than merely hidden: in `declaration-range-contains-its-members.xml` the `name`
Attribute node at **2701..2730** *encloses* the declaration at **2713..2730**, so
`ValueOnNextLine -contains-> name` is a true edge whose source sits inside its target. Shape
2 is the same collision both ways: `AttrOnNextLine` and its own `name` attribute occupy
**2638..2659** together. Both reported LINES stay on the name — 46 and 49 — and if a future
change anchors those shapes to the element, both symbols report the tag's line and the
fixture fails. The residual's size in the corpus is the M19 evidence: 4 of 19,852
declarations.

#### `imports` was already exact, in both directions

The same instrument's `imports` half enumerates every path the tree carries — `ExternalID` →
`SystemLiteral` / `PubidLiteral`, `PseudoAtt href` on `StyleSheetPI` / `XmlModelPI`, and a
`schemaLocation` token list with the odd/even pairing re-derived from the token count rather
than copied from the analyzer's branch:

| | count |
| --- | ---: |
| `imports` edges on the 400-file draw | 50 |
| sites on the parse tree | 50 |
| sites with **no** edge (missed) | **0** |
| edges with **no** site (fabricated) | **0** |
| sites refused because the path carries a URI scheme | 0 |

It deliberately does **not** re-derive `isRemoteUri`, so a refused remote URI would surface
as a site with no edge for adjudication rather than be silently agreed with. None appeared.
`imports`'s 0 % resolution rate is unchanged and is not a defect: its target is a file
path, and a path is not a symbol.

#### What this instrument cannot find

Stated in the artifact and repeated here because the claim is easy to over-read. It is a
**coverage ledger, not an oracle**: it proves each edge has a real nesting or a real path
behind it, which is necessary and not sufficient, and it does not adjudicate the edge's
LABEL. It is a **second walker over the same `tree-sitter-xml`**, so a construct the grammar
drops is invisible to both walkers — the limitation `script/m14/differential.ts` exists to
break, and it cannot break it here because `LANG_REPOS` has no `xml` entry (§8 item 4). And
it takes **identity from the analyzer's symbol set**, so a systematically mis-*named* symbol
is confirmed by it; the check is on spans. Naming is covered by the source-authenticity
ledger in `derivation-accounting.mts`.

#### Three defects the instrument had, each of which produced a confident wrong number

They are recorded because the failure mode is not a crash.

1. **It read `s.range?.startIndex`, which does not exist on `parseFile`'s output.** The
   worker publishes `startLine` / `startIndex` / `endIndex` as TOP-LEVEL fields, so every
   symbol came back spanless: `29,639 symbols without a span`, `B-target-symbol-absent` on
   **4,383 of 4,383 edges**, rate 0.0000. A total, confident, entirely fictional result.
   Same wrong-field-name class as reading `rel.from`/`rel.to`.
2. **Its collision map was keyed by byte range alone, across files.** Byte offsets repeat
   across documents — `name="name"` at 3332..3343 in gtksourceview's `language.rng` and
   `name="bold"` at 3332..3343 in another file of the same draw are two attributes in two
   documents — so it reported **154 collisions where the ledger measured 0**, and the two
   instruments of this lane disagreed about a named property of the same 400 files. Fixed
   by keying on file and range; every other instrument here already keys per file.
3. **Its `imports` owner walk and its span test disagreed about `<Attribute>` nodes**, which
   is what produced the `G` class at all. That one was a finding rather than a defect, and
   it is the class that made the mechanism nameable.

`declaration-span-before-after.mts` — the before/after that measures the fix's blast radius
— records three more of its own, and its header names them: a `git stash` path built with
three `..` from `validation/m14/fixtures/xml` resolving to `validation/` rather than the
repo root, so `git stash push --` on a non-existent path warned, stashed nothing, exited 0,
and **both legs read one revision**; the analyzer module being cached across legs, so
popping the stash changed the bytes on disk without changing the module the second leg
already held (`369 → 154`, byte-identical to what HEAD produces — the second leg never saw
the fix); and the collision map keyed by range alone, above. A fourth was operational: a
`timeout`-killed run left `src/ast/real-xml-analyzer.ts` **stashed**, the next run refusing
for the wrong reason, and the change itself sitting in `stash@{0}`. `SIGTERM`/`SIGINT`/
`SIGHUP` now pop it, and the probe exits 2 rather than reporting if the stash did not take
or the pop did not restore.

### The ledger's own parser died at document 8,513, and the site numbers moved with it

The ledger above is the instrument that answers `imports` row 3 and direction B for
`contains`. It builds its tree in a second pass, and the way it built it made its own
coverage claim false in a way no error marker reported.

**The measurement.** `validation/m14/fixtures/xml/parser-lifetime.mts`, over the whole
admitted population, one reused parser versus a fresh parser per file:

```
admitted: 11552
ONE reused parser : failures=11552 of 11552, firstFailureAtIndex=8513
FRESH parser each  : ok=0 parseFail=0 newParserThrew=11552 firstThrowAtIndex=0
```

Read the first line rather than the count. The parser served documents `0..8512` and then
failed on **every one of the remaining 3,039** — and `unparsedByOwnParser` was 3,039.
Those are the same 3,039 files. It was never a property of the corpus: it is the point at
which the wasm heap stops growing, so the failure is permanent rather than per-file, which
is why the second line throws at index **0**. A fresh `Parser()` cannot recover it, because
by then the heap is already spent. The two lines together are the whole diagnosis: this is
exhaustion, not a bad file, and the obvious repair does not work.

**What it was hiding.** Phase 2 kept every tree alive and parsed 11,552 documents through
one instance. Every site-side number was therefore computed over the first 8,513 documents
of a sorted population and truncated at the heap boundary — and a heap boundary is not a
file boundary, so nothing in the report could see it. The consequence is measurable in the
artifact: `sitesOnTree` read **186** while the ledger's own `sitesWithNoEdge` read **0**,
which reads as complete coverage of 186 sites and says nothing about the other 283 edges.
It also explains a discrepancy this document could previously only observe:

| draw | admitted | `unparsedByOwnParser` | `sitesOnTree` |
| --- | ---: | ---: | ---: |
| `84970cf3d`, 11:16 | 11,464 | 2,631 | 234 |
| same commit, same corpus, later | 11,464 | 2,631 | 234 |
| +88 files admitted by other lanes | 11,552 | 3,039 | **186** |

Sites went **down** while the population went **up**, and the arbiter's own `contains`
figures drifted across runs for reasons §`countsAreDeterministic` could not name. Both are
this: which documents fall past the boundary depends on the sort order, so adding files
mid-list pushes more of them over. The count of "unparsed files" was itself the artifact.

**The fix, and it is one line.** Phase 2 now calls `ASTEngine.parseTree`, the same entry
the production analyzers receive their tree from, which deletes each tree in a `finally`
(`src/ast/engine.ts:1972-1981`) and keeps its parsers in an evicting pool
(`src/ast/engine.ts:189-195`). Phase 1 already called `parseFile`, so the edge walk and the
site walk now share one parser discipline instead of two. Measured, same corpus:

| | before | after |
| --- | ---: | ---: |
| `unparsedByOwnParser` | 3,039 | **0** |
| `imports` sites on the tree | 186 | **468** |
| `imports` sites with no edge | 0 | 0 |
| `imports` edges with a site | 186 | **468** |
| `imports` edges with **no** site | 283 | **1** |
| `contains` edges / confirmed | 188,267 / 188,262 | 188,267 / 188,262 |

Site coverage of `imports` edges went from **39.7 %** to **99.8 %**, and the instrument was
reporting the gap as zero. `contains` is unchanged, which is itself worth stating: its
confirmation reads symbol spans from phase 1 and never consulted the phase-2 walk, so the
truncation could not touch it. `filesWithParseErrors` is 57 and is newly visible for the
same reason — it was always being counted, over a population 3,039 files short of the one
it claimed.

### A PUBLIC identifier is not a file, and one `imports` edge was withdrawn

The single edge the parser fix left without a site is the whole finding:

```
libxslt/tests/general/bug-52.xml
  <!NOTATION GIF PUBLIC "GIF">
  <!ENTITY graphic SYSTEM "graphic.gif" NDATA GIF>
->
  GIF -imports-> GIF   role=notation_external_id   confidence=1
```

`extractExternalId` read `findDirectChild(externalId, "SystemLiteral") ??
findDirectChild(externalId, "PubidLiteral")`, and its notation caller reached further still:
`findDirectChild(node, "ExternalID") || (isNotation ? findDirectChild(node, "PublicID") : null)`.
The grammar makes the two ExternalID shapes different node types, which
`validation/m14/fixtures/xml/dump-dtd.mts` prints:

```
GEDecl        <!ENTITY graphic SYSTEM "graphic.gif" NDATA GIF>
  ExternalID  SYSTEM "graphic.gif"
    SystemLiteral  "graphic.gif"     <- a PATH. the only shape that imports

NotationDecl  <!NOTATION GIF PUBLIC "GIF">
  PublicID    PUBLIC "GIF"
    PubidLiteral   "GIF"             <- a CATALOGUE NAME. names no file
```

A `PublicID` has no `SystemLiteral` child at all, so a read that falls back to
`PubidLiteral` is not reading a file. XML's own grammar permits `PUBLIC PubidLiteral` with
no system literal precisely so a parser can resolve the name against a catalogue. This is
the defect class the powerShell round removed from `New-Object $type`: a value that is not
a file published as an edge target. The analyzer's own node glossary called `PublicID`
"a file reference on a NotationDecl", and that sentence is where the error started.

**Counted twice, from sources that do not share a code path.**
`validation/m14/fixtures/xml/public-id-census.mts`, 11,552 admitted files:

| | count |
| --- | ---: |
| A, the tree: `ExternalID`/`PublicID` nodes | 299 |
| A, nodes carrying a `SystemLiteral` | 298 |
| A, nodes carrying **only** a `PubidLiteral` | **1** |
| B, `imports` edges with `externalIdKind: "system"` | 298 |
| B, `imports` edges with `externalIdKind: "public"` | **1** |

Both ones are `libxslt/tests/general/bug-52.xml` line 2. Two instruments, one file, and
the counts agree to the edge — which is what makes the fix scoped rather than guessed. The
`SystemLiteral` path needed no change and the agreement says so: 298 nodes, 298 edges.

**Withdrawn:** `imports` **469 → 468**, and edges with no site **1 → 0**. The invariant now
lives in `extractExternalId`, at the single point where the target string is created, so a
future caller that hands it a `PublicID` gets nothing rather than an edge. The glossary
entries for `ExternalID`, `PubidLiteral` and `PublicID` state what each is.

Fixture `xml/dtd-public-id-names-no-file` pins it and carries a SYSTEM notation (`jpeg`) and
a `PUBLIC "pubid" SYSTEM "sys"` notation (`pairs`) as controls, so it cannot pass by
refusing the construct; its forbid row is constrained on `from: "gif"` **alone**, because a
row naming the fabricated target would be satisfied by an analyzer that invented a different
one. Two mutants, one per direction: `xml/public-id-published-as-an-import` reinstates the
fabrication, `xml/notation-import-refused-entirely` performs the over-correction. Both are
caught; **21/21 caught, 0 survivors**.

**Not claimed.** That a public identifier is worthless is not what this says. `PUBLIC
"-//IETF//NOTATION TIFF//EN"` on a notation is a real, declared identifier and a consumer
that wants it has nowhere to read it now. That is a `references`-class GAP this round did
not adjudicate, and it is listed as unresolved rather than counted as coverage.

### The six questions, answered for every emitted type

Rows 2, 4, 5 and 6 are from the 2,500-file family-stratified draw
(`ontology-census.json`, draw `c38110881a301dae`, workers 8, 86,412 relationships,
388,365 symbols, 86 distinct node types over the same draw, 0 files failed,
**1 file silently degraded** — see §`countsAreDeterministic: true` was false); the edge counts in the ontology table
above are the arbiter's full-population pass. `overrides` reads **0 in this draw**
and 3 in the full population, which is stated here rather than averaged over. The
draw is re-run for every row, so a row that predates the `references` re-base and
was not re-measured would be a stale claim rather than a history.

| Question | `contains` | `references` | `imports` | `calls` | `extends` | `overrides` |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Exists | walk + DTD branches | deferred reference pass | `extractExternalId`, `schemaLocation`, PI `href` | `XSLT_CALL_ELEMENTS` | `xsdDerivationElement` branch | `competingTemplates` + the §5.5 pass |
| 2. Fires | 77,882 edges / 2,471 files | 7,415 / 195 | 261 / 175 | 2 / 1 | **852 / 93** | **0 / 0 in this draw; 3 / 3 in the full population** |
| 3. Correct | **site ledger; 5,856 of 5,856 edges have the target's span inside the source's, 0 with no site, 0 of 36,319 real nestings with no edge** | **no ledger; `unmeasured`** | **site ledger; 50 sites on the tree, 50 edges, 0 with no site, 0 with no edge** | **site ledger; 481 accepted sites, 481 occurrences, 0 unrepresented** | **1 oracle; 1,615 of 1,652 sites covered, 37 refused, 0 edges without a site** | **no ledger; 3 probe sites in 3 files against 3 edges in 3 files, per-file identity only** |
| 4. Labelled | `structural` 77,882 (100 %) | `reference_qualified` 7,415 (100 %) | `import_based` 261 (100 %) | `reference_qualified` 2 (100 %) | `structural` 852 (100 %) | `structural` 3 (100 %) |
| 5. Resolved | 77,882/77,882 = **100.0 %** | source **7,415/7,415 = 100.0 %**; target 3,591/7,415 = **48.4 %** | 0/261 = 0 %, target is a file | 2/2 = **100 %** | source **1,429/1,429 = 100.0 %**; both ends 267/852 = 31.3 %, and 56.4 % of bases are built-in or imported | 3/3 = **100 %** |
| 5b. Source is a name the file writes | 77,882/77,882 (the parent, read off the tree) | **10,413/11,094 = 93.9 %** — was 8,771/10,411 = 84.2 % | n/a, the target is a file | **402/402 = 100 %** | **1,429/1,429 = 100 %** — was 438/438 = 0 % | 3/3 = **100 %** |
| 5c. The claim is expressible in the ranges the analyzer publishes | **5,856/5,856 = 100.0 %** — was 3,909/4,383 = 89.2 %; byte ranges held by 2+ names **0**, was 253 | n/a | n/a | n/a | n/a | n/a |
| 6. Confident | 0 edges < 0.7 | 0 | 0 | 0 | 0 | 0 |

Row 5c exists because row 5 could not see the defect this round found. `contains` resolved
at 100.0 % at both ends, carried `confidence: 1` and tier `structural`, and every fixture
asserted targets and lines — while 474 of 4,383 edges made a claim the analyzer's own byte
ranges could not express. A resolution rate asks whether an endpoint binds to a symbol; it
cannot ask whether the symbol's span is on the right side of the other one's.

**The two rates below 100 % are a declared resolvability class, not dangling
edges, and the split is measured rather than asserted.** `metadata.resolvable`
carries it per edge:

| type | in-document | builtin | external | unresolved | both-ends rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| `references` | 3,071 | 3,594 | 738 | 12 | 48.4 % target, 100.0 % source |
| `extends` | 232 | 436 | 184 | 0 | 31.3 % both ends, 100.0 % source |

`references`' both-ends rate went 49.1 % → 48.4 % and that is the arithmetic of the
re-base rather than a regression: the denominator grew 6,750 → 7,415 (+9.9 %) while the
resolved-target count grew 3,312 → 3,591 (+8.4 %), and the `external` class nearly doubled
(375 → 738) because distinct declaring types now produce distinct edges to the same
imported names. Row 5 splits the two ends apart for exactly this reason, and the **source
resolves at 100.0 % both before and after** — which is the trap this section exists to
name: a minted source resolves perfectly, so a resolution rate cannot detect a fabricated
endpoint, and asking the source directly is the only instrument that can.

XML names far more specification built-ins than the reference point (CSS
`references` at 66.8 %): `xs:string`, `xs:int`, `xs:positiveInteger` and their
kind are declared in the XML Schema specification, not in the file being read, so
they are deliberately not published as in-file symbols. `imports` reads 0 % by
design for a different reason — **its target is a file path**, which is the one
case in this analyzer where a value is the right target, and a path is not a
symbol. Only 12 `references` edges (0.16 %) are genuinely `unresolved`, up from 6,
and the rise is the same un-collapsing: a site that used to share one source with a
site that resolved now gets an edge of its own, and a distinct declarer can leave a
name unsatisfied that the shared source satisfied by accident.

**Q3, and the limitation that comes with it.** `script/m14/differential.ts --lang
xml` **does not run this lane**: it prints `[lane] SKIP xml: no corpus repo mapped
in LANG_REPOS and none checked out — declared unrun, not measured` and reports
`measured 0 lane(s)`. `xml` is present in that file's `LANGS` (line 25226) and
**absent from `LANG_REPOS`**, so no independent oracle has ever adjudicated any
XML edge. The xml completeness spec claims the lane is "registered in
differential.ts LANGS / **LANG_REPOS**"; the second half of that is false, and the
measurement is what caught it.

So question 3 has a **coverage ledger for four of the six** — `contains`, `imports` and
`calls` from `validation/m14/fixtures/xml/containment-ledger.mts` and
`derivation-accounting.mts`, `extends` from `script/m14/xml-ruled.ts`'s `countOnTree` — and
a ledger is not an oracle. `references` has none, and `overrides` has a weaker thing: the
arbiter's own instrument-B probe counts **3 competing-template groups in 3 files**
(`libxslt/tests/docbook/fo/toc.xsl` and `libxslt/tests/docbook/html/toc.xsl`, two templates
each at `match="*" mode="toc.for.section"`, plus one file the gate counts without naming)
and the analyzer emits **3 edges in 3 files**. Those two numbers agree at the granularity of
one group per file, and each of the two named files has exactly one group, so per-edge
identity holds for the corpus as it stands — but nothing checks it, and a fourth site in an
already-counted file would break the correspondence silently. Stated as what it is. The
honest statement of why is structural rather than procedural for the rest: the lane's own
oracle
(`script/m12/xml-corpus-differential.mts`, 20 relationship classes, and
`script/m12/xml-differential-gap.mts`, 43 unexplained of 250,135 `contains` edges)
is a second walker over the **same grammar**. It can disagree with the analyzer,
which makes it a real check, but a grammar bug present in the tree is invisible to
both, and the 595 `REL_SPURIOUS` rows the m12 document discusses are an instrument
falling behind a correct analyzer rather than a disagreement. The lab's own
warning applies here verbatim: *two implementations disagreeing is evidence about
both; a percentage computed against a broken second implementation is a lie with a
decimal point.*

The `extends` oracle is newer and narrower than those: `script/m14/xml-ruled.ts`'s
`countOnTree` counts XSD derivation sites from the parse tree, so it is a **second
walker over the same grammar in exactly the sense the warning names** — it agrees
with the analyzer 4 sites / 2 files against 4 edges / 2 files, which is evidence that
the emitter and the construct agree, and is blind to a grammar fault that makes both
walkers miss the same sites. It is reported as Q3 answered, not as Q3 settled beyond
doubt, and it was built to close a false verdict rather than to audit an emitter.

Q6 in full: every emitted edge carries `confidence: 1`. The heuristic ratio —
edges below the 0.7 threshold — is **0 of 86,412** on the 2,500-file draw and **0 of
199,663** on the full admitted population at `BB_XML_WORKERS=1`
(186,270 + 11,094 + 465 + 1,429 + 402 + 3), and the `inferred` tier, the
honest default for a rule the tier table does not name, holds **0 edges**. Every
edge's tier is assigned where the edge is written, from `EVIDENCE_TIER`, keyed by
the rule's role.

**The 0 is a measurement of this analyzer's code, not of the corpus, and the two
must not be confused.** `confidence` is not computed anywhere in this file: it is a
single unconditional literal at `real-xml-analyzer.ts:739`, the one and only
`confidence:` assignment in the analyzer. So "0 edges below 0.7" restates the
existence of that literal and would read identically on a corpus of pure noise.
It is reported because the contract requires heuristic edges to be countable, and
this lane's honest answer is that it has none to count — not because 199,663
independent judgements were made and all 199,663 came out certain.

What does carry per-edge weight is the **tier**, because it is stamped from
`EVIDENCE_TIER` per role and an unmapped role falls to `inferred`. The census
counting `inferred = 0` is therefore a real result: it says every rule that emits
an edge is named in that table, and a new rule added without a tier would show up
as a non-zero `inferred` count. That is the number to watch on this lane; the
confidence ratio cannot detect anything.

### Integrity of the census itself

**This subsection previously said the counts reproduce. They do not, and the sentence is
withdrawn rather than edited away.** Its evidence was four runs of `ontology-census.mts`
against the same corpus at the same caps with **every count field byte-identical in all
four**, and the `reproducibility` block recorded `countsAreDeterministic: true` on the
strength of it. Four runs at one worker count cannot detect a dependence on concurrency,
and the claim was false: see §`countsAreDeterministic: true` was false, and the mechanism
is named for the two probes, the six-run table, and the captured losing result objects.
Two consecutive runs at the same worker count, same draw fingerprint, unchanged corpus
bytes and unchanged analyzer, gave `contains` 77,887 and 77,882.

What survives from the original text, and it is still the right reading of the arrays:
the draw is deterministic — repositories in sorted order, files in lexicographic path
order, no randomness in the selection, so every run parses the same files — while
`fileExamples`, `unresolvableExamples` and the probe `examples` record the *first* file a
type was seen in, and "first" is whichever concurrent worker arrived first. Reordered
example arrays are a **misread**, and they look at a glance exactly like a count that
moved. That is why `exampleArraysAreDeterministic: false` stands and why the rule is
still **compare counts, not byte order** — except that the counts are now declared
non-comparable unless `drawFingerprint` and `workers` both match, and even then a reader
must read `production.fallbackFiles` beside them.

The counts themselves, from the matched 11,066-file pair:

| property | value |
| --- | ---: |
| files sampled | 11,066 (every git-tracked file routed to `xml`; 91 repositories) |
| files that failed to parse | 0 |
| files reporting parse errors | 55 |
| symbols | 734,939 |
| relationships | 191,333 |
| `SymbolKind` values seen | `property` 466,862 · `class` 254,845 · `namespace` 12,659 · `type` 419 · `module` 203 |
| empty or unknown `SymbolKind` | **0** |
| symbols with an empty name | **0** |
| edge endpoints equal to `unknown` | **0** (was 2 — see below) |
| `contains` targets that resolve to a symbol | 179,605 / 179,605 = **100 %** |
| `contains` sources that resolve to a symbol | 179,604 / 179,605 — **1** miss |
| grammar node types | 95 distinct (64 named, 31 anonymous tokens) over 5,444,635 nodes |
| `ERROR` nodes | 6,955, concentrated in 55 files |

**Two defects the census found, both fixed here.**

1. **The placeholder literal collided with a real component.** Resolving both ends
   of all 191,251 pre-change relationships found **2** endpoints equal to the
   literal `unknown` — in `libxslt/tests/general/bug-166.xsl`, whose two
   `xsl:variable` result-tree fragments each begin with a literal result element
   `<unknown/>`. The analyzer was asserting two truths a consumer cannot tell
   apart: "the variable admits an element the author named `unknown`" and the same
   three words meaning "this endpoint could not be determined". That violates M60
   rule R7. Both symbols and both edges are now **refused**, at one choke point
   rather than per publish site, because the name can arrive as an element tag, an
   attribute name, a DTD entity name, a notation name or a content-model member.
   Cost: 2 symbols and 2 edges in 1 file of 11,066. Pinned by fixture
   `xml/placeholder-literal-refused`, whose two sibling-element rows stop the
   refusal from being explained by a rule that stopped walking.
2. **The documentation claimed a `calls` edge the analyzer never emitted.** The
   ontology table above used to read "`calls` | `xsl:call-template` /
   `xsl:apply-templates` → the `xsl:template` that declares the named template",
   and the source contained no `RelationshipType.Calls` at all. A doc claim with no
   code behind it is the same defect class as an unbacked ruling, and it survived
   because nobody diffed the table against the enum.

The single `contains` edge whose **source** does not resolve is
`libxslt/tests/general/bug-110.xml: contains elem -> id`, and it is correct as
written: `<!ATTLIST elem id ID #IMPLIED>` in the internal subset does say element
`elem` carries attribute `id`, and the only `<elem>` in the file is inside a
comment, so no symbol named `elem` exists. The lane's hard invariant is about
`contains` **targets** — every target is a published symbol, and 179,605 of
179,605 hold. The source is a name a DTD introduces and the document never
declares, which is a statement about the document rather than a defect in the
edge, and it is stated here rather than rounded into the 100 %.

### Before and after, measured on the same corpus

Both runs are the same instrument over the same 11,066 files.

| Type | before | after | delta | what the delta is |
| --- | ---: | ---: | ---: | --- |
| `calls` | 0 | 548 | **+548** | the GAP, implemented |
| `extends` | 0 | 434 | **+434** | the GAP, implemented |
| `references` | 11,207 | 10,331 | **−876** | −434 `attribute_qname_reference` (the derivations) and −442 `xslt_named_template_reference` (the calls), exactly |
| `contains` | 179,629 | 179,605 | −24 | **not** this work — see below |
| symbols | 734,988 | 734,939 | −49 | **not** this work — see below |

The `contains` and symbol deltas are the parser's **120-second hang guard**
(`BB-HANG`), which is wall-clock dependent and dropped a *different* SVG file in
each run: `bulma/.../svgs/solid/phone.svg` in the before run,
`cargo/.../stderr.term.svg` in the after run. Scoping the census to exactly those
two repositories and re-running it on **both** revisions gives byte-identical
totals — 34,253 symbols and 8,975 relationships, `contains` 8,854, `references`
120 — which is the checkable form of the claim that the delta is run noise rather
than a consequence of the relabel. The `references`/`calls`/`extends` deltas
reconcile exactly to the construct counts and cannot be produced by a whole-file
drop.

### DERIVATION findings: 6, and every type this lane emits is unaudited by the shared differential

A DERIVATION finding is a type the analyzer emits that no differential audits. For
XML the count is now **6 of 6 — `contains`, `references`, `imports`, `calls`,
`extends`, `overrides`** — every type this analyzer emits, stored and compared
against nothing by the shared differential. The reason is the one measured above
rather than a policy: `differential.ts` does not run this lane at all, and has no
XML oracle to run. It was 4 before the M60 ontology pass added `calls` and
`extends`, and 6 after this pass added `overrides`; the debt grew by exactly the
work that was supposed to reduce it, which is the shape of the problem.

A 5th type, `contains`, is audited only by a lane-local instrument outside the
shared differential (`script/m12/xml-differential-gap.mts`, 43 unexplained of
250,135 edges over 8,889 files in the m12 corpus). So **no relationship type this
lane emits has a shared-oracle check**, and the debt is not new: before this work
the lane emitted `references` and `imports` with no auditor, which is exactly the
structural condition the ontology workstream was convened to end.

**One of the six has been paid down since, and the instrument that paid it was not
built for that.** The `extends` probe added to `script/m14/xml-ruled.ts` to close the
false verdict in §8 item 2 walks the same XSD derivation sites the analyzer reads, and
it agrees with the analyzer exactly at the scale where both can be compared without
the analyzer's refusals dominating: 4 sites / 2 files against 4 edges / 2 files. That
is an oracle, so **Q3 is answered for `extends` and the remaining DERIVATION debt is 5
of 6** — `contains`, `references`, `imports`, `calls`, `overrides`. It is still not a
*differential*: it checks the emission against the construct, not against another
parser's reading of the same document, so a grammar bug shared by the analyzer and the
probe stays invisible to it. The count of 6 above is left standing as the DERIVATION
finding proper, because DERIVATION means "unaudited by the shared differential" and
this lane-local probe does not change what `differential.ts` does.

### Limitations

Declared non-empty because the corpus is real and every gap below is a measured
number rather than an assumption. XML is not a general-purpose programming
language, so some limitation classes do not apply to it; the ones that do
apply are the ones listed.

1. **No independent oracle.** Every number above comes from the analyzer plus its
   own fixtures. `differential.ts` will not run the lane (`LANG_REPOS` has no
   `xml`), and the two lane-local oracles are separate walkers over the same
   grammar, so a grammar-level defect is invisible to all three.
2. **Cross-file calls are refused, not resolved.** 774 of 1,528 `xsl:call-template`
   sites name a template in an included or imported stylesheet. Resolving them
   needs the import graph, which is a project-level pass and not a per-file one.
3. **Cross-file overrides are invisible.** 455 `xsl:import`/`xsl:include`/
   `xs:redefine` sites in 221 files are where XSLT overrides live (§5.6). Both
   ends are in different files.
4. **`xs:include` cannot be resolved per file.** An included schema shares the
   including schema's target namespace, so a bare base or type name may be
   satisfied by either file. 24 `references` edges are `unresolved` for this
   reason, and 103 carry `ambiguousWithBuiltin`.
5. **37 of 1,652 derivations are refused, all one class.** A prefixed base bound
   to a namespace this file neither declares nor imports names a component no file
   supports, and from inside one file that is indistinguishable from one an
   `xs:import` supplies. (This was written as "1,212 of 1,648"; that number was
   inferred rather than counted and the count is 37.)
6. **A `calls` source is still the anonymous inline element, and `extends` no
   longer is.** The owner of a `base=` attribute was the `xs:extension`/
   `xs:restriction` element itself, which measured as a fabricated source on 438 of
   438 edges; that is FIXED and the source is now the nearest named schema ancestor.
   The `calls` case is untouched and still has the shape this paragraph used to
   describe for both: the owner of a `xsl:call-template` site is the enclosing
   template, reached by walking containment back up when the call sits in an inline
   `<xsl:variable>` body. `bb_graph`'s owner-cascade attributes member rows to the
   owner class, so the answer is reachable, but the hop exists and its depth varies.
7. **111 of 11,094 `references` edges still carry a vocabulary tag as their source,
   because the site has no named declaration to name.** All three types that resolve
   below 100 % had this defect and it is now fixed in the two fixed forms: `extends`
   was 438/438 fabricated, `calls` 495/548, `references` was 1,066/10,411 and is
   111/11,094 after the re-base. The residue is not a smaller version of the same
   bug — every one of the 111 sits where **nothing declares a name**: XSLT 1.0 §5.4
   gives a `match=`-dispatched template no `name`, and an instruction at stylesheet
   top level is inside no template at all. By role: `entity_reference` 85,
   `xslt_named_template_reference` 22, `attribute_qname_reference` 4. The honest
   alternatives are a refusal (which deletes a real edge — the `references` pass
   emits for every vocabulary, not only XSD) or a synthetic name (which is the
   fabrication this whole line of work removed). The fallback keeps the value that was
   there before, so it cannot make the graph worse than it was; it is pinned by
   `xml/references-source-is-the-declarer` so it cannot be dropped silently either.
8. **261 Wayland `<interface name=…>` declarations are published under their tag.**
   The vocabulary is absent from `DECLARATION_VOCABULARIES`. Recorded above.
9. **Standalone `.dtd` files are routed but not representable** by the `xml`
   grammar, whose `document` rule requires a document element; they are declared
   negative controls rather than counted as clean parses.
10. **Grammar-version drift.** The wired grammar is the vendored, twice-patched
    `grammars/tree-sitter-xml` (`grammars/tree-sitter-xml/PIN.md`,
    sha256 `2425a26e…`), so every node name quoted above is a name in *that*
    grammar. The 95 node types and their counts are re-measured by the census on
    every run rather than quoted from this document.

A `references` target is a local name, a built-in, a name in another file, or a
name this file does not satisfy — and the four are told apart in
`metadata.resolvable` rather than left to the reader. Resolving any of the four to
a phantom local symbol is the M60.R10 lie, and a consumer that resolves a
built-in, an external or an unresolved reference to a symbol with no declaration
behind it is worse off than one that is told where to look.

`builtin` carries the full `qname`, `prefix` and `namespaceUri`, so
`type="xs:string"` is recorded as a reference to the built-in `string` and never as
a local symbol named `string`.

`unresolved` carries `ambiguousWithBuiltin` — 103 of the 413 — when the name is
*also* a built-in. That is the one case where a consumer must not guess either way:
`<!ENTITY>`-style shadowing aside, a bare `type="date"` may mean XSD's built-in
`date` or a same-named type an `xs:include` brought in, and **from inside this one
file the two are indistinguishable**. The analyzer records the claim and the
ambiguity rather than dropping the claim (as it did before) or resolving it to a
built-in (as the corpus oracle did, which is a confidently wrong answer —
`libxml2/test/schemas/vdv-simpleTypes.xsd` declares its own `date` at line 32).

Resolving includes for real needs the include **graph**, which a per-file analyzer
cannot see and which belongs to a project-level pass. That is a feature, not a gap
in this function, and naming it as one would be a way of not doing it.

Each relationship carries `metadata.evidenceClass`, assigned where the edge is
written so a tier cannot drift from the rule that produced it:

| tier | edges | count on the corpus |
| --- | --- | ---: |
| `structural` | containment read off the tree, DTD→declaration, declaration→notation, PI→target | the large majority |
| `import_based` | the target is a FILE: `ExternalID`, stylesheet `href`, `schemaLocation` | 964 |
| `reference_qualified` | the target is a NAME reached through a declared prefix, or a named XSLT template | 11,145 |
| `usage_contextual` | the document stating what an element MAY contain through an attribute, e.g. `<!ELEMENT catalog (entry+)>` | 665 |
| `inferred` | the honest default for a role the table does not name | 0 |

`evidenceClass` is the tier of the edge's **primary** role. A merged edge carries
its other roles in `meta.alsoRoles`, and their tiers are not separately recorded —
so a consumer asking "is this edge *also* a usage claim?" has to read
`alsoRoles`, not `evidenceClass`.

That is not a hypothetical: `<!ELEMENT catalog (entry+)>` inside a document that
also contains a real `<entry/>` produces `contains catalog -> entry` twice — once
read off the tree, once from the DTD — and the two collapse onto one edge because
edge identity is `source|type|target`. Whichever rule wrote first becomes the
primary role. Measured over 2,500 corpus files: **665** content-model edges carry
`tier: usage_contextual`, and a further **148** carry `tier: structural` with
`alsoRoles: ["dtd_content_model"]`. So the content-model claim is never *lost* —
it is counted and preserved — but on 148 of 813 sites the edge's own tier
describes the tree reading rather than the usage one.

`dtd_notation_reference` also maps to `usage_contextual` and is exercised by
`xml/dtd-declarations`, but it occurs **zero** times across the 8,889-file corpus.
The tier is reachable; it is not common.
`<!ELEMENT catalog (entry+)>` says catalog MAY admit entry; `contains
catalog -> entry` read off an actual `<entry/>` child is nesting. They are
different claims, and because edge identity is `source|type|target` they collapse
onto one edge. The collapse is counted, not hidden: the edge records
`meta.occurrences`, `meta.lines`, and `meta.alsoRoles`, so every contributing
rule and every contributing line survives the merge.

Relationships are deduplicated by `(source, type, target)` in a `Set`, so the
same tag/attribute identity cannot create repeated edges during traversal.
Document-level processing instructions intentionally have no synthetic element
owner; they are emitted as symbols without a containment edge.

## Supported constructs

Independent fixtures cover:

- XML declaration, namespaced elements, default and prefixed namespaces,
  attributes, nested elements, empty-element tags, and processing instructions
  (`validation/m12/fixtures/xml/Catalog.xml`);
- external DTD identity and import relationship
  (`validation/m12/fixtures/xml/Doctype.xml`);
- XML Schema structure, XSD namespace, and schema attributes
  (`validation/m12/fixtures/xml/Schema.xsd`);
- malformed closing tags and explicit syntax-error handling
  (`validation/m12/fixtures/xml/Negative.xml`).

A separate shape probe exercises internal DTD declarations, including
`elementdecl`, `AttlistDecl`, `AttDef`, `DefaultDecl`, `StringType`, and
`PubidLiteral`. These node types are live in the grammar even though the clean
production corpus acceptance set contains XML/XSD documents rather than
standalone DTD files.

## Unsupported / explicit-unknown constructs

- Standalone `.dtd` files are detected as XML but are not included in the
  production corpus acceptance set because the wired XML grammar requires a
  document element. External DTD references are supported and tested.
- XML Schema semantics are structural only: the analyzer records XSD elements
  and attributes but does not validate types, restrictions, substitution groups,
  or cross-document schema references.
- Entity expansion and runtime external-resource loading are not performed.
  The AST records declaration nodes and external identifiers without fetching
  files.
- Character data, comments, CDATA payloads, and XML declaration metadata are
  not symbols; they are document content rather than declarations. CDATA and
  comments are retained by the parser and never source-scanned by the analyzer.
- Grammar recovery errors remain explicit. The analyzer does not rewrite
  malformed XML or infer missing tags.

## Regex inventory

The XML analyzer has **zero regex usages**, and the machine census agrees.
`script/m12/verify-regex-census.ts` reports **0 rows mentioning
`real-xml-analyzer.ts`** — not 0 entries, not 0 missing, but no row at all — and
the global gate's remaining rows belong to other lanes (css 11, scss 2, sql 1,
svelte 3, clean 2, fsharp 4, javascript 1, python 1, typescript 6, vue 11; 17
missing and 25 stale out of a HEAD scan of 18). Verified at this commit, after it,
and the `references` re-base this round added **no** regex: it is two nullish
coalescences and one walk already in the traversal.

That agreement was not free, and both times it was reached the doc had claimed it
before the machine agreed. Recording both, because the pattern is the lesson.

**First: `value.split(/\s+/)` at the `schemaLocation` handler**, classified
`needs_review` with an **empty justification**. The doc had been written when the
claim was true and never re-checked against the machine that can disprove it; the
census had been right the whole time and the prose had drifted.

**Second, and it survived the first fix: `const isValueForm = ref.length === 0
|| /\s/.test(ref)`** at the `PEReference` branch, the analyzer's last regular
expression. The comment beside it claimed the corpus proved the test necessary, and
cited measurements from **libxml2's own test suite, which is not in
`$HOME/fixtures`** — so the number in the comment could not be
reproduced from the committed corpus. Re-measured: **0 `PEReference` nodes across
the entire 11,456-file admitted population.** The 22 admitted files whose text
carries `<!ENTITY %` are bare `.dtd` fragments this grammar cannot root (its
`document` rule requires a document element), and the one admitted `.xml` —
libxslt's `tests/xmlspec/REC-xml-20001006.xml` — carries its occurrences inside
`CDATA`, i.e. documentation *about* parameter entities. The branch is live on
fixtures (4 nodes in 2 files, all published) and unreachable on the corpus.

**What replaced it, and why not the method the brief prefers.** The brief's rule is
"where the information is IN THE NODE, a regex over the text is strictly worse",
and `grammar.json` supports the reading: `PEReference` is the sequence
`"%" Name ";"` and `Name` is `[a-zA-Z_][a-zA-Z0-9_:.·-]*`, a character class that
**cannot contain whitespace**. So the whitespace test can never be true for a node
the grammar built, and reading the `Name` child looks like a clean win.

`validation/m14/fixtures/xml/pereference-shape-probe.mts` ran three candidate
predicates over every `PEReference` node obtainable and printed both verdicts per
node. **The `Name`-child lookup LOSES.** It disagreed with the shipped predicate on
3 of 11 nodes and was **wrong on 2 of them**:

| shape | shipped | `Name` child | which is right |
| --- | --- | --- | --- |
| `%pe;` in an internal subset | publish `pe` | publish `pe` | agree |
| `% zz '&#60;` (the value form the old comment cites) | drop | publish `zz` | **shipped** — a value-form *declaration* is not a use |
| `%pe` in `<!ELEMENT %pe EMPTY>` | drop | publish `pe` | **shipped** — the document never wrote `%pe;` |
| `%p<U+00A0>e;` | drop | publish `p` | **shipped** |

Both wrong cases are **error recovery**: the grammar builds a `PEReference` whose
only child is a `Name` and whose text has no `;`, so the child lookup invents a
use from a document that never expressed one. That is the fabrication rule's exact
case. The semicolon guard had **no fixture pin at all**, which is why
`xml/pereference-semicolon-required` exists and why mutant
`xml/pereference-semicolon-guard-removed` is in the lane's mutant set.

So the text read stayed and only the regex went: a char walk over the **enumerated
ECMAScript `\s` code points**, deliberately **not** narrowed to XML's own `S`.
Narrowing is defensible on XML grounds and would have been a behaviour change on
exactly one of the 11 measurable nodes — the U+00A0 case, where the wider class
drops and the narrower one publishes a symbol named `p<U+00A0>e`, a name no XML
parser would accept. On that single node the wider class is the better answer, so
it is kept, and the narrowing is recorded here as measured-and-declined rather than
silently taken.

**Two more regexes left in this lane's census script**, at
`validation/m14/fixtures/xml/ontology-census.mts`:
`av.replace(/^["']|["']$/g, "")`, twice. The brief's hard rule covers census scripts
as well as analyzers, and the arbiter only scans analyzers, so this lane's own
count was 3 and the arbiter could only see 1 of them. Replaced by an `unquote`
character test that drops the first character when it is a quote **and** the last
is the **same** quote, which is what the anchored alternation meant.

**And a third, in the arbiter runner.** `validation/m14/fixtures/xml/ruled-gate.ts`
selected the gate's verdict rows with

```
stdout.split("\n").filter((l) => /\b(EMITTED|RULED-SOUND|FALSIFIED|RULED-UNJUSTIFIED)\b/.test(l))
```

The brief's hard rule names "any analyzer, census script, or oracle", and
`script/m12/verify-regex-census.ts` scans **analyzers only** — so the arbiter reported
this lane at 0 while this file carried one, the same blind spot the census scripts
were found behind. Replaced by a named `VERDICT_WORDS` array matched with
`String.includes`, and the substitution is sound for this job for a stated reason
rather than by luck: each of the four constants contains a hyphen or ends the
alphabet, so none can be a prefix or a substring of another (`RULED-SOUND` and
`RULED-UNJUSTIFIED` share `RULED-` but neither contains the other, and neither
appears inside `EMITTED` or `FALSIFIED`). That is a claim about four constants, which
is why they are named at module scope instead of inlined at the call site.

**This lane's regex count across analyzer and census scripts: 4 → 0**, of which the
arbiter could see 1 at any point.

`schemaLocation` is the one attribute whose value is a token list rather than a
single name, so it is the only place a value has to be cut into words. That is now
a char walk over space, tab, LF, CR — the XML `S` production, spelled out so the
behaviour is pinned to a stated character set rather than to a regex dialect,
matching the house idiom in `real-groovy-analyzer.ts`. The tree supplies the
attribute name and the value node; only the tokenisation changed, and the emitted
edges are byte-identical (contract 90/90 and fixtures 8/8 unchanged across the
edit).

Attribute names, element names, namespace URIs, and QNames are all read from tree
nodes. Nothing is read by scanning source text.

## Complexity envelope

Evidence: `validation/m12/results/xml-corpus-complexity.json`.

| Run | files | symbols | relationships | wall ms | files/s | symbols/s | relationships/s | errors | crashes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Grails XML/XSD corpus (superseded) | 154 | 6,195 | 2,388 | 2,188.9 | 70.36 | 2,830.24 | 1,090.98 | 0 | 0 |
| CXF archetypes, all seven globs | 2,439 | 184,388 | 76,455 | 268,928 | 9.07 | 686 | 284 | 0 | 0 |

The second row is 16x the file count and 30x the symbol count of the first, and
it is the honest figure: the first row measured only `*.xml`/`*.xsd` and so
excluded every `.dtd`, `.xsl`, `.xslt`, `.rng`, and `.wsdl` file, which is most of
what a real corpus contains. Peak RSS 298 MB, single process, no database writes. The symbol and
relationship totals are stable across runs; the rates move a few percent with
machine load, which is why the gate's perf budget takes the minimum over repeated
timed runs rather than one measurement.

The hot path is a single explicit stack traversal. Each AST node is visited
once; direct child lookups scan only the bounded child list of that grammar
node, and emitted relationship dedupe is constant-time. There are no scans of
the whole symbol or relationship list and no O(n²) per-symbol resolution.
Space is O(h + s + r), where `h` is traversal depth and `s`/`r` are emitted
symbols/relationships.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/xml.json`
- Authority: manual audit of independent XML/XSD/DOCTYPE fixtures
- Result: `validation/m12/results/xml-differential.json`
- Differential: **49/49 facts, precision 1.000, recall 1.000, 0 FP, 0 FN,
  0 unknown**
- Contract probe: `validation/m12/results/xml-contract.json` — 90/90
- Shape safety: `validation/m12/results/xml-shape-safety.json` — 10 checks, and
  16/16 analyzer node references live with 0 dead defensive references

The 49/49 figure is the small-fixture ground truth and is unaffected by what
follows. It should not be quoted as though it were the corpus result.

### The corpus differential, and why its recall is not reported

A second, larger instrument — `script/m12/xml-corpus-differential.mts`, **now in
this repository** — builds an **independent oracle** from the parse tree and
compares class by class over the whole manifest. It is the only gate here that
measures three things nothing else does: **symbol-level** agreement (including a
`SPURIOUS` class for symbols the analyzer minted that the tree does not support),
**type coverage across twenty relationship classes**, and **multiset** rather than
set comparison, because XML legitimately repeats names.

Its oracle is written from the grammar's own declaration with a deliberately
different algorithm, which is what makes a disagreement a finding rather than the
same bug counted twice. The analyzer walks an explicit worklist carrying the owner
*down*; the oracle makes one flat pre-order sweep and reads the owner by walking
*up* a precomputed parent map.

**It was vendored, not re-measured.** The probe used to live in a sibling
worktree at `fixtures/xml/probes/` while the artifact it produces,
`validation/m12/results/corpus-differential.json`, was version-controlled and cited
here — so the evidence was in the repository and the instrument was not, and a
fresh checkout could read the number with no way to re-derive it. Only four paths
were absolute; they are now relative and overridable (`XML_CORPUS_ROOT`,
`XML_WASM`, `XML_DIFF_OUT`).

Current run, 8,889 files over all six corpora:

```
grammarNodes 5,899,555   grammarErrorNodes 48,847   grammarMissingNodes 9
filesWithGrammarError 177   filesUnparseableByRouter 0
symbolsEmitted 657,432      relationshipsEmitted 230,603
per-symbol class: 13 classes at recall 1 / precision 1
per-relationship class: 18 of 20 at recall 1 / precision 1
```

**The 36 `SPURIOUS` this document used to quote is now 595, and that is the
INSTRUMENT falling behind a correct analyzer rather than a regression.** M18 taught
the analyzer that `&name;` is a use and that the five predefined entities are
`builtin`, which added 5,350 `entity_reference` edges corpus-wide — 4,816 of them
`builtin`. This oracle declares nineteen relationship classes and
`entity_reference` is **not one of them**; the string does not occur in the file.
An oracle that derives none of them calls every one spurious.

The distinction is checkable rather than asserted, and it is worth stating how:
sample the artifact's `REL_SPURIOUS` list and **every** row either carries
`resolvable=builtin` or names an entity the document declares in its own DTD —
including `bigentname.xml`'s 3,965-character entity, correctly published by the
length-cap fix. A real fabrication would not look like that.

Deliberately **not** fixed here. Teaching this third oracle entity references is
real work, and the lane already has two that cover them: `deriveTreeEdges`' xml
branch in `script/m14/differential.ts` (which section E's 0/0 row rests on) and
`script/m12/xml-entity-accounting.mts` (the accounting identity over 11,940 sites).
Adding a third copy of that knowledge buys no additional coverage. The gap is
recorded in the artifact itself as `knownGapEntityReferenceCoverage`.

It once reported `contains-attribute` recall **0.910** and 76,372 spurious
relationships, and **both numbers were the oracle's error**. On
`grails-context.xsd` its namespace histogram is `[["…XMLSchema",1],["(none)",61]]`
— it resolved the XSD namespace for 1 of 62 elements and therefore published
owners as `xsd:element` where the analyzer correctly published `component-scan`.
Every "spurious" edge was that one scoping defect.

So the recall figure is not reported as a finding, and the oracle-free check
replaces it:

> **one symbol per `element` node in the tree, one per `Attribute` node, per
> file, equal on both sides, no tolerance.**

This is stronger than a recall percentage. It cannot be satisfied by publishing
the wrong *name*, and it cannot be satisfied by publishing anything *twice* — a
differential recall of 1.000 would pass both of those failures. It runs over 12
sources (39 elements, 40 attributes, all exact), and the gate's self-test carries
a mutation that loses an element and another that duplicates an attribute, so it
is known to be able to fail: **11/11 mutations caught**.

Two implementations disagreeing is evidence about both. A percentage computed
against a broken second implementation is a lie with a decimal point.

Still owed, and deliberately not claimed: the differential's 25 line mismatches
and 20,904 repeated identity keys, each of which has to be adjudicated against
the tree before it can be called a defect — the instrument that produced them is
the one shown above to be wrong.

## Corpus validation

Three independent instruments, none of which shares code with the analyzer's walk,
and the third one added by the ontology work above.

### Differential coverage — all six corpora

The differential is **not** a single-corpus gate. `script/m12/xml-differential-gap.mts`
runs the analyzer and the independent oracle over **all 8,889 tracked files in
every pinned repository** and buckets every `contains` edge by the ROLE that
emitted it:

| corpus | files | oracle `contains` | corroborated | unexplained | share |
|---|---|---|---|---|---|
| cxf | 2,439 | 76,310 | 76,310 | 1 | 0.0% |
| docx4j | 431 | 66,529 | 66,529 | 0 | 0.0% |
| grails-core | 314 | 8,327 | 8,327 | 0 | 0.0% |
| libxml2 | 1,311 | 23,652 | 23,647 | 24 | 0.1% |
| libxslt | 1,144 | 21,499 | 21,493 | 18 | 0.1% |
| maven | 3,250 | 53,786 | 53,786 | 0 | 0.0% |
| **total** | **8,889** | **250,103** | **250,092** | **43** | **0.02%** |

Read the columns carefully, because the two counts are of *different populations*
and conflating them is how this table previously acquired a total that was wrong
in the fourth digit. **`oracle` is distinct truth keys** (a `from`→`target` set, so
one key counts once however many writings produced it): 250,103. The analyzer
emits **250,135** `contains` edges — 250,092 corroborated + 43 unexplained — and it
is that larger figure which is the denominator for the percentage. The oracle set is
11 keys *smaller* than the analyzer's corroborated count, which is expected: the
set de-duplicates while the edge count does not, and the two `xml_*` residuals
below are exactly the files where one name has 200+ writings.

All 43 are **named rather than absorbed**, enumerated by the rule that emitted them
(`script/m12/xml-differential-gap.mts` publishes this table, with a corroborated
count per role):

| role | unexplained | reading |
|---|---|---|
| `pseudo_attribute` | 18 | a synthetic `xml-stylesheet` representation — an analyzer artefact rather than a fact in the tree, so the oracle correctly declines to corroborate it |
| `dtd_content_model` | 10 | self-references such as `contains dia:group -> dia:group`, where a DTD content model admits the element it belongs to and both readings are defensible |
| `dtd_ndata_notation` | 7 | the `NDATA`/`SYSTEM` notation of an unparsed entity; the oracle derives the entity, not its notation binding |
| `dtd_attribute_declaration` | 4 | an `<!ATTLIST>` re-declaring an attribute the oracle counts once |
| `xml_attribute` | 2 | the `libxml2` stress files where one name has 200+ writings |
| `xml_element` | 2 | the same stress files, element side |

18 + 10 + 7 + 4 + 2 + 2 = **43**, and none is a class the oracle claims to derive.
Publishing the roles is what keeps the number from decaying into a tolerance: each
row is individually falsifiable, so a new defect appears as a new row instead of
quietly shrinking a percentage.

Getting here meant fixing the **oracle**, not this analyzer: the review had
attributed the five-corpora gap to oracle coverage on the strength of a shape
rather than a measurement, and the measurement found six oracle defects — `id`
read as a name attribute, XSLT node-construction read as declaration, WSDL absent,
the whole DTD branch missing, a prefix slice where the LOCAL name was needed, and
RELAX NG wrong in two opposite directions that caught each other. Every one of
those is written up where it lives (the oracle's source, and
`reviews/xml/master-review.md` owed item 8).

**The pinned `grails-core` row did not move through any of the six fixes** — 100%
covered, MISSING=0, unexplained=0 throughout — which is the signature of a fix to
the instrument rather than to the analyzer.

Two declaration-vocabulary tables are kept, in this file and in the oracle,
**deliberately**: importing one into the other would make them agree by
construction, and an oracle that cannot disagree is a mirror rather than a check.
`script/m12/xml-vocab-tables.ts` is the defence against drift — it asserts the two
cover the same **namespaces**, which is the drift that produces thousands of
unexplained edges and an argument instead of a finding. It deliberately does not
assert the construct lists agree, because that is a semantic judgement and forcing
two copies to match textually would put the oracle's independence in the same
place. Failure-proven: removing WSDL from one table exits 1.

### Corpus inputs

- Manifest: `validation/m12/corpus/MANIFEST.json` (vendored; the corpora themselves
  live in the sibling worktree and are addressed by `XML_CORPUS_ROOT`) — six repositories at pinned
  revisions, 8,889 tracked files over seven globs (`*.xml`, `*.xsd`, `*.dtd`,
  `*.xsl`, `*.xslt`, `*.svg`, `*.rng`), deterministic lexicographic order.
  grails-core's 314 are 146 xml + 9 xsd + 4 dtd + 155 svg, so a lane that measured
  only `*.xml`/`*.xsd` was measuring 49% of the corpus it claimed. `*.wsdl` is
  NOT in the set: the engine does not claim it, and 805 such files are recorded
  as unrouted under the M60 #913 ruling to refuse rather than claim
- Pinned: grails-core `334007a`, docx4j `0e8e763`, libxml2 `c43dc98`, maven
  `d296cc33`, cxf `e43776be`, libxslt `ec95343`
- Error acceptance, grails 314 files: **0 unexpected error files, 0 crashes**,
  with **4 declared negative controls** — a file that MUST produce errors and did,
  so a gate that stopped parsing would fail rather than report zero
- Throughput acceptance, cfx 2,439 files: **0 unexpected error files, 0 crashes,
  21 declared negative controls**
- Evidence: `xml-corpus-errors.json`, `xml-corpus-complexity.json`,
  `xml-corpus-shapes.json`

The negative controls are the part that makes the zero meaningful. An error gate
that measures zero cannot tell "parsed everything" from "parsed nothing", so each
run names files that are expected to fail and fails the run if they succeed.
- Standalone tracked `*.dtd` files are an explicit boundary and are not
  falsely counted as XML documents.

## Gates, and the command behind every number above

Re-run from a clean checkout of `analyzer/XML` with `node_modules` present. Measured
2026-10-04 while six other lanes shared the same 8-core host at load 18, which is the
condition §8 item 3 is about — the worker count matters more here than anywhere else in
the project.

| command | result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx tsx script/m12/verify-regex-census.ts` | gate FAILED project-wide, **0 rows for `real-xml-analyzer.ts`** — census entries 26, HEAD scan 18, **17 missing + 25 stale**, and every one of the 42 rows belongs to another lane (css 11, scss 2, sql 1, svelte 3, clean 2, fsharp 4, javascript 1, python 1, typescript 6, vue 11). This lane's count is **0 before and 0 after** this round |
| `npx tsx script/m14/run-fixtures.ts --lang xml` | `{"xml":{"pass":28,"fail":0}}` — 28 since `xml/dtd-public-id-names-no-file` was added this round |
| `BB_MUTANT_ONLY="xml/" bun run script/m14/mutate-analyzer.ts` | **all 21 caught**, 0 survivors (filtered 1748 → 21) — not re-run this round; the two new mutants are in the lane-local suite below because `script/m14/mutate-analyzer.ts` is supervisor-owned |
| `npx tsx validation/m14/fixtures/xml/ontology-mutants.mts` | **21/21 caught**, 0 survivors. Added this round: `xml/public-id-published-as-an-import` (caught by `xml/dtd-public-id-names-no-file`) and `xml/notation-import-refused-entirely` (caught by `xml/dtd-public-id-names-no-file`, `xml/dtd-declarations`, `xml/dtd-self-named-external-id` — the over-correction is visible in three fixtures, the fabrication in one). Earlier, `xml/declaration-anchored-to-the-name-attribute-again` is caught **only** by `xml/declaration-range-contains-its-members` and localises there — it is invisible to the M19 line fixture, which is the measurement that the pre-existing suite had a hole in that shape |
| `BB_XML_WORKERS=1 npx tsx validation/m14/fixtures/xml/containment-ledger.mts` | **FULL POPULATION, 11,552 admitted files**, run after the parser-lifetime fix and the public-id withdrawal, and **two consecutive draws byte-identical**. `unparsedByOwnParser` **0** (was 3,039) · `filesWithParseErrors` 57 · `contains` **188,267 edges / 188,262 confirmed, rate 1.0000**, classes `A` 188,262 / `C-source-symbol-absent` 1 / `D-spans-disjoint` 3 / `G-collision` 1, **9 byte ranges held by 2+ names in 5 files** · direction B **787,972 candidate span pairs, 20 with no edge** · `imports` **468 edges / 468 tree sites / 0 with no site / 0 with no edge** (was 469 / 186 / 1 / 0). Before the earlier span fix, same instrument at 300 files: 3,909 of 4,383 = **89.2 %**, 253 colliding ranges |
| `npx tsx validation/m14/fixtures/xml/parser-lifetime.mts` | `ONE reused parser : failures=11552 of 11552, firstFailureAtIndex=8513` · `FRESH parser each : ok=0 parseFail=0 newParserThrew=11552 firstThrowAtIndex=0`. The wasm heap is exhausted at document 8,513 and a fresh `Parser()` cannot recover it — which is why the ledger's own `unparsedByOwnParser` was 3,039 |
| `BB_XML_WORKERS=1 npx tsx validation/m14/fixtures/xml/public-id-census.mts` | tree **299** `ExternalID`/`PublicID` nodes, **298** with a `SystemLiteral`, **1** pubid-only · edges **469** `imports`, `externalIdKind=system` **298**, `externalIdKind=public` **1** · both ones are `libxslt/tests/general/bug-52.xml:2`. Pre-fix figures; the post-fix re-run is in §Unresolved |
| `npx tsx validation/m14/fixtures/xml/dump-dtd.mts <file>` | prints the `doctypedecl` subtree to depth 4. On `bug-52.xml` it shows `GEDecl > ExternalID > SystemLiteral` beside `NotationDecl > PublicID > PubidLiteral` — the two shapes are different node types, which is the fact the fix rests on |
| `bun run script/m14/verify-analyzer-hygiene.ts` | **3 findings, 0 for this lane** — `cpp:170`, `haskell:1157`, `elixir:942`, all bare node-identity comparisons. MUST BE RUN UNDER BUN: under `npx tsx` it dies on `__dirname` in ESM scope (line 27). **It also rewrites `validation/m14/results/M14.0.F7.json` with findings from all lanes**, so running it from a lane worktree dirties a §8-owned artifact; this lane reverted that write and did not commit it |
| `BB_SPAN_MAX=400 npx tsx validation/m14/fixtures/xml/declaration-span-before-after.mts` | 36,774 symbols in **both** legs · **0 startLines moved** · **0 symbols added or removed** · spans held by 2+ names **253 → 0** · exits 2 rather than reporting if the stash did not take or the pop did not restore |
| `BB_XML_WORKERS=1 npx tsx validation/m14/fixtures/xml/ruled-gate.ts` | **run TWICE**, exit 0 both, full 10-row table both, **0 `[BB-PARSE-ERR]`, 0 `[BB-HANG]`** both, `FALSIFIED 0`, `ruled-without-justification 0` both. `XML_B_PROBE_WALK uses walked=11464 / 11473 unparsed=0 occurrences=0`. The two runs differ in admitted population (11,464 → 11,473, another lane added a repository mid-afternoon) and agree on every row — see §`contains 185,957 did not reproduce` |
| `npx tsx script/m14/ontology-coverage-gate.ts xml` | **6/10 EMITTED, 4 RULED-SOUND, FALSIFIED 0, ruled-without-justification 0** — exit 0. `contains` **186,233** on this run and 186,149 on an earlier run of the same commit at the same 8 workers, against **186,270** on two `ruled-gate.ts` runs at `BB_XML_WORKERS=1` — see §`countsAreDeterministic: true` was false. `references` 11,094 · `imports` 465 · `extends` 1,429 · `calls` 402 · `overrides` 3, byte-identical across all five runs. **Run through `ruled-gate.ts` at `BB_XML_WORKERS=1`, twice, both exit 0, both 0 `[BB-PARSE-ERR]` and 0 `[BB-HANG]`, both printing these numbers** — the shared gate at its own 8 workers cannot finish this corpus (it self-destructs at 120 s on one file before printing a row), so `ruled-gate.ts` is the instrument the numbers come from. See §`contains 185,957 did not reproduce` |
| `npx tsx script/m14/firing-check.ts --files 120 xml` | **4/10 fired, 1,653 edges, 120/120 files, 0 degraded** — `contains, imports, references, extends` |
| `BB_XML_WORKERS=4 npx tsx validation/m14/fixtures/xml/ontology-census.mts` | 2,500 files, **0 failed**, 388,365 symbols, 86,412 relationships, **0 empty names, 0 `unknown` endpoints**, draw `c38110881a301dae`, **1 file silently degraded** (`phpmyadmin/…/dark/col-minus.svg`, 359 B, 0 symbols) |
| `npx tsx validation/m14/fixtures/xml/worker-determinism-probe.mts --workers {1,8,16}` | `countsAreDeterministic: true` **falsified**. One 600-file draw, fingerprint `6ad7d4ddf1656e6f`: symbols 126,486 / 126,430 / 126,447, and **126,486 again at the same worker count on re-run**. A 1,200-file draw at 1 vs 8 workers: 230,021 both, **0 per-file differences**. `--diff` prints the per-file breakdown |
| `BB_XML_ROUNDS=20 npx tsx validation/m14/fixtures/xml/shared-parser-probe.mts` | sequential 223,400 symbols, **0 files vary**; concurrent(8) 221,087 symbols, **5 of 48 files return 0 symbols**, every losing result `success=true fallback=true errors=0` |
| `npx tsx validation/m14/fixtures/xml/derivation-accounting.mts` | `extends` fabricated **0 of 1,429** · `calls` fabricated **0 of 402** · call-site ledger **481 accepted = 481 occurrences, 0 unrepresented** · `references` fabricated **111 of 11,094** (was 1,066 of 10,411) · **0 edges with no site behind them** |
| `npx tsx validation/m14/fixtures/xml/concurrent-parser-probe.mts --files 600` | grade **INCONCLUSIVE**, exit 0 (control intact) |
| `npx tsx script/m14/verify-honesty.ts` | gate FAILED project-wide, **23 failures and 0 name an xml file** — 12 banned-term rows in other lanes' fixtures and `validation/` artifacts, `M14.0.F7` non-passing on `analyzer-hygiene-cpp` / `analyzer-hygiene-elixir`, 9 `declared inputs changed since <sha>` regeneration rows, and `freshness rule flags every artifact`. Not one is this lane's |
| `bun run script/m14/verify-doc-truth-emissions.ts --no-write` | gate FAILED project-wide, `UNDOCUMENTED=42 FALSE_NEGATIVE=7 MISSING_DOC=1 NO_CLAIM_TABLE=16`, and the single xml row is `UNDOCUMENTED [xml] contains` — the shared `parseClaimTable` first-row defect documented above, re-measured, unchanged |

The `firing-check` row reads **4/10**, where the round brief's table says 5/10 for this
lane, and the difference is **not** the `references` re-base. Measured both ways on the
same stride sample, `src/ast/real-xml-analyzer.ts` stashed and restored:

```
  analyzer stashed   xml  120/120  4/10  1,653 edges  0 degraded
  analyzer restored  xml  120/120  4/10  1,653 edges  0 degraded
```

byte-identical, so the re-base neither added nor removed a firing type on this sample. The
lost type is `calls`, whose 2 edges need an `xsl:call-template` whose target is declared in
the same file, and the admitted corpus has grown since the brief was written (11,066 files
/ 91 repositories → 11,456 / 110). The honest reading is that the stride sample no longer
reaches a `calls` file, which is the same "high score on few files is a warning"
situation the brief names for protobuf, pointed the other way. `calls` remains EMITTED at
402 edges on the arbiter's full-corpus run, which is the instrument that counts.

One of those rows is not a pass and is not written as one. The regex census gate
FAILS; this lane contributes **zero** of its 18 findings and the failure belongs to four
other lanes. Coverage as applicable is **6/10 EMITTED**, and the denominator shrank only by
RULED verdicts carrying a corpus measurement, taken from the arbiter rather than from this
lane. Of the four types the 120-file stride sample does not reach, all four are accounted
for: three are RULED with a corpus measurement behind the ruling, and the fourth is
`overrides`, whose 3 corpus edges sit in 3 of 11,456 files.

The firing-check edge count is also not comparable with a figure quoted for an earlier
corpus: the admitted population moved from 11,066 files / 91 repositories to 11,456 /
110, and this lane's own edge counts moved with it.

## Evidence pointers

- Ruling table: `script/m14/xml-ruled.ts` → `XML_RULED`, registered at
  `script/m14/ontology-coverage-gate.ts` lines 49 and 196; the arbiter prints
  `emitted 6/10  ruled-sound 4  FALSIFIED 0  ruled-without-justification 0` for `xml`
- Ontology census (production `parseFile`, 2,500-file stratified draw):
  `validation/m14/fixtures/xml/ontology-census.mts` →
  `…/ontology-census.json`. Pre-fix artifact for the same draw:
  `…/ontology-census-overrides-gap.json` (carries a `superseded` block)
- Determinism: `…/worker-determinism-probe.mts` (`--diff` compares two artifacts,
  per-file) and `…/shared-parser-probe.mts` (sequential against concurrent schedules).
  Both are what falsified `countsAreDeterministic: true`
- Ruling walk counts: `…/ruled-gate.ts`, `BB_XML_WORKERS=1`, full admitted population
- Derivation accounting: `…/derivation-accounting.mts` → `…/derivation-accounting.json`
- Containment ledger (Q3 for `contains` and `imports`): `…/containment-ledger.mts` →
  `…/containment-ledger.json`. Its `corpus` block states the population, the worker count
  and the fallback count, and `contains.spanCollisions` states the population it counts
  over, because that figure is compared with the next entry's
- Declaration span anchor before/after: `…/declaration-span-before-after.mts` →
  `…/declaration-span-before-after.json`. Two child processes, one per revision; exits 2
  rather than reporting if the stash did not take or the pop did not restore
- Range-shape fixture: `…/declaration-range-contains-its-members.xml` +
  `.expectation.json`, and the mutant that only it catches is
  `xml/declaration-anchored-to-the-name-attribute-again` in `…/ontology-mutants.mts`
- Fixtures: `validation/m12/fixtures/xml/`
- Ground truth: `validation/m12/ground-truth/xml.json`
- Differential: `validation/m12/results/xml-differential.json`
- Contract: `validation/m12/results/xml-contract.json`
- Corpus errors: `validation/m12/results/xml-corpus-errors.json`
- Complexity: `validation/m12/results/xml-corpus-complexity.json`
- Shape safety: `validation/m12/results/xml-shape-safety.json`
- Corpus differential: **vendored** — runner `script/m12/xml-corpus-differential.mts`,
  artifact `validation/m12/results/corpus-differential.json`. Both are in this
  repository and both are re-derivable from a clone (the corpus itself lives in the
  sibling worktree and is addressed by `XML_CORPUS_ROOT`).
  The grammar A/B probe, the conforming-parser verdict probe, the corpus manifest
  and the pre-repair wasm are vendored too, so **no number quoted in this document
  depends on an instrument outside version control**. What remains in the sibling
  worktree is scratch — the `dbg*.mts` debugging probes and the per-finding
  forensics output — which nothing cites.
- Lane registration and per-language record: `script/m14/completeness-inventory.ts`
  → `script/m14/spec/xml-completeness.json`, emitted by
  `script/m14/emit-xml-completeness.ts`
- M14 fixtures: `validation/m14/fixtures/xml/` (18 fixture pairs), mutants via
  `script/m14/mutate-analyzer.ts` (21, all caught, 0 survivors)
- Grammar A/B: `script/m12/xml-grammar-corpus-ab.mts` →
  `validation/m12/results/grammar-corpus-ab.json`; both wasms in-repo
  (`validation/m12/grammar/tree-sitter-xml.PRE-REPAIR.wasm`,
  sha256 `50ad134273834d5efe37…`) — **31 improved / 2 regressed / 8,855 unchanged**
- Grammar verdict vs a conforming parser:
  `script/m12/xml-grammar-verdict-vs-reference.mts` →
  `validation/m12/results/grammar-verdict-vs-reference.json` — **16 agree, 0 disagree**
- Corpus manifest: `validation/m12/corpus/MANIFEST.json` (vendored; corpora
  addressed by `XML_CORPUS_ROOT`)
- Declared-name line contract: `script/m12/xml-declared-name-lines.mts` — 8,889
  files, 52,651 declaration anchors, **0 mis-anchored**; 43 offenders and exit 1
  with the fix reverted
- Entity-reference accounting: `script/m12/xml-entity-accounting.mts` — 11,940
  `EntityRef` sites, 908 collapsed edges, **11,919 accounted**; the 21-site
  residual is declared by file and size and the gate exits 1 if any of it changes
- Differential corpus coverage: `script/m12/xml-differential-gap.mts` — 43
  unexplained of 250,135 `contains` edges over **8,889 files / all six corpora**
- Ontology arbiter, run against this lane's ruling table without editing the shared
  gate: `validation/m14/fixtures/xml/ruled-gate.ts` — full 11,456-file corpus at
  `BB_XML_WORKERS=1`, exit 0, **emitted 6/10 · ruled-sound 4 · FALSIFIED 0 ·
  ruled-without-justification 0**, with `XML_B_PROBE_WALK uses walked=11456 unparsed=0
  occurrences=0` beside the `uses` 0
- Concurrent-parser probe behind the §8 item 3 retraction:
  `validation/m14/fixtures/xml/concurrent-parser-probe.mts` →
  `validation/m14/fixtures/xml/concurrent-parser-probe.json` — 603 files (4
  known-trapping + 599 discovered) at n=1 and n=8, **0 traps at both levels**,
  identical 36,852 symbols / 8,452 relationships, grade **INCONCLUSIVE**
- Ontology census: `validation/m14/fixtures/xml/ontology-census.mts` →
  `validation/m14/fixtures/xml/ontology-census-overrides-gap.json`; lane mutants
  `validation/m14/fixtures/xml/ontology-mutants.mts` (**12/12 caught**)
- Vocabulary-table drift: `script/m12/xml-vocab-tables.ts` — analyzer and oracle
  cover the same 4 namespaces; exit 1 on drift
- Encoding recovery: `script/m12/xml-encoding-recovery.mts` — 22 files, 1,537
  symbols, 229 relationships, **with the predicate written into the script**
- Grammar provenance: `grammars/tree-sitter-xml/PIN.md`, verified by
  `script/m14/verify-grammar-pins.ts`
- Grammar corpus A/B: `script/m12/xml-grammar-corpus-ab.mts`, artifact
  `validation/m12/results/grammar-corpus-ab.json` — **both wasms now live in this
  repository**, so the comparison cannot go dead the way it did once by pointing its
  pre-repair arm at the patched build:
  `validation/m12/grammar/tree-sitter-xml.PRE-REPAIR.wasm`
  (sha256 `50ad134273834d5efe37…`, 50,008 B) and `wasm/tree-sitter-xml.wasm`.
  Re-run: **31 improved, 2 regressed, 8,855 unchanged** over 8,888 files
- Grammar verdict vs a conforming parser:
  `script/m12/xml-grammar-verdict-vs-reference.mts`, artifact
  `validation/m12/results/grammar-verdict-vs-reference.json` — **16 agree, 0
  disagree** over 16 accept/reject cases
- Corpus manifest: `validation/m12/corpus/MANIFEST.json` (vendored; six
  repositories at pinned revisions, 8,889 tracked files)
- Evidence scripts: `script/m12/xml-corpus-errors.ts`,
  `xml-corpus-measure.ts`, `xml-node-types-compare.ts`,
  `xml-contract-probe.ts`, and `regex-census.ts`

## Entity references: what is a use, and of what

`&name;` is a **use** of a declared entity, and the graph says so — one
`references` edge per (owner, name), collapsed, carrying `occurrences` and `lines`.
Two things about that are decided rather than incidental, and both were measured
first:

**Whose use it is.** A reference in element content belongs to that element. A
reference inside an entity's own **replacement text** belongs to *that entity*:

```xml
<!ENTITY shout "&greeting; THERE">   →   shout references greeting
```

`shout` cannot be expanded without `greeting`, so the dependency is real and it is
the entity's. Such a reference has no element above it, which is why the first
implementation dropped all of them — **611 of a 651-site shortfall**, and
`libxml2/test/recurse/lol_ig_content.xml` at 147 sites and 1 edge is the extreme.

**Whether it can be satisfied.** Three answers, and only three:

| `resolvable` | meaning | example |
| --- | --- | --- |
| `in-document` | the document's own DTD declares it | `&greeting;` where `<!ENTITY greeting …>` exists |
| `builtin` | the XML specification declares it in every document | `&lt; &gt; &amp; &apos; &quot;` |
| `unresolved` | neither — a real claim the document gets wrong | `&undefinedEntity;`, or `&nbsp;` in an XML document that never declares it |

`builtin` is exactly the five predefined entities (XML 1.0 §4.6) and nothing
else. Before that answer existed all five took `unresolved` and were stamped
`danglingEntityReference: true` — **4,575 sites across 180 files** where the
analyzer asserted that a well-formed document references an entity nothing
defines. The same argument X8 settled for the `xml` and `xmlns` prefixes, and the
same shape of knowledge as `BUILTIN_NAMESPACE_URIS`, which this analyzer already
carried for namespaces.

`&nbsp;` and `&d;` are **not** predefined, and that is the half that keeps the
rule honest: an XML document using an undeclared HTML entity really does reference
something undefined, and widening the builtin set until the five passed would be
the wrong fix with nothing to catch it.

There is **no length cap** on an entity name. The name is a substring of a file
already in memory, so a cap cannot bound what the file size has not already
bounded — and the 256 that used to be here disagreed with the uncapped
declaration path, leaving `bigentname.xml`'s 3,965-character entity in the graph
as a symbol with none of its uses.

Gated by `script/m12/xml-entity-accounting.mts`, which asserts the accounting
identity `sum(occurrences) == EntityRef nodes` and declares its 21-site residual
by file and size. Pinned by fixture `xml/xsd-entity-replacement-builtin` and
mutants `xml/predefined-entities-unresolvable` and
`xml/entity-replacement-text-ownership-dropped`.

`%pe;` is a different construct and is deliberately absent: a `PEReference`
inside an internal subset is a `DeclSep` separator, and outside one it is a
parameter-entity use. That distinction is recorded as owed rather than decided —
**24 `PEReference` sites** in the corpus, and a ruling is owed.

## Where a declaration's line comes from

A vocabulary declaration is written in an **attribute**, and a formatted document
routinely puts that attribute — or the value itself — on a different line from the
tag that opens the declaration:

```xml
<xsl:with-param          ← not where the name is
    name="content"      ← the name
```

A symbol and a `contains` edge therefore report **the line carrying the value**,
not the line carrying the tag:

| shape | anchor | example |
| --- | --- | --- |
| attribute and value on one line | the `Attribute` | `<xsd:attribute name="x" type="…"/>` |
| attribute and value on different lines | the `AttValue` | `<xsd:element name=` ⏎ `"InvalidModificationFault"` (`cxf/wsn/wsdl/rp-2.xsd`) |
| value with surrounding whitespace | the line carrying it, after the trim XSD value normalization performs | `name=" xmlns"` (`libxml2/…/spectest.xml`) |

The **structural** span is not lost. `metadata.elementRange` carries the element's
own range whenever a declared name was used, so a consumer that wants "where does
this element start" has it and a consumer that wants "where is this name written"
has `range`. Before this the two readings shared one field and one of them had to
be wrong.

Gated by `script/m12/xml-declared-name-lines.mts`, which reads the analyzer's
output and goes back to the **source text** — it cannot tell a wrong line from a
right one by agreeing with the analyzer. Pinned by fixture
`xml/xsd-declared-name-lines` (all three shapes) and mutant
`xml/declared-name-anchored-to-the-tag`.

This is the same rule as the `ExternalID` line contract above and the `#861` web
family finding, reached from the declaration side.

### The two grammar repairs

`grammars/tree-sitter-xml/` is vendored and patched, not consumed as an upstream
blob. Both defects are in the **grammar**, not in the analyzer, and neither is
reachable from an analyzer workaround — the tree does not contain the nodes:

1. **`common/scanner.h`** — the scanner ran a failing `advance_if_eq('\n')` on a
   PI's trailing whitespace, consuming the character on failure and losing text.
   Replaced with a non-failing `skip_if_eq`.
2. **`xml/grammar.js`** — `_intSubsetItem` was defined but unreachable, so an
   internal DTD subset's conditional section was not parsed as a conditional
   section. Added the rule and wired it into `conditionalSect`.

The pre-repair wasm is provably an **unmodified, current upstream v0.7.0 build**:
its enumerable surface is 143 ids / 51 named / 2 fields, a wasm built from
upstream HEAD has the same surface with a zero set difference in both directions,
and behaviour is identical on all 29 constructs of the A/B battery. The repairs
were therefore necessary rather than opportunistic.

Corpus A/B, 8,888 files / 6.69M nodes: 31 files repaired, 2 moved, 8,855
unchanged. MISSING nodes fell 32 → 10. Both movements were adjudicated as
standalone-DTD and libxml2 negative controls, not as repairs. Independently, the
16-case expat oracle agreed on 16/16 accepts and rejects, which is what retracted
an earlier third "defect" that a hand-read of one file had suggested.

## §8 — changes this lane needs in files it does not own

Recorded precisely enough to apply without re-deriving. None of these is edited here.

**1. `script/m14/ontology-coverage-gate.ts` — wire the xml ruling table (2 lines).
RESOLVED, and the doc is the last artifact still saying otherwise.** `RULED_BY_LANG`
was a literal with no extension point, so run against `xml` the gate printed
`no RULING TABLE for xml` and exited 2. It is now wired at lines 49 and 196 and the
arbiter reports for this lane:

```
emitted 6/10   ruled-sound 4   FALSIFIED 0   ruled-without-justification 0
```

`validation/m14/fixtures/xml/ruled-gate.ts` remains useful and still passes — it runs
the arbiter over the full 11,464-file population at `BB_XML_WORKERS=1` and prints the
per-probe walk count beside every instrument-B 0, which the shared gate does not. It is
no longer needed to prove the wiring, only to prove the walk.

**1a. This should be an extension point, not a one-lane edit, and the round brief is
what shows it.** The brief asks every lane to "register it in
`script/m14/ontology-coverage-gate.ts` `RULED_BY_LANG`", and it names 17 lanes with no
ruling table. A literal map entry per lane is 17 edits to one shared file by 17 agents
working concurrently — which is how two analyzers end up interleaved in one file. The
change that serves all of them is a directory scan instead of a literal, in the spirit of
what `run-fixtures.ts` already does for fixtures:

```ts
// replace the literal with: import every ./<lang>-ruled module present on disk
const RULED_BY_LANG: Record<string, Ruled[]> = Object.fromEntries(
  readdirSync(path.join(import.meta.dirname, "."))
    .filter((f) => f.endsWith("-ruled.ts"))
    .map((f) => [f.replace(/-ruled\.ts$/, ""), loadIt(f)]),
)
```

with `Ruled` exported from a shared type module so each lane's table typechecks against
the gate's own shape rather than restating it (this lane restates it at `xml-ruled.ts:146`
because there was nowhere to import from). A missing table then stays a refusal, which is
the current correct behaviour, and each lane lands its own file with no shared edit at all.

**1a. The same gate should refuse before it walks, not after. STILL OPEN.** The
`if (RULED_BY_LANG[LANG] === undefined)` check sits at line 338, *below* the `parseFile`
worker pool (line 226) and both instrument loops (lines 250, 264), so an unwired lane pays
a full corpus parse and a full grammar inventory and then prints `no RULING TABLE`.
Moving the check above the corpus walk costs nothing and stops the walk from dying to
`BB-HANG` first — measured: run unwired, `xml` printed `corpus: 11456 admitted files` and
then exited on a hang without ever reaching the refusal that was its whole answer. It no
longer costs this lane anything, because `xml` is wired; it costs the next lane that is
not.

**2. `script/m14/ontology-coverage-gate.ts` — `rulingFor` must match by identity, not
by prose. HALF RESOLVED, and the half that matters here is now identity.** `rulingFor`
used to select a spec decision by testing its `resolution` text for the type name
(``new RegExp(`\\b${t}\\b`)``, plus a backticked variant) and return the first hit, so a
type with 0 emitted edges was ruled by whichever decision happened to use its name in
prose. On this lane that graded `extends` RULED-SOUND on `XML-ONTOLOGY-IMPLEMENTS`,
because that resolution says "an implements/extends clause" — a false verdict on the
lane's own emitted type. `rulingFor` now checks the lane's `RULED` table FIRST, by
`r.type === t` (line 292), which is identity. **What is left is the spec path**, which
is still prose-matched below that line and still reachable for any type this lane does not
rule in its own table. This lane currently rules all four of its unadjudicated types in
`script/m14/xml-ruled.ts`, so the spec path is not what grades it and the defect is not
reachable from here — but it is reachable from a lane whose table is partial. The fix is
the decision's own `relationship` field, which the emitter already writes
(`"relationship": "extends"`), compared for equality, with the prose test deleted rather
than kept as a fallback — a fallback preserves the defect.

**3. `src/ast/engine.ts:1442` — the per-file self-destruct ends the whole run, and the
fault is NOT the XML grammar.** The 120 s timer calls `process.exit(1)`, so one
unparseable file kills every worker and prints either no verdict table or an
undercounted one (table in §Relationship ontology).

**This item previously blamed the grammar and that attribution was wrong; it is
retracted here rather than edited away.** The earlier text said the underlying fault is
"in the XML grammar's wasm memory" on the evidence that the failing paths repeat and each
hang is preceded by a parse error on the same path. Two measurements remove that support.

**The sizes do not correlate.** Every corpus file observed tripping either diagnostic is
between **459 and 1,254 bytes** — measured, and the sizes are in
`validation/m14/fixtures/xml/concurrent-parser-probe.json` →
`observedFailingPathBytes`. A 459-byte document cannot exhaust a wasm heap, so
"pathological input" has nothing to stand on. The earlier text also described "a parser
that faults on a 40 KB SVG"; no such file appears in any failing set.

**The fault tracks concurrency, not the document.** Same runner, same corpus, same
patches, one variable:

| `BB_XML_WORKERS` | `[BB-PARSE-ERR]` | `[BB-HANG]` | gate exit | verdict table |
| --- | ---: | ---: | ---: | --- |
| 1 | **0** | **0** | 0 | printed, full |
| 8 | 8 | 3 | 1 | **none printed** |

**What that does and does not settle.** It settles that the trigger is not the file. It
does NOT settle the mechanism, and the honest report is that I could not separate two
things that moved together: raising the worker count raises in-process concurrency AND
raises the process's memory footprint. The host during the 8-worker runs was at 15 GB RAM
with 13 GB used, 0 free, 8 GB of swap in use and ~38,000 pages/s of major faults at load
18 on 8 cores — which is also when the earlier standalone measurement of one 459-byte
"hanging" file took 1.7 s and a 907-byte one took 57 ms.

So the two candidate mechanisms, neither measured to be the cause:

  - **Reentrancy on a shared instance.** `getParser` caches ONE `Parser` per language
    (`parsers.get(language)!` in the `MAX_PARSER_CACHE_SIZE` map) and `parseFile` calls
    `parser.parse(content)` on it. `TSParser` is stateful, so concurrent calls on one
    instance are undefined behaviour, and undefined behaviour inside wasm surfaces as a
    trap or as a call that never returns — which is exactly the pair of diagnostics seen.
  - **Use-after-free on the eviction path.** `currentCount >= 500` calls `p.delete()` on
    the cached parser and drops it from the map while sibling workers may still hold the
    reference and be inside `parse()`. On an 11,456-file corpus that eviction fires 22
    times, each with up to 7 siblings in flight.

`validation/m14/fixtures/xml/concurrent-parser-probe.mts` drives the production
`parseFile` over the 4 known-trapping inputs plus a deterministic discovered sample at
n=1 and n=8 and grades the result three ways, because a probe that only knows how to
report the case it was built to find will report its conclusion on a run that found
nothing. Measured over **603 files** (4 known-trapping + 599 discovered):

```
serial     n=1 files=603 parsed=603 threw=0 traps=0 recoveryLabels=20 symbols=36852 rels=8452
concurrent n=8 files=603 parsed=603 threw=0 traps=0 recoveryLabels=20 symbols=36852 rels=8452
GRADE INCONCLUSIVE: no wasm trap at either level
```

**INCONCLUSIVE is the result, and it is reported as one.** At n=8 on a host with memory to
spare, 603 files produced output byte-identical to the serial level — same 36,852 symbols,
same 8,452 relationships — and none of the four known-trapping inputs trapped. So this
probe does **not** establish the reentrancy reading, and it must not be quoted as if it
did. What it does establish is the refutation above: the four files are sound here, at
both concurrency levels, so the fault is not in them.

**AND NOW THE SECOND HALF IS MEASURED, by a probe that could have said no.**
`validation/m14/fixtures/xml/shared-parser-probe.mts` asks the question the 603-file probe
could not: not "does a trap occur" but "does a concurrent schedule return FEWER SYMBOLS for
the same bytes". 48 files, 20 rounds, sequential against 8-in-flight, one process:

```
sequential  223,400 symbols · 0 of 48 files ever vary
concurrent  221,087 symbols · 5 of 48 files return 0 symbols in some rounds
LOST Exposed/.idea/icon.svg:  success=true fallback=true errors=0 rels=0 size=2997
LOST Documenter.jl/test/examples/images/big.svg:  success=true fallback=true errors=0 rels=0 size=113087
```

So the shared-instance reading is **supported, not established**: the concurrent schedule
loses whole files to a silent `extractFallback` substitution, and the file count that
varies is 0 out of 48 under a serial schedule in the same process over the same bytes. The
falsifier is stated rather than implied — the 1,200-file draw at 1 and 8 workers returned
**230,021 symbols both with 0 per-file differences** — so neither the worker count nor the
500-parse eviction boundary is *sufficient* to trigger it, and this lane does not claim
which of the two candidates in the list above is the cause.

**What is needed, precisely enough to apply without re-deriving it.**
`src/ast/engine.ts`, `getParser`: hand each parse its own `Parser`, or wrap the cached
entry in a borrow count so a `Parser` is never `delete()`d or shared while a `parse()` is
in flight — the two eviction sites are `cleanupParsers()` at `MAX_CONCURRENT_PARSERS = 20`
and the `currentCount >= 500` recreate. `src/ast/pool-worker.ts`, `parseFile`'s catch: the
`extractFallback` substitution returns `success: true` with `errors: []`, which is why the
loss is invisible; it must carry an `errors` entry naming the grammar-load failure and the
fallback, so a degraded file is countable rather than indistinguishable from an empty one.
Neither edit is in this lane (§8).

Two defects were found while building that probe and are recorded because both would have
produced a confident wrong answer. It first counted every entry in `result.errors` as a
failure, which graded `INPUTS UNSOUND` and exited 2 on 20 `Syntax error (unexpected node)`
entries — those are this analyzer's **recovery labelling** for a tree-sitter ERROR node
(`AnyFeed.xml`, `JsonInXml.xml` are damaged input by construction; `xml/recovery-labelling`
pins the behaviour), not traps, and conflating them graded the wrong diagnostic. And its
600-file discovered sample contained only **1 of the 4** known-trapping paths, because the
rest sort past the cap — so it graded a claim about files it had never parsed. The failing
paths are now added to the input set rather than sampled from it, and the probe exits 2 if
any of them fails to reach the measured set.

The fix needed here is unchanged in direction and different in content: the timer should
abort the FILE, not the process; the cached `Parser` should not be shared across
concurrent `parse()` calls nor `delete()`d while in flight; and the trigger still needs its
own diagnosis, which this lane cannot supply because `engine.ts` is supervisor-owned and
the two candidate causes cannot be separated without control over host memory.

**4. `script/m14/differential.ts` — `LANG_REPOS` has no `xml` entry.** `--lang xml`
prints `SKIP xml: no corpus repo mapped` and measures 0 lanes, so **Q3 (Correct) is
unanswerable for five of the six emitted types** and this lane's DERIVATION debt is
6 of 6. `extends` is the sole exception and only because the probe added for item 2
doubles as an oracle (it agrees 4 edges / 2 files against the analyzer's 4 / 2).

**5. `script/m14/verify-doc-truth-emissions.ts` — `parseClaimTable` drops the first
data row of every claim table.** `if (isRuleRow(cs)) continue` already consumes the
`---` rule, and the `if (!started) { started = true; continue }` line below it then
discards the NEXT row as well. Minimal repro — 3 rows in, 2 out, the missing one being
the first:

```
| Relationship | Emitted? |
| --- | --- |
| `calls` | yes |
| `contains` | yes |
| `imports` | no |
```

Deleting that second skip restores the first data row for all 32 affected docs
(`contains` for xml, elixir, erlang, go, haskell, objective-c, rust, swift; `calls`
for 14 more; `implements` for lua; `references` for protobuf; `extends` for zig).
`contains` was LEFT in first position in this lane's table on purpose — reordering it
would move the defect to another type and make this lane look clean while hiding the
bug.

**7. `src/ast/pool-worker.ts:1020-1067` — the per-symbol `metadata` whitelist drops 14 of
the 15 keys this lane emits, and no fixture in the repository can see it.** The block
copies a closed list of `metadata` keys and ends
`return Object.keys(out).length > 0 ? out : undefined`, so a lane with nothing on the list
gets **no metadata object at all**. Every key on the list was added by a CSS or a markdown
wave (`declaresProperties`, `isSelector`, `headingLevel`, `isRepeatedSite`, `nodeType`), and
the reasoning printed above the markdown keys says so: *"each of these is READ by a check"*.

Measured on `declaration-range-contains-its-members.xml`, the same 15 symbols through the
analyzer and through production `parseFile`:

| survives | dropped |
| --- | --- |
| `nodeType` (15) | `namespaceUri` (13), `attributeName` (9), `isXmlAttribute` (9), `isXmlNamespace` (9), `namespacePrefix` (9), `value` (9), `isXmlElement` (6), `isSchemaConstruct` (6), `declaredName` (4), `declarationKind` (4), `declaredByAttribute` (4), `isVocabDeclaration` (4), `elementRange` (4) |

Three consequences this lane can name and cannot fix:

1. **The declared-name mechanism is invisible in the index.** §Declared names, not written
   prefixes describes `declaredName` / `declarationKind` / `namespaceUri` / `tagName`, and a
   consumer reading `brain_symbol.annotations` sees none of them. A reader cannot
   distinguish a declaration symbol from a tag-named one, so the doc's central claim — that
   `xs:element` is `catalog` rather than `xs:element` — is checkable in the analyzer and
   unverifiable in the store.
2. **`elementRange` is dropped, and that is the field M19's fix exists to preserve.** The
   comment at `real-xml-analyzer.ts:875` says the structural span is kept "so a reader can
   still find the element itself". No such reader exists on this path.
3. **A fixture cannot assert any of them**, which is why
   `xml/declaration-range-contains-its-members` pins byte offsets and symbol names and says
   in its own `rationale` that `meta.isVocabDeclaration` is deliberately not asserted. A
   fixture that asserted it would fail against correct code, and the honest fix is the
   whitelist rather than the fixture.

**What is needed, precisely enough to apply without re-deriving it.**
`src/ast/pool-worker.ts`, the `metadata:` IIFE at line 1020: carry the keys a consumer
reads rather than the keys one wave added. For this lane that is at minimum `declaredName`,
`declarationKind`, `declaredByAttribute`, `isVocabDeclaration`, `namespaceUri`, `tagName`,
`writtenName`, `elementRange`, `isXmlElement`, `isXmlAttribute`, `isXmlNamespace`,
`namespacePrefix`, `attributeName`, `value`, `isSchemaConstruct`. Whether the right shape
is a per-language list (as `run-fixtures.ts` already does for fixtures) or a
pass-through-with-a-cap is a call for the owner; the pass-through is one line and the cost
is a wider `annotations` column. **Before it is changed, the measurement that says the
whitelist is too narrow is itself only reproducible from a lane instrument:** no shared gate
in the repository compares an analyzer's `metadata` against the worker's, because
`runLang`-based fixtures read the analyzer's return value and never cross the boundary.
`validation/m14/fixtures/xml/containment-ledger.mts` is the instrument that did, and it is
in this lane's tree.

**6. `src/ast/engine.ts` `resolveWasm` — 20 GB of leaked grammar copies in `/tmp`, and
the cost was assessed as "only" when it was bytes.** The registry fallback writes the
grammar to `os.tmpdir()/bb-wasm_<path>_<pid>_<hrtime>` and deliberately does not unlink
it, because a concurrent process may be reading it. The comment states the trade
explicitly: *"the per-process tag already makes an unbounded tmpdir growth the only
cost."* That reasoning holds while the growth is bytes per process. It is no longer a
per-process cost, because `procTag` is recomputed on **every** call — so a single
long-running process leaks one copy per parser recreation, and `getParser` recreates the
parser every 500 parses.

Measured on this host, 2026-10-04:

| | |
| --- | ---: |
| leaked `bb-wasm_*` files in `/tmp` | **7,382** |
| total size | **20 GB** (1,405,135 B per bash copy) |
| `/tmp` total | 36 GB |
| root filesystem | **92 % used** (397 GB of 460 GB) |
| accumulation window | 2026-10-01 04:11 → 2026-10-04 04:54 |
| distinct writer processes | 7,383 |

By grammar: zig 1,561 · json 1,113 · nim 1,029 · **xml 942** · sql 883 · protobuf 636 ·
css 292 · bash 234. No lane owns this file, and no lane can fix it from its own worktree.

The fix is small and does not need the unlink that was correctly rejected: the
per-process tag only needs to be per-process, not per-call. Deriving `procTag` once per
process (module scope) rather than inside `resolveWasm` makes every call in a process
resolve to the SAME path, so the write becomes idempotent and the leak stops at one copy
per process per grammar — roughly 23 processes × 8 grammars instead of 7,382 files. A
process-exit hook may then unlink its own tags safely, because by definition no sibling
is still writing them. Alternatively a startup sweep of `bb-wasm_*` files whose owning
pid is no longer alive is safe by the same argument, and reclaims the 20 GB immediately.

This is filed as §8 rather than fixed here for a second reason: it is the most likely
contributor to the memory and I/O pressure documented in item 3, and cleaning `/tmp` from
this lane would risk the exact bug the per-process tag was added to prevent — deleting a
file another lane's process is mid-`Language.load` on, which silently degrades that lane
into the 0.4/0.5-confidence regex extractor. It needs an owner.

**8. Any lane instrument that builds its own tree-sitter parser will silently truncate,
and there is no shared gate that can see it.** This is the same wasm heap as items 3 and
6, reached from a different direction, and it is reported here because the fix is one line
in the caller and there is no gate anywhere in the repository that would notice.

`validation/m14/fixtures/xml/parser-lifetime.mts` over 11,552 corpus files:

```
ONE reused parser : failures=11552 of 11552, firstFailureAtIndex=8513
FRESH parser each  : ok=0 parseFail=0 newParserThrew=11552 firstThrowAtIndex=0
```

The parser served documents `0..8512` and then failed on **every one of the remaining
3,039**. A tree-sitter `parse()` call in `web-tree-sitter` is ASYNC, so N holders of one
instance interleave inside the WASM module — the same reentrancy item 3 names as candidate
mechanism one — and the failure mode is not a thrown error but a silent `Abort` after which
the instance never recovers. The two lines together are what make it diagnosable rather
than merely mysterious: a fresh `Parser()` throws at index **0**, so the heap is spent
process-wide, which rules out "a bad file" and rules out the obvious repair.

The consequence for an instrument is that its coverage claim becomes unfalsifiable. This
lane's ledger reported `sitesOnTree 186` and `sitesWithNoEdge 0` — which reads as complete
coverage of 186 sites and says nothing about the other 283 edges — while its own
`unparsedByOwnParser` field held the only evidence, and that field read as a corpus
property. Site coverage of `imports` edges was **39.7 %** reported as **100 %**. Nothing
errored, nothing was flagged, and two draws agreed with each other, so every reproducibility
check this lane had would have passed.

Two things would serve every lane, and neither is this lane's to make:

  - **Use `ASTEngine.parseTree`.** It is the entry the production analyzers get their tree
    from, it deletes each tree in a `finally` (`src/ast/engine.ts:1972-1981`), and it keeps
    parsers in an evicting pool (`src/ast/engine.ts:189-195`, recreate every 500 parses).
    A census that walks its own tree beside `parseFile` has re-implemented the one part of
    the engine that was already correct, and gets it wrong in the direction that flatters
    the analyzer. This lane's fix was to delete its own parser, which is the whole change.
  - **A shared arity guard in the instrument layer.** Any probe that parses more than N
    files with one instance should count consecutive failures and REFUSE to report, the way
    `ruled-gate.ts` already refuses when the per-probe walk count line is absent
    (§Relationship ontology). The failure is silent, periodic and self-consistent, so no
    amount of re-running detects it; only a counter can.

## Issue

M12.35 / GitHub issue #174.
