# M10.07 Public Contract Attestation

Issue: [#120](https://github.com/backbencher-hq/backbencher-brain/issues/120)
Date: 2026-08-10
Milestone: M10 — Intelligence Consolidation and Evidence Governance

## Scope

M10.07 re-verifies that the public contract holds after M10.03 (intelligence
consolidation) and M10.06 (deletion of legacy symbols). The goal is one
deliberate, documented, and reproducible public surface.

## What was done

1. Reviewed all existing verifiers (`verify-public-surface.ts`,
   `verify-mcp-e2e.ts`, `verify-cli-surface.ts`, `verify-contracts.ts`,
   `verify-m10-baseline.ts`) — they already check registry/handlers parity,
   MCP dispatch, CLI gateway parity, and baseline descriptor freeze.

2. Added `script/verify-contract-diff.ts` — a new contract-diff verifier
   that adds three higher-order guarantees:
   - Undocumented-option rejection is enforced live for every public tool
     (each tool rejects `__m10_undeclared_probe__: true`).
   - Required-field and type validation are active for every public tool.
   - Registry/handlers/CLI-gateway triangle has no drift (handler count
     equals descriptor count, handler set equals descriptor set, CLI
     gateway dispatches through the same validator and handler map).
   - Migration guidance stays coherent with registry truth: 0.3.0 has
     zero aliases, no descriptor is marked deprecated, and both
     `docs/MCP_TOOL_MIGRATION.md` and `docs/TOOL-REGISTRY.md` agree.

3. Wired the new verifier into the aggregate `npm run verify` chain and
   into `script/verify-quality-gate.ts`.

## Attestation

- **Baseline is unchanged.** `docs/data/m10-baseline.json` descriptors,
  CLI commands, library exports, and tool names match the live registry
  exactly. No baseline drift occurred.
- **Public surface unchanged.** 10 tools, 0 aliases, 0 deprecated
  descriptors, 0 undocumented options accepted.
- **CLI and MCP use identical handlers and validation.** Both routes call
  `validateToolArguments(descriptor, args)` before dispatch into
  `createToolHandlers()`.
- **No intentional breaking change.** All removals in M10.06 were internal
  implementation details of `src/ast/tools.ts` which is not part of the
  public contract.
- **Generated docs have no drift.** `docs/MCP_TOOL_MIGRATION.md` and
  `docs/TOOL-REGISTRY.md` agree with runtime truth.

## Verification commands

```sh
npm run docs:verify
bun run script/verify-public-surface.ts
bun run script/verify-contracts.ts
bun run script/verify-cli-surface.ts
bun run script/verify-mcp.ts
bun run script/verify-mcp-e2e.ts
bun run script/verify-contract-diff.ts
npm run verify
```

All pass with zero failures.

## Residual risks

- `BrainTools.searchCode` remains as a thin delegating alias (it is still
  exported as a library symbol, frozen in `libraryExports`). Full collapse
  would require migrating two internal call sites and re-releasing a
  minor version. Deferred to a future milestone.
- The CLI tool gateway uses the same `validateToolArguments` path, but
  its options typing is loose (`any`) inside `cmdTool`. This matches the
  MCP handler shape and is not a public API drift.

## Disposition

**Resolution**: public contract is frozen, deliberate, and reproducible.
No further changes required to close M10.07.
