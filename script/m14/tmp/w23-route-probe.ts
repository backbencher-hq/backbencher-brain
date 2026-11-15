// W23 step 2: which alternative of the closure rule actually wins? Parses the
// same body under (a) a typed parameter, (b) `def`, (c) an explicit zero-arg
// arrow, and (d) no parameter list at all, printing the closure's child types so
// the winning route is visible rather than inferred.
// Usage: bun script/m14/tmp/w23-route-probe.ts
import * as fs from "fs"

const BODIES = [
  ["one-level field", "it.name"],
  ["two-level field", "it.cp.files"],
  ["one-level call", "it.filter(File)"],
  ["two-level call", "it.cp.filter(File)"],
  ["two-level call (parens)", "(it.cp.filter(File))"],
]

const PARAMS = [
  ["typed SourceSet it ->", "SourceSet it -> "],
  ["def it ->", "def it -> "],
  ["zero-arg ->", "-> "],
  ["none", ""],
  ["untyped name a ->", "a -> "],
]

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  for (const [plabel, p] of PARAMS) {
    console.log(`\n=== param form: ${plabel}`)
    for (const [blabel, body] of BODIES) {
      const src = `def x = a.collect { ${p}${body} }\n`
      const tree = parser.parse(src)
      const root = tree.rootNode
      const closure = (function find(n: any): any {
        if (n.type === "closure") return n
        for (let i = 0; i < n.childCount; i++) {
          const r = find(n.child(i))
          if (r) return r
        }
        return null
      })(root)
      const kids = closure
        ? Array.from({ length: closure.namedChildCount }, (_, i) => {
            const c = closure.namedChild(i)
            return c.type === "lambda_expression"
              ? `lambda[params=${c.childForFieldName("parameters")?.type ?? "-"},body=${c.childForFieldName("body")?.type}]`
              : c.type
          }).join(" + ")
        : "(no closure)"
      const typedParam =
        closure &&
        /_unannotated_type|type_identifier|integral_type/.test(
          Array.from({ length: closure.namedChildCount }, (_, i) => closure.namedChild(i).type).join(" "),
        )
          ? "  [typed-param route WON]"
          : ""
      void typedParam
      console.log(`${root.hasError ? "FAIL" : "ok  "}  ${blabel.padEnd(22)} ${kids}`)
    }
  }
}
main()
