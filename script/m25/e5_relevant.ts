// script/m25/e5_relevant.ts — the files E5's evidence actually depends on.
// Author: Muhammad Ishaq Khan
//
// WHY THIS IS A MODULE AND NOT A LIST INSIDE A GATE:
//
// Two gates ask a question about E5's evidence. `script/m25/verify-governance.ts`
// asks "is this record still fresh by relevance?" when it projects M25's ledger;
// `script/m44/verify-closure.ts` asks "is the in-editor leg still standing at
// THIS HEAD?" while auditing the M44 completion bar. They were answering with two
// different rules — the governance gate used the relevance rule, the closure used
// exact commit equality — so a record that was plainly still valid could be
// certified by one and refused by the other in the same run.
//
// A single owner for the list removes the drift and lets both readers apply the
// same rule: a record pinned at an ancestor commit stays valid while nothing in
// this set changed since. The list is the harness, the editor sources it drives
// and the server it talks to — nothing else can change E5's result.

/** Files whose content can change what E5 measures. */
export const E5_RELEVANT_FILES = [
  "script/m25/run-vscode-e2e.mts",
  "script/m25/e5-inner.js",
  "script/m25/feature-assertions.ts",
  "ide/vscode/src/extension.ts",
  "ide/vscode/esbuild-extension.mjs",
  "src/lsp/server.ts",
  "src/lsp/freshness.ts",
  "src/ast/parallel-indexer.ts",
] as const
