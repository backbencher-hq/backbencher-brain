/**
 * Grammar bake-off: measure parse success of every candidate VB.NET grammar
 * over a real corpus, with the project's own web-tree-sitter loader.
 *
 * M60 precedent: a grammar is chosen by measurement over a real corpus, never
 * by star count. Reports, per grammar: files, clean files, files carrying an
 * ERROR/MISSING node, total error bytes, and the top offending node types.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { Parser, Language } from "/home/ishaq2321/backbencher-brain/node_modules/web-tree-sitter/tree-sitter.js"

const CORE_WASM = "/home/ishaq2321/backbencher-brain/wasm/tree-sitter.wasm"

const CORPUS_ROOT = process.argv[2] ?? "/home/ishaq2321/bb_tests/vb-corpus"
const LIMIT = Number(process.argv[3] ?? 0)

const GRAMMARS = [
  { name: "vbnet", wasm: "/home/ishaq2321/bb_tests/grammar-eval/tree-sitter-vbnet/tree-sitter-vbnet.wasm" },
  { name: "vb_dotnet", wasm: "/home/ishaq2321/bb_tests/grammar-eval/tree-sitter-vb-dotnet/tree-sitter-vb_dotnet.wasm" },
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
  return LIMIT > 0 ? out.slice(0, LIMIT) : out
}

function countErrorNodes(tree: any): { errors: number; missing: number; errBytes: number; types: Map<string, number> } {
  const types = new Map<string, number>()
  let errors = 0, missing = 0, errBytes = 0
  const cursor = tree.walk()
  const visit = (): boolean => {
    const isErr = cursor.nodeType === "ERROR" || cursor.nodeType === "_ERROR"
    const isMiss = cursor.nodeType === "MISSING" || cursor.isMissing
    if (isErr) { errors++; errBytes += cursor.endIndex - cursor.startIndex }
    if (isMiss) { missing++; errBytes += Math.max(1, cursor.endIndex - cursor.startIndex) }
    if (isErr || isMiss) types.set(cursor.nodeType, (types.get(cursor.nodeType) ?? 0) + 1)
    if (cursor.gotoFirstChild()) {
      do { if (!visit()) return false } while (cursor.gotoNextSibling())
      cursor.gotoParent()
    }
    return true
  }
  visit()
  return { errors, missing, errBytes, types }
}

const files = collectVbFiles(CORPUS_ROOT)
console.log(`corpus: ${CORPUS_ROOT}`)
console.log(`files:  ${files.length}`)
console.log("")

await Parser.init({
  locateFile: () => CORE_WASM,
  wasmBinary: readFileSync(CORE_WASM),
})

for (const g of GRAMMARS) {
  if (!existsSync(g.wasm)) { console.log(`${g.name}: MISSING WASM ${g.wasm}`); continue }
  let lang: any
  try {
    lang = await Language.load(g.wasm)
  } catch (e: any) {
    console.log(`${g.name}: LOAD FAILED ${e?.message ?? e}`)
    continue
  }
  const parser = new Parser()
  parser.setLanguage(lang)

  let clean = 0, errFiles = 0, crash = 0
  let totalErrors = 0, totalMissing = 0, totalErrBytes = 0, totalBytes = 0
  const typeTally = new Map<string, number>()
  const worst: Array<{ f: string; rate: number; e: number }> = []
  const t0 = Date.now()

  for (const f of files) {
    let src: string
    try { src = readFileSync(f, "utf8") } catch { continue }
    totalBytes += Buffer.byteLength(src)
    let tree: any
    try {
      tree = parser.parse(src)
    } catch (e: any) {
      crash++
      worst.push({ f, rate: 1, e: -1 })
      continue
    }
    const r = countErrorNodes(tree)
    totalErrors += r.errors
    totalMissing += r.missing
    totalErrBytes += r.errBytes
    for (const [k, v] of r.types) typeTally.set(k, (typeTally.get(k) ?? 0) + v)
    const bad = r.errors + r.missing
    if (bad === 0) clean++
    else {
      errFiles++
      const len = Math.max(1, Buffer.byteLength(src))
      worst.push({ f, rate: r.errBytes / len, e: r.errors })
    }
    tree.delete?.()
  }
  const ms = Date.now() - t0
  parser.delete?.()

  const total = files.length || 1
  console.log(`=== ${g.name} ===`)
  console.log(`  files                ${files.length}`)
  console.log(`  clean                ${clean}  (${((clean / total) * 100).toFixed(2)}%)`)
  console.log(`  files w/ ERROR|MISS  ${errFiles}  (${((errFiles / total) * 100).toFixed(2)}%)`)
  console.log(`  crash files          ${crash}`)
  console.log(`  ERROR nodes          ${totalErrors}`)
  console.log(`  MISSING nodes        ${totalMissing}`)
  console.log(`  err bytes / all      ${((totalErrBytes / Math.max(1, totalBytes)) * 100).toFixed(3)}%`)
  console.log(`  parse wall ms        ${ms}  (${(ms / total).toFixed(2)} ms/file)`)
  const top = [...typeTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  if (top.length) console.log(`  top bad node types   ${top.map(([k, v]) => `${k}=${v}`).join("  ")}`)
  worst.sort((a, b) => b.rate - a.rate)
  console.log(`  worst 5 files:`)
  for (const w of worst.slice(0, 5)) console.log(`    ${(w.rate * 100).toFixed(1).padStart(6)}%  ${w.f.replace(CORPUS_ROOT, "")}`)
  console.log("")
}
