<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_patterns: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_patterns through any MCP host, the CLI (`bb tool bb_patterns`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_patterns/descriptor.ts, src/mcp/tools/bb_patterns/handler.ts, script/tool-docs/curation/bb_patterns.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_patterns --write`.
-->
# `bb_patterns`

Detect orphaned code, framework patterns, and anti-patterns, ranked by confidence, with staleness markers when a finding's file changed after indexing. Use scope=orphaned for dead code; scope=all (default) for the full pattern scan with the optional class/confidence filters. Orphan confidence is derived from evidence (0.30-0.70); anti-pattern confidence is 0.60-0.90; framework findings carry a fixed 0.6. `limit` is one bounded page (maximum 500) and the answer names the full census. Architecture and code-quality analysis are planned, not yet executable.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `orphaned`, `all`
- Planned modes (roadmap, not executable): `quality`, `architecture`
- Defaults: `{"scope":"all","limit":20,"includeOrphaned":true,"includeFramework":true,"includeAntiPatterns":true,"confidenceThreshold":0,"history":false,"recordRun":false}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "scope": {
      "type": "string",
      "enum": [
        "orphaned",
        "all"
      ],
      "default": "all",
      "description": "orphaned only, or all pattern classes (default all)"
    },
    "limit": {
      "type": "number",
      "default": 20,
      "minimum": 0,
      "maximum": 500,
      "description": "maximum findings displayed (default 20, maximum 500); the answer's census line reports the full count"
    },
    "includeOrphaned": {
      "type": "boolean",
      "default": true,
      "description": "include orphaned-code patterns in an all scan (default true)"
    },
    "includeFramework": {
      "type": "boolean",
      "default": true,
      "description": "include framework patterns (default true)"
    },
    "includeAntiPatterns": {
      "type": "boolean",
      "default": true,
      "description": "include anti-patterns (default true)"
    },
    "confidenceThreshold": {
      "type": "number",
      "default": 0,
      "minimum": 0,
      "maximum": 1,
      "description": "drop findings below this confidence (default 0 = report everything, ranked). Orphan confidence is evidence-derived and spans 0.30-0.70; anti-pattern confidence spans 0.60-0.90; framework findings are a fixed 0.6"
    },
    "history": {
      "type": "boolean",
      "default": false,
      "description": "return persisted pattern history (runs bounded by limit; the findings window and its total are declared in the answer)"
    },
    "recordRun": {
      "type": "boolean",
      "default": false,
      "description": "persist this scan as an analysis run (persists the whole census, not the displayed page; works in both scopes; capped at 50,000 findings with the cap disclosed)"
    }
  }
}
```

## Returns

- A bounded page of findings (default 20, maximum 500): rule/type, file:line, symbol for orphan rules, confidence, and a per-finding [stale] marker when the finding's file changed after indexing
- A census line naming the full finding count and the per-rule breakdown, so the page never reads as the population
- scope=orphaned: suppression accounting (every candidate the scan discarded, by reason), refused-usage counts (selfLoop/inferred/lowConfidence), and import-resolution counts
- provenance line: evidence class, engine, symbols/files scanned, limitations count
- Explicit JSON when history=true: runs bounded by limit, a findings window (200) with findingsTotal/findingsReturned/findingsTruncated declared

## Examples

`{"scope":"orphaned"}`

`{"confidenceThreshold":0.6}`

`{"recordRun":true}`

## Errors

- scope must be one of: orphaned, all
- confidenceThreshold must be between 0 and 1
- limit must be a whole number >= 0; above 500 it is refused by name (the census line reports the full count)
- unknown or irrelevant options are refused and the accepted options are named
- No index found for <project>: run: bb index <project> — an unindexed project is a named refusal, never a clean zero

## Limitations

- A finding is not a deletion instruction. The tool reports what the index does and does not record; where the index is silent, the finding says so on its face rather than presenting absence of evidence as evidence of absence.
- The text answer does not include the engine's per-finding evidence array, limitations array or remediation text. Those travel on the engine report (PatternFinding) that the text is rendered from; the answer surface carries the aggregate disclosures listed under Returns.
- Confidence is derived from evidence classes, not assigned per rule. Orphans span 0.30-0.70 (0.30-0.55 for file findings); anti-patterns span 0.60-0.90. Name-unique orphan candidates measured a 0.0% false-positive rate against a source-text oracle; ambiguous names measured 14.4%; per-corpus rates are a lower bound because the oracle cannot see reflection or template indirection.
- Framework findings carry a FIXED confidence of 0.6 — that is the whole population of that rule, so a threshold above 0.6 removes every framework finding at once rather than discriminating among them.
- A relationship counts as usage evidence only when it is not a self-loop, its published evidenceClass is not "inferred", and its confidence is at least 0.7. Refused rows are counted in the orphaned answer's [usage-evidence] line and itemised on the findings they would have cleared.
- A finding whose symbol had no recorded incoming reference while its file did carries a coverage-gap indicator: that is the signature of an analyzer that reached the file and not the declaration, and such a finding may be a coverage gap rather than dead code.
- Dynamic dispatch, reflection and string-keyed lookups are invisible to the index; the engine never fabricates a resolved edge for them, so a symbol reached only that way is reported with the limitation stated on the finding.
- Lifecycle methods can look unreferenced because a framework invokes them by convention rather than by a recorded call: Ruby "initialize", constructors in Java/Kotlin/C#/Python, and similar framework entry points are known false-positive classes. Treat them as entry points when reviewing a report.
- Test files are excluded from candidates but not from evidence: a production symbol called only from a test is not reported, and a production file imported only by a test is not reported as orphaned. The engine option includeTests (true means "also report test symbols") is an engine API option, not a bb_patterns parameter.
- Framework and anti-pattern detection is heuristic and confidence-qualified; non-code languages (JSON, YAML, Markdown, ...) contribute no symbol candidates and no anti-pattern findings, though they are still indexed and checked as whole files.

## Performance

Warm in-process measurements (one excluded warm-up, five runs, wall clock and process CPU recorded): T0 (5 files / 13 symbols) p50 18.6 ms default-all and 11.2 ms orphaned; T1 (97 files / 3,512 symbols) p50 632 ms default-all and 773 ms orphaned at 404-607 ms process CPU. T2 (6,452 files / 310,423 symbols / 820,040 relationships): the common campaign baseline (validation/release/T2-BASELINE.json, in-process, shared reference index) is p50 3,504 / p95 3,506 ms — inside the 5,000 ms budget; this tool's warm confirmation on the same index measured p50 4,535 ms / p95 5,385 ms at load 4-8, with db+WAL unchanged by every call. The migration that builds the extended covering index and brain_symbol_type_cover_idx costs 28.8 s once per database. limit bounds the displayed page only; the census in the header is the full candidate count. Full data: validation/tools/bb_patterns/LATENCY.json.

## Safety

The read path is byte-read-only: db and WAL are unchanged by a call (the -shm read marks may move). A read never creates an index or a schema. recordRun is the one write and it is opt-in: it persists analysis-history records (never source), records the whole census up to a declared 50,000-finding cap rather than the displayed page, and reports the recorded count and any cap on the answer.

## Evidence Semantics

The wire answer is deliberately explicit about its own coverage: census and per-rule counts, suppression accounting by reason (orphaned scope), refused usage rows by reason and import-resolution counts (orphaned scope), provenance (evidence class, engine, symbols/files scanned), and per-finding staleness markers with a manual-repair footer. The engine report beneath it additionally carries a per-finding evidence array, limitations array and remediation text; those are engine-report fields, available through the library API rather than the MCP text surface.

## Relationship to other tools

For security-specific taint findings use `bb_security`; this tool covers orphans, framework patterns, and anti-patterns.

## Deep guides

- [Patterns: dead code, orphans, frameworks and anti-patterns](../BB_PATTERNS.md)

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: per-finding `[stale]` markers + counts footer naming the remediation; silent when all fresh. This tool does NOT auto-refresh: the per-finding flags DESCRIBE the index as it stands, nothing is reindexed to make them stale or fresh, and there is no `refresh` option to opt out with. When findings name stale or missing files, repair them with the manual interface: run: `bb index --changed` (or the `bb_index` tool with the project path — incremental, changed files only). Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
