# XML — the residual record

> The analyzer's contract lives in [`real-xml-analyzer.md`](./real-xml-analyzer.md) (not this
> lane's file to edit this wave). This page is the **residual** record: what is not yet real
> about the edges xml emits, which population each number is over, and what has been ruled.
> Machine-readable companion: [`residual-baseline.json`](../../validation/m14/fixtures/xml/residual-baseline.json).

## State, 2026-10-09

The board carries `xml 93.9% residual — 28,477 ambiguous + 332 unresolved of 30,676 edges`.
Two things are true about that sentence, and both were measured rather than argued.

### 1. It is measured over 18% of the lane

| | files | `contains` edges | `references` edges | `imports` edges |
| --- | ---: | ---: | ---: | ---: |
| the board's instrument (`incoming-gate.ts xml xml 0`) | **2,081** | 30,205 | 335 | 136 |
| this lane's declared corpus (`coverage-census.json`) | **11,552** | 188,224 | 11,108 | 468 |
| share | 18.0% | 16.1% | **3.0%** | 29.1% |

The instrument admits one extension; the language router maps six to `xml`
(`.xml`, `.xsd`, `.xsl`, `.svg`, `.dtd`, `.rng` — measured through
`detectLanguageFromPath`). The excluded mass is 8,419 SVG files plus the XSL and XSD
populations, and it carries 97% of the lane's `references` edges and 84% of its `contains`
edges. The gap is not a judgement call: `incoming-gate.ts`'s own `LANES_B` table records the
identical defect and its fix for yaml —

> `BOTH SPELLINGS, because one language does not become a different population by being spelled
> .yml. Measured on ansible — 13 .yaml files against 2,068 .yml, 2,081 combined — so the --all
> table was measuring 0.6% of the lane's files and reporting the 13-file verdict as the lane's.`

— and still reads `xml: "xml"`. The one-line change is
`xml: "xml,xsd,xsl,svg,dtd,rng"` in `script/m14/incoming-gate.ts` (+ the same map in
`script/m14/residual-gate.ts`). Both files are outside this lane's write scope; reported, not
edited.

**Consequence for reading this page:** every before/after below names its file population. A
number without one is not comparable to the board's.

### 2. The largest bucket is the gate's model, not the graph

`contains` is 28,413 of the 28,809 residual edges (98.6%). It is not 28,413 broken edges:

| | edges | resolved | ambiguous | residual |
| --- | ---: | ---: | ---: | ---: |
| gate's key-space model (2,081 `.xml`) | 30,205 | 1,792 | 28,413 | **94.1%** |
| the real store (`store-binding-truth-120`, production indexer) | 3,097 | 3,048 bound | — | **1.6% unbound** |

The real-store instrument copies a draw into a scratch project, runs the **production**
`indexProjectParallel`, and reads `brain_relationship.target_symbol_id` out of the table:
`bound 3,048` of 3,097 (**98.4%**), of which `boundSameFile 3,033` (**97.9%**),
`targetUnbound 49` (**1.6%**), `boundOtherFile 15` (0.5%), `crossFileFlagWrong 0`.

**Why the two disagree.** Production resolves a `contains` edge **at insert time** by
`(leaf(target) as a name, the edge's OWN FILE first, then the nearest line)`
(`parallel-indexer.ts` `resolveContainsTargetStmt`; kept eager for `contains` even where every
other type defers). The gate's `classifyEdge` receives only a project-wide declaration count
keyed by name and qualified-name alias — it has no file parameter and no line parameter, so it
cannot express "the declaration in this edge's own file" and reports a collision whenever a bare
local name (`path`, `name`, `item`, `template`) occurs more than once in a repository.

The caveat runs **against** the flattering reading, so it is stated: the store draw pools 120
files from 120 repositories into one key space, which is *harsher* than production's per-repo
scope; and the gate table is the 2,081-file `.xml` corpus. A same-project run on one repository
(both instruments) is the next measurement.

**What is real for `contains`:** 1.6% unbound and 0.5% cross-file in the store draw. The edges
themselves are genuine — the lane's containment ledger checks every emitted edge for a real
nesting behind it on the parse tree: `188,219 of 188,224` confirmed (99.997%). So the only open
question was ever target resolution, and the endpoints are real.

Split by what the edges share (whole 11,552-file corpus, `role` metadata):
`xml_attribute` 111,060 · `xml_element` 64,173 · `xml_namespace` 12,743 · DTD/PI/pseudo 248.

### 3. The real residual, and its mechanism

| type | edges | resolved | ambiguous | unresolved |
| --- | ---: | ---: | ---: | ---: |
| contains | 30,205 | 1,792 | 28,413 | 0 |
| references | 335 | 73 | 64 | **198** |
| imports | 136 | 2 | 0 | **134** |

`extFAIL 0 · bindFAIL 0 · causeFAIL 0`.

The 332 unresolved edges are the genuine defect class, and the analyzer already knows what they
are: `real-xml-analyzer.ts` publishes `metadata.resolvable` ∈
`in-document | builtin | external | unresolved` on exactly these edges. What it does **not**
publish is any of the claim keys the gate verifies
(`isExternalTarget`, `importProjectFile`, `importOutsideProject`, … — `incoming-rule.ts`
`EXTERNAL_KEYS`/`FILE_CLAIM_KEY`/`IMPORT_CLAIM_KEY`). An unmarked external target is
indistinguishable from a broken one to the gate, which is the gate's stated rule: *"an unmarked
external edge is indistinguishable from a broken one, so it counts against the lane."*

Mapping each resolvable class to its claim is the next cause. It is not a relabel: `builtin`
and imported-namespace targets are different claims with different verification (owner lookup vs
the project's own file list), and a claim the key space can answer is **refuted**, not accepted.

## Method notes

- One cause per turn, one commit per verdict; a cause is closed by a before/after over a named
  population or by a ruling with evidence (this page's §2).
- Corpus-scale runs are guarded with `( flock -w 600 9 || exit 9; … ) 9>.bb-heavy.lock`. A run
  that exits 9 on the lock timeout is reported as **KILLED** with no output, never as a
  measurement about the lane.
