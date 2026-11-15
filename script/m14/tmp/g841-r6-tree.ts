// Compare the parse of the PASSING closure shape (T) with the FAILING one (U),
// so the mechanism behind "typed param + >=3-segment dotted body" is observed
// rather than guessed.
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

const T = `class W {\n    def m(d) {\n        boolean b = d.find() { File f -> f.endsWith('.groovy') }\n    }\n}\n`
const U = `class W {\n    def m(d) {\n        boolean b = d.find() { File f -> f.name.endsWith('.groovy') }\n    }\n}\n`
const R = `class W {\n    def m(d) {\n        boolean b = d.find() { f -> f.name.endsWith('.groovy') }\n    }\n}\n`

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  for (const [name, src] of [["T passing (typed param, 2-segment call)", T], ["U failing (typed param, 3-segment call)", U], ["R passing (untyped param, 3-segment call)", R]] as Array<[string, string]>) {
    const root = parser.parse(src)!.rootNode
    console.log(`===== ${name} =====`)
    console.log(`hasError: ${root.hasError}`)
    console.log(root.toString())
    console.log()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
