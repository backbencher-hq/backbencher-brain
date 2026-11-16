// ROOT CAUSE + BLAST RADIUS for the ERROR-node id collision.
//
// Claim: `sequenceIndex()` can never early-return, because web-tree-sitter hands back a NEW
// JS wrapper per `namedChild(i)` call, so `sibling === itemNode` is false for every sibling
// including the item itself. The loop then runs to completion and returns the TOTAL count
// of `block_sequence_item` + `flow_node` children of the parent -- the same number for every
// item. Under a grammar ERROR the items' parent is the ERROR node, whose `flow_node` children
// number in the hundreds, so every item in the file gets one identical index and an empty
// parent path.
//
// If this is right, the fix is not "cap the name" but "stop trusting a sibling-identity scan".
// This probe asserts all three links separately so the fix is aimed at the real cause.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS_ROOT = "<corpus-root>/bb_tests/repositories"
const REPOS = ["grails-core", "docker", "ansible", "kubernetes", "terraform", "openapi-spec", "helm", "gh-cli"]
const PER_REPO = 250

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 14) return
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else if (/\.(ya?ml)$/i.test(e.name)) out.push(p)
  }
}

const SRC = `steps:
# a comment between the key and its items
- name: a
  image: x
- name: b
  image: y
args: [
  'unterminated
`

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-yaml.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  // ---- LINK 1: does `sibling === itemNode` ever hold? ----
  const clean = parser.parse("steps:\n- name: a\n  image: x\n- name: b\n  image: y\n")
  const seq = (() => {
    const st: any[] = [clean.rootNode]
    while (st.length) { const n = st.pop(); if (n.type === "block_sequence") return n; for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c) } }
    return null
  })()
  const item0 = seq!.namedChild(0)
  const item0Again = seq!.namedChild(0)
  let identityHits = 0, eqHits = 0
  for (let i = 0; i < seq!.namedChildCount; i++) {
    const sib = seq!.namedChild(i)
    if (sib === item0) identityHits++
    if (sib.equals(item0)) eqHits++
  }
  console.log("=== LINK 1: node identity vs .equals() ===")
  console.log(`  item0 === item0Again (same call site, two calls) : ${item0 === item0Again}`)
  console.log(`  wrapper reused across namedChild() calls (===)   : ${identityHits} (expected 1 if it worked)`)
  console.log(`  .equals() matches                                : ${eqHits} (expected 1)`)

  // ---- LINK 2: reproduce the identical index for every item ----
  const bad = parser.parse(SRC)
  console.log("\n=== LINK 2: the broken input ===")
  console.log(SRC.split("\n").map((l) => `   | ${l}`).join("\n"))
  console.log(`  tree: ${bad.rootNode.toString()}`)
  const items: any[] = []
  const st: any[] = [bad.rootNode]
  while (st.length) { const n = st.pop(); if (n.type === "block_sequence_item" && n.parent?.type === "ERROR") items.push(n); for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c) } }
  console.log(`  block_sequence_item nodes whose parent is ERROR: ${items.length}`)
  for (const it of items) {
    // the analyzer's own algorithm, verbatim
    const parent = it.parent
    let index = 0
    for (let i = 0; i < parent.namedChildCount; i++) {
      const sibling = parent.namedChild(i)
      if (sibling === it) { console.log("    EARLY RETURN FIRED (unexpected)"); break }
      if (sibling?.type === "block_sequence_item" || sibling?.type === "flow_node") index++
    }
    console.log(`    item at line ${it.startPosition.row + 1}: analyzer's sequenceIndex() = ${index}  (correct = position among block_sequence_item siblings)`)
  }

  // ---- LINK 3: blast radius over the eight corpora ----
  const mod: any = await import(path.join(ROOT, "src/ast/real-yaml-analyzer.ts"))
  const parser2 = new ParserClass()
  parser2.setLanguage(grammar)
  let files = 0, errFiles = 0, errFilesWithDup = 0, totalDup = 0, errFilesWithEmptyPathId = 0, symbolsInErrFiles = 0
  const worst: Array<{ file: string; dups: number; syms: number }> = []
  for (const r of REPOS) {
    const list: string[] = []
    walk(path.join(CORPUS_ROOT, r), list)
    list.sort()
    let n = 0
    for (const f of list) {
      if (n >= PER_REPO) break
      let content: string
      try { content = fs.readFileSync(f, "utf8") } catch { continue }
      if (content.length > 4_000_000) continue
      n++
      files++
      const t = parser2.parse(content)
      if (!t?.rootNode) continue
      let hasErr = false
      const probe: any[] = [t.rootNode]
      while (probe.length) { const nd = probe.pop(); if (nd.type === "ERROR") { hasErr = true; break } for (let i = 0; i < nd.childCount; i++) { const c = nd.child(i); if (c) probe.push(c) } }
      if (!hasErr) continue
      errFiles++
      const res: any = await new mod.RealYamlAnalyzer().analyze(t.rootNode, content, f)
      const syms = res.symbols ?? []
      symbolsInErrFiles += syms.length
      const ids = syms.map((s: any) => String(s.id))
      const counts = new Map<string, number>()
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
      const dups = [...counts.values()].reduce((a, c) => a + (c - 1), 0)
      if (dups > 0) { errFilesWithDup++; totalDup += dups; worst.push({ file: path.relative(CORPUS_ROOT, f), dups, syms: syms.length }) }
      if (syms.some((s: any) => typeof s.id === "string" && s.id.startsWith("["))) errFilesWithEmptyPathId++
    }
  }
  console.log("\n=== LINK 3: blast radius over the eight corpora ===")
  console.log(`  files scanned              ${files}`)
  console.log(`  files with a grammar ERROR ${errFiles}`)
  console.log(`  ...of those, with duplicate ids : ${errFilesWithDup}`)
  console.log(`  ...of those, with an id starting "[" (empty parent path) : ${errFilesWithEmptyPathId}`)
  console.log(`  total colliding ids        ${totalDup}`)
  console.log(`  symbols emitted from ERROR-bearing files ${symbolsInErrFiles}`)
  worst.sort((a, b) => b.dups - a.dups)
  console.log("  worst files:")
  for (const w of worst.slice(0, 8)) console.log(`    ${String(w.dups).padStart(5)} colliding  ${String(w.syms).padStart(6)} syms  ${w.file}`)
}
main()
