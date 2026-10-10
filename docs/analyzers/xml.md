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
| extends | 1,429 | 84 | 991 | **354** | **94.1%** | 354 |
| **TOTAL** | **202,725** | **190,517 (94.0%)** | 8,854 | **631** | **4.7%** | 3,354 |

Raw: [`residual-after-claims.txt`](../../validation/m14/fixtures/xml/residual-after-claims.txt),
[`residual-true-population.txt`](../../validation/m14/fixtures/xml/residual-true-population.txt)
(the 6.0% state before the claim mapping).

The claim mapping of §3 is the last column's delta: **unresolved 3,354 → 631 (−81%)** and the
lane's residual **6.0% → 4.7%**, with `extFAIL` 0 at every step. What is left is `extends` (94.1%)
and the ambiguity of `references`/`calls`/`extends`.

> `contains` is 189,310 resolved of which **183,888 (97.1%) are resolved AMONG A COLLISION** — the
> tie-break chose the row. The gate prints that as an upper bound on arbitrary bindings, not a count
> of wrong ones; only the store can split it (the indexer measures 37,318 of 49,729 such picks as
> wrong). That is the honest next question on this type, after `extends`.

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

## Method notes

- One cause per turn, one commit per verdict; a cause is closed by a before/after over a named
  population or by a ruling with evidence.
- Corpus-scale runs are guarded with `( flock … ) 9>.bb-heavy-v2.lock` (the original lock was found
  stuck with no visible holder). A run that exits 9 on a lock timeout is reported **KILLED** with no
  output, never as a measurement about the lane.
- The store instrument writes `~/.bb/projects/<id>`; under this sandbox `/` is read-only outside the
  workspace, so it must run with `HOME` relocated into the workspace. Without that it dies `ENOENT`
  in a way that reads like a code error.
