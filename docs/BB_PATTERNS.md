# bb_patterns Reference

`bb_patterns` reports code-pattern findings. One canonical orphan-detection
engine (`src/intelligence/patterns/orphans.ts`) and one canonical rule engine
(`src/intelligence/patterns/rules.ts`) produce every finding. The MCP tool and
the `PatternBrainTools` façade delegate to them.

Every number here was measured against a real corpus. The harness, the probes
and the raw outputs are in `fixtures/bb_patterns/`, a separate repository.
Corpora: `backbencher-brain` (TypeScript), `rake` (Ruby), `ripgrep` (Rust),
`lodash` (JavaScript), `rebar3` (Erlang), `clojure`, `clyde` (Python),
`luarocks` (Lua), `mojo` (Perl).

`REVIEW-PLAN.md` in that directory holds the first measurement round;
`RE-VERIFICATION.md` holds the re-measurement after the analyzer work landed,
including which decisions changed as a result.

## Finding schema

Every `PatternFinding` carries:

| Field | Meaning |
| --- | --- |
| `rule` | `orphaned_function` / `orphaned_class` / `orphaned_file` |
| `engine` | Provenance (which engine produced it) |
| `severity` | `info` / `warning` / `error` |
| `confidence` | 0..1, **derived from evidence** (see below) |
| `location` | `{ file, line, symbol? }` |
| `linesOfCode` | Exact indexed span for symbols; the file's real `line_count` for files. Never an invented number. |
| `description` | What was detected |
| `remediation` | Evidence-aware guidance — never "safe to remove" |
| `evidence` | Array of `{ kind, description }`, including any **refused** evidence |
| `limitations` | Known false-positive classes for this finding |

## What counts as "used"

Two claims, at different strengths, because the index distinguishes them and the
distinction is not cosmetic.

**ID evidence** — an *anchored* edge (`source_symbol_id` present) from a
different symbol to this one, structurally published. Decisive: it clears the
candidate outright.

**Name evidence** — the leaf of `target_external`, or the name of an
*unanchored* edge's target. Clearing on this requires the name to be unambiguous
in the reporting scope.

**Nothing** — a row that fails the quality gate contributes nothing, not even its
name. A guess is not a sighting.

The split is necessary because the share of edges carrying no source is a
property of the project, not of the relationship type:

| repo | calls | uses | imports | references |
| --- | --- | --- | --- | --- |
| rake | 2% | 0% | 5% | 97% |
| ripgrep | 2% | 4% | 0% | 0% |
| rebar3 | 0% | 0% | 0% | 0% |
| clojure | 0% | 3% | 0% | 0% |
| lodash | 83% | 31% | 65% | 61% |
| luarocks | 17% | 14% | 83% | 13% |

On lodash the 3,775 unanchored `calls` edges are published as
`{"isFieldAccess":true,"bareRead":true}` — a bare identifier name-matched to a
symbol. Treating them as proof of consumption produced a 95.1% false-positive
rate in an earlier revision.

## The evidence quality gate

A resolved target is necessary but not sufficient. Every relationship row carries
a `confidence` and a `metadata.evidenceClass`, and a meaningful share of rows
assert something that is not evidence of a consumer. Measured share of resolved
edges that are all-clean — not a self-loop, not `inferred`, confidence ≥ 0.7:

| type | rake | ripgrep | lodash | rebar3 |
| --- | --- | --- | --- | --- |
| calls | 96.3% | 97.2% | 98.9% | 87.5% |
| uses | 100% | 98.8% | **9.2%** | 95.4% |
| references | 0.0% | 99.2% | — | 99.4% |
| instantiates | 100% | 100% | — | 100% |
| extends | 100% | 100% | — | 100% |
| implements | 100% | 99.4% | — | 100% |
| **overrides** | **2.1%** | **0.0%** | — | — |

`uses` is 98.8% clean on ripgrep and 9.2% on lodash, so **no list of types can be
right**. The gate is therefore on the row, stated once:

1. a **self-loop** (`source_symbol_id == target_symbol_id`) asserts a symbol is a
   consumer of itself;
2. `evidenceClass: "inferred"` is the heuristic tier, which the analyzer
   documentation discloses has no oracle and is 65.2% wrong on real Kotlin;
3. `confidence < 0.7` is the guess tier.

The concrete defect, from rake's own rows: `test_files=` and `ruby_version` in
`lib/rake/testtask.rb` each carried an `overrides` edge to *themselves*,
`reasonCode: "first-parent-guess"`, `evidenceClass: "inferred"`, confidence 0.5.
The indexer guessed that a method overrides its own name in the parent class, and
an earlier revision read that guess as proof of a consumer.

The gate is self-correcting: an analyzer that starts publishing sound
`overrides` rows contributes them again with no change to the engine.

