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

## Deduplication

The indexer emits multiple rows per real issue (one per `source_type` variant,
plus intermediate-variable flows). Findings are deduplicated by flow-equivalence
(`vulnerabilityType | sink | sinkType | file:line | state`). `summary.scannedFlows`
vs `summary.deduplicatedFlows` shows the reduction.

## Vulnerability-type normalization

Aliases are normalized (e.g. `sqli`/`sql` → `sql_injection`, `rce` →
`code_injection`, `xss_reflected`/`xss_stored` → `xss`). Findings never retain a
raw alias.

## Modes

`analyzeSecurity(projectId, { mode })` supports:
- `findings` — the finding list.
- `flow` — per-finding resolved path nodes.
- `summary` — `bySeverity`, `byType`, `byState`, `crossLanguage`, scan/dedup counts.
- `hotspots` — files/symbols with the most findings.

Options: `minConfidence`, `includeMitigated`, `includeUnresolved`, `maxResults`.

## Limitations & safe interpretation

- Flows are **indexer heuristics**. A parameterized or escaped sink can still be
  reported (the engine surfaces this as a per-finding limitation rather than
  silently trusting or dropping it).
- `source_only`/`unresolved` findings are observations, not confirmed
  exploitable paths — treat as leads, not verdicts.
- **`recordRun` persists only real findings** (confirmed/mitigated).
  `source_only`/`unresolved` observations are reported live as "unvalidated
  sources" and are **excluded from persisted history** — history must never
  contain `rule="unresolved"` or `severity="unknown"` rows.
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
