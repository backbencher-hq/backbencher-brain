// Why does the analyzer emit ZERO uses for navigation.js?
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPO = "<corpus-root>/bb_tests/repositories"
let P: any, LANG: any

async function parsers() {
  const wts: any = await import("web-tree-sitter")
  P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  LANG = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
}

async function probe(tag: string, src: string) {
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  const a = new RealJavaScriptAnalyzer() as any
  const r = await a.analyze(root, src, "probe.js", {})
  const rels = r.relationships ?? []
  const byType: Record<string, number> = {}
  for (const x of rels) byType[x.type] = (byType[x.type] ?? 0) + 1
  console.log(`\n${tag}: hasError=${root.hasError} symbols=${r.symbols?.length ?? 0} rels=${rels.length} ${JSON.stringify(byType)}`)
  console.log("   ", rels.map((x: any) => `${x.type}[${x.source}->${x.target}]`).join(", ") || "(none)")
}

async function main() {
  await parsers()
  const exact = fs.readFileSync(path.join(REPO, "grails-core/grails-data-docs/data-mapping-website/src/main/resources/javascripts/navigation.js"), "utf8")
  await probe("1. exact navigation.js", exact)
  await probe("2. minimal call-arg", `function f(a) { g(a) }`)
  await probe("3. chain-assign in fn", `function f(a) { x.y.z = 1 }`)
  await probe("4. getElementById shape", `function f(a) { document.getElementById(a).style.display = "block" }`)
  await probe("5. both statements", `function show(s, h) {\n  document.getElementById(s).style.display = "block"\n  document.getElementById(h).style.display = "none"\n}`)
  await probe("6. same w/ trailing newline", `function show(s, h) {\n  document.getElementById(s).style.display = "block"\n}\n`)
  await probe("7. no assignment, just call", `function f(a) { document.getElementById(a) }`)
}

main()
