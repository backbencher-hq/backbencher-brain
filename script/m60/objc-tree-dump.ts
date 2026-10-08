/**
 * objc-tree-dump — print the parse tree of a file as an indented node listing.
 *
 * NO REGEXP (lane rule 1). String `startsWith`/`endsWith`/`includes` only.
 * Every node line is `type  [field]  "text"` with the text taken from the node
 * itself, so the listing is what the grammar produced, not what a pattern
 * matched.
 *
 * WASM LOADING. This used to point `locateFile` at
 * `node_modules/web-tree-sitter/tree-sitter.wasm`, which does not exist in this
 * repository — the core wasm ships at `wasm/tree-sitter.wasm` — so the script
 * aborted with ENOENT on every run and produced nothing. It also called
 * `Language.load` directly, which needs the WASI shim that
 * `src/util/wasm.ts` installs. Both are fixed by going through the engine the
 * way every other objc instrument does: `ASTEngine.getParser` first (which
 * installs the shim and registers the repo's wasm), then `loadWebTreeSitter`,
 * then the core wasm located by the SAME resolver production uses.
 *
 * Usage: bun script/m60/objc-tree-dump.ts <file> [maxDepth] [filterIncludes]
 *   The third argument, when given, prints only rows whose text contains it.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"

// The engine installs the WASI shim web-tree-sitter's Language.load needs.
await ASTEngine.getParser("objective-c")
const mod: any = await loadWebTreeSitter()

const file = process.argv[2]
if (!file) {
  console.error("usage: objc-tree-dump.ts <file> [maxDepth] [filterIncludes]")
  process.exit(2)
}
const maxDepth = Number(process.argv[3] || 6)
const only = process.argv[4] ?? ""

const langName = process.env.BB_GRAMMAR || "tree-sitter-objc.wasm"
const parser = new mod.Parser()
parser.setLanguage(await mod.Language.load(readFileSync(resolveWasmAsset(langName))))
const src = readFileSync(file, "utf8")
const tree = parser.parse(src)
const rows: string[] = []
const counts = new Map<string, number>()
const visit = (n: any, d: number) => {
  counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
  const one = src.slice(n.startIndex, n.endIndex).split("\n")[0]
  const txt = one.length > 90 ? one.slice(0, 90) + "…" : one
  rows.push(`${"  ".repeat(d)}${n.isMissing ? "MISSING " : ""}${n.type}${txt ? `  "${txt}"` : ""}`)
  if (d >= maxDepth) return
  for (let i = 0; i < n.childCount; i++) visit(n.child(i), d + 1)
}
visit(tree.rootNode, 0)
if (only) {
  for (const r of rows) if (r.includes(only)) console.log(r)
} else {
  console.log(rows.join("\n"))
}
console.log(`\n--- node type counts (${counts.size} distinct) ---`)
for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(6)}  ${k}`)