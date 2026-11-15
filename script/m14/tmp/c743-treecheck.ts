// #743 grammar-wave gate: a grammar change must not silently re-shape the tree of
// a file that was ALREADY clean. For every file with no ERROR/MISSING under the
// pinned grammar, compare the full s-expression under pinned vs candidate. Any
// difference is a candidate regression that must be explained, not averaged away
// by the corpus totals.
//   bun script/m14/tmp/c743-treecheck.ts <pinned.wasm> <cand.wasm> <ext> [repo ...]
import fs from "node:fs"
import path from "node:path"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const [pinnedPath, candPath, extArg, ...repos] = process.argv.slice(2)
if (!pinnedPath || !candPath) {
  console.error("usage: c743-treecheck.ts <pinned.wasm> <cand.wasm> <c|cpp> [repo ...]")
  process.exit(2)
}
const FILE_RE = extArg === "c" ? /\.(c|h)$/ : /\.(cpp|cc|cxx|hpp|hh|h)$/
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const pinnedLang = await L.load(fs.readFileSync(pinnedPath))
const candLang = await L.load(fs.readFileSync(candPath))
const p1 = new P(); p1.setLanguage(pinnedLang)
const p2 = new P(); p2.setLanguage(candLang)

const MAX = 400
function damaged(root: any): boolean {
  const st = [root]
  while (st.length) {
    const n = st.pop()!
    if (n.isError || n.type === "ERROR") return true
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c?.isMissing) return true; st.push(c) }
  }
  return false
}

let cleanChecked = 0
const changed: Array<{ file: string; why: string }> = []
for (const repo of (repos.length ? repos : ["sqlite", "jq"])) {
  const repoDir = path.join(CORPUS, repo)
  const files: string[] = []
  const collect = (dir: string) => {
    if (files.length >= MAX) return
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (files.length >= MAX) return
      const p = path.join(dir, e.name)
      if (e.isDirectory()) collect(p)
      else if (FILE_RE.test(e.name)) files.push(p)
    }
  }
  collect(repoDir)
  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    const a = p1.parse(src).rootNode
    if (damaged(a)) continue // only files that are CLEAN under the pinned grammar
    cleanChecked++
    const b = p2.parse(src).rootNode
    const sa = a.toString()
    const sb = b.toString()
    if (sa !== sb) {
      changed.push({
        file: path.relative(CORPUS, f),
        why: damaged(b) ? "clean -> now damaged" : "clean -> different tree (still clean)",
      })
    }
  }
}
console.log(`clean-under-pinned files checked: ${cleanChecked}`)
console.log(`tree differences: ${changed.length}`)
const byWhy = new Map<string, number>()
for (const c of changed) byWhy.set(c.why, (byWhy.get(c.why) ?? 0) + 1)
for (const [k, v] of byWhy) console.log(`  ${k}: ${v}`)
for (const c of changed.slice(0, 25)) console.log(`   ${c.why.padEnd(36)} ${c.file}`)
