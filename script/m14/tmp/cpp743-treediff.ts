// #743 cpp port: dump the sexp of ONE file under a given wasm, indented, so two
// builds can be diffed directly. The baseline instrument answers "did the tree
// change"; this answers "how".
//
// Usage: bun script/m14/tmp/cpp743-treediff.ts <wasm> <file>
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const [wasmPath, file] = process.argv.slice(2)
if (!wasmPath || !file) {
  console.error("usage: cpp743-treediff.ts <wasm> <file>")
  process.exit(2)
}

const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await Parser.init({
  locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const lang = await Language.load(readFileSync(wasmPath))
const parser = new Parser()
parser.setLanguage(lang)
const tree = parser.parse(readFileSync(file, "utf8"))

function walk(n: any, depth: number, out: string[]) {
  const field = ""
  const txt = n.childCount === 0 ? ` ${JSON.stringify(n.text.slice(0, 30))}` : ""
  out.push(
    `@${n.startPosition.row + 1} ${"  ".repeat(depth)}${n.type}${n.isError ? " [ERROR]" : ""}${n.isMissing ? " [MISSING]" : ""}${field}${txt}`,
  )
  for (let i = 0; i < n.childCount; i++) walk(n.child(i), depth + 1, out)
}
const out: string[] = []
walk(tree.rootNode, 0, out)
process.stdout.write(out.join("\n") + "\n")
