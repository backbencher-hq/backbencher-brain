<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the reference for bb_security: what the tool reports, how a
finding is distinguished from an unvalidated observation, the declared bounds, the
read/write boundary, what it does not detect, and how the suite verifies it.
WHO IT IS FOR — callers of bb_security (agents and operators) and the maintainer
changing its evidence model.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_security/{handler,descriptor}.ts,
src/intelligence/security/taint.ts, src/security/cross-language-security.ts,
script/tool-docs/curation/bb_security.ts, docs/tools/bb_security.md (generated),
and the security verifier scripts.
-->

# bb_security Reference

`bb_security` reports security findings from the project's taint-flow index. The
strict engine (`src/intelligence/security/taint.ts`) treats `brain_taint_flow`
as the evidence source, resolves every endpoint to an indexed symbol and file,
deduplicates by flow equivalence, and classifies each flow by evidence state with
calibrated confidence. The MCP handler then renders an answer whose every claim
is bounded and declared: what was scanned, what was shown, what was not examined,
and — when a finding's file changed after indexing — what is stale.

## Evidence model

Each finding derives from one or more `brain_taint_flow` rows: source → sink
data-flow observations written by the indexer's taint analyzer and the parallel
indexer's cross-symbol resolution. The engine never invents a location: a
finding's `file`/`line`/`symbol` come from the resolved endpoint rows.

## Finding schema (`SecurityFindingV2`)

| Field | Meaning |
| --- | --- |
| `vulnerabilityType` | Normalized type (e.g. `sql_injection`) |
| `label` | Human label |
| `severity` | `critical` / `high` / `medium` / `low` / `unknown` |
| `confidence` | 0..1, calibrated by state |
| `state` | `confirmed` / `mitigated` / `unresolved` / `source_only` |
| `source`, `sink` | Resolved `FlowNode` (symbolId + name + file + line) |
| `path` | Intermediate nodes, each resolvable by id or location |
| `crossLanguage` | `cross_language_boundaries > 0` |
| `mitigated` | From `is_mitigated` |
| `evidence` | Array of `{ kind, description }` |
| `limitations` | Known false-positive classes |

## States

State is derived from **endpoint resolution**, not from the raw row alone:

- **confirmed** — both source and sink resolve to indexed files; unmitigated.
- **mitigated** — both endpoints resolve and `is_mitigated = 1`; kept as a
  low-confidence finding rather than dropped.
- **source_only** — the source resolves but no sink endpoint is reachable
  (isolated-source observation). Never promoted to a finding.
