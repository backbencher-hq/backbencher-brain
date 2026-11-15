// script/m14/tmp/cs-dt-tree.ts — the tree shapes at every declared-type position of
// validation/m14/fixtures/csharp/declared-type-graph.cs. The rule is written from this
// dump, not from the grammar's documentation.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const FILE = path.join(ROOT, "validation/m14/fixtures/csharp/declared-type-graph.cs")

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c_sharp.wasm")))
const p = new P()
p.setLanguage(LANG)
const root = p.parse(readFileSync(FILE, "utf8")).rootNode

/** Position roots we care about: the container that carries a declared type. */
const WANT = new Set([
  "field_declaration", "property_declaration", "indexer_declaration", "event_declaration",
  "event_field_declaration", "delegate_declaration", "method_declaration",
  "parameter", "local_declaration_statement", "variable_declaration",
])

function shape(n: any): string {
  const kids = []
  for (let i = 0; i < n.namedChildCount; i++) kids.push(shape(n.namedChild(i)))
  const field = n.parent?.childForFieldName ? "" : ""
  return kids.length ? `${n.type}(${kids.join(",")})` : `${n.type}${n.childCount === 0 ? `=${JSON.stringify(n.text)}` : ""}`
}

const seen = new Set<string>()
const stack = [root]
while (stack.length) {
  const n = stack.pop()!
  if (WANT.has(n.type)) {
    const t = n.childForFieldName?.("type")
    const nm = n.childForFieldName?.("name")
    const vd = (n.namedChildren ?? []).find((c: any) => c.type === "variable_declaration")
    const line = n.startPosition.row + 1
    const key = `${n.type}|${n.text.replace(/\s+/g, " ").slice(0, 60)}`
    if (!seen.has(key)) {
      seen.add(key)
      console.log(
        `L${String(line).padStart(3)} ${n.type.padEnd(26)} name=${JSON.stringify(nm?.text ?? null).padEnd(10)} ` +
          `typeField=${JSON.stringify(t?.text ?? null).padEnd(34)} vd=${vd ? JSON.stringify(vd.text.slice(0, 30)) : "-"}`,
      )
      console.log(`      ${n.type} => ${shape(n).slice(0, 220)}`)
    }
  }
  for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  if (n.type === "parameter" || n.type === "method_declaration") { /* children already pushed */ }
}
