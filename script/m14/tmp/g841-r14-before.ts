// BEFORE-measurement for the analyzer-side recovery of the typed-closure misparse.
//
// Round 13 established the tree-level fact: `{ File f -> f.name }` misparses as
//   juxt_function_call(name: File, args: (f))  +  lambda_expression
// while the untyped control parses as closure(identifier, field_access).
// The juxt handler (real-groovy-analyzer.ts ~577) then fabricates a `calls` edge
// to the type name.
//
// This probe measures what the ANALYZER extracts from both shapes, so the
// recovery's required delta is measured before any edit:
//   * param symbol present? with what name/type?
//   * what relationships does the misparse fabricate that the control doesn't?
import { ASTEngine } from "../../../src/ast/engine"

const CASES: [string, string][] = [
  ["misparse-typed", `class C {\n  def m() {\n    def x = files.find() { File f -> f.name }\n    return x\n  }\n}\n`],
  ["control-untyped", `class C {\n  def m() {\n    def x = files.find() { f -> f.name }\n    return x\n  }\n}\n`],
  ["misparse-two-params", `class C {\n  def m() {\n    props.each { String key, Object value -> map.put(key, value) }\n    return map\n  }\n}\n`],
  ["control-two-params", `class C {\n  def m() {\n    props.each { key, value -> map.put(key, value) }\n    return map\n  }\n}\n`],
]

const parser = await ASTEngine.getParser("groovy" as any)
for (const [name, src] of CASES) {
  const t = parser.parse(src)
  console.log(`\n===== ${name} (hasError=${t.rootNode.hasError}) =====`)
  const { RealGroovyAnalyzer } = await import("../../../src/ast/real-groovy-analyzer")
  const a = new RealGroovyAnalyzer()
  const res = await (a as any).analyze(t.rootNode, src, "Probe.groovy")
  for (const s of res.symbols ?? []) {
    console.log(`  sym  L${s.range?.startLine}  ${s.kind ?? "?"}  ${s.name}${s.type ? " : " + s.type : ""}`)
  }
  for (const r of res.relationships ?? []) {
    const srcN = typeof r.source === "object" ? r.source?.name : r.source
    const tgtN = typeof r.target === "object" ? r.target?.name : r.target
    console.log(`  rel  L${r.line_number}  ${r.type}  ${srcN} -> ${tgtN}`)
  }
}
