// M13 handoff, MEASURED (M14 #286 yaml lane, 2026-09-27).
//
// The companion to yaml-m13-codemask-probe.ts, and the half that found a real defect. The
// mask is correct on yaml, but the RENAME path is not: this probe prints the node-type chain
// of a yaml mapping key and asks `isIdentifierNodeType` about each level.
//
//   block_mapping_pair > flow_node > plain_scalar > string_scalar   <- the key
//
// `isIdentifierNodeType` accepts `identifier`, `*identifier`, or one of seven hand-listed
// per-language types (PHP/Bash/PowerShell/Haskell/Ruby). None of the three key levels
// qualifies, so `extractIdentifierOccurrences` returns 0 for a yaml file — including for the
// LIVE keys. Traced through src/intelligence/edit/edit-engine.ts, a `bb_edit refactor` of a
// yaml symbol therefore reaches `if (sites.size === 0) continue` and returns
// `{ changes: [], warnings: ["... 0 site(s) across 0 file(s)"] }` with no error thrown.
//
// The fix is expressible with data the occurrence ALREADY carries: key position is
// `IdentifierOccurrence.parentField === "key"`, and the yaml grammar's entire field surface
// is 2 fields (key, value). Matching on parentField rather than node type also leaves the
// value-position case alone, which must not be renamed.
//
// Run: bun run script/m60/yaml-m13-occurrence-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const grammar = await L.load(fs.readFileSync(`${ROOT}/wasm/tree-sitter-yaml.wasm`))
const parser = new P(); parser.setLanguage(grammar)
const src = "replicas: 3\nnested:\n  replicas: 4\n- replicas\n"
const tree = parser.parse(src)
const { isIdentifierNodeType } = await import(`${ROOT}/src/ast/safety-primitives.ts`)
const walk = (n: any, depth = 0): void => {
  const label = isIdentifierNodeType(n.type) ? "  <-- recognised as a reference site" : ""
  console.log(`${"  ".repeat(depth)}${n.type}${n.isNamed ? "" : " (anon)"}${n.startIndex === n.endIndex ? "" : ` ${JSON.stringify(src.slice(n.startIndex, n.endIndex))}`}${label}`)
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walk(c, depth + 1) }
}
walk(tree.rootNode)
