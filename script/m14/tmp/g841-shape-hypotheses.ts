// Hypothesis-driven naming for #841's residual. Reduction is expensive and, as
// measured, can land on fragments the language itself rejects — so instead of
// reducing, write the minimal COMPLETE program for a suspected construct, ask
// our grammar (must reject) and then ask real Groovy (must accept). A shape that
// clears both is a named gap; the shape that clears neither is discarded.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

const SHAPES: Array<[string, string]> = [
  // Seen in 2 of the 3 smallest residual files:
  ["A annotation arg is a parameterized class literal",
    `@Scaffold(RestfulServiceController<User>)\nclass W {\n}\n`],
  ["B control: annotation arg is a plain class literal",
    `@Scaffold(User)\nclass W {\n}\n`],
  ["C control: annotation arg is a parameterized type in a list",
    `@Scaffold(List<String>)\nclass W {\n}\n`],
  ["D annotation arg is a generic type as a class expression",
    `@Scaffold(value = RestfulServiceController<User>)\nclass W {\n}\n`],
  ["E annotation arg is a class literal, imported-style dotted",
    `@Scaffold(com.example.RestfulServiceController<User>)\nclass W {\n}\n`],
  ["F control: plain annotation, no args",
    `@Scaffold\nclass W {\n}\n`],
  ["G control: parameterized class literal in a field type",
    `class W {\n    RestfulServiceController<User> c\n}\n`],
  ["H control: parameterized class literal as an expression",
    `class W {\n    def m() {\n        Class c = RestfulServiceController<User>\n    }\n}\n`],
  // Round 5: `as` IS implemented (grammar line 457), so the 19 corpus files
  // matching `as Foo<Bar>` are co-occurrence, not causation. Test the
  // operator's generic form directly instead of inferring it.
  ["I control: as-coercion to a plain type",
    `class W {\n    def m(y) {\n        def x = y as String\n    }\n}\n`],
  ["J as-coercion to a parameterized type",
    `class W {\n    def m(y) {\n        def x = y as List<String>\n    }\n}\n`],
  ["K as-coercion by class literal",
    `class W {\n    def m(y) {\n        def x = y as RestfulServiceController<User>\n    }\n}\n`],
  // The other documented gap named in the grammar's own comment: array value
  // operands (`String[]`/`List<String>` in value position).
  ["L control: array class literal with .class",
    `class W {\n    Class c = String[].class\n}\n`],
  ["M array class literal as a value",
    `class W {\n    Class c = String[]\n}\n`],
  ["N generic class literal in a method argument",
    `class W {\n    def m() {\n        register(RestfulServiceController<User>)\n    }\n}\n`],
  ["O generic class literal in a map value",
    `class W {\n    def m() {\n        def h = [k: RestfulServiceController<User>]\n    }\n}\n`],
  ["P generic class literal in a comparison",
    `class W {\n    def m() {\n        boolean b = RestfulServiceController<User> == null\n    }\n}\n`],
]

async function main() {
  const dir = path.join(os.tmpdir(), "bb-shapes")
  mkdirSync(dir, { recursive: true })

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
  const parser = new P()
  parser.setLanguage(lang)

  const firstError = (root: any): any => {
    let found: any = null
    const walk = (n: any): void => {
      if (found) return
      if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) { found = n; return }
      for (let i = 0; i < n.childCount && !found; i++) walk(n.child(i))
    }
    walk(root)
    return found
  }

  const list: string[] = []
  console.log("shape                                          OURS")
  for (let i = 0; i < SHAPES.length; i++) {
    const [name, src] = SHAPES[i]
    const file = path.join(dir, `${String(i + 1).padStart(2, "0")}.groovy`)
    writeFileSync(file, src)
    list.push(file)
    const root = parser.parse(src)?.rootNode
    const err = firstError(root)
    console.log(`${(root?.hasError ? "REJECTS" : "accepts").padEnd(8)} ${name}`)
    if (err) console.log(`         ${err.isMissing ? "MISSING" : "ERROR"} row ${err.startPosition.row + 1} col ${err.startPosition.column + 1} :: ${JSON.stringify(String(err.text).replace(/\n/g, "\\n").slice(0, 90))}`)
  }
  writeFileSync(path.join(dir, "list.txt"), list.join("\n") + "\n")
  console.log(`\nwritten for the real-Groovy oracle: ${path.join(dir, "list.txt")}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
