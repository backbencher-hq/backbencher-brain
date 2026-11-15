import * as fs from "fs"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"
const FILE = "validation/m14/fixtures/groovy/scoped-type-recovery-refusal.groovy"
async function main() {
  const SRC = fs.readFileSync(FILE, "utf8")
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const tree = parser.parse(SRC)
  let errs = 0
  const st = [tree.rootNode]
  while (st.length) { const n = st.pop()!; if (n.type === "ERROR" || n.isMissing) errs++; for (let i = 0; i < n.childCount; i++) st.push(n.child(i)!) }
  process.stdout.write(`parse errors/missing: ${errs}\n`)
  const az: any = new RealGroovyAnalyzer()
  const res: any = az.analyze(tree.rootNode, SRC, FILE)
  process.stdout.write(`symbols: ${(res.symbols ?? []).map((s: any) => s.name + ":" + s.kind).join(", ")}\n`)
  for (const r of res.relationships ?? []) {
    process.stdout.write(`  ${r.type} ${JSON.stringify(r.source)} -> ${JSON.stringify(r.target)} line=${r.line_number} ${JSON.stringify(r.metadata ?? {})}\n`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
