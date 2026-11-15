import * as fs from "fs"
import * as path from "path"
import { RealObjectiveCAnalyzer } from "../../../src/ast/real-objective-c-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  const only = process.argv[2]
  const dir = "/tmp/oc-batt2"
  for (const f of fs.readdirSync(dir).sort()) {
    const name = f.replace(/\.m$/, "")
    if (only && name !== only) continue
    const src = fs.readFileSync(path.join(dir, f), "utf8")
    const root = await parseSrc(src)
    const r: any = await new RealObjectiveCAnalyzer().analyze(root, src, f)
    const syms = (r.symbols ?? []).map((s: any) => `${s.kind}:${s.ownerName ? s.ownerName + "." : ""}${s.name}`)
    const rels = (r.relationships ?? []).filter((x: any) => !["contains"].includes(String(x.type).toLowerCase())).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)
    const ora = mod.deriveObjcEdges(root).map((x: any) => `${x.label}[${x.from}->${x.target}]`)
    console.log("=== " + name + " err=" + root.hasError)
    console.log("  syms:", JSON.stringify(syms))
    console.log("  rels:", JSON.stringify(rels))
    console.log("  ora: ", JSON.stringify(ora))
  }
}
main()