- **unresolved** — a sink endpoint resolves but the source does not (isolated
  sink, typically the token-matcher's one-sided row). Never promoted to a
  finding.

Endpoint resolution **takes precedence over the mitigation flag**: a partial flow
marked `is_mitigated = 1` is classified `unresolved`, never `mitigated`.
`source_only` and `unresolved` rows are observations, not exploitable paths —
treat them as leads.

## Severity and confidence

Severity comes from the flow row. Confidence is calibrated by evidence quality:
`confirmed` = 0.7, `unresolved`/`source_only` = 0.4, `mitigated` = 0.3.

`brain_taint_flow.severity` is a bare `TEXT NOT NULL` column with no CHECK
constraint, so a writer can store a value outside the documented union. Severity
is therefore **normalized at the engine boundary** to exactly
`critical | high | medium | low | unknown`; anything else becomes `unknown`
rather than being cast through. Two consequences that are invariants rather than
hopes:

- `sum(summary.bySeverity) === summary.total`. An unrecognized severity used to
  appear in `bySeverity` and in none of the five named buckets, so the handler
  printed `0 critical / 0 high / 0 medium / 0 low` directly above a list of
  findings.
- A hotspot whose only finding has an unrecognized severity reports
  `maxSeverity: "unknown"`, not `"low"`. The hotspot accumulator seeds with the
  worst bucket so the fold is a true max.

The indexer currently writes only `critical`, `high` and `unknown`, so in
practice `medium` and `low` are empty and `unknown` is exactly the isolated-source
rows.

## Deduplication and determinism

The indexer emits multiple rows per real issue (one per `source_type` variant,
plus intermediate-variable flows). Findings are deduplicated by flow-equivalence
(`vulnerabilityType | sink | sinkType | file:line | state`).

Row order from `brain_taint_flow` is not a SQLite contract, and dedup keeps the
first row of an equivalence group as the finding's `id`, so the read is ordered
by `t.id` and the finding sort breaks its final tie on `id`. The reported
identity is a property of the data, not of the storage layout.

## Bounds and the census

The engine counts three distinct numbers, and they are not interchangeable:

| Field | Meaning |
| --- | --- |
| `summary.scannedFlows` | Rows read from `brain_taint_flow` (pre-dedup). |
| `summary.deduplicatedFlows` | Findings after dedup, **before** the `maxResults` cap. |
| `summary.total` | Findings actually returned by the engine call. |
| `summary.truncatedFindings` | `deduplicatedFlows - total`. `0` means the report is complete. |

The handler's live answer renders at most 20 findings and 5 observations, and
prints a `[scan: …]` census line with the pre-cap totals. When the scan cap
(500 flows for a live read) drops findings, the line says how many are beyond
the cap **and** the explicit `CAPPED at 500; N finding(s) exist and M were not
examined` sentence follows it. A zero-findings answer still states the census:
"no findings" and "nothing was scanned" are different facts.

`recordRun` re-scans with a census-sized cap (50,000) so the persisted snapshot
is the analysed set, not the display window. If even that cap bites, the same
`CAPPED` sentence declares it. `bySeverity`, `byType`, `byState` and `hotspots`
in the typed report are computed over the returned window; `provenance.truncated`
is set when a cap fired and `provenance.unknowns` names the dropped count.

## The history answer

`{ "history": true }` returns the persisted run history as a JSON page:

- `runs` — the completed runs, newest first, bounded by `limit` (default 20);
- `findings` — the persisted findings, capped at 200 per page;
- `findingsTotal`, `findingsShown`, `findingsTruncated` — the page and its true
  total, so a capped page can never read as the whole set;
- `summary` — finding-state counts over the **whole** persisted set;
- `census` — `{ runsTotal, runLimit, findingsTotal, findingsShown, findingsBeyondCap }`.

Persisted findings carry the engine's calibrated confidence, the taint-flow
evidence and the per-finding limitations. Unvalidated observations are never
persisted: history contains only confirmed and mitigated flows. The **state** is
what distinguishes them, not the vulnerability-type string — the indexer can
write the literal type `unresolved` for a flow whose endpoints both resolved,
and that flow is a finding.

Two requests are refused rather than silently reinterpreted: `limit` without
`history: true` (it would be accepted and then ignored), and `history` together
with `recordRun` (they are different answers).

## The recorded run

`{ "recordRun": true }` is bb_security's one write. It scans the way a read does,
then persists the analysed set into the analysis-history tables. The recorded
identity of a finding is
`taint:<type>:<sinkType>:<state>:<file>:<line>`: severity is deliberately not part
of it (re-grading a flow is a repeat, not a new finding), and the state is
deliberately part of it (a confirmed flow and a mitigated flow at the same sink
are two findings, and both must persist).

Recording is not a display slice: `completeAnalysisRun` resolves prior findings
absent from the persisted set, so the snapshot must be the census, not the 20-row
window.

## Read/write boundary

Reads are read-only in the filesystem sense: the index is opened with the
driver's read-only mode, so a read runs no migrations and moves no WAL. An
unindexed project is refused by name at every door — MCP, CLI (`bb tool
bb_security`) and the library (`createToolHandlers`) — because the handler
performs a read-only preflight before it scans; a read never creates an index.

`recordRun` is the one write. It stores analysis-history rows, and because it
opens the database for writing it may also run the additive open-path migrations
every write path runs. No source file is ever modified.

## Staleness

Findings and observations are resolved against the index's file metadata. A
finding or observation whose file changed after indexing is marked `[stale]`, and the answer
carries a footer of the form `N stale, M missing of K referenced file(s)` followed
by the **manual** repair command: `bb index --changed` (or the `bb_index` tool
with the project path — incremental, changed files only). Nothing stale means no
footer at all.

This tool does not auto-refresh and has no `refresh` option. A read does not
reindex a file to make an answer fresh; the flags and the footer describe the
index as it stands.

## Vulnerability-type normalization

Aliases are normalized (`sqli`/`sql` → `sql_injection`, `rce` →
`code_injection`, `xss_reflected`/`xss_stored` → `xss`, `cmd_injection`/`cmdi` →
`command_injection`, `lfi` → `path_traversal`, `pii` → `pii_leak`). Findings
never retain a raw alias.

## Modes

**One executable mode: `findings`.** The engine returns the finding list with its
`summary` and `hotspots` in one report; there is no per-mode dispatch. `flow`,
`summary` and `hotspots` are **planned, not executable**: they are declared in the
registry's `plannedModes` (not `modes`) and the generated page marks them as
roadmap.

Options honoured by the typed engine API: `minConfidence`, `includeMitigated`,
`includeUnresolved`, `maxResults`. None are exposed on the `bb_security` MCP
schema (which accepts only `history`, `recordRun`, `limit`); they are reachable
from the typed API, not from the agent-facing tool.

## What the tool does NOT detect

Stated explicitly, because a security answer is misread in exactly these places:

- **Hardcoded secrets — not implemented.** No writer emits any secret
  vulnerability type. The `sensitive_data` taint *source* rule marks a symbol as
  a data source; it never produces a finding. A `hardcoded_secret` rule exists in
  the pattern engine and is reported by `bb_patterns`, a different tool.
- **Cross-language taint is not a language comparison.** `crossLanguage` is
  `cross_language_boundaries > 0`, and the only writer of a non-zero value sets
  the column to the constant `1` for any flow joined across a `brain_relationship`
  edge. Read the field as "this flow was stitched across symbols", not as "this
  flow crosses languages".
- **Weak crypto is effectively unreachable as a finding.** `weak_crypto` is
  emitted as a *sink*, and a finding requires a co-located taint *source* in the
  same symbol (or a relationship join). A standalone `md5(x)` becomes an
  isolated-sink row, is classified `unresolved`, and is reported as an
  unvalidated observation rather than a finding.
- **Detection is source/sink token matching, not data-flow proof.** The indexer
  pairs every taint source with every taint sink in a symbol body. Two tokens in
  the same function produce a `confirmed` flow whether or not one reaches the
  other. `confirmed` means "both endpoints are indexed symbols", not "these
  values are connected". A token like `execute` can match the universal SQL-sink
  rule in a symbol that never touches a database; measured on real repositories,
  this produces critical `sql_injection` rows in Ruby and C corpora where no SQL
  is involved. The cost of a false positive is bounded (validate before acting);
  the cost of silence would be worse.
- **Parameterized/escaped sinks can still be reported.** The matcher does not
  track sanitizers, so a placeholder query may be flagged. The tool says so here
  and in every finding's limitations; it is not a substitute for validating the
  actual data flow.
- **Taint detection covers all languages; AST-level sink/source detection does
  not.** The taint analyzer runs on every parsed file, so taint rows exist
  outside TypeScript; the receiver-based AST rules exist for TypeScript only, and
  every other language is matched by the token rules.
- This tool reports **project-code** findings. Hardening of the MCP server itself
  is a separate concern and is not mixed into these results.

## Verification

The security suite is thirteen verifier scripts, all runnable from the working
tree against isolated fixture indexes:

- `script/m13/verify-security-contract.ts` — one executable mode, planned modes
  advertised honestly, the handler module read-only, the generated page byte-fresh.
- `script/m13/verify-security-handler.ts` — adapter shape, the CAPPED sentence on
  a >cap fixture, the census-sized recorded set, the declared history page, and a
  read-path proof (a dropped healing index is still missing and the database file
  is byte-identical after a CLI read).
- `script/m13/verify-security-adversarial.ts` — SQLi/CMDi/XSS true-positive
  fixtures, clean and parameterized negatives, mitigation flag, cross-language
  fixture, CLI and MCP stdio doors, and sampled real corpora.
- `script/m13/verify-security-docs.ts` — docs freshness, mode honesty, committed
  evidence validity, and a tamper test proving the release gate blocks a
  non-verified record.
- `script/m15/verify-security-deep.ts` — classification from a real indexer run,
  the classification-construct census, cross-file deterministic classification,
  measured complexity, an optional real-repository scan, the handler output
  contract plus registry/doc honesty, non-TypeScript coverage, and entry-point
  parity/determinism.
- `script/m15/verify-security-precision.ts` — findings that survive a real
  security fix (precision on a before/after fixture).
- `script/m15/verify-security-regressions.ts` — one section per defect class:
  severity accounting, truncation and the recordRun census, fabricated paths,
  evidence-free history, inverted observation text, determinism, and the
  auto-pass/sealed-write audits.
- `script/verify-security.ts` — the engine end to end: strict dedup reduction,
  calibration on findings asserted to exist, a pinned four-state matrix, hotspot
  content, alias normalization, determinism.
- `script/m20/verify-security-flow-boundary.ts` — endpoint resolution against the
  mitigation flag, with a mutation proof.
- `script/m20/verify-security-adversarial.ts` — the policy matrix, real
  behavior, the auto-pass audit over every security verifier, mutation proofs,
  accounting sums, and sealed evidence.
- `script/m20/verify-security-history.ts` — the history contract: observations
  surfaced live and marked not-persisted, persisted rows carrying evidence,
  confidence and limitations, a repeat run resolving nothing, and a severity
  re-grade being a repeat rather than a new finding.
- `script/m17/verify-sec-corpus.ts` and `script/m17/verify-sec-history.ts` —
  real-corpus history invariants and the shared history regression gate.

Evidence: the m15 and m20 verifiers write sealed records (`writeSealed`); the m13
and m17 records go through their milestone harnesses, which write unsealed JSON.
That split is knowable from each record (a `bbSeal` envelope is present or not),
and the trusted reader reports an unsealed record as `unsealed`.

The release-grade real-corpus evidence lives in
`validation/tools/bb_security/REAL-CORPUS.json`: five repositories — TypeScript,
Ruby, Erlang, Python and C — indexed in isolation and scanned through the real
MCP stdio door, with the findings/observations split and door latency recorded per
corpus, plus adversarial fixtures for the negative and boundary cases.

## Safe interpretation

Flows are **indexer heuristics**: a parameterized or escaped sink can still be
reported, and a token match is not a data-flow proof. Treat `confirmed` as "two
indexed endpoints named by this flow", not as a proven exploit. Treat a critical grade as a lead to validate against the actual data
flow, especially in the token-matched languages. Readings that a parameterized
sink is reported are expected behaviour, documented above, not a regression.
