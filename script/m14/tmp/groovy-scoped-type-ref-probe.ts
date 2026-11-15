// Sibling check for the scoped_type_identifier gap: the parameter extractor was
// fixed, but the lane has TWO more collectors that walk type nodes —
// `collectTypeNames` (field/local/coercion/cast positions) and the return-type
// root walk — and both select with `endsWith("type")`/`endsWith("_type")` plus
// the literal `type_identifier`. A `scoped_type_identifier` ends in
// "identifier", so it matches NEITHER. If those collectors miss it too, a
// qualified type is unnamed in the declared-type graph as well, and the payload
// fix alone would be a half-fix of one class.
//
// This measures the difference directly: the same shape written qualified vs
// written with a bare leaf name, in the positions those collectors own.
import * as fs from "fs"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

const SRC = `package acme

class Outer {
  static class Criterion {}
  static class Projection {}

  static class Holder {
    // field positions (collectTypeNames)
    Outer.Criterion qualifiedField
    Criterion leafField
    Outer.Projection qualifiedCoerced
    Projection leafCoerced

    // return-type positions (the return_type roots walk)
    Outer.Criterion qualifiedReturn() { return null }
    Criterion leafReturn() { return null }

    // parameter positions (the extractor fixed this round)
    void takes(Outer.Criterion q, Criterion l) {}

    void body() {
      Outer.Criterion qualifiedLocal = null
      Criterion leafLocal = null
      def coerced = [] as Outer.Projection
      def leafCoerced = [] as Projection
    }
  }
}
`

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const tree = parser.parse(SRC)
  let errs = 0
  const st = [tree.rootNode]
  while (st.length) {
    const n = st.pop()!
    if (n.type === "ERROR" || n.isMissing) errs++
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i)!)
  }
  process.stdout.write(`parse errors: ${errs}\n`)
  const az: any = new RealGroovyAnalyzer()
  const res: any = az.analyze(tree.rootNode, SRC, "probe.groovy")
  const refs = (res.relationships ?? []).filter((r: any) => String(r.type) === "references")
  process.stdout.write(`references edges: ${refs.length}\n`)
  for (const r of refs) {
    process.stdout.write(`  ${r.source} -> ${r.target}  ${JSON.stringify(r.metadata ?? {})}\n`)
  }
  const targets = new Set(refs.map((r: any) => String(r.target)))
  for (const t of ["Outer.Criterion", "Criterion", "Outer.Projection", "Projection"]) {
    process.stdout.write(`  target ${JSON.stringify(t)} present: ${targets.has(t)}\n`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
