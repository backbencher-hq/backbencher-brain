// GRAMMAR NODE-TYPE INVENTORY for the pinned tree-sitter-sql wasm.
//
// WHY THIS FILE IS COMMITTED. Rule-book §6: a `grammar-absence` claim needs "a node-type/keyword
// inventory — the language cannot express it", and §5r: a probe that cannot read what it is
// checking reports a defect in the code. So the inventory is enumerated from the WASM ITSELF
// through the engine's own loader and web-tree-sitter's Language API (nodeTypeCount /
// nodeTypeForId) — no hand-maintained node-type list anywhere — and it prints CONTROLS that must
// be non-empty, so a zero (`inherit` 0, `implement` 0, `export` 0) is distinguishable from a
// probe that opened nothing. The same shape as `script/m14/audit-analyzer-grammar.ts`, scoped to
// one lane and one question.
//
// USAGE  npx tsx validation/m14/fixtures/sql/grammar-node-inventory.mts
// RESULT recorded in validation/m14/fixtures/sql/whole-corpus-typing.txt §E (2026-10-11):
//        820 node types · inherit 0 · implement 0 · export 0 · interface 0 · super 0
//        controls: create 31 · table 26
import { loadWebTreeSitter } from "../../../../src/util/wasm.ts"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const wasm = path.join(ROOT, "wasm", "tree-sitter-sql.wasm")
const W: any = await loadWebTreeSitter()
const Language = W.Language ?? W.default?.Language
const initFn = W.init ?? W.Parser?.init ?? W.default?.init
if (initFn) await initFn()
const lang: any = await Language.load(readFileSync(wasm))
const n = lang.nodeTypeCount
const names: string[] = []
for (let i = 1; i <= n; i++) { const t = lang.nodeTypeForId(i); if (typeof t === "string" && t !== "") names.push(t) }
const uniq = [...new Set(names)].sort()
console.log(`pinned grammar: wasm/tree-sitter-sql.wasm`)
console.log(`node types enumerated from the wasm: ${uniq.length}`)
const probe = (label: string, test: (s: string) => boolean) => {
  const hit = uniq.filter(test)
  console.log(`${label}: ${hit.length}${hit.length ? " -> " + hit.join(" ") : " (NONE)"}`)
}
for (const [label, sub] of [["inherit","inherit"],["implement","implement"],["export","export"],["interface","interface"],["super","super"],["grant","grant"],["extension","extension"],["cast","cast"],["psql","psql"],["replace","replace"],["trigger","trigger"]] as const)
  probe(`names containing '${label}'`, (s) => s.includes(sub))
console.log(`\nCONTROL — positions that must be non-empty for the enumeration to be readable at all:`)
probe("names containing 'create'", (s) => s.includes("create"))
probe("names containing 'table'", (s) => s.includes("table"))
