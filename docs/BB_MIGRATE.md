<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the hand-written reference for bb_migrate: what a request
means, what every result block is computed from, what is measured versus declared,
and the limits a reader must know before quoting an effort figure.
WHO IT IS FOR — callers planning a cross-language migration through the MCP tool,
the CLI (`bb tool bb_migrate`), or the library, and the maintainers of the planner.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_migrate/{handler,descriptor}.ts,
src/intelligence/migration/{migration-engine,migration-source}.ts,
src/ast/cross-language-migration-assistant.ts, script/tool-docs/curation/bb_migrate.ts,
and the gates named at the bottom.
-->

# `bb_migrate` reference

`bb_migrate` is a read-only migration planner. It accepts `symbolNames`, indexed
`symbolIds` and project-relative `paths`, unions them into one request, and produces
at most one plan per component with dependency order, parallel-workable waves, an
effort model built from declared rates, a scope-completeness statement, and explicit
refusal and truncation records. It does not generate, replace or compile
target-language source, and it never reindexes on a read.

## Request model

| Selector | Meaning |
|---|---|
| `symbolNames` | component names; a name matching several symbols in different files is refused with candidate ids |
| `symbolName` | legacy single-symbol spelling; when supplied with `symbolNames` the entries are **unioned**, never silently dropped |
| `symbolIds` | indexed symbol ids, the only unambiguous selector. Shape: `<projectId>:<relative file>:<name>:<line>` |
| `paths` | project-relative file or directory paths (absolute paths inside the project are accepted); every indexed symbol inside them joins the request |

`symbolIds` and `paths` union with `symbolNames`; a component named through more than
one entry is planned **once**. The request is capped at **100 entries**, and each
entry resolves to at most one component before any relationship is read, so a common
name cannot expand the load past the cap.

A name is not an identity. When a name matches several components in different files
the tool refuses that entry and returns the candidate ids; re-run with `symbolIds`.
One exception is not ambiguity: two functions in the **same file** that differ only in
case (`execute`/`Execute`) are one component per file, and an exactly matching
spelling resolves to it.

## What a result contains

- `plans` — one per planned component, each with its `symbolId`, `sourceLanguage`,
  `targetLanguage`, `sourceFile`, `effortEstimateHours`, `complexityScore`,
  `riskAssessment` (`level` plus the measured factors), `dependencies`,
  `inferredDependencies`, `relationshipEvidence` and `dependencyProvenance`
- `dependencyOrder`, `waves`, `cohort.wavePlan` — the deterministic dependency order,
  its depth layers, and the same partition keyed by symbol id
