// W23: isolate `promise = promise.then { it * 2 } then { it + 6 }` —
// the localized failure in grails-async PromiseSpec.groovy (152, 163).
// Usage: bun script/m14/tmp/w23-juxtchain-probe.ts
import * as fs from "fs"

const CASES: Array<[string, string]> = [
  ["corpus shape", `def promise = Promises.createPromise { 1 + 1 }\npromise = promise.then { it * 2 } then { it + 6 }\n`],
  ["corpus shape, lowercase then", `def promise = p.create { 1 }\npromise = promise.then { it * 2 } then { it + 6 }\n`],
  ["method call + closure, then juxt closure call", `def x = a.b { it * 2 } c { it + 6 }\n`],
  ["two juxt closure calls", `x = a { 1 } b { 2 }\n`],
  ["field access + closure, then juxt", `x = a.b { 1 } c { 2 }\n`],
  ["field access + closure only", `x = a.b { 1 }\n`],
  ["method call(1) + closure, then juxt", `x = a.b(1) { 1 } c { 2 }\n`],
  ["juxt no-arg call then juxt closure", `x = a.b c { 2 }\n`],
  ["dot chain with two trailing closures", `x = a.b { 1 }.c { 2 }\n`],
  ["assignment then separate stmt", `x = a.b { 1 }\nc { 2 }\n`],
  ["juxt into method w/ parens", `x = a.b { 1 } c(2)\n`],
  ["three-step chain (corpus 163 shape)", `x = a.b { 1 } c { 2 } d { 3 }\n`],
  ["in class method", `class C {\n    def m() {\n        def x = a.b { 1 } c { 2 }\n    }\n}\n`],
  ["statement-position (no assignment)", `a.b { 1 } c { 2 }\n`],
  ["with return", `def m() {\n    return a.b { 1 } c { 2 }\n}\n`],
]

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  for (const [label, src] of CASES) {
    const root = parser.parse(src).rootNode
    let out = `${root.hasError ? "FAIL" : "ok  "}  ${label}`
    if (root.hasError) {
      let first: any = null
      const walk = (n: any): void => {
        if (first) return
        if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) {
          first = n
          return
        }
        for (let i = 0; i < n.childCount && !first; i++) walk(n.child(i))
      }
      walk(root)
      if (first) out += `\n        row ${first.startPosition.row + 1} col ${first.startPosition.column + 1} :: ${JSON.stringify((first.text || "").slice(0, 70))}`
    }
    console.log(out)
  }
}
main()
