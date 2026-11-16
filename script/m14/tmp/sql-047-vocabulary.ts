// PROBE — cited by reviews/m60-sql-grammar-l1xnan-047-refused.md §6.
//
// Read-only: loads two grammar wasms and reports their node-type vocabularies.
// No file in the tree is touched and nothing is written. Run:
//   bun script/m14/tmp/sql-047-vocabulary.ts
//
// Kills the "vocabulary migration" hypothesis for the @l1xnan 0.4.7 candidate: a
// 1-removed / 2-added delta means F1 shape-safety PASSES on the candidate, so the
// 100 vanished symbols cannot be explained by renamed node types. Node NAMES are
// stable; node CONTENT is not.

import { readFileSync } from "node:fs"
const W = await import("<corpus-root>/mcp/backbencher-brain/node_modules/web-tree-sitter/tree-sitter.cjs")
const wts = W.default ?? W
const init = wts.Parser.init ?? wts.init
await init.call(wts.Parser, { locateFile: () => "<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter.wasm" })
const P = await wts.Language.load(readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-sql.wasm"))
const C = await wts.Language.load(readFileSync("/tmp/opencode/grammars/sql-l1xnan-047.wasm"))
const names = (l) => { const s = new Set(); for (let i = 0; i < l.nodeTypeCount; i++) s.add(l.nodeTypeForId(i)); return s }
const p = names(P), c = names(C)
const removed = [...p].filter((x) => !c.has(x))
const added = [...c].filter((x) => !p.has(x))
console.log(`pinned distinct node types: ${p.size}   candidate: ${c.size}`)
console.log(`\nREMOVED by the candidate (${removed.length}) — every one is a literal the analyzer may dispatch on:`)
console.log("  " + removed.sort().join("\n  "))
console.log(`\nADDED by the candidate (${added.length}):`)
console.log("  " + added.sort().join("\n  "))
