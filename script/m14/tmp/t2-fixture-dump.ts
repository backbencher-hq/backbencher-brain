import * as fs from "fs"
import * as path from "path"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
  const p = new P(); p.setLanguage(lang)
  const f = "validation/m14/fixtures/typescript/dts-interface-property-overrides.ts"
  const src = fs.readFileSync(f, "utf8")
  const a = new RealTypeScriptAnalyzer() as any
  const r = await a.analyze(p.parse(src).rootNode, src, "dts-interface-property-overrides.ts", {})
  for (const s of (r.symbols ?? [])) console.log(`SYM ${s.kind} ${s.ownerName ?? "-"}.${s.name} ${JSON.stringify(s.metadata ?? {})}`)
  for (const rel of (r.relationships ?? [])) if (rel.type !== "contains") console.log(`${rel.type} ${rel.source}->${rel.target} @${rel.confidence}`)
}
main()
