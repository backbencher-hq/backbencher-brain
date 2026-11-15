// The converged repro of MailMessageBuilder.groovy (27 lines) contains several
// constructs. This parses one shape at a time, with the same wasm the reducer
// uses, to name the trigger instead of guessing it.
import * as fs from "fs"

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
const parser = new P()
parser.setLanguage(lang)

const CASES: Array<[string, string]> = [
  ["control: the converged 27-line repro", fs.readFileSync("/tmp/g841-reduced.groovy", "utf8")],
  ["baseline: assert with a plain single-quoted string", `class A {\n    void m() {\n        assert x, 'plain message'\n    }\n}\n`],
  ["assert whose single-quoted string contains double quotes", `class A {\n    void m() {\n        assert x, 'use "y" here'\n    }\n}\n`],
  ["assert with NO string at all", `class A {\n    void m() {\n        assert x\n    }\n}\n`],
  ["same string in an assignment", `class A {\n    void m() {\n        def s = 'use "y" here'\n    }\n}\n`],
  ["same string as a call argument", `class A {\n    void m() {\n        foo('use "y" here')\n    }\n}\n`],
  ["same string alone at top level", `'use "y" here'\n`],
  ["the original file's real assert line, verbatim", `class A {\n    void m() {\n        assert multipart, 'message is not marked as "multipart"; use "multipart true" as the first line in your builder DSL'\n    }\n}\n`],
  ["single-quoted string containing ONE double quote", `class A {\n    void m() {\n        assert x, 'a "b'\n    }\n}\n`],
  ["single-quoted string containing a semicolon and quotes", `class A {\n    void m() {\n        assert x, 'a "b"; c "d"'\n    }\n}\n`],
]

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

for (const [name, src] of CASES) {
  const root = parser.parse(src)?.rootNode
  const err = firstError(root)
  const verdict = root?.hasError ? "FAIL" : "ok  "
  console.log(`${verdict}  ${name}`)
  if (err) console.log(`        ${err.isMissing ? "MISSING" : "ERROR"} row ${err.startPosition.row + 1} col ${err.startPosition.column + 1} :: ${JSON.stringify(String(err.text).replace(/\n/g, "\\n").slice(0, 110))}`)
}
