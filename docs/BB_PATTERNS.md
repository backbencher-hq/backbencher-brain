<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the reference guide for bb_patterns: what it answers, how
orphan confidence is derived from evidence, how the pattern rules decide, what the
answer's bounds and disclosures are, and what the tool does not know.
WHO IT IS FOR — a caller deciding whether a reported finding is dead code, and an
operator reading the verification table before trusting the tool.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_patterns/{handler,descriptor}.ts,
src/intelligence/patterns/{orphans,rules,evidence}.ts, script/tool-docs/curation/bb_patterns.ts,
and the gates listed under Verification.
-->

# bb_patterns Reference

`bb_patterns` reports code-pattern findings from the indexed evidence. One canonical
orphan-detection engine (`src/intelligence/patterns/orphans.ts`) and one canonical rule
engine (`src/intelligence/patterns/rules.ts`) produce every finding; the MCP tool and
the `PatternBrainTools` façade both delegate to them.

Two scopes:

- `orphaned` — symbols and files with no recorded consumer, confidence derived from the
  evidence channels the scan could actually consult.
- `all` (default) — the orphan rule plus framework detection and the anti-pattern rules,
  merged, ranked by confidence, and bounded to one page.

## What the answer contains

The MCP answer is text, and it names its own coverage on every call:

```
patterns (13237 found):
  [warning] high-complexity-function @ src/lsp/impact.ts:210 (90%)
  ...
[scan: 13237 finding(s) across orphaned_file=5213 orphaned_function=4720 …; showing 20 — raise `limit` to see more (maximum 500)]
```

- **The page** is at most `limit` rows (default 20, maximum 500); each row carries the
  rule/type, `file:line`, the symbol for orphan rules, the confidence, and `[stale]`
  when that finding's file changed after indexing.
- **The census** in the `[scan: …]` line is the full finding count plus the per-rule
  breakdown. The page never reads as the population.
- **scope=orphaned** additionally prints:
  - `[suppressed: reason=count …]` — every candidate the scan discarded, by reason, so
    a zero is distinguishable from a scan that suppressed everything it saw;
  - `[usage-evidence: refused N row(s) (selfLoop=…, inferred=…, lowConfidence=…); imports: …]`
    — how much usage evidence was refused and how far the import channel was carried;
  - `[provenance: static_finding via orphans@intelligence; scanned …]`.
- **history=true** returns JSON: `runs` bounded by `limit`, and a findings window of 200
  with `findingsTotal`, `findingsReturned`, `findingsWindow` and `findingsTruncated`
  declared — the window is a bound, not a silent cut.

The engine report additionally carries a per-finding evidence array, limitations array
and remediation text. Those are engine fields; the MCP text surface does not inline them.

## What counts as "used"

Two channels, at different strengths, because the index distinguishes them:

**ID evidence** — an *anchored* edge (`source_symbol_id` present) from a different
symbol to this one. Decisive: it clears the candidate outright.

**Name evidence** — the leaf of `target_external`, or the name of an *unanchored*
edge's target. Clearing on this requires the name to be unambiguous in the reporting
scope.

A row that fails the evidence-quality gate contributes nothing, not even its name. A
guess is not a sighting.

## The evidence-quality gate

A resolved target is necessary but not sufficient. Every relationship row publishes a
`confidence` and a `metadata.evidenceClass`, and a meaningful share of rows assert
something that is not evidence of a consumer. A row counts only when all three hold:

1. it is not a **self-loop** (`source_symbol_id == target_symbol_id` — a symbol consuming
   itself asserts nothing);
2. its `evidenceClass` is not `inferred` (the heuristic tier);
3. its `confidence` is at least **0.7** (the guess tier sits below).

The gate is stated once, on the row's own evidence, rather than as a per-type exception
list — a row that a later analyzer publishes with sound evidence is accepted with no
change to the engine. Refused rows are **counted and rendered**, never hidden: that is
the `[usage-evidence]` line, and a candidate whose rows were refused carries a
`REFUSED EVIDENCE` entry in its engine-report evidence naming the reasons.

## The file-referenced decision

- The referenced-file map is built over **all** symbol types: a module-level `const`, a
  class field or a type alias is still evidence that the file is used.
- `contains` and `exports` are the indexer's own bookkeeping and are **not** usage.
- **Imports are resolved, not name-matched.** An `imports` row names the file that made
  it, so a specifier is joined onto the importer's own directory and matched against the
  real indexed path set: `./used` from `src/main.ts` clears `src/used.ts` and nothing
  else. Root-relative specifiers are also tried, which is safe because the result must
  name a path that **exists** (`node:fs` and `express` match nothing). Rows that cannot
  be attributed fall back to a stem match only where that stem names exactly one file,
  and the answer reports how often the fallback was needed.
