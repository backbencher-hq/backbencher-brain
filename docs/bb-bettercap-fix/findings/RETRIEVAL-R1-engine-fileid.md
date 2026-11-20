# [retrieval] R1 — engine-level `findSymbol` `fileId` is still an absolute path (next round)

Lane: retrieval. Status: OPEN (not fixed in wave 1; deliberately out of this lane's owned scope).
Landed wave-1 fix: commit `380a7e473`. Related: triage `docs/bb-bettercap-triage/findings/ISSUE-08-search-symbol-mode.md`.

## Observed

`src/ast/engine.ts:2836` (`ASTEngine.findSymbol` projection) still sets
`fileId: BrainFileTable.path` — the absolute filesystem path — and carries `relativePath` separately.
The wave-1 P2-2 fix remaps this at the `bb_search` handler boundary:
`src/mcp/tools/bb_search/handler.ts:306` sets `fileId = <projectId>:<relativePath>` and publishes the
machine path as `absolutePath`. Verified: no `bb_search` mode leaks an absolute `fileId` (content mode
rows use `brain_symbol.file_id` = `brain_file.id`; file mode uses `brain_file.id`; symbols mode is text
and has no `fileId`). Gate: `script/verify-retrieval-contract.ts` group B3.

## Why it is not fixed here (and what a clean fix costs)

`ASTEngine.findSymbol` has a second consumer that expects a filesystem path:
`src/intelligence/edit/edit-engine.ts:814` and `:857` pass the result into refactor/rename logic that
reads source by that path. Changing the engine projection therefore needs a coordinated change:
(a) engine returns `fileId = <projectId>:<relativePath>` + `path` (absolute) — or only `relativePath`
plus a resolver; (b) `bb_search` handler drops its remap and keeps emitting the new identity;
(c) edit-engine migrates `m.fileId` reads to the new `path` field; (d) any annotation/LSP surface that
consumes `findSymbol` rows is audited the same way. Engine + edit-safety ownership overlap, hence a
next-round item, not a wave-1 drive-by.

## Gate that would catch a regression

Extend `script/verify-retrieval-contract.ts` with a direct `ASTEngine.findSymbol` assertion once the
engine changes: for a fixture file, every returned row must satisfy
`fileId === ${projectId}:${relativePath}` and `absolutePath`/`path` must be the on-disk path; and any
direct consumer of the engine rows (edit-engine rename plan) must still read source successfully.
