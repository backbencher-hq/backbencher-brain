<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the static test-evidence reference for bb_analyze modes test_mapping,
test_gaps and test_impact: what counts as evidence, the validation a candidate row must pass before
it becomes a link, how the counts are ranked, and what they cannot mean.
WHO IT IS FOR — callers reading test evidence and the arithmetic behind its counts.
EDIT TOGETHER WHEN THIS CHANGES — src/intelligence/testing/test-intel.ts,
src/mcp/tools/bb_analyze/{descriptor,handler}.ts, docs/tools/bb_analyze.md,
docs/bb-bettercap-fix/go-testintel.md, script/verify-test-intel.ts,
validation/tools/bb_analyze/AUDIT.md.
-->

# Test intelligence reference

> **Not a tool.** There is no `bb_test_intel` (or `bb_test_quality`) tool. The test-intelligence
> surface belongs to `bb_analyze` through its `test_mapping`, `test_gaps`, `test_impact` and
> `test_quality` modes. The only public tools are the sixteen in
> `docs/data/public-tools.json`.

Static, evidence-based test intelligence over the current `brain_*` tables.
Engine: `src/intelligence/testing/test-intel.ts`.

## What counts as test evidence (validation contract)

A stored relationship row is **not** test evidence by itself. A row whose source symbol
lives in a test file (`brain_file.is_test_file = 1`) becomes a published link only when
`validateTestLink` proves the test can **reach the target's exact symbol**:

1. **The row must not refute itself.** A row whose `brain_relationship.metadata` says
   `isStdlib: true` describes a call to an external/stdlib package member, so its stored
   target id cannot be that callee's declaration.
2. **A qualified call must name the target's package.** The analyzer may record a
   package-qualified call as its bare leaf (`errors.New` → `New`); such a row is evidence
   only when the qualifier names the target file's package/module **and** the test file
   imports it. A bare leaf that came from a qualified spelling is not evidence for any
   same-named symbol anywhere else in the project.
3. **A receiver/member chain is unresolved.** `m.Lock()` / `mod.Session.Lock()` carries no
   receiver type in the index, so it fails closed instead of binding a same-named method
   from another package.
4. **An unqualified callee names a declaration in the caller's own package/module.** It is
   evidence when the test file is in the target's package directory (for languages whose
   module boundary is the directory: Go, Java, Kotlin, Scala, C#) or when one of the test
   file's `brain_import` specifiers reaches the target file (relative resolution, a Go
   package import whose last segment names the target package, or a file-module basename).
5. **Non-call kinds** (`references`, `uses`, `extends`, `implements`, `imports`) need the
   same reachability, but no call expression.

When a candidate row fails, it is **counted per reason and declared** — never silently
dropped. The five reasons:

| `reason` | Meaning |
| --- | --- |
| `external-stdlib-leaf` | the row's metadata marks the callee as a stdlib/external package member (`isStdlib: true`) |
| `qualified-call-target-is-a-leaf` | a two-segment `pkg.Fn` spelling was stored as a bare leaf and the qualifier does not prove the target's package |
| `receiver-selector-unresolved` | a receiver/member chain (`m.Lock`, `mod.Session.Lock`); no receiver type is available |
| `cross-package-unreachable` | the target is not in the test's package/module and no test-file import reaches it |
| `target-name-mismatch` | the call's leaf does not name the resolved target symbol, or the stored target symbol/file no longer exists |

A rejected row gets **zero confidence evidence**: it is not published in `links[]` at all,
`strongestEvidence`/`testedSymbols` are computed from validated links only, and the reason
counts are declared by both report modes (see below).

## Evidence kinds & confidence (for validated links)

| Kind | Relationship types | Confidence |
| --- | --- | --- |
| `direct_call` | `calls`, `instantiates` | 0.85 |
| `reference` | `references`, `uses`, `extends`, `implements` | 0.6 |
| `import` | `imports` | 0.4 |

Mapping is keyed by **resolved symbol id**, so two same-named symbols in different files are
never conflated — and since the validation above runs first, the id it keys on is a proven
target rather than a name-resolution coincidence.

## Mode: test_mapping

`testMapping(projectId)` → per production symbol: its `links[]` (each a test symbol + file +
evidence kind + confidence), `strongestEvidence`, and (when a page row is trimmed)
`linksTruncated`. Summary reports production/tested/untested symbol counts and
test-file/test-symbol scan counts.

The summary also carries the validation accounting as an attached field:

