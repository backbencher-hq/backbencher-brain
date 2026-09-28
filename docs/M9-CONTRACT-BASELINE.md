# M9 Contract Baseline

This document freezes the public contract at the start of M9. It is a compatibility baseline, not a declaration that every current behavior is correct.

> **Superseded by M13.01 (contract authority):** `CURRENT_MCP_TOOL_CONTRACTS` and the
> `TargetToolInput`/`TARGET_TOOL_CONTRACTS` planning declarations referenced below no longer
> exist. The public tool contract is now derived from the executable registry
> (`deriveToolContracts()` in `src/mcp/tool-registry.ts`); aspirational modes live in each
> descriptor's `plannedModes` field and are never advertised as executable.

The machine-readable source is `src/contracts/tool-contracts.ts`. The executable baseline is `script/verify-contracts.ts`, using the polyglot fixture in `script/fixtures/contract-fixture.ts`.

## Current Surfaces

### MCP

The current MCP server exposes exactly 15 text-output tools:

| Tool | Mutation class | Planned replacement |
| --- | --- | --- |
| `bb_search` | Read | `bb_search` |
| `bb_select` | Read | `bb_search mode=symbol` |
| `bb_relationships` | Read | `bb_analyze` |
| `bb_ask` | Read | `bb_ask` |
| `bb_health` | Read | `bb_health` |
| `bb_patterns` | Read | `bb_patterns` |
| `bb_security` | Read | `bb_security` |
| `bb_visualize` | Read | `bb_visualize` |
| `bb_migrate` | Read | `bb_migrate` |
| `bb_refresh` | Index mutation | `bb_health refresh=true` |
| `bb_write` | Source mutation | `bb_edit mode=write` |
| `bb_update` | Source mutation | `bb_edit mode=update` |
| `bb_insert` | Source mutation | `bb_edit mode=insert` |
| `bb_delete` | Source mutation | `bb_edit mode=delete` |
| `bb_refactor` | Source mutation | `bb_edit mode=refactor` |

Input property names, required fields, and handler defaults are frozen in `CURRENT_MCP_TOOL_CONTRACTS`. Later M9 issues must preserve them through aliases until the documented compatibility window ends.

### CLI

The CLI currently supports `index`, `search`, `health`, `mcp`, and the Commander-provided `--version` flag. The manifest records required arguments and options. M9 does not remove these commands or add a separate `version` subcommand.

### Library

The root package currently exports database/schema access, `ASTEngine`, indexing, `BrainTools`, semantic/freshness helpers, and `getProjectId`. Internal namespace functions are not automatically public MCP contracts.

## Target Surface

M9 targets ten public tools:

1. `bb_search`
2. `bb_ask`
3. `bb_analyze`
4. `bb_patterns`
5. `bb_security`
6. `bb_doc`
7. `bb_visualize`
8. `bb_migrate`
9. `bb_edit`
10. `bb_health`

The typed modes are represented by `TargetToolInput` and the mode unions in `src/contracts/tool-contracts.ts`. These are planning contracts. Each implementation issue may refine fields, but it must retain discriminated modes and reject irrelevant options rather than ignoring them.

## Regression Fixture

The fixture intentionally contains:

- TypeScript, Python, Go, and Markdown files.
- Two same-named TypeScript symbols for disambiguation and pagination.
- A test file referencing production code.
- Existing source documentation and a documentation file.
- A callable relationship and an unreferenced function.
- Files that can be made stale after indexing.
- Throwaway targets for all five mutation tools.

Embedding and relationship generation use the real project indexer. The fixture is created in a temporary directory and its project database is removed after verification.

## What The Baseline Protects

`verify-contracts.ts` protects:

- Exact current tool count and names.
- Input property and required-field schemas.
- Target surface uniqueness.
- Search limit and pagination acceptance.
- Missing-symbol output.
- Default relationship direction.
- Default health counts and freshness output.
- Stale search markers.
- Write, update, insert, delete, and refactor side effects and reindex messages.

The existing MCP E2E test continues to exercise every public tool. The new baseline supplements it with contract-level checks.

## Known Incorrect Behavior

These defects are recorded but are not desired compatibility behavior:

- Search regex currently returns no results.
- Content/comment search is not implemented by the current symbol search.
- Broad ranking may operate on an arbitrary capped prefix.
- Coupling outgoing counts use the incoming direction.
- Several options in recall, dependency, pattern, semantic, impact, and feature functions are ignored.
- Some pattern detectors are empty or use incorrect orphan semantics.
- Hidden Test Intelligence and flow/test-generation helpers query obsolete tables.
- The dormant patrol system references missing persistence tables and contains stubs.
- Semantic retrieval can compare incompatible model spaces and scans JSON vectors in memory.
- Current edits lack the complete safety model planned for `bb_edit`.

Tests added during M9 should reproduce these defects before fixing them, then assert the corrected behavior. They should not encode the defect as the permanent expected result.

## Runtime Matrix

- Bun runs source TypeScript and uses the Bun SQLite driver.
- Node users run the compiled distribution with the Node SQLite driver.
- `script/verify-contracts.ts` supports both runtime paths, but the package `verify` command currently runs the Bun path.
- Cross-runtime parity and the documented Node engine/build target mismatch are completed in M9.20.

## Definition Of Done

Every M9 issue follows this sequence:

1. Re-read the issue and completed dependencies.
2. Review implementations, callers, schemas, and existing tests.
3. Reproduce the defect or establish a representative fixture.
4. Implement the smallest complete correction.
5. Update canonical reference documentation and machine-readable metadata.
6. Add focused tests and run affected suites.
7. Run issue-specific verification plus required project gates.
8. Inspect status and diff; stage only intended files.
9. Commit with the issue number.
10. Post verification evidence and residual risks, close the issue, then proceed.

Implementation alone is not completion. Documentation, tests, verification, and a focused commit are required.

## Website Boundary

The website repository at `$HOME/mcp/website` is not modified during this issue. Future website work should consume generated contract metadata rather than duplicate MCP schemas manually. M9.19 defines and publishes the final website-ready artifact after the ten-tool surface is established.
