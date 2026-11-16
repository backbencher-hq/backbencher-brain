// Parse real corpus files that fail, dump every ERROR/MISSING node with row+text
// Usage: bun script/m14/tmp/g841-file-probe.ts <file1> <file2> ...
import * as fs from "fs"

const R = "<corpus-root>/bb_tests/repositories/grails-core/"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)

  const args = process.argv.slice(2)
  const files = args.length ? args : [
    "build-logic/docs-core/src/main/groovy/org/apache/grails/gradle/tasks/bom/ExtractDependenciesTask.groovy",
    "build-logic/docs-core/src/main/groovy/grails/doc/asciidoc/AsciiDocEngine.groovy",
    "build-logic/docs-core/src/main/groovy/grails/doc/DocEngine.groovy",
  ]
  for (const f of files) {
    const p = f.startsWith("/") ? f : R + f
    const src = fs.readFileSync(p, "utf8")
    const tree = parser.parse(src)
    const lines = src.split("\n")
    console.log(`\n=== ${f.split("/").pop()} err=${(tree.rootNode as any).hasError} lines=${lines.length}`)
    if (!(tree.rootNode as any).hasError) { console.log("  (clean at full file — census mismatch?)"); continue }
    const nodes: any[] = []
    const walk = (n: any) => {
      if (n.type === "ERROR" || n.isMissing) nodes.push(n)
      for (const ch of (n.namedChildren ?? [])) walk(ch)
      if (n.childCount > (n.namedChildCount ?? 0)) {
        for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && (c.type === "ERROR" || c.isMissing)) walk(c) }
      }
    }
    walk(tree.rootNode)
    console.log(`  error/missing nodes (first 6 of ${nodes.length}):`)
    for (const n of nodes.slice(0, 6)) {
      const r0 = n.startPosition.row + 1, c0 = n.startPosition.column
      const txt = (n.text || "").split("\n").slice(0, 2).join(" ⏎ ").slice(0, 100)
      console.log(`   ${n.type}${n.isMissing ? "(MISSING)" : ""} @L${r0}:${c0} :: ${JSON.stringify(txt)}`)
    }
  }
}
main()
