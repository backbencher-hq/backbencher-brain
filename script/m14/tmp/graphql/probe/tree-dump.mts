/**
 * GraphQL TREE DUMP — exact s-expression + ERROR/MISSING spans for arbitrary
 * snippets passed on the command line (or from `--file`), so every claim about
 * "what the grammar produces here" is a measurement, not a memory.
 *
 *   tsx tree-dump.mts 'type Q { a: Int }'
 *   tsx tree-dump.mts --file some.graphql
 */
import * as fs from "fs"
import * as path from "path"
import { ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const language: any = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-graphql.wasm")))
const parser = new ParserClass()
parser.setLanguage(language)

function sexp(n: any, depth = 0, src = ""): string {
  const pad = "  ".repeat(depth)
  const field = ""
  const flags = `${n.isError ? " ERROR" : ""}${n.isMissing ? ` MISSING(${n.type})` : ""}`
  const snippet = src.slice(n.startIndex, Math.min(n.endIndex, n.startIndex + 46)).replace(/\n/g, "\\n")
  let s = `${pad}${field}${n.type}${flags}  [${n.startPosition.row + 1}:${n.startPosition.column + 1} - ${n.endPosition.row + 1}:${n.endPosition.column + 1}]  ${JSON.stringify(snippet)}\n`
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    const fld = n.fieldNameForNamedChild(i)
    s += sexp(c, depth + 1, src)
  }
  return s
}

const args = process.argv.slice(2)
const inputs: Array<[string, string]> = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--file") inputs.push([path.basename(args[++i]), fs.readFileSync(args[i], "utf8")])
  else inputs.push([`arg${i}`, args[i]])
}

for (const [label, src] of inputs) {
  const tree: any = parser.parse(src)
  console.log(`\n===== ${label} =====`)
  console.log(`hasError=${tree.rootNode.hasError}`)
  console.log(sexp(tree.rootNode, 0, src))
}
