# M12.44 Full Analyzer Wiring And Pipeline Integration

Issue: [#183](https://github.com/backbencher-hq/backbencher-brain/issues/183)

Date: 2026-08-20

## Objective

Prove every one of the 41 analyzers is fully wired end-to-end: language
detection → analyzer selection → AST extraction → normalization → database
persistence → pool-worker/indexer storage, with identical behavior across the
library, Bun CLI, compiled Node CLI, and MCP entry points — with **no
per-language special casing in storage**.

## Integration Defect Found And Fixed

A store-time persistence audit (parseFile-emitted vs `brain_symbol` persisted,
across all 41 fixture languages) exposed a genuine pipeline defect: **the
store layer silently dropped verified analyzer output that the per-analyzer
differentials guarantee at P/R 1.000.**

Every dropped name was a hand-audited ground-truth symbol:

| Language | Dropped verified symbols | Cause |
| --- | --- | --- |
| CSS | `.header`, `.card`, `.card .title`, `.card:hover`, `.container`, `@layer base`, `#orders-table th, #orders-table td`, `tr[data-order="1001"]` | `isIndexArtifactName` soft rules (space / dot-prefix / quotes) |
| Markdown | `Main Title`, `Section One`, `Sub Section A/B`, `Setext Section`, `Setext H1`, `Level Four/Five/Six`, `1.0.0 - 2026-01-01`, `0.9.0 - 2025-12-01`, `Migration Notes`, `Older Releases` | soft rules (space / numeric prefix) |
| F# | `(|Even|Odd|)` active pattern | soft rule (`(` prefix) |
| Groovy | `addition works` Spock test name | soft rule (space) |
| YAML | `<<` merge key | soft rule (punctuation-only) |
| TypeScript / C# | `None` enum members | `SYMBOL_NAME_DENYLIST` literal words |
| JSON | entire `schema.json` fixture (19 symbols) | fixture name collided with the documented production skip `/schema\.json$/` ("large auto-generated schemas") |

### Root cause

`storeResults` applied the **same aggressive name filter to every result**
regardless of provenance. The soft rules (quoted names, parenthesized names,
numeric prefixes, embedded whitespace, punctuation-only) were written to block
regex-fallback garbage, but they are **legitimate symbol contracts** for
verified analyzers. The universal denylist additionally listed language-literal
words (`None`, `True`, `False`, `nil`) that are legal identifiers in verified
output (e.g. `enum Status { None }`).

### The fix — provenance-based, not per-language

1. **`isIndexArtifactName` narrowed to hard artifacts only** (empty, >500
   chars, synthetic placeholders `anonymous_`/`block_`/`lambda_`/`object_\d+`,
   language keywords, absolute paths). New `isIndexArtifactNameStrict` keeps the
   full historical filter for the regex-fallback path.
2. **Store-time denylist literal words gated on `result.fallback`** — the regex
   fallback can extract `const None = ...`, verified analyzers never emit
   literal words as symbols, so only fallback results are filtered. The store
   denylist now matches the pool-worker's per-language filter instead of
   contradicting it.
3. **Read-side filters aligned** (`isNoiseSymbolName`, SQL
   `analysisSymbolNameConditions`/`analysisSymbolNameScopeSQL`): soft patterns
   removed so persisted verified symbols actually surface in search/graph
   queries; hard artifacts and dotted property-access chains still filtered.
4. **`json/schema.json` fixture renamed to `api-contract.json`** — the fixture
   name collided with a documented production skip; ground truth, contract
   probe, and node-types probe updated. The production policy is unchanged.

No per-language branch was added anywhere in storage — the fix is purely
provenance-aware.

## Evidence

### 1. End-to-end pipeline proof — `script/m12/verify-m12-pipeline.ts`

A single multi-language corpus (all 97 positive fixtures across all 41
languages) is indexed through the production `indexProjectParallel`
pool-worker path, then exercised:

- **Index**: 97/97 files, 0 errors, all 41 languages persisted with correct
  labels, every language ≥ 1 symbol and ≥ 1 relationship
  (1213 symbols / 1572 relationships).
- **No bypass**: no language relies solely on generic-fallback kinds (HTML's
  tag→`class` contract handled via a symbol-count floor, since the regex
  fallback cannot extract meaningful symbols from markup).
- **Incremental / deletion / rename**: identical behavior across JVM
  (java/kotlin/scala), .NET (csharp/fsharp), Web (typescript/swift/dart), and
  Systems (rust/go/cpp) boundary families.
- **Cross-language**: 1130 cross-language symbols / 1537 relationships spanning
  multiple relationship types across JVM/.NET/Web/Systems boundaries.
- **Verified contracts persist**: 11 previously-dropped ground-truth symbols
  (`.header`, `tr[data-order="1001"]`, `Main Title`, `1.0.0 - 2026-01-01`,
  `(|Even|Odd|)`, `<<`, `addition works`, `None` ×2, `$schema`, `Address`) all
  persist through the standard pipeline — the regression guard for this fix.

### 2. Store-drop elimination

Recomputed emitted-vs-persisted across all 41 fixture languages: **zero
missing symbols**. The only prior "missing" rows (Objective-C/C++ header
constants) were a probe artifact — `.h` files detect as language `c` and were
correctly persisted under `c` (verified by direct DB query).

### 3. Differential integrity

All 9 affected analyzers re-verified at **P/R 1.000, 0 FP / 0 FN** after the
change (css, markdown, fsharp, groovy, yaml, typescript, csharp, objective-c,
cpp), plus json after the fixture rename (119/119).

### 4. Cross-cutting gates

- `npm run typecheck`, `npm run build`: PASS
- Full `npm run verify` (all 46 gate scripts): **PASS** (run with proxy env
  vars unset per the M12.43 environment finding)
- `EMBED VERIFY: ALL PASS`; MCP E2E: 10 public tools PASS
- The "Embedding Coverage" health warnings in MCP fixture runs are pre-existing
  background-queue timing warnings (the async embedding pass completes after
  the tiny fixture runs are health-checked), not regressions — the embedding
  path is untouched by this change.

## Scope

Storage remains a single shared insert path with zero per-language branches.
The fix narrows store/read-side noise filters by provenance (verified analyzer
output vs regex fallback) so that the pipeline persists exactly what the
verified analyzers emit — closing the last gap between per-analyzer P/R 1.000
evidence and the persisted database.
