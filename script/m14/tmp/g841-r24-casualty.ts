// #841 r24: pre-edit baselines — the r17 casualty + the two SumController files
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2] ?? "wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)
const FILES = [
  "grails-core/grails-core-cli-legacy/src/test/groovy/org/apache/grails/core/cli/LegacyCommandRegistryLoadingSpec.groovy",
  "grails-core/grails-test-examples/async-events-pubsub-demo/grails-app/controllers/pubsub/demo/SumController.groovy",
  "grails-core/grails-test-examples/hibernate7/async-events-pubsub-demo/grails-app/controllers/pubsub/demo/SumController.groovy",
]
function errInfo(t: any): string {
  const errs: string[] = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex)
      errs.push(`${n.type}@r${n.startPosition.row + 1} len=${n.endIndex - n.startIndex}`)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t)
  return errs.length === 0 ? "CLEAN" : `${errs.length} nodes: ${errs.slice(0, 3).join(",")}`
}
for (const f of FILES) {
  const p = `/home/ishaq2321/bb_tests/repositories/${f}`
  const t = parser.parse(fs.readFileSync(p, "utf8")).rootNode
  console.log(`${f.split("/").pop()}  ${errInfo(t)}`)
}
