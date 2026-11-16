// #916: what FOLLOWS the truncated declaration? A declaration cut at a bare
// macro with a MISSING ';' is only recoverable in the analyzer if the real
// declarator survives as a *sibling* node — if the parser swallowed it into a
// new declaration with a wrong name, recovery has a different shape.
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = (wts.Parser ?? wts.default) as any
const L = (wts.Language ?? wts.default?.Language) as any
await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const lang = await L.load(readFileSync(`${ROOT}/wasm/tree-sitter-c.wasm`))
const parser = new P()
parser.setLanguage(lang)

const SITES: Array<[string, number]> = [
  ["<corpus-root>/bb_tests/repositories/sqlite/src/btmutex.c", 53],
  ["<corpus-root>/bb_tests/repositories/sqlite/src/btree.c", 87],
  ["<corpus-root>/bb_tests/repositories/sqlite/src/notify.c", 40],
  ["<corpus-root>/bb_tests/repositories/sqlite/src/os.c", 355],
  ["<corpus-root>/bb_tests/repositories/sqlite/src/main.c", 138],
  ["<corpus-root>/bb_tests/repositories/sqlite/ext/jni/src/c/sqlite3-jni.c", 6244],
]

const show = (m: any) =>
  `${m.type}${m.isMissing ? "[MISSING]" : ""}${m.isError ? "[ERROR]" : ""} @${m.startPosition.row + 1}-${m.endPosition.row + 1} ${JSON.stringify(m.text.length > 70 ? m.text.slice(0, 70) + "…" : m.text)}`

for (const [file, line] of SITES) {
  const src = readFileSync(file, "utf8")
  const tree = parser.parse(src)
  const want = line - 1
  // find the innermost declaration that STARTS on this line and is truncated
  let target: any = null
  const walk = (n: any, parent: any) => {
    if (n.startPosition.row === want && /declaration/.test(n.type)) {
      let missing = false
      for (let i = 0; i < n.childCount; i++) if (n.child(i)?.isMissing) missing = true
      if (missing && (!target || n.endPosition.row <= target.node.endPosition.row)) {
        target = { node: n, parent }
      }
    }
    for (const c of n.children ?? []) walk(c, n)
  }
  walk(tree.rootNode, null)
  console.log(`\n=== ${path.basename(file)}:${line}`)
  console.log(`    source: ${JSON.stringify(src.split("\n")[want]?.trim())}`)
  if (!target) {
    console.log("    (no truncated declaration found on this line)")
    continue
  }
  const { node, parent } = target
  console.log(`    CUR: ${show(node)}`)
  console.log(`    children:`)
  for (let i = 0; i < node.childCount; i++) console.log(`      ${"".padEnd(4)}${show(node.child(i))}`)
  const sibs = parent?.children ?? []
  const idx = sibs.indexOf(node)
  console.log(`    siblings (parent=${parent?.type} idx=${idx} of ${sibs.length}):`)
  for (let i = Math.max(0, idx - 1); i < Math.min(sibs.length, idx + 4); i++) {
    console.log(`      ${i === idx ? ">>" : "  "} ${show(sibs[i])}`)
  }
}
