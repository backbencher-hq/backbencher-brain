// G7 honesty check: the class the finding called "the parse-visible tip" is a
// nested double quote INSIDE `${ }` — `logger.warn("... ${System.getenv("X")}")`.
// After the fix that line must parse AND the inner call must reach the graph.
// Plumbing mirrors the working probes: getParser() + analyze(), not parseFile().
import { ASTEngine } from "../../../src/ast/engine"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

const CASES: Array<[string, string]> = [
  ["nested-dquote-in-interp", 'def a = "v=${System.getenv("X")}"\n'],
  ["plain-interp-call", 'def b = "${System.getenv("X")}"\n'],
  ["no-outer-string", 'def c = System.getenv("X")\n'],
  ["nested-dquote-warn", 'logger.warn("set to (EPOCH=${System.getenv("SOURCE_DATE_EPOCH")})")\n'],
  // the same expression INSIDE vs OUTSIDE a string, both in statement position
  // (so the declaration-initializer path cannot confound the comparison)
  ["stmt-plain-call", 'System.getenv("X")\n'],
  ["stmt-plain-member", 'System.out.println("X")\n'],
  ["stmt-interp-call", '"${System.getenv("X")}"\n'],
  ["stmt-interp-member", '"${System.out.println}"\n'],
  ["stmt-interp-bare", 'def field = 1; "${field}"\n'],
  ["def-init-plain", 'def c = System.getenv("X")\n'],
  ["def-init-interp", 'def b = "${System.getenv("X")}"\n'],
  ["method-call-stmt", 'import groovy.json.JsonOutput\ndef m() { System.getenv("X") }\n'],
  ["method-interp-stmt", 'def m2() { "${System.getenv("X")}" }\n'],
  // owner resolution for a script-level vs class-method interpolation read
  ["script-level-bare", 'def s = "${unknownName}"\n'],
  ["class-method-bare", 'class C { def m() { return "${unknownName}" } }\n'],
  ["script-level-member", 'def s2 = "${unknownObj.prop}"\n'],
]

async function main(): Promise<void> {
  const parser = await ASTEngine.getParser("groovy" as any)
  const analyzer = new RealGroovyAnalyzer()
  for (const [name, src] of CASES) {
    const root = parser.parse(src)?.rootNode
    const res: any = analyzer.analyze(root!, src, "t.groovy")
    const rels = res.relationships ?? []
    const found: string[] = []
    const seen = new Set<number>()
    const visit = (n: any): void => {
      if (!n || seen.has(n.id)) return
      seen.add(n.id)
      if (n.type === "string_interpolation" || n.type === "interpolated_identifier" || n.type === "method_invocation") {
        found.push(`${n.type}@${n.startPosition.row + 1}:${JSON.stringify(n.text.slice(0, 50))}`)
      }
      for (let i = 0; i < n.childCount; i++) visit(n.child(i))
    }
    visit(root)
    console.log(`\n=== ${name} ===`)
    console.log(`hasError: ${root?.hasError}`)
    console.log(`nodes  : ${found.length ? found.join(" | ") : "(none)"}`)
    console.log(`edges  : ${rels.length ? rels.map((r: any) => `${r.type} ${r.source}->${r.target}@${r.line_number}`).join(" | ") : "(none)"}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
