# bb_security Reference (M9.09)

`bb_security` reports security findings from the project's taint-flow index. The
strict engine (`src/intelligence/security/taint.ts`) treats `brain_taint_flow`
as the **primary evidence source**, resolves every flow to symbols/files,
deduplicates, and classifies each by state with calibrated confidence.

## Evidence model

Each finding derives from one or more `brain_taint_flow` rows (source → sink
data-flow observations written by the indexer's taint analyzer). Source scanning,
when integrated, contributes only lower-confidence corroborating evidence — it
never overrides flow evidence.

## Finding schema (`SecurityFindingV2`)

| Field | Meaning |
| --- | --- |
| `vulnerabilityType` | Normalized type (e.g. `sql_injection`) |
| `label` | Human label |
| `severity` | `critical` / `high` / `medium` / `low` / `unknown` |
| `confidence` | 0..1, calibrated by state |
| `state` | `confirmed` / `mitigated` / `unresolved` / `source_only` |
| `source`, `sink` | Resolved `FlowNode` (symbolId + name + file + line) |
| `path` | All intermediate nodes, each resolvable by id/location |
| `crossLanguage` | `cross_language_boundaries > 0` |
| `mitigated` | From `is_mitigated` |
| `evidence` | Array of `{ kind, description }` |
| `limitations` | Known false-positive classes |

## States

State is derived from **endpoint resolution**, never from the raw row alone:

- **confirmed** — both source and sink resolve to indexed symbols; unmitigated.
- **mitigated** — `is_mitigated = 1`; kept but low actionable confidence.
- **source_only** — the source symbol resolves but **no sink endpoint is
  reachable** (isolated-source observation). Never promoted to a finding.
- **unresolved** — a sink endpoint exists but the source endpoint does not
  resolve to an indexed symbol (sink-only row), i.e. one endpoint unresolved.

`source_only`/`unresolved` findings are observations, not confirmed
  exploitable paths — treat as leads, not verdicts.

## Severity & confidence

Severity comes from the flow row. Confidence is calibrated by evidence quality:
`confirmed` = 0.7, `unresolved`/`source_only` = 0.4, `mitigated` = 0.3.

`brain_taint_flow.severity` is a bare `TEXT NOT NULL` column with **no CHECK
constraint** (`src/brain/schema-ddl.ts:241`), so a writer can store a value
outside the documented union. Severity is therefore **normalized at the engine
boundary** to exactly `critical | high | medium | low | unknown`; anything else
becomes `unknown` rather than being cast through. Two consequences that are
now invariants instead of hopes:

- `sum(summary.bySeverity) === summary.total`. Previously an unrecognized
  severity appeared in `bySeverity` and in none of the five named buckets, so
  the handler printed `0 critical / 0 high / 0 medium / 0 low` directly above a
  list of findings.
- A hotspot whose only finding has an unrecognized severity reports
  `maxSeverity: "unknown"`, not `"low"`. The hotspot accumulator seeds with the
  worst bucket so the fold is a true max.

The indexer currently writes only `critical`, `high` and `unknown`
(`src/ast/parallel-indexer.ts`), so in practice `medium` and `low` are empty
and `unknown` is exactly the isolated-source rows.

## Deduplication

The indexer emits multiple rows per real issue (one per `source_type` variant,
plus intermediate-variable flows). Findings are deduplicated by flow-equivalence
(`vulnerabilityType | sink | sinkType | file:line | state`).

Row order from `brain_taint_flow` is not a SQLite contract, and dedup keeps the
first row of each equivalence group as the finding's `id`, so the read is
ordered by `t.id` and the finding sort breaks its final tie on `id`. The
reported identity is a property of the data, not of the storage layout.

## Truncation and the census

Three numbers, and they are not interchangeable:

| Field | Meaning |
| --- | --- |
| `summary.scannedFlows` | Rows read from `brain_taint_flow` (pre-dedup). |
| `summary.deduplicatedFlows` | Findings after dedup, **before** the `maxResults` cap. |
| `summary.total` | Findings actually returned. |
| `summary.truncatedFindings` | `deduplicatedFlows - total`. `0` means the report is complete. |

`bySeverity`, `byType`, `byState` and `hotspots` are computed over the
**returned** findings, so they always describe exactly what is on screen and
`sum(bySeverity) === total` holds. `provenance.truncated` is set when the cap
bit, and `provenance.unknowns` names the dropped count.

The legacy adapter (`src/security/cross-language-security.ts`) now carries
`provenance`, `scannedFlows`, `deduplicatedFlows` and `truncatedFindings`
through to the handler. It previously returned none of them, which is why a
capped scan was indistinguishable from a complete one at the tool surface.

## Vulnerability-type normalization

Aliases are normalized (e.g. `sqli`/`sql` → `sql_injection`, `rce` →
`code_injection`, `xss_reflected`/`xss_stored` → `xss`). Findings never retain a
raw alias.

## Modes

**One executable mode: `findings`.** The strict engine
(`src/intelligence/security/taint.ts`) returns the finding list together with
`summary` and `hotspots` in a single report; there is no per-mode dispatch.

`flow`, `summary` and `hotspots` are **planned, not executable**. They are
declared in `src/mcp/tool-registry.ts` under `plannedModes` (not `modes`) and
in `docs/tools/bb_security.md` as "roadmap, not executable".
`SecurityOptions.mode` is accepted by the type and **ignored** by the engine —
there is no code path that reads it. `docs/M10-CONTRACT-BASELINE.md:41`
records this same drift. Treat the `mode` field as a documentation artifact,
not a capability.

Options honoured by `analyzeTaintFlows`: `minConfidence`, `includeMitigated`,
`includeUnresolved`, `maxResults`. None are exposed on the `bb_security` MCP
schema (which accepts only `history`, `recordRun`, `limit`); they are reachable
from the typed API, not from the agent-facing tool.

## Limitations & safe interpretation

- Flows are **indexer heuristics**. A parameterized or escaped sink can still be
  reported (the engine surfaces this as a per-finding limitation rather than
  silently trusting or dropping it).
- `source_only`/`unresolved` findings are observations, not confirmed
  exploitable paths — treat as leads, not verdicts.
- **`recordRun` persists only real findings** (confirmed/mitigated).
  `source_only`/`unresolved` observations are reported live as "unvalidated
  sources" and are **excluded from persisted history** — history must never
  contain `rule="unresolved"` or `severity="unknown"` rows. They are shown on
  the `recordRun` response too (marked "not persisted"); previously that path
  omitted them entirely, so `{"recordRun": true}` reported less than `{}`.
- **`recordRun` persists the full analysed set, never a display slice.**
  `completeAnalysisRun` auto-resolves any prior `open` finding that is absent
  from the persisted set, so persisting a capped scan would resolve findings
  that were never examined. The recording path therefore re-scans with
  `maxResults: SECURITY_RECORD_RUN_CENSUS_CAP` (50 000), and when even that cap
  bites, the response says so with the same `CAPPED at …` note `bb_patterns`
  uses. `bb_security` had no such guard before this.
- **Persisted findings carry evidence and confidence.** The legacy adapter
  used to drop `confidence`, `evidence` and `limitations` from the strict
  finding, so the `recordRun` mapper read them off a shape that never had them:
  every persisted security finding was stored with `confidence = NULL` and
  `evidence = '[]'` — no calibration and no evidence. Both are now carried, and
  the fingerprint is `taint:<type>:<sinkType>:<file>:<line>` (the old
  `file:line:label` key collided for two sinks on one line and changed identity
  when a finding was merely re-graded).
- **A finding with no resolvable file reports `<unresolved location>`**, not
  `?`. The old `"?"` sentinel was passed to the freshness resolver, which
  queried `relative_path IN ('?')` — a file that cannot exist — so those
  findings were counted `missing` and inflated the staleness footer.
- **Sink classification is token-based over symbol bodies.** A symbol whose
  body text contains a token like `execute` can match the universal SQL-sink
  regex even when no database/SQL is involved — reproducing Ruby `def execute`
  as a phantom `sql_injection` on a build tool with no DB (reproduced against
  rake/lib during the M16 real-repo run; the tool layer faithfully mirrors the
  taint table, the limitation lives in the indexer's sink matcher). Sink-only
  rows (no resolved source) are still surfaced as criticals. Improving the
  sink matcher is an **analyzer/indexer-domain** fix tracked in the M14/M17
  analyzer truth milestones — until then, validate critical findings against
  actual data-flow before acting on them.
- This tool reports **project-code** findings. Hardening of the MCP server
  itself is a separate concern and is not mixed into these results.

## What the tool does NOT detect

Stated explicitly, because the previous tool description claimed otherwise:

- **Hardcoded secrets — not implemented.** No writer emits any secret
  vulnerability type. The `sensitive_data` taint *source* rule
  (`src/ast/taint-analyzer.ts:88`) marks a symbol as a data source; it never
  produces a finding. A `hardcoded_secret` rule exists in
  `src/ast/patterns.ts` and is reported by `bb_patterns`, a different tool.
- **Cross-language taint is not a language comparison.** `crossLanguage` is
  `cross_language_boundaries > 0`, and the only writer of a non-zero value is
  `resolveCrossSymbolTaints` (`src/ast/parallel-indexer.ts:3787`), which sets
  the column to the constant `1` for *any* flow joined across a
  `brain_relationship` edge. No code compares the source and sink languages.
  Read the field as "this flow was stitched across symbols", not as "this flow
  crosses languages". Every committed corpus run records `crossLanguage: 0`.
- **Weak crypto is effectively unreachable as a finding.** `weak_crypto` is
  emitted as a *sink* (`src/ast/taint-analyzer.ts:221`) and a finding requires a
  co-located taint *source* in the same symbol (or a relationship join). A
  standalone `md5(x)` becomes an isolated-sink row, is classified `unresolved`,
  and is reported as an unvalidated observation rather than a finding.
- **Detection is source/sink co-location, not data flow.** The indexer pairs
  every taint source with every taint sink in a symbol body
  (`src/ast/parallel-indexer.ts:2846-2872`). Two tokens in the same function
  produce a `confirmed` flow whether or not one reaches the other. `confirmed`
  means "both endpoints are indexed symbols", not "these values are connected".
- **Taint detection covers all languages; AST-level sink/source detection does
  not.** `TaintAnalyzer.enrichSymbols` runs on every parsed file
  (`src/ast/pool-worker.ts:572-578`) for every language, so taint rows exist
  outside TypeScript. The receiver-based, AST-shaped rules in
  `real-typescript-analyzer.ts` exist for TypeScript only; every other language
  is matched by the token regexes in `taint-analyzer.ts`.

## Verification

`script/verify-security.ts` covers same-language SQLi, deduplication, resolved
path nodes, confidence calibration, and — via deterministic row insertion —
mitigated state, cross-language flags, `includeMitigated` filtering, hotspots,
and alias normalization. `script/m20/verify-security-flow-boundary.ts` additionally
proves that endpoint resolution takes precedence over a mitigation flag: partial
flows remain `source_only`/`unresolved` observations and are excluded when
`includeUnresolved=false`. `script/m20/verify-security-adversarial.ts` runs a
deterministic policy matrix (exact state/severity/confidence per injected row),
real concatenation-vs-clean behavior, a mutation proof, and a tautology audit
that rejects any security verifier containing unconditional assertions
(`check(..., true)`, `>= 0`, `|| true`). `script/m20/verify-security-history.ts`
proves the history contract: live `source_only`/`unresolved` observations are
surfaced as unvalidated sources but excluded from persisted history; persisted
rows never carry `rule="unresolved"` or `severity="unknown"`; repeat runs keep
finding counts stable; CLI and direct handler record the same set. These are
fixture-level evidence; they do not prove complete real-repository taint recall
(owned by M20.X2).
