// The command-expression ambiguity, in the exact context that produced it: a
// method body whose LAST statement is `println <local>`. Records the tree shape
// and the analyzer's edges, so the residual is measured rather than inferred.
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
const amod: any = await import(path.join(ROOT, "src/ast/real-groovy-analyzer"))
const parser = new P(); parser.setLanguage(lang)
const CASES: Array<[string, string]> = [
  ["last statement, class method", "class C {\n    void run() {\n        println filtered\n    }\n}\n"],
  ["last statement, followed by another", "class C {\n    void run() {\n        println filtered\n        println 'x'\n    }\n}\n"],
  ["script scope", "println filtered\n"],
]
for (const [name, src] of CASES) {
  const t: any = parser.parse(src)
  const rows: string[] = []
  const walk = (n: any, d: number): void => { if (d > 7) return; rows.push(`${" ".repeat(d)}${n.type}`); for (let i=0;i<n.namedChildCount;i++) walk(n.namedChild(i), d+1) }
  walk(t.rootNode, 0)
  const res: any = await new amod.RealGroovyAnalyzer().analyze(t.rootNode, src, "probe.groovy")
  const decl = (res.relationships ?? []).filter((r: any) => String(r.metadata?.relationshipType) === "declared_type")
  console.log(`\n=== ${name}  err=${t.rootNode.hasError}`)
  console.log(rows.join("\n"))
  console.log(`  analyzer declared_type edges: ${decl.length ? decl.map((r: any) => `${r.source} -> ${r.target} @${r.line_number} (${r.metadata?.declaredOn})`).join(", ") : "none"}`)
}
process.exit(0)