Rejected rows are **counted, not hidden** — `summary.unverifiedUsageEdges`, by
reason and by relationship type, at the index's own published values. Measured:
lodash 5,670 · clojure 6,442 · mojo 3,626 · rebar3 1,507 · ripgrep 401 ·
clyde 479 · rake 76.

### Refused evidence is disclosed per finding

A candidate whose symbol had rows rejected by the gate carries a
`REFUSED EVIDENCE` entry in its `evidence` naming the reasons, plus a limitation
saying that if the analyzer missed a real caller the finding is a coverage gap
rather than dead code.

This is not decoration. mojo's `listen` in `lib/Mojo/IOLoop/Server.pm` has **no
incoming call edge at all** — its callers were never recorded — and the only thing
that had been keeping it out of the report was the self-loop guess above.
Reporting it is the honest reading of the index; failing to say that a rejected
guess pointed here is not.

## The file-referenced decision

- The map is built over **all** symbol types, not six. The six-type version
  discarded 76.7% of cross-file edges on one index and 53.7–85.9% across a
  nine-repository corpus, because a module-level `const`, a class field or a type
  alias was invisible as evidence.
- `contains` and `exports` are the indexer's own bookkeeping and are **not**
  usage. An oracle that counted them reported that 86% of candidates were
  "provably still used", which is an artifact of counting bookkeeping as a
  consumer.
- **Imports are resolved, not name-matched.** An `imports` row now names the file
  that made it (96 of 96 on ripgrep, 18 of 19 on rake; it was 0 of 3,554 before
  the analyzer work), so a specifier is joined onto the importer's own directory
  and matched against the real indexed path set. `./used` from `src/main.ts`
  clears `src/used.ts` and nothing else. Root-relative specifiers are also tried,
  which is safe because the result must name a path that **exists**: `node:fs`
  and `express` match nothing. That is the property the earlier flat stem set
  lacked, and the reason it cleared a local `node.ts` from Node's own builtins —
  185 real files were suppressed by such a collision on one index. Rows that
  still cannot be attributed fall back to a stem match, only where that stem
  names exactly one file, and `summary.importResolution` reports how often the
  fallback was needed.
- **Non-code files contribute no symbol candidates.**
  `analysis-exclusions.NON_CODE_LANGUAGES` — markdown, yaml, json, toml, xml,
  css, html and friends — index headings, mapping keys and selectors, which have
  no callers by construction: 21% of rake's reportable pool, 8.5% of ripgrep's.
  They are still indexed, still searchable, and still checked as whole files.
- **Project manifests** (`package.json`, `Cargo.toml`, `pom.xml`, …) are never
  offered as dead code. Tooling reads them; source does not import them.
- **Entry points** are excluded by explicit name/suffix rules and by filename
  (`index`, `main`, `app`, `mod`).
- **Visibility is not used to filter.** Many analyzers mark everything public.

## Confidence is derived from evidence

Each term was assigned from the measured false-positive rate of that class:

| Class | Measured false-positive rate |
| --- | --- |
| name unique in the reporting scope | **0.0%** |
| name ambiguous | 14.4% |
| file already cross-file referenced | 11.4% |
| file not cross-file referenced | 3.7% |

Symbol confidence is `0.5 ± 0.15` for name uniqueness, `± 0.05` for file
reachability, clamped to **[0.30, 0.70]**. The ceiling is the cap this tool has
always published, kept rather than raised: a candidate can move within the band,
but the band did not move. Nothing can reach 1.0, because name matching cannot
see dynamic dispatch, reflection, or string lookup.

The file-reachability term points opposite to intuition and the measurement is
what settled it: a file other files already reach is where an unrecorded
reference is most likely, while a file with no cross-file edge at all is the one
most likely to be genuinely dead.

`RuleFinding` confidence is the emitted value (0.6–0.9), filtered by the same
`confidenceThreshold`. A finding past the display budget carries
`truncatedByDisplayLimit: true`.

## Results, scored against the source text

A candidate is a false positive when a **uniquely named** symbol is consumed in
another file. The instrument cannot see reflection, string lookup or template
indirection, so every rate is a **lower bound**.

| repo | symbol candidates | contradicted | rate | file candidates | rate |
| --- | --- | --- | --- | --- | --- |
| rake | 120 | 15 | 12.5% | 19 | 5.3% |
| ripgrep | 1,835 | 7 | 0.4% | 53 | 7.5% |
| lodash | 151 | 42 | 27.8% | 24 | 4.2% |
| rebar3 | 824 | 2 | 0.2% | 67 | 6.0% |
| luarocks | 179 | 1 | 0.6% | 117 | 2.6% |
| mojo | 543 | 11 | 2.0% | 207 | 1.9% |
| clyde | 1,886 | 0 | 0.0% | 41 | 0.0% |

## Ranking

