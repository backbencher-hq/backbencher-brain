# bb_patterns Reference

`bb_patterns` reports code-pattern findings. One canonical orphan-detection
engine (`src/intelligence/patterns/orphans.ts`) and one canonical rule engine
(`src/intelligence/patterns/rules.ts`) produce every finding. The MCP tool and
the `PatternBrainTools` façade delegate to them.

Every number quoted in this document was measured on a nine-repository,
nine-language corpus. The harness, the probes, and the raw outputs are in
`fixtures/bb_patterns/` (a separate repository, so nothing here depends on
another lane's working tree). Corpora: `backbencher-brain` (1,654 files /
45,018 symbols / 160,126 relationships), `rake` (Ruby), `rebar3` (Erlang),
`ripgrep` (Rust), `lodash` (JavaScript), `clojure`, `clyde` (Python),
`luarocks` (Lua), `mojo` (Perl).

## Finding schema

Every `PatternFinding` carries:

| Field | Meaning |
| --- | --- |
| `rule` | `orphaned_function` / `orphaned_class` / `orphaned_file` |
| `engine` | Provenance (which engine produced it) |
| `severity` | `info` / `warning` / `error` |
| `confidence` | 0..1, **derived from evidence** (see below) |
| `location` | `{ file, line, symbol? }` |
| `linesOfCode` | Exact indexed span (`line_end - line_start`) for symbols; the file's real `line_count` for files. Never an invented number. |
| `description` | What was detected |
| `remediation` | Evidence-aware guidance — never "safe to remove" |
| `evidence` | Array of `{ kind, description }` |
| `limitations` | Known false-positive classes for this finding |

## Orphan semantics (correctness model)

- A **symbol is used** iff it is the target of a resolved edge of a USAGE type,
  or is named unambiguously by a cross-file reference. The USAGE types are
  `calls`, `instantiates`, `extends`, `implements`, `uses`, `references`,
  `imports`, `overrides`. `contains` and `exports` are the indexer's own
  bookkeeping and are **not** usage.
- Those eight are the complete set: across the whole corpus they are the only
  relationship types that ever carry a resolved `target_symbol_id` and are not
  `contains`/`exports`. Omitting `references`, `imports` and `overrides` was
  three separate false-positive classes; `overrides` alone accounted for 60% of
  the reported orphans on the Perl corpus.
- The **file-referenced** decision is made over **all** symbol types. The
  previous engine keyed that map on six types and looked up *both* endpoints of
  each edge in it, so a module-level `const`, a class field, or a type alias was
  invisible as evidence: **35,835 of 46,730 cross-file edges (76.7%)** on the
  main corpus, and 53.7–85.9% across all nine.
- If a name is declared more than once **in the reporting scope** — the six
  reported types, in non-test non-noise files — unresolved name-only references
  are ambiguous and do not suppress any declaration. Ambiguity is deliberately
  not computed project-wide: the previous query had no `symbol_type`, path or
  test filter, so a declaration in a test file made a same-named production
  declaration ambiguous and disabled the only channel that could clear it.
- A `target_external` tail is taken after the last colon **and** after the last
  dot, matching the indexer's own `extractLeaf`. A qualified reference
  (`com.example.Service`, `Mod.fn`) never equals a stored bare name otherwise.
- **Visibility is not used to filter.** Many analyzers mark everything public.
- **Non-code files contribute no symbol candidates.** `markdown`, `yaml`,
  `json`, `toml`, `xml`, `css`, `html` and friends (one shared set,
  `analysis-exclusions.NON_CODE_LANGUAGES`) index headings, mapping keys and
  selectors, which have no callers by construction. They measured 3,094 of
  4,890 candidates on the main corpus. They are still indexed, still
  searchable, and still checked as whole files.
- **Entry points** are excluded by explicit, extensible name/suffix rules
  (`main`, `init`, `run`, `*Handler`, `*Controller`, `*Route`, …) and by
  filename (`index`, `main`, `app`, `mod`). How many candidates each rule
  suppressed is reported in `summary.suppressedByReason`.
