# [retrieval] R1 — engine-level `findSymbol` `fileId` is still an absolute path (next round)

Lane: retrieval. Status: **FIXED** (commit `ee45e176d`, verified; see "Resolution" below).
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


## Resolution (2026-11-20, commit `ee45e176d`)

`ASTEngine.findSymbol` now returns `fileId = <projectId>:<relativePath>` (the portable identity the
other read surfaces use) and carries the filesystem path in a new `absolutePath` field; the internal
`SymbolRow` type documents both. `edit-engine`'s `matchesOf()` maps `absolutePath` into the internal
`SymbolMatch.fileId` that its read/edit/stale helpers actually path with (`?? fileId` fallback keeps an
older/foreign producer readable). `bb_search` symbol mode resolves the scope filter, freshness and the
bounded source via `absolutePath` and publishes the project-scoped id on the wire.

Verification: `script/verify-retrieval-contract.ts` gained three engine-level assertions (identity,
`absolutePath` exists on disk, `relativePath` preserved) → **48/48**; edit family green (rename E2
92/92, crossfile E4/E5/E8, freshness E5 14/14, honesty E11 10/10, batch E13 61/61); m71 23/23;
search-modes S1 48/48; `npx tsc --noEmit` clean except the external `real-csharp-analyzer.ts` error;
build + `verify:dist` clean. CLI/dist E2E: `bb_doc Session` single subject; `bb_search symbol Session`
publishes `<projectId>:<path>` + `absolutePath` + bounded source. Evidence:
`docs/bb-bettercap-fix/evidence/retrieval/R1-engine-fileid/` and
`.../evidence/retrieval/DIST-E2E-*.json`.
