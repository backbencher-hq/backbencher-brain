// #919: why does the tree predicate find 10 sites where the source-based census
// found 193? For each census site, print the statement node's children, its
// next sibling, and its parent.
//   bun script/m14/tmp/c919-shapes.ts
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const census = JSON.parse(readFileSync("/tmp/c743-blocks.json", "utf8")) as any[]
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)

const shapes = new Map<string, number>()
const samples = new Map<string, string>()
const roots = new Map<string, any>()
for (const s of census) {
  if (!roots.has(s.file)) roots.set(s.file, parser.parse(readFileSync(path.join(CORPUS, s.file), "utf8")).rootNode)
  const root = roots.get(s.file)
  const st: any[] = [root]
  let found: any = null
  while (st.length) {
    const n = st.pop()!
    if (n.type === "expression_statement" && n.startPosition.row + 1 === s.line && n.text.startsWith(s.macro.slice(0, 20))) { found = n; break }
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  }
  if (!found) { shapes.set("NOT FOUND", (shapes.get("NOT FOUND") ?? 0) + 1); continue }
  let missing = false
  for (let i = 0; i < found.childCount; i++) if (found.child(i)?.isMissing) missing = true
  const first = found.namedChild(0)
  const fn = first?.childForFieldName?.("function")
  const key = [
    `child0=${found.child(0)?.type}`,
    `named0=${first?.type}`,
    `fnField=${fn?.type}`,
    `missing=${missing}`,
    `next=${found.nextSibling?.type ?? "null"}`,
    `parent=${found.parent?.type}`,
  ].join(" ")
  shapes.set(key, (shapes.get(key) ?? 0) + 1)
  if (!samples.has(key)) samples.set(key, `${s.file}:${s.line}  ${s.macro.slice(0, 50)}`)
}
console.log(`census sites: ${census.length}\n`)
for (const [k, v] of [...shapes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(v).padStart(4)}  ${k}`)
  console.log(`      e.g. ${samples.get(k)}`)
}
