// Why does the JS lane report MISSING `uses` edges on
// grails-data-docs/.../navigation.js? Dump analyzer vs truth for the exact file.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
import { deriveTreeEdges, deriveJavaScriptEdges } from "../differential"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const REPO = "/home/ishaq2321/bb_tests/repositories"
let P: any, LANG: any

async function parsers() {
  const wts: any = await import("web-tree-sitter")
  P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  LANG = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
}

async function run(rel: string) {
  const abs = path.join(REPO, rel)
  const src = fs.readFileSync(abs, "utf8")
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  const a = new RealJavaScriptAnalyzer() as any
  const r = await a.analyze(root, src, path.basename(abs), {})
  const aUses = (r.relationships ?? []).filter((x: any) => x.type === "uses")
  const truth = [
    ...deriveTreeEdges(root, "javascript").filter((e: any) => e.label === "uses"),
    ...deriveJavaScriptEdges(root).filter((e: any) => e.label === "uses"),
  ]
  console.log(`\n===== ${rel} (hasError=${root.hasError}) =====`)
  console.log("analyzer uses:", aUses.map((u: any) => `${u.source}->${u.target}${u.metadata?.bareRead ? "(bare)" : ""}${u.metadata?.chainRoot ? "(root)" : ""}${u.metadata?.isFieldAccess && !u.metadata?.bareRead ? "(field)" : ""}`).join(", ") || "(none)")
  console.log("truth uses   :", truth.map((e: any) => e.target).join(", ") || "(none)")
  const truthTargets = new Set(truth.map((e: any) => e.target))
  const analyzerTargets = new Set(aUses.map((u: any) => u.target))
  const missing = [...truthTargets].filter((t) => !analyzerTargets.has(t as string))
  console.log("MISSING      :", missing.join(", ") || "(none)")
}

async function main() {
  await parsers()
  await run("grails-core/grails-data-docs/data-mapping-website/src/main/resources/javascripts/navigation.js")
  await run("grails-core/grails-forge/grails-forge-core/src/main/resources/assets/javascripts/welcome.js")
}

main()
