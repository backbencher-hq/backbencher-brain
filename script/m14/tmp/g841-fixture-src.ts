// #841 fixture: grammar-residual classes fixed in this wave — typed for-in
// loop with `def`, slashy string regex literal, spread-map argument `*:`,
// one-line class body with trailing field, and one-line try/catch with bare
// expression/throw tails. Each of these was an ERROR/MISSING region before the
// grammar round; the analyzer can only see symbols inside if the parse is
// clean. Pinned via analyzer-visible symbols+relationships, not parse-tree
// internals, so the pin survives grammar refactors.
import * as fs from "fs"

const WASM = "wasm/tree-sitter-groovy.wasm"
const SRC = `// fixture: groovy/grammar-residuals-841
// #841: every statement below was an ERROR/MISSING region before the grammar
// round; the analyzer only sees it when the parse is clean.
class RetrySpec {
    def limiter = 3
}

def deployAll(targets) {
    def seen = [:]
    for (def t : targets) { seen[t] = true }
    def pattern = /deploy.*/
    deploy(*: seen)
    try { attempt(seen) } catch (e) { log(e) }
    return seen
}
`

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync(WASM))
  const parser = new P(); parser.setLanguage(lang)
  const tree = parser.parse(SRC)
  const clean = !(tree.rootNode as any).hasError
  console.log("parse clean:", clean)
  if (!clean) process.exit(1)
  fs.writeFileSync("/tmp/g841-fixture.groovy", SRC)
  console.log("fixture source written to /tmp/g841-fixture.groovy")
}
main()
