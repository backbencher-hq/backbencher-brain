# M10 Contract And Evidence Baseline

This document freezes the repository state at the start of M10. It is a measured
starting point, not a claim that every retained behavior is correct. The machine-readable
projection is `docs/data/m10-baseline.json`; `script/verify-m10-baseline.ts` is the
executable drift gate.

> **Superseded by M13.01 (contract authority):** the hand-maintained
> `CURRENT_MCP_TOOL_CONTRACTS`/`TARGET_TOOL_CONTRACTS` declarations referenced below were
> removed; the contract is now derived from the executable registry. The contract-drift
> items in the next section were resolved by M13.01.

## Baseline Identity

- Milestone: M10 Intelligence Consolidation and Evidence Governance
- Baseline issue: #116
- Baseline commit: `02a24cd` plus the M10.01 implementation commit
- Package version at baseline creation: `0.3.0`
- Canonical runtime surface: ten MCP descriptors from `src/mcp/tool-registry.ts`
- Baseline fixture: `script/fixtures/contract-fixture.ts`

## Frozen Surfaces

The baseline freezes four distinct surfaces:

1. **Runtime MCP registry:** the ten descriptors advertised by `tools/list` and dispatched by
   `src/mcp/tool-handlers.ts`.
2. **Planning/contract declarations:** `CURRENT_MCP_TOOL_CONTRACTS`, `TARGET_TOOL_CONTRACTS`,
   CLI contracts, and library export declarations in `src/contracts/tool-contracts.ts`.
3. **CLI surface:** `index`, `search`, `health`, `mcp`, `tool`, and Commander `--version` behavior.
4. **Legacy intelligence inventory:** retained symbols and claims that require an explicit
   keep/migrate/improve/quarantine/remove decision before later implementation or deletion.

The runtime registry is authoritative for MCP discovery. Planning declarations are recorded
separately because their drift is a M10 decision, not an accidental compatibility guarantee.

## Known Baseline Drift And Risks

- `bb_health` is registered as `read` while the target contract describes refresh-capable health
  as `index`.
- `bb_security` target contracts describe `findings`, `flow`, `summary`, and `hotspots`, while
  the runtime registry currently exposes `findings` only.
- `bb_patterns` target contracts describe `quality` and `architecture`, while the runtime
  registry currently exposes `orphaned` and `all`.
- `bb_ask` target contracts describe `answer`, `explain`, and `feature`, while the registry
  currently exposes `answer` and the handler uses the legacy quick-answer adapter.
- `src/index.ts` exports `CoreStorage` from the Bun adapter despite the package's Node support claim.
- Legacy Sentinel contains obsolete `sentinel_*` persistence queries, empty detectors, and
  fabricated metric/verification helpers; these are inventory items, not trusted results.
- Legacy architecture text contains unverifiable superiority claims; M10.06 must remove or
  replace them with factual scoped language.
- Canonical engine files have broad integration verification but limited direct unit coverage.

These risks are intentionally frozen so later issues must resolve or explicitly accept them.

## Runtime Matrix

| Path | Baseline expectation | Verification |
| --- | --- | --- |
| Bun source | Supported; runs `src` and Bun SQLite adapter | `npm run verify` |
| Built Node distribution | Build target is Node 20; Node adapter is intended | `npm run build`, M10 runtime follow-up |
| MCP stdio | JSON-RPC on stdout; diagnostics must not contaminate it | MCP E2E and integration runtime verifier |
| CLI gateway | Shares registry validation and handlers with MCP | CLI surface verifier |

## Change Policy

This baseline should not be casually regenerated. Any baseline change after M10.01 requires
an explicit issue that identifies the changed surface, reason, compatibility impact, and a
before/after comparison. Deletion or migration issues must prove their changes against this
baseline rather than rewriting the baseline to make drift disappear.

## Definition Of Done

M10.01 is complete only when the JSON artifact, disposition ledger, and baseline verifier are
committed; the verifier is part of `npm run verify` and `verify-quality-gate.ts`; focused gates,
typecheck, build, docs verification, and the full verification chain pass; and issue #116 has
closure evidence with the commit and residual risks.
