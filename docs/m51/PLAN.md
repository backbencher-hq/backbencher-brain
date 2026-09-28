# M51: Index Integrity — No Dangling References, Honest Health

> GitHub milestone #50 ("M51: Index Integrity — No Dangling References, Honest Health").
> Issues: #716 (A1), #717 (A2), #718 (A3), #719 (X1).

## The milestone invariant (verbatim, enforced by X1)

> **The indexer must never write a reference (owner_symbol_id, relationship endpoint) to a symbol row that does not exist, and every health check must separate real defects from by-design representations — no false remediations.**

Every acceptance criterion in this milestone traces to this sentence.

## Why this milestone exists (row-level evidence, not memory)

Measured on a fresh `--force` index of this repository (Sep 2026, 159,336 symbols):

| Signal | Number | Truth |
|---|---|---|
| Orphan-owner symbols | **134,073 (84.1%)** | 134,045 end in `:0` — synthetic module/container ids the indexer wrote as an owner fallback that can never resolve (no stored row can have line 0). Only **28** were genuine danglers. |
| Worst victim | `src/mcp/tool-handlers.ts` | 194 of its symbols pointed at the phantom `<file>:tool-handlers:0` module owner; 830 distinct phantom TS file-module ids repo-wide. |
| "Dangling" relationship sources | 4,154 | **4,122 were NULL-source false positives** — legitimate external edges (`source_external` carries the name) that the health query miscounted. Only **32** were real (anonymous symbols in m14 fixtures, skipped by insert-time filters after the edge id was computed). |
| Health remediation | — | Recommended `bb_health refresh=true force=true` for a condition a clean rebuild provably reproduces. A verdict issued without verification — the exact class this project's evidence taxonomy forbids. |

Mechanism (`src/ast/parallel-indexer.ts`, owner assignment + loop-2 source
resolution): references were computed against the analyzer's RAW symbol list,
not against rows that survive the insert-time filters (denylist, name length,
`startLine >= 1`, artifact-name filter). Any owner skipped by a later filter
left every child pointing at a ghost.

Impact: every consumer JOINs on `owner_symbol_id` (LSP document tree,
`src/lsp/symbols.ts`; impact owner walk, `src/lsp/impact.ts`; graph cascade,
`graph-engine.ts`; pattern member counts, `patterns/rules.ts`) — so phantom
owners were already invisible. The column value was a lie, not a functional
bug — except in `bb_trace`, where containment chains silently truncate, and
in health, where 84% noise trained users to ignore real errors.

## Design decision (made on evidence)

**Null the reference; never fabricate an owner.** Storing the ~28,518 missing
meta containers as symbol rows would pollute symbol queries with JSON/YAML
internals; 40+ analyzers set `ownerName = module` for top-level symbols by
design. Since all consumers JOIN, a NULL owner is strictly more honest than a
dangling id — and the contains-edge emission now keys off the same storeable
set, which additionally un-breaks forward-declared containers (the old
`insertedSymbolIds.has()` check silently dropped those edges).

## What changed

| Issue | Change | Gate |
|---|---|---|
| #716 A1 | Storeable-row replica guard in owner assignment (exact mirror of insert filters); `:0` module fallback removed; Tier-1/2 container search skips non-storeable containers; contains edges emitted for every guarded owner | `script/m51/verify-a1-owner-integrity.ts` (+ `probe-a1-mutant.ts`) |
| #717 A2 | `Orphan Owner References` now counts only genuine danglers (tight thresholds); new informational `Synthetic Container References`; dangling-source query excludes NULL sources; remediations state mechanism and never promise the disproven rebuild | `script/m51/verify-a2-health-split.ts` |
| #718 A3 | Loop-2 same-file endpoints validated against the same storeable replica — non-storeable sources degrade to external edges; `script/m13/verify-health-integrity.ts` expectation flipped from "dangling ≥ 1 is truth" to "0, or the indexer regressed" | closure re-runs m13 live |
| #719 X1 | Closure gate: sequential live re-runs (A1 mutant patches source — no parallel gate runs), evidence conformance, real-repo integrity snapshot with era-honest bounds | `script/m51/verify-closure.ts` |

## Honest scope notes

- Existing indexes keep their pre-M51 rows until reindexed; health reports
  them as informational synthetic references, not defects. A reindex clears
  them (children rewritten with NULL owners).
- The 28 genuine danglers observed pre-fix were owner references to symbols
  filtered at insert time (artifact names, line < 1); the same-file
  relationship analog (32 edges) degrades to external edges instead of
  dangling ids.
- Coordination: no shared-component file from the M48 L1 inventory
  (`graph-engine.ts`, `src/lsp/impact.ts`, `cross_language_hover.ts`,
  annotation store) is touched — no L1 entry required.
