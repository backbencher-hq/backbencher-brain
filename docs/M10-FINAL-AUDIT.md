# M10 Final Evidence Audit

Issue: [#115](https://github.com/backbencher-hq/backbencher-brain/issues/115)

Date: 2026-08-10

Release decision: **ready** for version `0.3.0`

## Issue And Dependency Audit

M10 was executed in dependency order. M10.01 through M10.07 are closed; this
audit is the only issue authorized to close the milestone.

| Order | Issue | Commit | Result |
| --- | --- | --- | --- |
| M10.01 | #116 | `06086ca` | Closed; contract and evidence baseline frozen |
| M10.02 | #118 | `8714980` | Closed; provenance taxonomy enforced |
| M10.03 | #113 | `19d9bdd` | Closed; canonical engines and adapters consolidated |
| M10.04 | #117 | `74cacde` | Closed; analysis-run and finding lifecycle governed |
| M10.05 | #114 | `7e8df02` | Closed; correctness and performance budgets established |
| M10.06 | #121 | `032a093` | Closed; legacy intelligence deleted with safety proof |
| M10.07 | #120 | `c18b821` | Closed; CLI/MCP contract re-verified |
| M10.08 | #115 | audit commit containing this file | Ready to close after final gates |

No dependency was bypassed. Each issue was closed only after its predecessor
was complete and its issue-specific verifier passed.

## Artifact Matrix

| Issue | Primary artifacts | Fixture | Verifier |
| --- | --- | --- | --- |
| M10.01 | `docs/M10-CONTRACT-BASELINE.md`, `docs/data/m10-baseline.json`, `docs/M10-DISPOSITION-LEDGER.md` | Repository source | `script/verify-m10-baseline.ts` |
| M10.02 | `src/intelligence/evidence.ts`, provenance fields in canonical reports | Contract fixture | `script/verify-evidence-governance.ts` |
| M10.03 | `docs/M10-INTELLIGENCE-OWNERSHIP.md`, `src/intelligence/search/quick-answer.ts` | `script/fixtures/contract-fixture.ts` | `script/verify-intelligence-consolidation.ts` |
| M10.04 | `docs/M10-ANALYSIS-GOVERNANCE.md`, `src/intelligence/analysis/run-history.ts` | Contract fixture | `script/verify-analysis-governance.ts` |
| M10.05 | `docs/M10-BENCHMARKS.md`, `docs/data/m10-benchmark-baseline.json`, `docs/data/m10-benchmark-last-run.json` | Contract fixture | `script/verify-m10-benchmarks.ts` |
| M10.06 | `docs/M10-DELETION-LEDGER.md`, updated disposition ledger | Repository source | `script/verify-deletion-safety.ts` |
| M10.07 | `docs/M10-PUBLIC-CONTRACT-ATTESTATION.md` | Registry, CLI, MCP fixture | `script/verify-contract-diff.ts` plus public surface, CLI, MCP, and E2E verifiers |
| M10.08 | This file and `docs/data/m10-final-audit.json` | All preceding artifacts | `script/verify-m10-final-audit.ts` |

The machine-readable artifact contains the complete path inventory and is
validated by `script/verify-m10-final-audit.ts`.

## Public Contract Comparison

The baseline-to-final public contract is unchanged:

- 10 public MCP tools, in the same order and with the same names.
- 0 aliases and 0 deprecated descriptors.
- Descriptor mutability, index requirements, modes, required fields,
  properties, and defaults exactly match `docs/data/m10-baseline.json`.
- CLI commands remain `index`, `search`, `health`, `mcp`, `tool`, and
  `--version` with their baseline options.
- 21 package-root exports remain declared.
- CLI `bb tool` and MCP dispatch use the same `validateToolArguments` and
  `createToolHandlers` paths.
- Every tool rejects undocumented options, wrong argument types, invalid enum
  values, and missing required fields.

M10.06 removed internal implementation symbols, not public tools, modes, CLI
commands, or package-root exports. No versioning change or new migration path
is required. Historical alias migration remains documented in
`docs/MCP_TOOL_MIGRATION.md`.

## Correctness And Performance

Correctness comparison: **0 regressions** on the canonical contract fixture.
The fixture verifies indexed search, semantic candidates, graph traversal,
impact, complexity, dependencies, project statistics, orphan detection,
security analysis, test intelligence, analysis execution, and history.

Performance comparison: **16 of 16 measurements pass**, with zero budget
violations. The most expensive measured operation is `bb_ask_semantic` at
approximately 259 ms against a 2,500 ms upper-bound budget. The next highest
budget utilization is `bb_search_content` at approximately 87 ms against a
500 ms budget. All other measurements use less than 4% of their budget in the
recorded run.

These numbers are fixture-local measurements, not universal latency claims.
Machine load, project size, parser availability, database state, and storage
can change observed performance. Budgets are declared upper bounds; correctness
regressions block, while performance violations are recorded for investigation.

## Deletion And Quarantine

M10.06 removed 5,453 net lines from `src/ast/tools.ts` and preserved only thin
delegating compatibility boundaries. The complete per-symbol evidence is in
`docs/M10-DELETION-LEDGER.md`.

Removed groups include `AdvancedBrainTools`, `TestIntelligenceBrainTools`,
sentinel orchestration and persistence markers,
`revolutionaryArchitectureIntelligence`, duplicate `BrainTools` methods, and
`PatternBrainTools.findOrphanedCode`. Canonical replacements are recorded in
the deletion ledger and ownership matrix.

Unsupported claim markers such as `WORLD'S FIRST`, `No other tool in the
world`, and `BREAKTHROUGH` are absent from shipped source. Removed code remains
recoverable through Git history; no runtime quarantine namespace is shipped.

## Runtime Evidence

Bun/source evidence:

- All M10-specific TypeScript verifiers run with Bun.
- `verify-public-surface.ts` checks live descriptors and handlers.
- `verify-contract-diff.ts` exercises live validation for every public tool.
- `verify-mcp-e2e.ts` indexes a fixture and executes all ten MCP tools.

Compiled Node evidence:

- `npm run build` produces ESM output successfully.
- `script/verify-integration-runtime.ts` exercises compiled/runtime integration.
- MCP initialization, `tools/list`, dispatch, validation errors, and edit
  operations pass the E2E verifier.

This is the supported runtime evidence available in the repository. No claim
is made for untested operating systems, Node versions, host applications, or
project language combinations.

## Limitations And Deferred Work

Accepted residual risks:

- `BrainTools.searchCode` remains as a thin delegating compatibility alias for
  possible out-of-tree library consumers. Removing it requires a deliberate
  package-export/versioning decision.
- Static analysis cannot prove runtime execution coverage. Test-intelligence
  reports explicitly mark runtime coverage as unavailable.
- Orphan, security, complexity, impact, and dependency findings are static or
  heuristic and can contain false positives and false negatives.
- Semantic search quality depends on embedding availability and indexed
  content; fallback lexical evidence is weaker and is identified as such.
- Benchmark results are fixture-local upper-bound checks, not cross-machine
  performance guarantees.
- Framework and anti-pattern detection in the retained compatibility shim is
  not presented as a canonical intelligence result.

All listed risks are accepted for `0.3.0`. None changes the frozen public
contract or blocks release readiness. Future work should become a separately
scoped issue rather than silently extending M10.

## Claims Policy

Unsupported claims are not presented as proven. Canonical M10 intelligence
results carry provenance, evidence class, engine identity/version, and explicit
limitations where applicable. Static findings are not described as runtime
facts, semantic candidates are not described as exact proof, and fixture-local
benchmarks are not described as production-wide guarantees.

## Release Decision

**Decision: ready.** Version `0.3.0` is release-ready from the M10 evidence and
contract-governance perspective because:

- Every preceding M10 issue is closed with a dedicated commit and verifier.
- The public CLI/MCP/library contract matches the frozen baseline.
- Correctness fixtures pass with zero regressions.
- All 16 benchmark measurements remain within declared budgets.
- Legacy duplicate intelligence and unsupported claims were removed.
- Bun/source and compiled Node runtime paths pass their supported gates.
- Residual risks are explicit and accepted.

This decision does not claim defect-free behavior outside the verified scope.

## Reproduction

Run from the repository root:

```sh
npm ci
npm run typecheck
npm run build
npm run docs:verify
npm run verify
git diff --check
git status --short
git diff --stat
```

`npm run verify` includes every M10-specific verifier and the full domain,
integration, CLI, MCP, contract, and E2E chain. The quality-gate verifier also
asserts that no required M10 verifier is omitted.

## Worktree And Commit Evidence

Before the final audit commit, the intended diff consists of:

- `docs/M10-FINAL-AUDIT.md`
- `docs/data/m10-final-audit.json`
- `script/verify-m10-final-audit.ts`
- aggregate verifier wiring in `package.json` and
  `script/verify-quality-gate.ts`

`docs/data/m10-benchmark-last-run.json` may be regenerated by the benchmark
verifier; it is deterministic in structure but contains current timing and a
timestamp. The final closure comment records the concrete audit commit hash,
final `git status --short`, `git diff --check`, and `git diff --stat` results.
The audit artifact uses `audit-commit-containing-this-artifact` for M10.08 to
avoid a self-referential commit hash.
