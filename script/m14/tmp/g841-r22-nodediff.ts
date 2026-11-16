// #841 round 22: node inventory per source line, region 425-440, both builds
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const SRC = fs.readFileSync("<corpus-root>/bb_tests/repositories/grails-core/grails-views-gson/src/main/groovy/grails/plugin/json/view/api/internal/DefaultGrailsJsonViewHelper.groovy", "utf8")
for (const W of ["/tmp/x22-base.wasm", process.argv[2] ?? "/tmp/x22j.wasm"]) {
  const lang = await L.load(fs.readFileSync(W))
  const parser = new P(); parser.setLanguage(lang)
  const root = parser.parse(SRC).rootNode
  const perLine = new Map<number, string[]>()
  const walk = (n: any): void => {
    if (n.startPosition.row === n.endPosition.row && n.startPosition.row >= 424 && n.startPosition.row <= 440 && n.childCount === 0) {
      // leaf: attribute to its line
    }
    if (n.startPosition.row >= 424 && n.startPosition.row <= 440) {
      if (["method_invocation", "juxt_function_call", "call_expression", "static_access", "closure", "lambda_expression", "ERROR", "formal_parameters", "identifier"].includes(n.type) && n.endIndex > n.startIndex) {
        const r = n.startPosition.row + 1
        const arr = perLine.get(r) ?? []
        arr.push(`${n.type}@${n.startPosition.column + 1}..${n.endPosition.column + 1}`)
        perLine.set(r, arr)
      }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  console.log(`\n===== ${W}`)
  for (const r of [...perLine.keys()].sort((a, b) => a - b)) {
    console.log(`  ${r}: ${perLine.get(r)!.join("  ")}`)
  }
}
