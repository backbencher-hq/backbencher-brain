// #841 r24: characterize the five real files whose first ERROR starts at row 1
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2] ?? "wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)
const FILES = [
  "grails-data-mongodb/core/src/test/groovy/org/apache/grails/data/mongo/core/GrailsDataMongoTckManager.groovy",
  "grails-datastore-core/src/main/groovy/org/grails/datastore/mapping/config/ConfigurationBuilder.groovy",
  "grails-spring-security/plugin/src/main/groovy/grails/plugin/springsecurity/SpringSecurityCoreGrailsPlugin.groovy",
  "grails-spring-security/plugin/src/main/groovy/grails/plugin/springsecurity/web/filter/DebugFilter.groovy",
  "grails-spring-security/rest/core/grails-app/services/grails/plugin/springsecurity/rest/RestOauthService.groovy",
]
for (const f of FILES) {
  const p = `<corpus-root>/bb_tests/repositories/grails-core/${f}`
  const src = fs.readFileSync(p, "utf8")
  const t = parser.parse(src).rootNode
  const errs: Array<[string, number, number]> = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex)
      errs.push([n.type, n.startPosition.row + 1, n.endIndex - n.startIndex])
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t)
  errs.sort((a, b) => b[2] - a[2])
  console.log(`===== ${f.split("/").pop()}  totalErr=${errs.length}`)
  for (const [k, r, len] of errs.slice(0, 5)) console.log(`   ${k}@row${r} len=${len}`)
  const lines = src.split("\n")
  const top = errs[0]
  if (top) {
    console.log(`   biggest region context (row ${top[1]}):`)
    for (let i = Math.max(0, top[1] - 3); i < Math.min(lines.length, top[1] + 2); i++)
      console.log(`     ${i + 1}: ${lines[i]?.slice(0, 100)}`)
  }
}
