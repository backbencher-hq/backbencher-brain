// Probe: does the PINNED csharp wasm grammar declare the two node types the
// F1 audit convicts (`record_struct_declaration`, `constraint_clause`)?
// The audit's oracle is the wasm itself (nodeTypeCount/nodeTypeForId), so this
// prints every node type containing "record" or "constraint" — the check is
// whether the conviction is a dead branch or an enumeration artifact.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await Language.load(
  fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")),
)
const names: string[] = []
for (let i = 0; i < grammar.nodeTypeCount; i++) names.push(grammar.nodeTypeForId(i))
const hits = names.filter((n) => /record|constraint/i.test(n))
console.log("nodeTypeCount:", grammar.nodeTypeCount)
console.log("record/constraint node types:", JSON.stringify(hits, null, 1))
for (const want of ["record_struct_declaration", "constraint_clause", "record_declaration", "type_parameter_constraints_clause"]) {
  console.log(want.padEnd(36), names.includes(want) ? "PRESENT" : "ABSENT")
}
