// #861 family check: does the JAVASCRIPT analyzer emit decorator-position calls
// and references from the enclosing scope the way typescript did before this
// round? If it does, the family rule ("a decorator is metadata on the symbol it
// decorates") is only half-applied across the web family.
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"

const SRC = [
  "function sealed(target) { return target }", // 1
  "function inject(name) { return () => undefined }", // 2
  "", // 3
  "@sealed", // 4
  "class Service {", // 5
  '  @inject("db")', // 6
  "  pool = 1", // 7
  "", // 8
  "  @sealed", // 9
  "  method() {}", // 10
  "}", // 11
].join("\n") + "\n"

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "js861-"))
  const file = path.join(dir, "S.js")
  writeFileSync(file, SRC)
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)
  const tree = parser.parse(SRC)
  console.log("=== JS decorator nodes present? ===")
  let decorators = 0
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "decorator") decorators++
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
  console.log(`   decorator nodes in tree: ${decorators}`)
  console.log("=== JS tree shape (which node OWNS the decorator?) ===")
  const shape = (n: any, d = 0): void => {
    if (["decorator", "class_declaration", "field_definition", "public_field_definition", "program", "class_body", "method_definition"].includes(n.type)) {
      const kids: string[] = []
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) kids.push(`${c.type}@${c.startPosition.row + 1}`)
      }
      console.log(`${"  ".repeat(d)}${n.type} startsL${n.startPosition.row + 1} children=[${kids.join(", ")}]`)
    }
    for (let i = 0; i < n.namedChildCount; i++) shape(n.namedChild(i), d + 1)
  }
  shape(tree.rootNode)

  const mod: any = await import(path.join(ROOT, "src/ast/real-javascript-analyzer.ts"))
  const analyzer = new mod.RealJavaScriptAnalyzer()
  const res = await analyzer.analyze(tree.rootNode, SRC, "S.js")
  console.log("=== JS symbols ===")
  for (const s of res.symbols ?? []) console.log(`   L${s.range?.startLine} ${String(s.kind).padEnd(9)} ${s.name} decorators=${JSON.stringify(s.decorators ?? [])}`)
  console.log("=== JS relationships ===")
  for (const r of res.relationships ?? []) console.log(`   L${r.line_number} ${String(r.type).padEnd(11)} ${r.source} -> ${r.target} meta=${JSON.stringify(r.metadata ?? {})}`)
}
main()
