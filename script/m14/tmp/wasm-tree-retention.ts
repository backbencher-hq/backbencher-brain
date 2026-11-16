// script/m14/tmp/wasm-tree-retention.ts — is the harness's per-lane "budget" a fixed wasm
// ceiling, or the RETENTION of every parsed tree until the lane ends?
//
// Why this question exists. `differential.ts` parses each file and keeps only `rootNode`;
// the Tree wrapper is dropped and `tree.delete()` is never called (the only `.delete?.()`
// in the file tears the PARSER down at lane end, line 13730). Measured consequences at
// full extent: scala3 (18,446 files, one pass) survives in a single instance; dart/proxicall
// (2,351 files) and go/terraform (1,993) publish ZERO truth edges — i.e. the module dies —
// and scala dies in pass 2 when the harness's retry loop multiplies the same sample by up to
// 4. If the ceiling were fixed in PARSES, 2,351 x 4 = 9,404 could not die before 18,446
// survives. So the claim under test: the retained-tree bytes, not the parse count, set where
// the module dies — which makes the remedy `tree.delete()`, not chunking.
//
// Method. ONE parser, ONE pass, same corpus, same order; two modes:
//   leak  — the harness's exact shape: parse, take rootNode, never delete
//   free  — parse, take rootNode, measure nothing, then `tree.delete()`
// A canary every CANARY_EVERY parses answers "is the INSTANCE dead" independently of file
// content, and a poison shape (non-empty content, EMPTY tree) is recorded separately,
// because a dying web-tree-sitter instance returns empty trees at least as often as it
// throws.
//
// Usage: bun script/m14/tmp/wasm-tree-retention.ts <leak|free> <repo> <ext> <wasm> [limit]
//   e.g. bun script/m14/tmp/wasm-tree-retention.ts leak  <corpus-root>/bb_tests/repositories/proxicall dart dart.wasm
import fs from "node:fs"
import path from "node:path"

const ROOT = process.env.BB_PROBE_ROOT ?? "<corpus-root>/mcp/backbencher-brain"
const MODE = process.argv[2] ?? "leak"
const REPO = process.argv[3]
const EXT = process.argv[4]
const WASM = process.argv[5]
const LIMIT = Number(process.argv[6] ?? "0")

if (!REPO || !EXT || !WASM) {
  console.error("usage: bun script/m14/tmp/wasm-tree-retention.ts <leak|free> <repo> <ext> <wasm> [limit]")
  process.exit(2)
}

const files: string[] = []
const walk = (d: string) => {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|target|out)/.test(e.name)) walk(p) }
    else if (e.name.endsWith("." + EXT)) files.push(p)
  }
}
walk(REPO)
files.sort()
const sample = LIMIT > 0 ? files.slice(0, LIMIT) : files
console.log(`retention probe: mode=${MODE} repo=${path.basename(REPO)} ext=.${EXT} files=${sample.length} wasm=${WASM}`)

const ws: any = await import("web-tree-sitter")
const P: any = ws.Parser ?? ws.default ?? ws
const L: any = ws.Language ?? ws.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", WASM)))

const CANARY = EXT === "dart" ? "class C { int f() { return 1; } }\n" : "object O { def f(): Int = 1 }\n"
const parser = new P()
parser.setLanguage(grammar)

let ok = 0, emptyTrees = 0, threw = 0
let firstDeath: { i: number; f: string; kind: string } | null = null
let firstPoison: { i: number; f: string; kind: string } | null = null
let peakRss = 0
const t0 = performance.now()
const canaryHealth = (i: number): string | null => {
  try {
    const t = parser.parse(CANARY)
    const c = t?.rootNode
    if (!c) return "canary returned no root"
    if (c.childCount === 0) return `canary returned an EMPTY tree (root=${c.type})`
    c.delete?.()
    t?.delete?.()
    return null
  } catch (e: any) { return `canary THREW ${String(e?.message ?? e).slice(0, 70)}` }
}

for (let i = 0; i < sample.length; i++) {
  if (i > 0 && i % 100 === 0) {
    const bad = canaryHealth(i)
    if (bad && !firstDeath) {
      firstDeath = { i, f: sample[i], kind: `${bad} — the INSTANCE is dead, not this file` }
      console.log(`  !! FIRST DEATH at #${i} ${path.relative(REPO, sample[i])}: ${firstDeath.kind}`)
    }
  }
  let content: string
  try { content = fs.readFileSync(sample[i], "utf8") } catch { threw++; continue }
  let tree: any = null
  let root: any = null
  try { tree = parser.parse(content); root = tree?.rootNode ?? null } catch (e: any) {
    threw++
    if (!firstDeath) { firstDeath = { i, f: sample[i], kind: `parse THREW ${String(e?.message ?? e).slice(0, 70)}` }; console.log(`  !! FIRST DEATH at #${i}: ${firstDeath.kind}`) }
    continue
  }
  if (!root) { emptyTrees++; continue }
  if (root.childCount === 0 && content.trim().length > 0) {
    emptyTrees++
    if (!firstPoison) { firstPoison = { i, f: sample[i], kind: "EMPTY tree for NON-empty content (a dying instance's other face)" }; console.log(`  !! FIRST POISON at #${i} ${path.relative(REPO, sample[i])}: ${firstPoison.kind}`) }
  } else ok++
  if (MODE === "free") { try { tree?.delete?.() } catch { /* best effort */ } }
  if ((i + 1) % 1000 === 0) {
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
    console.log(`  [#${i + 1}/${sample.length} ok=${ok} empty=${emptyTrees} threw=${threw} rss=${(peakRss / 1e6).toFixed(0)}MB ${((performance.now() - t0) / 1000).toFixed(0)}s]`)
  }
}
try { (parser as any).delete?.() } catch { /* torn down */ }
console.log(`RESULT mode=${MODE} files=${sample.length} ok=${ok} empty=${emptyTrees} threw=${threw} firstDeath=${firstDeath ? `#${firstDeath.i} ${(firstDeath as any).kind}` : "none"} firstPoison=${firstPoison ? `#${firstPoison.i}` : "none"} rssPeak=${(Math.max(peakRss, process.memoryUsage().rss) / 1e6).toFixed(0)}MB`)
