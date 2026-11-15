// #916 / btmutex.c:53 — the recovery produced no symbol at all, which points at
// `isCgd19SuppressedVarDecl` returning true BEFORE the #916 hook runs. Printing
// the ancestor chain of the truncated declaration to see what CGD19 would see.
import { readFileSync } from "node:fs"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const F = "/home/ishaq2321/bb_tests/repositories/sqlite/src/btmutex.c"
const wts: any = await import("web-tree-sitter")
const P = (wts.Parser ?? wts.default) as any
const L = (wts.Language ?? wts.default?.Language) as any
await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const lang = await L.load(readFileSync(`${ROOT}/wasm/tree-sitter-c.wasm`))
const parser = new P()
parser.setLanguage(lang)
const src = readFileSync(F, "utf8")
const tree = parser.parse(src)
const want = 52
let target: any = null
const walk = (n: any) => {
  if (n.type === "declaration" && n.startPosition.row === want) target = n
  for (const c of n.children ?? []) walk(c)
}
walk(tree.rootNode)
console.log("target:", target ? `${target.type} ${JSON.stringify(target.text)} hasError=${target.hasError} isError=${target.isError}` : "NOT FOUND")
let p = target?.parent ?? null
const chain: string[] = []
while (p) {
  chain.push(`${p.type}${p.isError ? "[ERROR]" : ""} @${p.startPosition.row + 1}-${p.endPosition.row + 1} hasError=${p.hasError}`)
  p = p.parent
}
console.log("ancestors (innermost first):")
for (const c of chain.slice(0, 8)) console.log("   " + c)
// does any ERROR ancestor contain a function header (CGD19's discriminator)?
const errAncestor = (() => {
  let q = target?.parent ?? null
  while (q) {
    if (q.isError) return q
    q = q.parent
  }
  return null
})()
console.log("\ninnermost ERROR ancestor:", errAncestor ? `${errAncestor.type} @${errAncestor.startPosition.row + 1}-${errAncestor.endPosition.row + 1}` : "(none)")
if (errAncestor) {
  const found: string[] = []
  const scan = (n: any) => {
    if (["function_definition", "declaration"].includes(n.type)) found.push(`${n.type} @${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 60))}`)
    for (const c of n.children ?? []) scan(c)
  }
  scan(errAncestor)
  console.log("  header-shaped nodes inside it:", found.length)
  for (const f of found.slice(0, 5)) console.log("    " + f)
}
