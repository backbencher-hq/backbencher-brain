// scala-oracle-crash.ts — why does `deriveTreeEdges(root, "scala")` throw
//   TypeError: undefined is not an object (evaluating 'decls[nm].methods.add')
// on tests/neg-macros/i18825/Macro_1.scala, and on nothing else in 18,446 files?
//
// The throw is measured and file-local: `script/m14/tmp/scala-instance-lifetime.ts one`
// reads the whole corpus with one healthy module (18,446/18,446, 57,925 truth edges, no
// parser failure at all) and reports exactly ONE oracle throw, at #16,148. `file` mode
// reproduces it on one parse of one file. The harness calls `deriveTreeEdges` OUTSIDE any
// try, so in a lane whose parser survives long enough this is a fatal, and it is masked
// today only because the module dies earlier (see the sweep/rotate numbers).
//
// This probe prints the shape the oracle's `collectDecl` sees in that file: the
// declaration nodes, the name each one resolves to, and the body node it walks — i.e.
// the smallest thing that makes the defect falsifiable instead of guessed at.
//
// Run: bun script/m14/tmp/scala-oracle-crash.ts [file] [harnessRoot]
import fs from "node:fs"
import path from "node:path"

const FILE = process.argv[2] ?? "/home/ishaq2321/bb_tests/repositories/scala3/tests/neg-macros/i18825/Macro_1.scala"
const ROOT = process.argv[3] ?? "/home/ishaq2321/bb_tests/replicas/m60-93cf6ed6"

const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))
const ws: any = await import("web-tree-sitter")
const P: any = ws.Parser ?? ws.default ?? ws
const L: any = ws.Language ?? ws.default?.Language
await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-scala.wasm")))
const parser = new P()
parser.setLanguage(grammar)

const src = fs.readFileSync(FILE, "utf8")
const root = parser.parse(src).rootNode
console.log(`file: ${FILE}`)
console.log(`parse: root=${root.type} childCount=${root.childCount} hasError=${root.hasError}`)

// The oracle's own declaration test and name rule, transcribed for comparison.
const DECL = /^(class|interface|record|trait|object)_declaration$|^class_definition$|^trait_definition$|^object_definition$|^(class|struct|union)_specifier$/
const lastSegment = (s: string) => s.split(/[:.]/).filter(Boolean).slice(-1)[0] ?? s
let decls = 0
const walk = (n: any, depth: number): void => {
  const pad = "  ".repeat(depth)
  if (n.type === "class_definition" || n.type === "trait_definition" || n.type === "object_definition") {
    const byField = n.childForFieldName?.("name")
    const fallback = n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "type_identifier")
    let nm: string | undefined = (byField ?? fallback)?.text
    if (nm) { const lt = nm.indexOf("<"); if (lt !== -1) nm = nm.slice(0, lt).trim(); nm = lastSegment(nm) }
    const bodies = n.namedChildren.filter((c: any) => /body|field_declaration_list/.test(c.type)).map((c: any) => `${c.type}(children=${c.namedChildCount})`)
    console.log(`${pad}DECL ${n.type}`)
    console.log(`${pad}  name field: ${byField ? `${byField.type} "${byField.text}"` : "ABSENT"}`)
    console.log(`${pad}  fallback  : ${fallback ? `${fallback.type} "${fallback.text}"` : "ABSENT"}`)
    console.log(`${pad}  nm        : ${nm === undefined ? "UNDEFINED (decls[nm] would be decls[undefined])" : `"${nm}"`}`)
    console.log(`${pad}  bodies    : ${bodies.length ? bodies.join(", ") : "NONE (member walk would be skipped)"}`)
    console.log(`${pad}  children  : ${n.namedChildren.map((c: any) => c.type).join(", ")}`)
    decls++
  }
  for (const c of n.namedChildren) walk(c, depth + 1)
}
walk(root, 0)
console.log(`declaration nodes seen: ${decls}`)

// The live oracle, in isolation — the call the harness makes outside any try.
try {
  const edges = diff.deriveTreeEdges(root, "scala")
  console.log(`oracle: OK, ${edges.length} edge(s)`)
} catch (e: any) {
  console.log(`oracle: THREW ${String(e?.message ?? e).slice(0, 120)}`)
  console.log(`  (the harness calls this outside any try, so this is a fatal for the lane)`)
}
try { parser.delete?.() } catch { /* best effort */ }