- **Non-code files contribute no symbol candidates** (`analysis-exclusions.NON_CODE_LANGUAGES`:
  markdown, yaml, json, toml, xml, css, html). They are still indexed, searchable and
  checked as whole files.
- **Project manifests** (`package.json`, `Cargo.toml`, `pom.xml`, …) are never offered as
  dead code: tooling reads them, source does not import them.
- **Entry points** are excluded by explicit name/suffix rules and by filename (`index`,
  `main`, `app`, `mod`).
- **Visibility is not used to filter**: many analyzers mark everything public.

## Confidence is derived from evidence

Symbol confidence starts at 0.5 and moves by measured evidence classes: +0.15 for a name
unique in the reporting scope (−0.15 when ambiguous), +0.05 when the file has no
cross-file reference (−0.05 when it does), clamped to **[0.30, 0.70]**. File findings
span 0.30-0.55 depending on whether the import channel could be consulted at all.

Measured against a source-text oracle over real repositories, name-unique candidates had
a 0.0% false-positive rate and ambiguous names 14.4%; per-corpus rates ranged to 27.8%
and are a **lower bound**, because the oracle cannot see reflection or template
indirection. The 0.70 ceiling is the published cap: name matching cannot reach 1.0.

Rule findings carry the confidence the rule derives: `high-complexity-function`
`min(0.9, 0.5 + complexity/100)` (complexity ≥ 15), `long-parameter-list` a fixed 0.7
(> 7 parameters), `god-class` `min(0.9, 0.5 + members/40)` (> 10 direct members), and
`framework-detected` a fixed **0.6** — every framework finding carries 0.6, so a
threshold above 0.6 removes the whole class rather than discriminating within it.

A finding past the display budget carries `truncatedByDisplayLimit: true` in the engine
report; the text surface does not render that flag per row.

## Ranking and the requested-class guarantee

Findings are ordered by confidence, then severity, then file. Orphan candidates are
ranked by confidence, then size, then path — the page is not an alphabetical prefix.

The page keeps **one slot per requested class**: if the caller asked for framework
findings (the default), a page filled with higher-ranked anti-patterns still shows one
framework finding. The handler asks the engine for exactly the caller's `limit`, so the
guarantee applies to the page the caller actually sees, not to a larger internal page.

## Bounds a caller can trust

- `limit`: whole number 0..**500**; above 500 the request is refused by name. The census
  line reports the full count, so a bounded page never hides the population.
- `confidenceThreshold`: 0..1; default 0 (report everything, ranked).
- `history`: `runs` bounded by `limit`; findings window **200** with the total and the
  truncation flag declared.
- `recordRun`: persists the **whole census**, not the displayed page, capped at
  **50,000** findings with the cap disclosed on the answer when hit. It works in both
  scopes; the recorded count is printed next to the found count.

## The read path does not write

Every read opens the index **byte-read-only**: db and WAL are unchanged by a call (the
`-shm` read marks may move), no schema is created, and an unindexed project is a named
refusal (`No index found … run: bb index <project>`) rather than an empty-looking
report. `recordRun` is the one write, and only when the caller asks for it.

Staleness is reported, never repaired: a finding whose file changed after indexing is
marked `[stale]` and the footer counts stale/missing files. The tool does **not**
auto-refresh and publishes no `refresh` option; the remediation is manual
(`bb index --changed`, or `bb_index` with the project path).

## Known false-positive classes

- Dynamic dispatch, reflection and string-keyed lookups are invisible. The engine never
  fabricates a resolved edge for them, so a symbol reached only that way is reported.
- **An index coverage gap is not visible to the tool.** A symbol with no recorded
  callers is reported; when a rejected edge pointed at it the finding says so. An
  upstream resolver that collapses a call onto every same-named declaration makes both
  look consumed, and the engine cannot disambiguate a resolution it was given — that is
  an upstream coverage property, recorded as such.
- Each finding's engine-report limitations array names its false-positive classes.
- **Lifecycle methods** can look unreferenced because a framework invokes them by
  convention rather than by a recorded call: Ruby `initialize`, constructors in
  Java/Kotlin/C#/Python, and similar framework entry points. Treat them as entry points
  when reviewing a report.
- Framework entry points not covered by the built-in name/suffix rules; build configs and
  plugin manifests (XML); test conventions.
- Test files are excluded from *candidates* but not from *evidence*: a production symbol
  called only from a test is not reported, and a production file imported only by a test
  is not reported as orphaned. The engine option `includeTests: true` means "also report
  test symbols"; it is an engine API option, not a bb_patterns parameter.

## Latency

Measured with the tool's own handler, warm in-process (one excluded warmup, five runs),
recording wall clock **and** process CPU time per call, with db+WAL stat'ed before and
after every call. Full data and commands: `validation/tools/bb_patterns/LATENCY.json`.

