// W23 (#841 G9): adjudicate a per-file RELATIONSHIP loss between two groovy
// grammar builds by printing the exact edge sets, so a loss is named instead of
// counted. Usage:
//   bun script/m14/tmp/w23-rel-loss-probe.ts <repo-relative-file> <wasmA> <wasmB>
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPO = "<corpus-root>/bb_tests/repositories/grails-core"

async function main(): Promise<void> {
  const rel = process.argv[2]
  const wasmA = process.argv[3]
  const wasmB = process.argv[4]
  const src = fs.readFileSync(rel.startsWith("/") ? rel : path.join(REPO, rel), "utf8")
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const mod: any = await import(path.join(ROOT, "src/ast/real-groovy-analyzer.ts"))
  const key = (r: any): string =>
    `${String(r.type ?? r.relationshipType)} | ${r.source} -> ${r.target ?? r.targetName} | L${r.line_number ?? r.line ?? "-"}`
  const results: Record<string, Map<string, any>> = {}
  for (const [name, wasm] of [["A", wasmA], ["B", wasmB]] as Array<[string, string]>) {
    const lang = await L.load(fs.readFileSync(wasm))
    const parser = new P()
    parser.setLanguage(lang)
    const tree = parser.parse(src)
    const analyzer = new mod.RealGroovyAnalyzer()
    const res: any = await analyzer.analyze(tree.rootNode, src, rel)
    const m = new Map<string, any>()
    for (const r of res.relationships ?? []) m.set(key(r), r)
    results[name] = m
    console.log(
      `${name} (${path.basename(wasm)}): hasError=${tree.rootNode.hasError} symbols=${res.symbols?.length ?? 0} relationships=${m.size}`,
    )
  }
  const A = results.A
  const B = results.B
  const onlyA = [...A.keys()].filter((k) => !B.has(k))
  const onlyB = [...B.keys()].filter((k) => !A.has(k))
  console.log(`\nedges only in A (lost by B): ${onlyA.length}`)
  for (const k of onlyA.sort()) console.log("   A-ONLY", k)
  console.log(`edges only in B (new in B): ${onlyB.length}`)
  for (const k of onlyB.sort().slice(0, 40)) console.log("   B-ONLY", k)
}
main()
