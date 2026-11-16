// #841 round 23 close-out: what do the 3 varargs/default files lose at committed r22?
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)

const FILES: Array<[string, string, number]> = [
  // dedup: drop the second TestDataService path
  ["TestDataService", "<corpus-root>/bb_tests/repositories/grails-core/grails-test-examples/spring-security/ui/simple/grails-app/services/test/TestDataService.groovy", 115],
  ["TestDataService2", "<corpus-root>/bb_tests/repositories/grails-core/grails-test-examples/spring-security/ui/simple/grails-app/services/test/TestDataService.groovy", 0],
  ["ViolationAgg", "<corpus-root>/bb_tests/repositories/grails-core/build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/GrailsViolationAggregationPlugin.groovy", 250],
]
for (const [tag, path, focusLine] of FILES) {
  if (!fs.existsSync(path)) { console.log(`${tag}: FILE MISSING`); continue }
  const src = fs.readFileSync(path, "utf8")
  const t = parser.parse(src).rootNode
  const errs: string[] = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex)
      errs.push(`${n.type}[${n.startPosition.row + 1}:${n.startPosition.column}] len=${n.endIndex - n.startIndex}`)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t)
  console.log(`===== ${tag}  ${errs.length === 0 ? "CLEAN" : errs.length + " err nodes"}`)
  for (const e of errs.slice(0, 6)) console.log(`   ${e}`)
  if (focusLine > 0) {
    const lines = src.split("\n")
    console.log(`   ctx ${focusLine}: ${lines[focusLine - 1]?.trim()}`)
  }
}
