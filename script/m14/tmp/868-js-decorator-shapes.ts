// #868 shape checks before authoring any fixture: where does the JS grammar
// attach a decorator when the class is EXPORTED, and do accessors/args behave?
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const SHAPES: Array<{ label: string; src: string }> = [
  {
    label: "A: decorator BEFORE export",
    src: ["function sealed(t) { return t }", "@sealed", "export class A {}", ""].join("\n"),
  },
  {
    label: "B: decorator on default-exported class",
    src: ["function sealed(t) { return t }", "@sealed", "export default class B {}", ""].join("\n"),
  },
  {
    label: "C: decorator on a getter + decorator with an identifier argument",
    src: [
      "function sealed(t) { return t }",
      "function inject(n) { return () => undefined }",
      "const DB = 'db'",
      "class C {",
      "  @inject(DB)",
      "  get value() { return 1 }",
      "}",
      "",
    ].join("\n"),
  },
  {
    label: "D: a field initializer call is NOT decorator position",
    src: [
      "function make() { return 1 }",
      "function inject(n) { return () => undefined }",
      "class D {",
      '  @inject("x")',
      "  pool = make()",
      "}",
      "",
    ].join("\n"),
  },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const fs = await import("node:fs")
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-javascript-analyzer.ts"))

  for (const { label, src } of SHAPES) {
    const parser = new P()
    parser.setLanguage(grammar)
    const tree = parser.parse(src)
    console.log(`===== ${label} =====`)
    console.log("--- tree (decorator owners) ---")
    const walk = (n: any, d = 0): void => {
      if (["decorator", "class_declaration", "export_statement", "field_definition", "program", "class_body", "method_definition"].includes(n.type)) {
        const kids: string[] = []
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c) kids.push(`${c.type}@${c.startPosition.row + 1}`)
        }
        console.log(`${"  ".repeat(d)}${n.type} children=[${kids.join(", ")}]`)
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), d + 1)
    }
    walk(tree.rootNode)
    const analyzer = new mod.RealJavaScriptAnalyzer()
    const res = await analyzer.analyze(tree.rootNode, src, "S.js")
    console.log("--- symbols ---")
    for (const s of res.symbols ?? []) console.log(`   L${s.range?.startLine} ${String(s.kind).padEnd(9)} ${s.name} decorators=${JSON.stringify(s.decorators ?? [])} lines=${JSON.stringify(s.metadata?.decoratorLines ?? null)}`)
    console.log("--- relationships ---")
    for (const r of res.relationships ?? []) console.log(`   L${r.line_number} ${String(r.type).padEnd(11)} ${r.source} -> ${r.target} meta=${JSON.stringify(r.metadata ?? {})}`)
    console.log("")
  }
}
main()