- A **file is referenced** iff a resolved cross-file usage edge lands in it
  (any symbol type), or an import specifier agrees with it: either the last two
  path segments match, or the stem matches **and that stem names exactly one
  file in the project**. The previous global stem set matched `node:fs`
  (1,158 rows) against a local `node.ts`, and `src/utils/foo.ts` against
  `src/other/foo.ts`: 185 real files were suppressed by such a collision,
  mostly Markdown docs "imported" because a same-named `.ts` file was.
- **Project manifests** (`package.json`, `Cargo.toml`, `pom.xml`, …) are never
  offered as dead code. Tooling reads them; source does not import them.
- **Known limit of the import channel:** an `imports` relationship cannot be
  attributed to the file that made it — 3,444 of 3,554 rows on the main corpus
  have a NULL `source_symbol_id`. The file rule therefore cannot require "some
  *other* file imports this one", and every file finding says so.

## Confidence is derived from evidence

It used to be a constant per rule (0.6 symbols, 0.5 files), which made
`minConfidence` a two-valued switch, made the page sort degenerate to
alphabetical path order, and made the documented default of 0.6 silently delete
the entire `orphaned_file` rule.

Each term was assigned from the measured false-positive rate of that class,
scored against "is something other than `contains`/`exports` pointing at this
symbol, or unambiguously naming it":

| Class | Candidates | Measured false-positive rate |
| --- | --- | --- |
| name unique in the reporting scope | 2,581 | **0.0%** (zero in all nine repos) |
| name ambiguous | 6,113 | 14.4% |
| file already cross-file referenced | 7,234 | 11.4% |
| file not cross-file referenced | 1,460 | 3.7% |

Symbol confidence is `0.5 ± 0.15` for name uniqueness, `± 0.05` for file
reachability, clamped to **[0.30, 0.70]**. The ceiling is the cap this tool has
always published, kept rather than raised: a candidate can move within the band,
but the band did not move. Nothing here can reach 1.0, because name matching
cannot see dynamic dispatch, reflection, or string lookup.

The file-reachability term points opposite to intuition and the measurement is
what settled it: a file other files already reach is where an unrecorded
reference is most likely, while a file with no cross-file edge at all is the one
most likely to be genuinely dead.

`RuleFinding` confidence is the emitted value (0.6–0.9) and is filtered by the
same `confidenceThreshold`. A finding past the display budget carries
`truncatedByDisplayLimit: true`.

## Results, before and after

| Measure | Before | After |
| --- | --- | --- |
| symbol candidates (main corpus) | 5,190 | 468 |
| symbol false-positive rate | 30.7% | 6.2% |
| file candidates | 1,259 | 1,134 |
| file false-positive rate | 14.4% | 0.0% |
| file false-positive rate, worst corpus | 23.2% (mojo 60.0%) | 2.1% |
| findings under `src/` in the default 100-row page | 0 | 20 |
| `bb_patterns {}` wall clock | 330s | 6.7s |

## Ranking

Findings are ordered by confidence, then severity, then size, then path. The
old comparator was confidence then path, and with constant confidences the page
was an alphabetical prefix of the repository: 59 rows of `.github/workflows/*.yml`,
39 of `docs/*.md`, 2 of `.vscode/*.json`, and nothing under `src/`.

`detectPatterns` ranks the orphan branch and the rule branch as **one** list.
The old code concatenated the orphan page first and then sliced, so on any
repository with more orphan candidates than `maxResults` the entire
anti-pattern branch was cut while `includeAntiPatterns` defaulted to true.

## Counts a caller can trust

- `statistics.totalFound` is the **census**. It used to be the returned page's
  length while `byType`, `bySeverity` and `averageConfidence` beside it
  described the census, and the handler printed the page length under the words
  "found": with the default limit the tool fetched 100, printed 20, and said 100.
- `scan.displayed` is the page. `scan.findingsBeforeDisplayLimit` is the census.
- Both scopes print the census, the page size, and the per-rule census
  breakdown. `scope=orphaned` also prints `summary.suppressedByReason`, so a
  report of zero is distinguishable from a scan that suppressed everything it
  saw.
- `summary.scannedFiles` describes the file branch's real scope (1,630 of 1,654
  on the main corpus). It used to count only files holding one of six symbol
  types while the branch iterated every `brain_file` row.

## recordRun persistence contract