Findings are ordered by confidence, then severity, then size, then path. An
earlier revision ordered by confidence then path with a constant confidence, so
the page was an alphabetical prefix of the repository: 59 rows of
`.github/workflows/*.yml`, 39 of `docs/*.md`, 2 of `.vscode/*.json`, and nothing
under `src/`.

`detectPatterns` ranks the orphan branch and the rule branch as **one** list. The
earlier code concatenated the orphan page first and then sliced, so on any
repository with more orphan candidates than `maxResults` the entire anti-pattern
branch was cut while `includeAntiPatterns` defaulted to true.

## Counts a caller can trust

- `statistics.totalFound` is the **census**. It was the returned page's length
  while `byType`, `bySeverity` and `averageConfidence` beside it described the
  census, and the handler printed the page length under the words "found": with
  the default limit the tool fetched 100, printed 20, and said 100.
- `scan.displayed` is the page. `scan.findingsBeforeDisplayLimit` is the census.
- Both scopes print the census, the page size, and the per-rule census
  breakdown. `scope=orphaned` also prints `summary.suppressedByReason`, so a
  report of zero is distinguishable from a scan that suppressed everything it
  saw.
- `summary.scannedFiles` describes the file branch's real scope.
- `confidenceThreshold` defaults to **0**. It previously defaulted to 0.6, which
  is above most of the derived range and dropped most symbol findings and every
  file finding.

## recordRun persistence contract

`bb_patterns { recordRun: true }` persists the **whole census**, and the response
reports `(N found, M recorded)` where `M` equals `N`.

This was previously broken in the direction its own comment warned about: since
M57.T3 bounded the page inside `detectPatterns`, the array persisted was
`min(census, max(limit,100))`, so the next run's auto-resolve pass marked live
findings as resolved. `recordRun` re-scans for the full census, with a 50,000 cap
that is **disclosed in the response** when hit, because a cap that is not
reported is silent data loss.

## Latency

The god-class rule's self-join did not use `brain_symbol_owner_idx`, which exists
for exactly that predicate, so the member count cost
`|candidate types| × |all symbols in the project|` row visits. A plain
`bb_patterns {}` took 330s on a 45,018-symbol index. The correlated-`COUNT(*)`
form returns an identical row set and 104ms on the same index. Every rewrite was
checked to return identical rows before being considered.

## Known false-positive classes

- Dynamic dispatch, reflection, and string-keyed lookups remain unknown; they are
  never converted into fabricated resolved usage edges.
- **An index coverage gap is not visible to this tool.** A symbol with no
  recorded callers will be reported, and when a rejected edge pointed at it the
  finding says so. Closing this class is the analyzer lane's work; the engine's
  obligation is to name it rather than paper over it.
- Framework entry points not covered by the built-in name/suffix rules.
- Build configs, plugin manifests (XML), and test conventions.
- Test files are excluded from *candidates* but not from *evidence*: a
  production symbol called only from a test is not reported, and a production
  file imported only by a test is not reported as orphaned. `includeTests: true`
  means "also report test symbols", not "ignore tests when looking for users".

## Suppression accounting

`summary.suppressedByReason` counts every candidate the scan discarded:
`testPath`, `hardNoise`, `noiseSymbolName`, `entryPointName`, `nonCodeFile`,
`manifestFile`, `ruleNotRequested`, `belowMinConfidence`. Seven suppression paths
existed before and none was counted, so a project with 5,000 real orphans and
5,000 suppressed entry points looked identical to a clean one.

## Options

`detectOrphans(projectId, { rules?, minConfidence?, maxResults?, includeTests? })`.
`rules` selects which orphan rules to run. Results are ranked by confidence, then
size, then path; `summary.truncated` is set when `maxResults` is exceeded.

## Verification

- `script/verify-patterns.ts` — positive and negative fixtures across TypeScript
  and Python; schema, exact LOC, evidence-aware remediation, confidence cap.
- `script/m13/verify-patterns-orphans.ts` — 22 checks across TypeScript, Python,
  Ruby, Go and Java, with 5 negative guards, including cross-language
  false-positive guards and `is_cross_file` honesty.
- `script/m13/verify-patterns-rules.ts`, `script/m13/verify-patterns-contract.ts`
  (both transports), `script/m20/verify-patterns-parameter-scan.ts`,
  `script/m20/verify-patterns-pagination-history.ts`,
  `script/m57/verify-t3-scope-all.ts` (17 checks, mutation-tested).
- `fixtures/bb_patterns/` — the corpus suite: nine real repositories, the
  source-text oracle, the evidence-quality tables, the query-plan measurements,
  and the design comparisons that chose every fix above.

### Known pre-existing failure

`script/m20/verify-patterns-orphan-semantics.ts` fails 2 of its 6 checks. It fails
them identically on the unmodified engine, so the change did not cause it: the
indexer resolves one call to **both** same-named declarations, so the ambiguity
guard is defeated upstream of the pattern engine. The fix belongs to the
indexer, not here.
