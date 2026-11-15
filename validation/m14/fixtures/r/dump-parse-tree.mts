/**
 * R LANE — PARSE-TREE DUMP. `npx tsx validation/m14/fixtures/r/dump-parse-tree.mts '<src>'`
 *
 * The narrowest instrument in the lane: it prints the shape tree-sitter-r gives a
 * snippet, with no analyzer consulted. It exists because a probe that reads text
 * cannot answer a question about a GRAMMAR, and because "the analyzer published
 * nothing" and "the grammar has no node for it" are different findings that look
 * identical in an edge count.
 *
 * `.mts` because the repository's tsconfig emits cjs, and top-level await needs a
 * module. NO REGEX: every node is reached by index and field name.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-r.wasm"))))

const tree = parser.parse(process.argv[2] ?? "")
const visit = (n: any, d: number): void => {
  const op = n.childForFieldName?.("operator")
  console.log(`${"  ".repeat(d)}${n.type}${n.isNamed ? "" : " (anon)"}${op ? `  op=${JSON.stringify(op.text)}` : ""}`)
  for (let i = 0; i < n.childCount; i++) visit(n.child(i), d + 1)
}
visit(tree.rootNode, 0)