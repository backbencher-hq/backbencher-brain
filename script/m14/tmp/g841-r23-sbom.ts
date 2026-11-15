// #841 round 23: dump SbomPlugin error regions at a given build
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2] ?? "/tmp/x23c.wasm"))
const parser = new P(); parser.setLanguage(lang)
const SRC = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/grails-core/build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/SbomPlugin.groovy", "utf8")
const root = parser.parse(SRC).rootNode
const errs: any[] = []
const walk = (n: any): void => {
  if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) errs.push(n)
  for (let i = 0; i < n.childCount; i++) walk(n.child(i))
}
walk(root)
errs.sort((a, b) => a.startIndex - b.startIndex)
for (const e of errs.slice(0, 4)) {
  console.log(`\n=== ERROR [${e.startPosition.row + 1}:${e.startPosition.column}] len=${e.endIndex - e.startIndex}`)
  // print structure shallowly
  const walk2 = (x: any, d: number): void => {
    console.log(`${"  ".repeat(d)}${x.type}${x.childCount === 0 ? " " + JSON.stringify(x.text.slice(0, 30)) : x.type === "ERROR" || x.isMissing ? " <<" + x.type + ">>" : ""}`)
    if (d < 6) for (let i = 0; i < x.childCount; i++) walk2(x.child(i), d + 1)
  }
  walk2(e, 0)
}
