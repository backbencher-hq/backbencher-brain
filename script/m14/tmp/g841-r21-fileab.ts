import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const SRC = fs.readFileSync("<corpus-root>/bb_tests/repositories/grails-core/grails-test-suite-persistence/src/test/groovy/grails/web/databinding/GrailsWebDataBinderSpec.groovy", "utf8")
for (const wasm of process.argv.slice(2)) {
  const lang = await L.load(fs.readFileSync(wasm))
  const parser = new P(); parser.setLanguage(lang)
  const t = parser.parse(SRC)
  const errs: string[] = []
  const walk = (x: any) => { if (x.type === "ERROR" || x.isMissing) errs.push(`${x.type}[${x.startPosition.row+1}:${x.startPosition.column+1}]${JSON.stringify(x.text.slice(0, 30))}`); for (let i = 0; i < x.childCount; i++) walk(x.child(i)) }
  walk(t.rootNode)
  console.log(`${wasm.replace(/^.*\//, '')}: ${errs.length} errs`)
  for (const e of errs.slice(0, 5)) console.log("   ", e)
}