| Tier | Population | Shape | p50 wall | p95 wall | CPU per call | 1,000 ms budget |
|---|---|---|---|---|---|---|
| T0 | 5 files / 13 symbols | default-all | 18.6 ms | 25.0 ms | 9-10 ms | pass |
| T0 | | orphaned | 11.2 ms | 18.8 ms | 5-11 ms | pass |
| T1 | 97 files / 3,512 symbols | default-all | 632 ms | 1,877 ms | 409-572 ms | pass on CPU and p50 |
| T1 | | orphaned | 773 ms | 1,537 ms | 404-607 ms | pass on CPU and p50 |

The p95 wall figures on T1 are inflated by the shared host (load average 18-25 during
the run); the same calls take 404-607 ms of process CPU. A quiet-load rerun is the
remaining verification step.

T2 (6,452 files / 310,423 symbols / 820,040 relationships): after the schema lane extended
`brain_rel_pattern_cover_idx` with `target_external` and added
`brain_symbol_type_cover_idx`, the campaign baseline row on the shared reference index
(`validation/release/T2-BASELINE.json`, in-process handler calls, warm) is **p50 3,504 /
p95 3,506 ms — inside the 5,000 ms budget**. This tool's own warm confirmation on the same
index measured **p50 4,535 ms / p95 5,385 ms** at load 4.0-8.0 (p50 inside the budget; p95
marginal on the shared box), and every call left db+WAL unchanged. Building the two
indexes costs 28.8 s once per database, at migration time rather than per call. On the
byte-identical copy, `ANALYZE` made the covering-index plans worse (externals 0.39 s →
2.90 s) and its statistics were removed; copy measurements are therefore plan evidence,
and the budget verdict rests on the shared-index rows. T1 remains p50 632/773 ms at
404-607 ms process CPU.

## Options — tool surface versus engine API

Tool parameters: `scope`, `limit`, `includeOrphaned`, `includeFramework`,
`includeAntiPatterns`, `confidenceThreshold`, `history`, `recordRun` (schema in
`docs/tools/bb_patterns.md`).

Engine API options (`detectOrphans(projectId, { rules?, minConfidence?, maxResults?,
includeTests? })`) are broader than the tool surface; `rules` and `includeTests` are not
exposed by this tool.

## Verification

Every gate below was run from the working tree and is able to go red:

- `bun run script/verify-patterns.ts` — canonical positive/negative fixtures (TS and Python):
  used symbols not flagged, orphans flagged, schema/evidence-aware remediation, confidence cap.
- `bun run script/m13/verify-patterns-orphans.ts` — 22 checks across TypeScript, Python,
  Ruby, Go and Java, 5 negative guards.
- `bun run script/m13/verify-patterns-rules.ts` — 29 checks that the rules fire on real
  indexed evidence and not on stubs.
- `bun run script/m13/verify-patterns-contract.ts` — scope enum, planned-mode honesty, and
  both transports (CLI + MCP stdio).
- `bun run script/m13/verify-patterns-handler-contract.ts` — the tool surface: read path
  does not write, unindexed refusal, page class representation, `limit` bound, history
  window, recordRun in both scopes, staleness truth, evidence lines. `--self-test` plants
  six mutations in tmp copies and requires the gate to go red for each.
- `bun run script/m13/verify-patterns-e2e-corpus.ts` — CLI + MCP stdio + real-repository
  corpus sampling.
- `bun run script/m13/verify-patterns-docs.ts` — generated page freshness and
  registry/curation agreement.
- `bun run script/m15/verify-patterns-deep.ts` — deep semantic redo (orphan semantics,
  rules engine, real repos).
- `bun run script/m20/verify-patterns-parameter-scan.ts`,
  `bun run script/m20/verify-patterns-orphan-semantics.ts`,
  `bun run script/m20/verify-patterns-pagination-history.ts` — parameter/evidence
  scanning, engine-level ambiguity invariants, pagination and history persistence.
- `bun run script/m57/verify-t3-scope-all.ts` — the `all`-scope aggregates (census,
  byType, average confidence) agree with an independent count.
- `bun run script/m64/verify-patterns-evidence-gate.ts` (45 assertions) and
  `script/m64/verify-gate-selftest.ts` (mutations) — the evidence-quality gate.
- `bun run script/m65/verify-rules-budget-and-gates.ts` and
  `script/m65/verify-rules-gate-selftest.ts` (mutations) — rule budgets, confidence
  gates, non-code exclusion, owner-index query plan.
- `bun run script/m69/verify-patterns-page-class-representation.ts` — the engine's
  one-slot-per-requested-class contract.

The corpus measurements behind the false-positive and evidence-quality tables were taken
with a harness that lives outside this checkout; they are recorded here as measured facts,
not as commands this repository can re-run.
