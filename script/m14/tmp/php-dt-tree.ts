// script/m14/tmp/php-dt-tree.ts — the tree shapes at every declared-type position of
// validation/m14/fixtures/php/declared-type-graph.php. The php rule is written from this
// dump, not from the grammar's documentation (the same discipline as the csharp round).
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const FILE = path.join(ROOT, "validation/m14/fixtures/php/declared-type-graph.php")

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm")))
const p = new P()
p.setLanguage(LANG)
const root = p.parse(readFileSync(FILE, "utf8")).rootNode

const WANT = new Set([
  "property_declaration", "method_declaration", "formal_parameter", "simple_parameter",
  "property_promotion_parameter", "const_declaration", "variadic_parameter",
])

function shape(n: any): string {
  const kids = []
  for (let i = 0; i < n.namedChildCount; i++) kids.push(shape(n.namedChild(i)))
  return kids.length ? `${n.type}(${kids.join(",")})` : `${n.type}${n.childCount === 0 ? `=${JSON.stringify(n.text)}` : ""}`
}

const seen = new Set<string>()
const stack = [root]
while (stack.length) {
  const n = stack.pop()!
  if (WANT.has(n.type)) {
    const t = n.childForFieldName?.("type")
    const rt = n.childForFieldName?.("return_type")
    const nm = n.childForFieldName?.("name")
    const line = n.startPosition.row + 1
    const key = `${n.type}|${n.text.replace(/\s+/g, " ").slice(0, 50)}`
    if (!seen.has(key)) {
      seen.add(key)
      console.log(
        `L${String(line).padStart(3)} ${n.type.padEnd(30)} name=${JSON.stringify(nm?.text ?? null).padEnd(12)} ` +
          `typeField=${JSON.stringify(t?.text ?? null).padEnd(20)} returnTypeField=${JSON.stringify(rt?.text ?? null)}`,
      )
      console.log(`      ${shape(n).slice(0, 240)}`)
    }
  }
  for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
}
