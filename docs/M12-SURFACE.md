# M12.47 — MCP/CLI Surface Across All 41 Languages

**Issue:** [#186](https://github.com/backbencher-hq/backbencher-brain/issues/186)
**Milestone:** M12.47 — Complete MCP and CLI coverage across all 41 languages
**Status:** ✅ Verified

## Objective

Prove that the advertised 41 fixture-backed languages are usable through the
public surface, not merely parseable in isolated analyzer tests. The verifier
indexes the complete positive M12 fixture corpus and exercises the shared
handlers, compiled Node CLI, and real MCP stdio server against the same database.

## Evidence

Verifier: `script/m12/verify-m12-surface.ts`
Result: `validation/m12/results/mcp-cli-surface.json`

| Contract | Result |
| --- | --- |
| Advertised language matrix | **41/41**, exactly equal to `validation/m12/fixtures/` |
| Positive fixture corpus | **97/97 files**, zero indexer file errors |
| Per-language query | **41/41**, exact symbol and exact language label through the shared handler |
| Per-language analysis | **41/41**, file complexity JSON returned |
| Per-language documentation | **41/41**, file documentation JSON returned |
| Per-language migration | **41/41**, normalized migration result with explicit `plans`/`unsupported` arrays |
| Per-language visualization | **41/41**, filtered project graph with provenance |
| Per-language editing surface | **41/41**, safe `bb_edit` write dry-run with no corpus mutation |
| Compiled CLI query | **41/41**, byte-for-byte equal to shared handler output |
| Real MCP query | **41/41**, one Node stdio MCP session and exact language labels |
| Public MCP tool list | **10/10** registered tools |
| Global MCP smoke | **10/10** tools responded through the real server |

The published matrix is `docs/data/m12-surface-matrix.json`. The verifier fails
if its language set or capability vocabulary drifts from the fixture-backed
advertised set.

## Error and validation contract

A malformed `bb_search` request (`query: 42`) was sent through both transports:

- MCP: `isError=true`, text exactly `error: bb_search: query must be string`.
- CLI: non-zero exit, stderr exactly `error: bb_search: query must be string`.
- Neither output contains a stack trace, runtime file path, or fabricated
  language attribution.

The CLI boundary now catches rejected tool invocations in `bin/bb` and emits the
same concise error form as MCP instead of exposing a Node implementation stack.

## Runtime boundary

The verifier itself runs under Bun because the source/indexing path uses
`bun:sqlite`. The compiled CLI and MCP child server are deliberately launched
with plain Node because the published compiled runtime uses `better-sqlite3`.
This separation is explicit in the verifier; Bun is never mistaken for the
compiled Node surface.

## Scope and honesty

- `indexed`, `queried`, `analyzed`, `documented`, `migrated`, and `visualized`
  are exercised against language-selected indexed targets.
- `edited` is intentionally a **dry-run write**. It verifies public mutation,
  path safety, and request serialization without modifying or reindexing the
  evidence corpus. Full mutating edit behavior remains covered by
  `verify-mcp-e2e.ts` and `verify-edit.ts`.
- Migration results may classify a symbol as unsupported; that is a successful
  explicit result, not fabricated conversion support.
- The evidence proves the fixture-backed advertised surface. It does not claim
  runtime/compiler/build semantics for arbitrary projects.

## Regression verification

- `npm run typecheck`: PASS
- `npm run build`: PASS (compiled CLI rebuilt before surface verification)
- `script/m12/verify-m12-surface.ts`: PASS
- Existing CLI surface, MCP handshake, and ten-tool MCP E2E gates: PASS
- Full `npm run verify` is configured to run the M12.47 surface verifier after
  the existing gates; proxy-unset embedding environment remains the documented
  local requirement for the embedding gate.