`bb_patterns { recordRun: true }` persists the **whole census** — every detected
pattern, not the page and not the preview. The response reports
`(N found, M recorded)` where `M` equals `N`.

This was previously broken in the direction its own comment warned about: since
M57.T3 bounded the page inside `detectPatterns`, the array being persisted was
`min(census, max(limit,100))`, so the next run's auto-resolve pass marked live
findings as resolved. `recordRun` now re-scans for the full census, with a
50,000 cap that is **disclosed in the response** when hit, because a cap that is
not reported is silent data loss.

## Latency

The god-class rule's self-join did not use `brain_symbol_owner_idx`, which
exists for exactly that predicate, so the member count cost
`|candidate types| × |all symbols in the project|` row visits. A plain
`bb_patterns {}` took 330s on a 45,018-symbol index. The correlated-`COUNT(*)`
form returns an identical row set and 104ms on the same index. Every rewrite
was checked to return identical rows before being considered; the measurements
are in `fixtures/bb_patterns/probes/probe-p7-godclass-scaling.mjs`.

## Known false-positive classes

- Dynamic dispatch, reflection, and string-keyed lookups remain unknown; they
  are never converted into fabricated resolved usage edges.
- **An index coverage gap is not visible to this tool.** A symbol with one
  `exports` edge and no usage edge may be dead, or may be called through a
  dynamic import the indexer did not record. Example measured on the main
  corpus: `src/ast/project-health.ts:13 computeAndStoreProjectHealth` is
  statically imported at `src/ast/parallel-indexer.ts:22` and called via
  `await import("./project-health")` at `:4208` and `:4611`, and the index holds
  exactly one relationship for it — its own `exports` edge. The 11.4% vs 3.7%
  file-reachability split above is the measured expression of this class.
- Framework entry points not covered by the built-in name/suffix rules.
- Build configs, plugin manifests (XML), and test conventions.
- Test files are excluded from *candidates* but not from *evidence*: a
  production symbol called only from a test is not reported, and a production
  file imported only by a test is not reported as orphaned. `includeTests: true`
  means "also report test symbols", not "ignore tests when looking for users".

## Suppression accounting

`summary.suppressedByReason` counts every candidate the scan discarded, by
reason: `testPath`, `hardNoise`, `noiseSymbolName`, `entryPointName`,
`nonCodeFile`, `manifestFile`, `ruleNotRequested`, `belowMinConfidence`. Seven
suppression paths existed before and none was counted, so a project with 5,000
real orphans and 5,000 suppressed entry points looked identical to a clean one.

## Options

`detectOrphans(projectId, { rules?, minConfidence?, maxResults?, includeTests? })`.
`rules` selects which orphan rules to run. Results are ranked by confidence,
then size, then path; `summary.truncated` is set when `maxResults` is exceeded
(no fixed per-category quotas).

`minConfidence` defaults to **0** in the handler. It previously defaulted to
0.6, which is now above most of the derived range and would drop most symbol
findings and every file finding.

## Verification

- `script/verify-patterns.ts` — positive and negative fixtures across
  TypeScript and Python; schema, exact LOC, evidence-aware remediation, and the
  confidence cap.
- `script/m13/verify-patterns-orphans.ts` — 22 checks across TypeScript,
  Python, Ruby, Go and Java, with 5 negative guards, including
  cross-language false-positive guards and `is_cross_file` honesty.
- `script/m13/verify-patterns-rules.ts`, `script/m13/verify-patterns-contract.ts`
  (both transports), `script/m20/verify-patterns-parameter-scan.ts`,
  `script/m20/verify-patterns-pagination-history.ts`,
  `script/m57/verify-t3-scope-all.ts` (17 checks, mutation-tested).
- `fixtures/bb_patterns/` — the corpus suite: nine real repositories, the
  false-positive oracles, the query-plan measurements, and the design-option
  comparisons that chose every fix above.

### Known pre-existing failure

`script/m20/verify-patterns-orphan-semantics.ts` fails 2 of its 6 checks. It
fails them identically on the unmodified engine, so the change did not cause it:
the indexer resolves one call to **both** same-named declarations, so the
ambiguity guard is defeated upstream of the pattern engine. The fix belongs to
the indexer, not here.