- `unvalidatedLinks` — candidate test-file rows (of kinds this engine classifies) whose target
  is in the queried production population and that **failed** validation. They are not
  published as links and not counted in `evidenceLinks`/`testedSymbols`.
- `unvalidatedByReason` — the same rows split by the five reasons above.
- `provenance.unknowns` carries an `unvalidated-test-links: N … (reason=count, …)` entry
  stating that those rows were withheld and why. A rejection count without reasons would be
  a different defect, so the reasons are always present.
- Scoped calls (`filePath`) count only rows landing on symbols in that scope; a project-wide
  call counts the whole corpus. The count is scope-relative by construction.

## Mode: test_gaps

`testGaps(projectId)` → risk-ranked gaps, computed from the **same validated evidence** as
mapping. Categories:

- `no_evidence` — no validated test edge references the symbol.
- `weak_evidence` — only reference/import evidence, no validated direct call.
- `indirect_only` — a declared category NO code path emits yet: `testGaps` classifies only
  `no_evidence` / `weak_evidence`. Named here because the contract reserves it, not because
  an answer can contain it.

Withheld candidate rows are declared in `provenance.unknowns` with the same
`unvalidated-test-links` entry (no summary field is attached to this mode).
Ranking: `riskScore = complexity*2 + gravity*10`, so high-complexity / high-gravity untested
symbols rank above trivial ones.

## Mode: impact

`testImpact(projectId, target)` → which tests exercise a changed symbol, split into
`directTests` (depth 0) and `indirectTests` (transitive, via the shared graph engine's caller
traversal), plus `affectedTestFiles`. `runtimeCoverage` is `{ available: false }` unless a
real artifact is supplied. Unknown target returns `found: false`.

**Not validated by this engine:** impact walks the graph engine's caller set (the same
stored relationship rows, read through the traversal) and does not apply
`validateTestLink`. Treat its rows as graph evidence with the graph engine's own stated
limits; the validation contract above applies to `test_mapping` and `test_gaps`.

## Symbol scope

Functions, methods, classes, interfaces, structs, and enums are included
(`includeMethods` defaults true). Hard-noise paths and noise symbol names are excluded via
the canonical `AnalysisExclusions`.

## Examples

- Mapping: `add` called by `testAdd` in `calc.test.ts` (same module) → validated
  `direct_call`, `strongestEvidence: "direct_call"`. A symbol with no validated incoming test
  edge → `strongestEvidence: "none"`. There is no `quality` field.
- Mapping, measured on the bettercap specimen: `session/session.go:New` was reported "tested"
  by `caplets/caplet_test.go` (which only calls `errors.New`) and by `js/data_test.go`
  (`otto.New()`); after validation those rows are `external-stdlib-leaf` /
  `qualified-call-target-is-a-leaf` and are not published, while genuine same-module callers
  whose tests import the package and call `session.New()` remain.
- Gaps: `untested` (complex) ranks above a trivial untested `helper`.
- Impact: changing `add` lists `testAdd` as a direct test and `calc.test.ts` as an affected
  test file (graph evidence, see "Mode: impact").

## Verification

`npx tsx script/verify-test-intel.ts` covers the validation contract with the measured
bettercap row shapes as MUST-REJECT fixtures (`errors.New` in `caplets/caplet_test.go`,
`otto.New()` in `js/data_test.go`, an embedded-`sync.Mutex` `m.Lock()`, a bare `New()` in
another package) and MUST-ACCEPT controls (same-package `session_test.go → ParseCommands`,
a genuinely imported `session.New`, a same-package reference edge); it also keeps the
mapping/gaps/impact, same-name-isolation and not-found checks. The handler-level contract
(`filePath` scoping, the stale/missing flag rule, the `test_impact` declared bound) is gated by
`script/m13/verify-analyze-modes.ts`.

## The population arithmetic

Both report modes publish the denominators, so the counts can be checked against the store
instead of trusted:

- `productionSymbols` — production symbols scanned, under the mode's own filter.
- `excludedAsNoise` — symbols that filter dropped, so
  `productionSymbols + excludedAsNoise` is the store's population under the filter.
- `test_mapping`: `testedSymbols + untestedSymbols = productionSymbols`; `evidenceLinks`
  counts validated links only; `unvalidatedLinks` is reported **separately** and is not part
  of that population.
- `test_gaps`: `total + directlyTested = productionSymbols` (`total` counts gaps).
- `returned` / `truncated` — the page, against those populations.
