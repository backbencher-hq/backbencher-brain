// #841 round 22: tree dump — dotted call inside a typed-parameter closure
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2] ?? "wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)

// The exact corpus shapes (normalized): dotted call as the last statement of a
// typed-parameter closure, and a couple of neighbours for context.
const CASES: Array<[string, string]> = [
  ["closure-dotted-call", `class C {\n  def m() {\n    def xs = []\n    xs.findAll { ILoggingEvent event ->\n      event.formattedMessage.contains('deprecated')\n    }\n  }\n}\n`],
  ["closure-dotted-args", `class C {\n  def m() {\n    task.includeConfigs.set(includeConfigs)\n  }\n}\n`],
  ["closure-dotted-field", `class C {\n  def m() {\n    loader.loadFactories(TraitInjector).findAll() { TraitInjector ti ->\n      ti.artefactTypes.contains(Views.TYPE)\n    }\n  }\n}\n`],
  ["control-untyped-closure", `class C {\n  def m() {\n    xs.findAll { event ->\n      event.formattedMessage.contains('deprecated')\n    }\n  }\n}\n`],
  ["control-dotted-plain", `class C {\n  def m() {\n    event.formattedMessage.contains('deprecated')\n  }\n}\n`],
]
for (const [name, src] of CASES) {
  const t = parser.parse(src)
  const errs: string[] = []
  const walk = (x: any, d: number): void => {
    if (x.type === "ERROR" || x.isMissing) errs.push(`  ${x.type} [${x.startPosition.row + 1}:${x.startPosition.column}] ${JSON.stringify(x.text.slice(0, 60))}`)
    if (x.type === "ERROR" && d < 12) for (let i = 0; i < x.childCount; i++) walk(x.child(i), d + 1)
  }
  walk(t.rootNode, 0)
  console.log(`=== ${name}: ${errs.length === 0 ? "CLEAN" : `${errs.length} error(s)`}`)
  for (const e of errs.slice(0, 4)) console.log(e)
}
