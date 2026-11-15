// M14 IMPORTS_ENUM gap 2 — a re-export recorded a module dependency in
// `imports` and published NO relationship.
//
// `export { a } from "./m"` and `export * from "./m"` both push an ImportInfo,
// which reaches the `brain_import` TABLE (parallel-indexer.ts:2168, insertImport).
// Neither reached `brain_relationship`, which is written by a SEPARATE statement
// (:2174) over a different shape, and no consumer reconciles the two stores. So a
// barrel file — the single most depended-on file in a TypeScript project —
// appeared to depend on nothing, in the graph that bb_graph, bb_impact and
// bb_migrate actually read.
//
// Measured with script/m14/ts-construct-probe.ts over tracked .ts files of
// bb_tests/repositories/typescript, production path, first 40 files: `export …
// from` occurs in 14 of them (86 named re-exports, 13 star re-exports, 1
// export-assignment) and ZERO published an `imports` edge. `export * from` also
// published no `exports` edge, so a pure barrel contributed no relationship at
// all.
//
// WHY THE STAR FORM STILL GETS NO `exports` EDGE, stated rather than assumed:
// `export * from "./m"` re-exports a set this file cannot name, and an `exports`
// edge needs a NAME. `*` is not one — it is the same unresolvable-endpoint class
// as an anonymous `new` constructor (X8) and a placeholder literal (R7). The
// star form publishes the dependency half and refuses the export half. The
// forbid below pins that refusal so a later "fix" cannot quietly ship
// `exports: barrel -> "*"`.
//
// Authored BEFORE the analyzer run.

export { alpha } from "./vendor/alpha"
export { beta as renamedBeta } from "./vendor/beta"
export * from "./vendor/gamma"
export * as gammaNs from "./vendor/gamma-ns"
export { delta } from "./vendor/delta"
export type { Epsilon } from "./vendor/epsilon"

// The control: an ordinary static import of the same module shape, which already
// published an edge. Pinned so the re-export fix cannot be mistaken for the
// import path having changed.
import { zeta } from "./vendor/zeta"

// An EMPTY re-export clause names a module but exports nothing. `export {} from`
// is not a dependency-for-side-effects the way `import "./x"` is — it asserts
// nothing about the module's evaluation — so it publishes no dependency edge.
export {} from "./vendor/empty"