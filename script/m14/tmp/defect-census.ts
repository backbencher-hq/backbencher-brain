/**
 * Defect-class census over every corpus, at once.
 *
 * Per-file error counts say nothing about what to fix next; the repair list is
 * the set of SHAPES the grammar cannot build. For each file, localise the
 * deepest node that still contains an error (grammar-bisect's method, which is
 * the only one that works on block-structured source), then bucket the site by
 * the grammar rule that should have matched at that position.
 *
 * Output is ranked by how many FILES each class costs, because that is the
 * order a repair is worth doing in.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { Parser, Language } from "<corpus-root>/backbencher-brain/node_modules/web-tree-sitter/tree-sitter.js"
import { readVbSource } from "./vb-source"

const CORE_WASM = "<corpus-root>/backbencher-brain/wasm/tree-sitter.wasm"
const GRAMMAR_WASM = process.env.VB_WASM ?? "<corpus-root>/backbencher-brain/wasm/tree-sitter-vbnet.wasm"

const CORPORA: Array<{ name: string; root: string; limit: number }> = [
  { name: "runtime-mvb", root: "<corpus-root>/bb_tests/vb-corpus/runtime", limit: 0 },
  { name: "p3d-legacy", root: "<corpus-root>/bb_tests/vb-corpus/p3d", limit: 600 },
  { name: "dismtools", root: "<corpus-root>/bb_tests/vb-corpus/dismt", limit: 400 },
  { name: "tankexporter", root: "<corpus-root>/bb_tests/vb-corpus/tankex", limit: 0 },
]

function collectVbFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: string[]
    try { entries = readdirSync(dir) } catch { continue }
    for (const e of entries) {
      if (e === ".git") continue
      const p = join(dir, e)
      let st: any
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) stack.push(p)
      else if (e.toLowerCase().endsWith(".vb")) out.push(p)
    }
  }
  out.sort()
  return out
}

const isBad = (n: any) => n.type === "ERROR" || n.type === "_ERROR" || n.isMissing
function hasBadBelow(node: any): boolean {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (isBad(c) || hasBadBelow(c)) return true
  }
  return false
}
function deepestContainer(node: any): any {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (isBad(c)) continue
    if (hasBadBelow(c)) return deepestContainer(c)
  }
  return node
}

/**
 * The repair signal: the text at the failure site, trimmed to the construct.
 * Two sites whose first 40 characters of source agree are the same class far
 * more often than their node types agree — a missing production shows up as a
 * hundred different node types.
 */
function signature(site: any, src: string): string {
  const line = src.slice(site.startIndex, Math.min(site.endIndex, site.startIndex + 90)).split(/\r?\n/)[0] ?? ""
  return line.trim().slice(0, 60)
}

await Parser.init({ locateFile: () => CORE_WASM, wasmBinary: readFileSync(CORE_WASM) })
const lang = await Language.load(GRAMMAR_WASM)
const parser = new Parser()
parser.setLanguage(lang)

/** class key -> { files:Set, sites:number, examples:[] } */
const classes = new Map<string, { files: Set<string>; sites: number; examples: string[] }>()
let totalFiles = 0, cleanFiles = 0

for (const corp of CORPORA) {
  const all = collectVbFiles(corp.root)
  const files = corp.limit > 0 ? all.slice(0, corp.limit) : all
  for (const f of files) {
    totalFiles++
    const src = readVbSource(f).text
    const tree = parser.parse(src)
    const root = tree.rootNode
    if (!hasBadBelow(root) && !isBad(root)) { cleanFiles++; tree.delete(); continue }
    // Collect EVERY failing site in the file, not just the first: a file can
    // carry two unrelated defects, and counting a file once per class would
    // under-report a class that hides behind another.
    const sites: any[] = []
    for (let i = 0; i < root.namedChildCount; i++) {
      const c = root.namedChild(i)
      if (isBad(c)) { sites.push(c); continue }
      if (hasBadBelow(c)) sites.push(deepestContainer(c))
    }
    const seen = new Set<string>()
    for (const s of sites) {
      const sig = signature(s, src)
      if (!sig) continue
      const key = sig
      let e = classes.get(key)
      if (!e) { e = { files: new Set(), sites: 0, examples: [] }; classes.set(key, e) }
      e.sites++
      if (!seen.has(key)) { seen.add(key); e.files.add(`${corp.name}:${f.replace(corp.root, "")}`) }
      if (e.examples.length < 3) e.examples.push(`${corp.name}:${f.replace(corp.root, "")}:${s.startPosition.row + 1}  <${s.type}>  ${sig}`)
    }
    tree.delete()
  }
}
parser.delete()

const ranked = [...classes.entries()]
  .map(([sig, e]) => ({ sig, files: e.files.size, sites: e.sites, examples: e.examples }))
  .sort((a, b) => b.files - a.files || b.sites - a.sites)

console.log(`files ${totalFiles}  clean ${cleanFiles} (${((cleanFiles / totalFiles) * 100).toFixed(2)}%)  bad ${totalFiles - cleanFiles}`)
console.log(`distinct failure signatures: ${ranked.length}`)
console.log("")
console.log("=== defect classes ranked by FILES lost ===")
for (const r of ranked.slice(0, 30)) {
  console.log(`  ${String(r.files).padStart(4)} files  ${String(r.sites).padStart(4)} sites  ${r.sig}`)
}
console.log("")
console.log("=== examples for the top 12 ===")
for (const r of ranked.slice(0, 12)) {
  console.log(`  --- ${r.files} files: ${r.sig}`)
  for (const e of r.examples) console.log(`        ${e}`)
}