- `cohort` — what the request resolved to: symbols, paths matched/unmatched, files
  covered, a by-file and by-wave rollup, the source-language mix, refusals by reason,
  and `cohort.work` (what the call actually read, against the project's own totals)
- `scope` — how much of the cited integration surface the request covers
- `effort` — one authoritative total plus the arithmetic that reconciles it with the
  per-plan figures
- `methodology` — the declared rates as data, the charged-edge split by relationship
  kind, the deduplication rule and the ordering rule
- `unsupported` — every entry that produced no plan, with a typed reason
- `truncation` — the cap and duplicate reductions, with the dropped entries named
- `freshness` (JSON) and per-plan `stale` flags

## Evidence: read, not invented

`brain_relationship` rows are read with the columns a migration plan needs:

| Field | Source column | Meaning |
|---|---|---|
| `line` | `line_number` | the index's line for the edge, when it has one |
| `confidence` | `confidence` | the indexer's own 0–1 value; a measurement, not strength |
| `isCrossLanguage` | `is_cross_language` | whether the edge crosses a language boundary |
| `bridgeMechanism` | `bridge_mechanism` | how the boundary is bridged, when recorded |
| `isCrossFile` | `is_cross_file` | whether the endpoints live in different files |
| `sourceExternal` / `targetExternal` | same | the name of an endpoint that is not an indexed symbol |
| `endpointsResolved` | derived | both endpoints are indexed symbols |
| `isTestEvidence` | derived from file paths | a test call site |
| `isIntegrationPoint` | derived from type | a call site to update, not containment |

An edge whose endpoint is not an indexed symbol cannot be located or scheduled: it is
shown and counted as `unresolvable`, and it is **not** charged. Structural edges
(`contains`, `exports`) are shown but not charged. Every other relationship kind is
charged. `evidenceBreakdown` partitions every cited edge into exactly one bucket.

## Library mappings

- `dependencies` — libraries backed by an **observed** import (the index's per-file
  import rows) or a third-party package at a `node_modules` relationship endpoint.
  `provenance: "indexed-import"`. An observed import with **no registered target** is
  listed with `target: null`, `confidence: 0`, `status: "uncertain"` — declared
  absence, never an invented equivalence.
- `inferredDependencies` — name-substring guesses. `provenance: "name-heuristic"`,
  `confidence: 0`, `status: "uncertain"`, excluded from effort and risk.

A specifier is canonicalized to the package name the dictionary is keyed by, and the
rule is language-aware because the same text means different things per ecosystem:

| Input | Language | Result | Rule |
|---|---|---|---|
| `@nestjs/core` | ts/js | `nestjs` | the dictionary is keyed by framework (the scope) |
| `node:fs`, `@types/node` | ts/js | excluded | builtin / type stub, not an installable dependency |
| `drizzle-orm/node-postgres` | ts/js | `drizzle-orm` | an npm subpath names the package |
| `socket.io` | ts/js | `socket.io` | dots are part of real package names |
| `net/http` | go | `net/http` | a host-less path is the standard library |
| `github.com/stretchr/testify/assert` | go | `testify` | the host layout decides which segment is the repository |
| `k8s.io/api/core/v1` | go | `api` | declared host rule; major-version segments are skipped |
| `sigs.k8s.io/yaml` | go | `yaml` | undeclared host: last segment, reported as a fallback guess |
| `package:flutter/material.dart` | dart | `flutter` | the package is the first segment |
| `core.async` | clojure | `core.async` | a namespace is a dotted path, not a module |
| `cryptography.fernet` | python | `cryptography` | the first dotted segment is the module |

Go repositories are resolved by declared host layout (`github.com`, `gitlab.com`,
`golang.org`, `k8s.io`, `google.golang.org`, `cloud.google.com`, `go.uber.org`,
`gopkg.in`, …); an unrecognised host falls back to the last segment and is counted in
`imports.fallbackHostNames` / named in `fallbackHostLibraries` so the guess is visible.

Every plan reports the measured import split: declared specifiers, how many came from
the index, standard-library / third-party / local / unclassified counts, mapped and
unmapped libraries, standard-library names without a dictionary row (visible, not
charged), and the fallback-host count. "Every import is standard library or local" and
"the index holds no import rows for this file" are different facts and the note says
which one applies.

## Unsupported cases

| `unsupportedReason` | Meaning |
|---|---|
| `missing-symbol` | no indexed symbol carries that name or id |
| `ambiguous-symbol` | the name matches several components; `candidates` carries their ids |
| `same-language` | source and target resolve to the same language |
| `unsupported-source` | the component is not migratable program logic (markdown, yaml, make, …) |
| `unsupported-target` | the target language is not one this tool knows |

A **known** target language with no dictionary rows for the pair is **planned**, with
the gap stated twice: in `dependencyProvenance.note` ("MISSING DATA, not an absence of
libraries") and as a risk factor. `dependencies` still reports the observed imports —
with no target and confidence 0 — so nothing is invented and nothing is hidden.
`plans.length + unsupported.length + truncation.deduplicated` equals the number of
entries processed; `requested = returned + capped`.

## Dependency order and waves

`dependencyOrder` is a deterministic topological order: a relationship's **source is
the dependent**, so a dependency is emitted before the component that uses it. The
graph's `orderingStatus` distinguishes:

| Status | Meaning |
|---|---|
| `complete` | every requested component placed, dependency-first, no cycles |
| `partial` | at least one dependency could not be placed — outside the request, or in a cycle |
| `cyclic` | the resolved graph has a cycle; members are named in `cycles` |
| `no-edges` | the requested components have no relationships at all |

`waves` groups the order by dependency depth: wave 0 can start now, wave *n* becomes
startable after wave *n-1*. An edge to a component **outside** the request is a scope
gap, not an ordering constraint, and does not push a wave. A cycle cannot be split, so
its members are collected into one trailing wave; `cohort.wavePlan` lists every plan
exactly once by symbol id, and `waves` renders `name (file)` when two components share
a name.

## Scope completeness

An integration point is **in scope** when its other endpoint is one of the requested
components. `scope` reports `integrationPoints`, `inScope`, `outOfScope`,
`unresolvable`, `completeness` (in-scope ratio, `null` when no edges are indexed) and a
sentence whose wording follows the number. Measured on the cobra corpus, requests for
the top 1/2/4/8/16 symbols by fan-in left 99.8/99.6/99.4/99.4/98.6% of the cited
integration surface outside the request: a request names a bounded set, and the scope
line (printed directly under the effort total) says so.

## Effort: one number, reconciled

- `effort.totalHours` — authoritative: `baseHours + relationshipHours + missingMappingHours`,
  counting each distinct chargeable indexed relationship once across the request.
- `plan.effortEstimateHours` — that plan's own view, so an edge cited by two plans is
  counted in both.
- `effort.perPlanSumHours`, `effort.sharedRelationshipHours` and
  `effort.reconciliation` state and reconcile the difference; a negative difference is
  reported as `INTERNAL MISMATCH` rather than printed as if it were a saving.

Declared rates (data at `methodology.rates`, uncalibrated methodology, never fitted
against a completed migration): **4h** per planned component, **2h** per chargeable
relationship, **6h** per third-party library with no registered target. The 2h rate is
flat across relationship kinds, which is an assumption: `methodology.relationshipByKind`
reports how much of the relationship budget rests on that equivalence, and the text
formatter names a non-`calls` dominant kind because call sites are often a minority of
the edges. The missing-mapping charge is per library name and per file, counted from
the measured import split; standard-library names without a row are listed but not
charged.

## Risk

`riskAssessment.level` derives from measured quantities only:

| Band | Rule |
|---|---|
| `High` | more than 5 chargeable indexed relationships |
| `Medium` | at least one unmapped third-party library, or at least one integration point crossing a language boundary |
| `Critical` | a data-shaped component (type plus a table/schema/entity/model/dao/repository name token) |
| `Low` | none of the above |

The text output prints every factor with a `why:` prefix. An evidence-free component
is `Low`; the tool does not escalate it by guessing.

## Truncation

| Field | Meaning |
|---|---|
| `requested` | entries in the request, before the cap (one component each) |
| `returned` | entries processed |
| `deduplicated` | entries that resolved to a component another entry already planned or refused |
| `capped` | entries dropped by the 100-entry cap |
| `cappedNames` | which entries were dropped, rendered as `name (file)` where a symbol and file identify them |
| `truncated` | true when either reduction applied |

A caller can distinguish a merged duplicate (already planned) from a dropped entry
(not planned at all). The cap's selection is `first N resolved entries by project-
relative file path, then symbol name`, so the dropped set is deterministic.

## Staleness

A plan is a claim about current code, so each plan's **own** source file is resolved
and flagged. JSON carries the registered `freshness` envelope
(`{ fresh, stale, missing, staleRatio, mode, remediation }`); text carries an up-front
notice (`⚠ N of M plans reference files changed …`) and a footer. A plan whose source
file cannot be resolved counts as `missing`, not fresh.

The tool **does not auto-refresh** and has no `refresh` option: the flags describe the
index as it stands. Repair is manual: `bb index --changed` (or the `bb_index` tool with
the project path — incremental, changed files only), or `bb index "<file>"` for one
file. Nothing stale → no remediation text.

## Known limits

- **The dictionary is the binding limit on mapping quality.** It carries 486 rows
  across 30 source languages and 21 target languages, covering 126 of 630 possible
  source-to-target pairs (20%). Two keys (`flutter/material`, `shadcn/ui`; 4 rows,
  0.8%) cannot be produced by import canonicalization and are enforced as a declared
  class by the audit; a further 31 rows carry knowledge reachable only through
  specifiers real code does not write (API idioms, a framework name, Flutter widget
  class names, display names with spaces). The audit proves internal consistency and
  reachability, not that a mapping's advice is correct.
- **Effort constants are uncalibrated** (4h / 2h / 6h), declared as methodology and
  published as data so a reader can substitute their own.
- **Ordering and mapping depend on the analyzer-extracted graph.** Reflection, dynamic
  dispatch and relations the grammar does not model limit completeness; where the
  indexer did not mark an edge cross-language, the plan does not claim it is.
- **Batch requests are capped at 100 entries.** `paths` does not lift the cap; it makes
  hitting it likely. The dropped entries are named.
- **Two components sharing a name are planned separately only when reached through
  `paths` or `symbolIds`.** A bare `symbolNames` entry for such a name is refused with
  the candidate ids, because a name genuinely does not identify a component.
- Plans are estimates. A migration is planned, not performed.

## Commands and evidence

The gates that verify this page and the behaviour it describes:

```bash
npx tsx script/m13/verify-migrate-accuracy.ts          # contract, decisions, read-only invariant, regex-free text ops
bun run script/m13/verify-migrate-docs.ts             # this page vs registry + curation
bun run script/m13/verify-migrate-e2e-corpus.ts       # CLI + real MCP stdio door + corpus
bun run script/m20/verify-migration-methodology.ts    # effort arithmetic
bun run script/m20/verify-migration-order.ts          # dependency order + waves
bun run script/m20/verify-migration-mappings.ts       # mapping provenance rules
bun run script/m20/verify-migration-dictionary.ts     # dictionary reachability audit
bun run script/m65/verify-migrate-latency.ts          # latency budget and work bound
bun run script/m65/verify-migrate-selectors.ts        # selector identity, dedupe, truncation
bun run script/verify-visualize-migrate.ts            # shared visualize/migrate contract
npx tsx script/verify-tool-docs.ts --only bb_migrate # this page is generated from registry + curation
bun run script/tools/verify-regex-policy.ts           # no unallowlisted regex in tool code
```

Real-corpus evidence (four cross-language repositories through the real MCP stdio
door, with planted negative controls) is recorded in
`validation/tools/bb_migrate/REAL-CORPUS.json`; latency on the three campaign tiers in
`validation/tools/bb_migrate/LATENCY.json`; the gate table in
`validation/tools/bb_migrate/GATES.json`.

```json
{ "symbolNames": ["authenticate", "authorize"], "targetLanguage": "go", "format": "json" }
```
