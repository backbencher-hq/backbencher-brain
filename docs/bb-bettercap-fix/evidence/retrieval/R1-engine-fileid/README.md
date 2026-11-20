# R1 — engine-level `fileId` identity (FIXED)

Closes `docs/bb-bettercap-fix/findings/RETRIEVAL-R1-engine-fileid.md`.

Change: `ASTEngine.findSymbol` now returns the portable identity
`fileId = <projectId>:<relativePath>` and keeps the filesystem path in a new
`absolutePath` field; `edit-engine`'s internal `SymbolMatch` uses `absolutePath`
for read/edit/stale operations; `bb_search` symbol mode reads the pre-image via
`absolutePath` and publishes the project-scoped id on the wire. Gate
`script/verify-retrieval-contract.ts` gained three engine-level assertions
(fileId identity, absolutePath on disk, relativePath preserved) → 48/48.

Verified in the wave-2 worktree with the final build (dist sha recorded in
build.txt): retrieval contract 48/48; edit family green (rename E2 92/92,
crossfile E4/E5/E8, freshness E5 14/14, honesty E11 10/10, batch E13 61/61);
m71 23/23; search-modes S1 48/48; `npx tsc --noEmit` clean except the external
`real-csharp-analyzer.ts` error; build exit 0; `verify:dist` clean.
CLI/dist E2E on bettercap: `bb_doc Session` → single subject (`struct`,
declaration-kind, passed at default and limit:1); `bb_search mode=symbol
Session` → 5 matches, every `fileId` is `<projectId>:<path>` with `absolutePath`
and a bounded `source` (JSON capture in `../DIST-E2E-bb_search-Session.json`).
Old-index read doors (gh-cli 2026-10-17 index) now refuse with the typed
`BB_SCHEMA_INCOMPATIBLE` + remedy instead of raw SQLite
(`../../verifier/p2/DIST-E2E-old-index-refusal-*.txt`).
