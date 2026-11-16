// #841 round 22: what does the analyzer lose on the typed-closure-juxt files?
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2] ?? "wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)

const FILES = [
  "<corpus-root>/bb_tests/repositories/grails-core/grails-core-cli-legacy/src/test/groovy/org/apache/grails/core/cli/LegacyCommandRegistryLoadingSpec.groovy",
  "<corpus-root>/bb_tests/repositories/grails-core/build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/SbomPlugin.groovy",
]
for (const f of FILES) {
  const src = fs.readFileSync(f, "utf8")
  const root = parser.parse(src).rootNode
  // collect ERROR region byte ranges
  const errRanges: Array<[number, number]> = []
  const walk = (n: any): void => {
    if (n.type === "ERROR") errRanges.push([n.startIndex, n.endIndex])
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  const inErr = (i: number) => errRanges.some(([a, b]) => i >= a && i < b)

  // method_declaration names + their line; call-ish nodes inside/outside ERROR
  const methods: string[] = []
  let callsIn = 0, callsOut = 0
  const walk2 = (n: any): void => {
    if (n.type === "method_declaration" || n.type === "function_definition") {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && c.type === "identifier") { methods.push(`${c.text}:${n.startPosition.row + 1}`); break }
      }
    }
    if (n.type === "method_invocation" || n.type === "juxt_function_call") {
      if (inErr(n.startIndex)) { callsIn++ } else { callsOut++ }
    }
    for (let i = 0; i < n.childCount; i++) walk2(n.child(i))
  }
  walk2(root)
  console.log(`\n=== ${f.split("/").pop()}: methods=${methods.length}, call-nodes in ERROR=${callsIn}, outside=${callsOut}`)
  console.log("   methods: " + methods.join(", "))
  // the specific dotted calls that live inside ERROR regions
  const src2 = src
  for (const needle of ["formattedMessage.contains", "includeConfigs.set", "componentName.set", "artefactTypes.contains"]) {
    const i = src2.indexOf(needle)
    if (i >= 0) console.log(`   '${needle}' @byte ${i}: inside ERROR = ${inErr(i)}`)
  }
}
