# bb_patterns Reference (M9.08)

`bb_patterns` reports code-pattern findings. This issue establishes one canonical
orphan-detection engine (`src/intelligence/patterns/orphans.ts`) with a single
finding schema and correct usage-edge semantics. The MCP `bb_patterns` tool and
the `PatternBrainTools` façades delegate to it.

## Finding schema

Every `PatternFinding` carries:

| Field | Meaning |
| --- | --- |
| `rule` | `orphaned_function` / `orphaned_class` / `orphaned_file` / `orphaned_import` |
| `engine` | Provenance (which engine produced it) |
| `severity` | `info` / `warning` / `error` |
| `confidence` | 0..1 (see caps below) |
| `location` | `{ file, line, symbol? }` |
| `linesOfCode` | Exact indexed span (`line_end - line_start`), never an invented average |
| `description` | What was detected |
| `remediation` | Evidence-aware guidance — never "safe to remove" |
| `evidence` | Array of `{ kind, description }` |
| `limitations` | Known false-positive classes for this finding |

## Orphan semantics (correctness model)

Verified against the indexer's actual relationship output:

- A **symbol is used** iff it has an incoming edge of a USAGE type
  (`calls`, `instantiates`, `extends`, `implements`, `uses`) where
  `target_symbol_id = symbol.id` (resolved) **or** an unambiguous
  `target_external = symbol.name` (name-matched, cross-file). `exports` and
  `contains` are **not** usage.
- If a name is declared more than once in the project, unresolved name-only
  references are treated as **ambiguous** and do not suppress any declaration.
  This is conservative: it may report extra candidates, but it does not claim
  a specific declaration was used without identity evidence.
- **Visibility is not used to filter.** Many languages (e.g. TypeScript) mark
  every symbol `public`, so the previous `visibility != public` filter silently
  suppressed *all* findings. Removed.
- **Entry points** are excluded by explicit, extensible name/suffix rules
  (`main`, `init`, `run`, `*Handler`, `*Controller`, `*Route`, …).
- A **file is orphaned** iff no *other* file references any of its symbols via a
  **resolved** cross-file usage edge, and no `imports` edge names its module
  path. File-level detection deliberately does **not** use bare-name matching
  (a method named `run` in an unrelated class must not mark its file as used).

### Fixed bugs

- Orphaned-class `HAVING count(*) = 0` after a LEFT JOIN (could never be zero).
- Orphaned-file logic that measured **outgoing** imports instead of **incoming**
  references.
- `visibility != public` filter that excluded all NULL/public-visibility symbols.
- Invented cleanup sizes (15/50/100 lines) replaced with exact indexed spans.
- "can be safely removed" language replaced with evidence-aware remediation.

## Confidence semantics

- Symbol orphans: capped at **0.6** — name matching cannot see dynamic dispatch,
  reflection, or string-based lookups.
- Lifecycle methods are not false orphans when reviewing results: `initialize`
  (Ruby), constructors (Java/Kotlin/C#/Python), and similar
  framework-invoked methods can look unreferenced — treat them as entry
  points, not dead code.
- File orphans: **0.5** — entry points and dynamically loaded files can appear
  orphaned.

## Known false-positive classes

- Dynamic dispatch / reflection / string-keyed lookups remain unknown; they are
  never converted into fabricated resolved usage edges.
- Duplicate declarations with unresolved name-only references are reported
  conservatively and carry an ambiguity limitation.
- Framework entry points not covered by the built-in name/suffix rules.
- Symbols referenced only from build configs, plugin manifests (XML), or test
  conventions (test files are excluded from scanning by default).

## Suppression

- Test paths (`AnalysisExclusions.isTestPath`) are skipped unless
  `includeTests: true`.
- Hard-noise paths and noise symbol names are always skipped.
- Entry-point name/suffix rules suppress common framework hooks.

## Options

`detectOrphans(projectId, { rules?, minConfidence?, maxResults?, includeTests? })`.
`rules` selects which orphan rules to run. Results are globally ranked by
confidence then file; `summary.truncated` is set when `maxResults` is exceeded
(no fixed per-category quotas).

## recordRun persistence contract

`bb_patterns { recordRun: true }` persists the **full analyzed set** — every
detected pattern, not just the first `limit` shown in the preview. The response reports `(N found, M recorded)` where `M` equals `N`; run history therefore
matches the run, and the auto-resolve pass never marks real findings past the display
limit as gone. `limit` affects only the displayed preview lines.

## Scan completeness (M20.P1)

The anti-pattern rules evaluate every indexed candidate before applying the public
`maxResults` display budget. The `detectPatterns` result includes:

- `scan.candidatesEvaluated`: all findings evaluated across enabled branches;
- `scan.findingsBeforeDisplayLimit`: the full finding count before display slicing;
- `scan.displayed`: the number returned in `patterns`;
- `scan.truncated`: true when findings were omitted from the display page.

`statistics.totalFound` describes the returned page and therefore equals
`patterns.length`; use `scan.findingsBeforeDisplayLimit` for the full scan count.
This prevents a late long-parameter candidate from being skipped merely because
earlier candidates consumed a query or display budget.

## Verification

`script/verify-patterns.ts` uses positive **and** negative fixtures across
TypeScript and Python: genuinely-unused symbols are flagged; used symbols
(called / instantiated) and entry points are **not**; used files are not flagged
as orphaned; and the finding schema (engine, evidence, limitations, exact LOC,
evidence-aware remediation, capped confidence) is asserted.
