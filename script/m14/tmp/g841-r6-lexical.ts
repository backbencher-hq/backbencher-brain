// Is the typed-parameter reading pruned by a LEXICAL tie?
//
// Hypothesis: in the closure's opening state both readings are live, and the
// command-call reading needs `File` as an `identifier` while the typed-parameter
// reading needs it as a `type_identifier`. If the lexer resolves that tie toward
// `identifier`, no parse route ever sees a type there.
//
// Prediction, which makes the hypothesis falsifiable: a param type that is a
// FIXED KEYWORD can never be an identifier, so the typed reading must work for
// it — while an identifier-like type name must keep failing.
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

const CASES: Array<[string, string]> = [
  ["int (keyword type)", "int"],
  ["boolean (keyword type)", "boolean"],
  ["def (keyword)", "def"],
  ["String (identifier-like)", "String"],
  ["File (identifier-like)", "File"],
  ["java.lang.String (qualified)", "java.lang.String"],
  ["String[] (array)", "String[]"],
  ["List<String> (generic)", "List<String>"],
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
  const parser = new P()
  parser.setLanguage(lang)

  console.log("param type                 typed-param?  wrong-reading?  error")
  for (const [label, ty] of CASES) {
    const src = `def m(d) { d.each { ${ty} f -> f } }\n`
    const root = parser.parse(src)!.rootNode
    let typed = false
    let wrong = false
    const walk = (n: any): void => {
      if (n.type === "juxt_function_call") wrong = true
      if (["type_identifier", "generic_type", "array_type", "scoped_type_identifier", "integral_type", "boolean_type"].includes(n.type)) typed = true
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    walk(root)
    console.log(`${label.padEnd(26)}  typed=${String(typed).padEnd(5)} wrongReading=${String(wrong).padEnd(5)} error=${root.hasError}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
