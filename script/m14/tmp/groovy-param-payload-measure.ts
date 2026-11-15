// Measure validation/m14/fixtures/groovy/parameters-payload.groovy — every
// symbol's parameters, so the expectation is authored from the measurement.
import * as fs from "fs"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const path = "validation/m14/fixtures/groovy/parameters-payload.groovy"
  const source = fs.readFileSync(path, "utf8")
  const tree = parser.parse(source)
  let errs = 0
  const st = [tree.rootNode]
  while (st.length) {
    const n = st.pop()!
    if (n.type === "ERROR" || n.isMissing) errs++
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i)!)
  }
  process.stdout.write(`parse errors: ${errs}\n`)
  const az: any = new RealGroovyAnalyzer()
  const res: any = az.analyze(tree.rootNode, source, path)
  process.stdout.write(`symbols with parameters:\n`)
  for (const s of res.symbols ?? []) {
    if (!Array.isArray(s.parameters) || s.parameters.length === 0) continue
    const ps = s.parameters.map((p: any) => `${p.name}:${p.type ?? "<ABSENT>"}`).join(", ")
    process.stdout.write(`  ${s.kind} ${s.ownerName ?? "-"}.${s.name}(${ps})\n`)
  }
  process.stdout.write(`all symbols:\n`)
  for (const s of res.symbols ?? []) process.stdout.write(`  ${s.kind} ${s.ownerName ?? "-"}.${s.name}${s.returnType ? ` : ${s.returnType}` : ""}\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
