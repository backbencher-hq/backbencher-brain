// FS026 — the F5 differential over REAL corpora: the production analyzer's output
// against the lane's independent truth oracle, with MISSING and UNEXPLAINED counted per
// file and the heuristic-class (confidence < 1.0) edges counted separately, because the
// honesty contract's §4 makes "how much of this graph is a confessed guess" a queryable
// number.
//
// Run:
//   BB_CORPUS_ROOT=... bun script/m14/tmp/fs026-corpus-diff.ts --repo fsharp --limit 200
//   ... --all --limit 200 --json out.json --show 25
import * as fs from "fs"; import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const { deriveFsharpEdges } = await import(path.join(ROOT, "script/m14/fsharp-truth-oracle.ts"))
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
function walk(d: string, exts: string[], out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let ns: string[]; try { ns = fs.readdirSync(d) } catch { return out }
  for (const n of ns) { if (out.length >= cap) return out
    if (n === ".git" || n === "node_modules" || n === "bin" || n === "obj") continue
    const p = path.join(d, n); let st: fs.Stats
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, exts, out, cap)
    else if (exts.includes(path.extname(n).slice(1))) out.push(p) }
  return out
}
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const LIMIT = parseInt(argOf("--limit") ?? "200")
const SHOW = parseInt(argOf("--show") ?? "15")
const repos = process.argv.includes("--all")
  ? fs.readdirSync(CORPUS_ROOT).filter((d) => { try { return fs.statSync(path.join(CORPUS_ROOT, d)).isDirectory() } catch { return false } })
  : [argOf("--repo") ?? "fsharp"]
let heapAborts = 0
const aborts: string[] = []
let files = 0, truthTotal = 0, missing = 0, unexplained = 0, heuristic = 0, edges = 0, crashes = 0
const missRows: any[] = [], unexpRows: any[] = []
const perRepo: Record<string, any> = {}
for (const repo of repos) {
  const before = { files, truthTotal, missing, unexplained, heuristic, edges, crashes }
  for (const file of walk(path.join(CORPUS_ROOT, repo), ["fs","fsi","fsx"], [], LIMIT)) {
    if (files >= LIMIT) break
    let src: string; try { src = fs.readFileSync(file, "utf8") } catch { continue }
    files++
    const rel = path.relative(CORPUS_ROOT, file)
    let r: any
    try { r = await ASTEngine.parseFile(file, src) } catch { crashes++; continue }
    // A FRESH wasm module per file: one module degrades after ~19-31 lanes on this
    // grammar and returns empty trees before aborting (M49 W11, and the reason the
    // 0312 review capped its own draw at 250).
    const parser = new P()
    let truth: any[] = []
    try {
      parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
      const tree = parser.parse(src)
      truth = deriveFsharpEdges(tree.rootNode, r.symbols ?? [])
    } catch { heapAborts++; if (aborts.length < 20) aborts.push(rel) }
    // NO explicit tree/parser delete: this grammar exhausts web-tree-sitter's fixed
    // heap on the F# compiler's largest sources, and deleting after the heap has already
    // failed is itself an out-of-bounds call (measured here). The module is dropped by
    // falling out of scope instead, and a file that cannot be parsed is COUNTED
    // (`heapAborts`) rather than silently skipped.
    const key = (l: string, a: string, b: string) => `${l}|${a}|${b}`
    const tk = new Set(truth.map((e: any) => key(e.label, e.from, e.to)))
    const rels: any[] = r.relationships ?? []
    const ak = new Set(rels.map((x: any) => key(String(x.type), String(x.source), String(x.target))))
    truthTotal += tk.size; edges += rels.length
    for (const x of rels) if (typeof x.confidence === "number" && x.confidence < 1) heuristic++
    for (const k of tk) if (!ak.has(k)) { missing++; if (missRows.length < SHOW * 4) missRows.push({ rel, k }) }
    for (const k of ak) if (!tk.has(k)) { unexplained++; if (unexpRows.length < SHOW * 4) unexpRows.push({ rel, k }) }
  }
  perRepo[repo] = { files: files - before.files, truth: truthTotal - before.truthTotal, missing: missing - before.missing, unexplained: unexplained - before.unexplained }
}
const out = { at: new Date().toISOString(), repos, limit: LIMIT, files, truthTotal, analyzerEdges: edges, missing, unexplained, heuristic, crashes, heapAborts, aborts, perRepo, missRows, unexpRows }
const jp = argOf("--json"); if (jp) fs.writeFileSync(jp, JSON.stringify(out, null, 1))
console.log(`FS026 — F5 differential, ${files} files`)
console.log(`  truth edges ${truthTotal}   analyzer edges ${edges}`)
console.log(`  MISSING ${missing}   UNEXPLAINED ${unexplained}   heuristic-class (conf<1) ${heuristic} (${((heuristic/Math.max(1,edges))*100).toFixed(1)}% of edges)   crashes ${crashes}   heap aborts ${heapAborts}`)
console.log(`\n== per repo ==`)
for (const [k,v] of Object.entries(perRepo)) console.log(`  ${k.padEnd(14)} files ${String(v.files).padStart(4)} truth ${String(v.truth).padStart(6)} MISSING ${String(v.missing).padStart(4)} UNEXPLAINED ${String(v.unexplained).padStart(4)}`)
console.log(`\n== MISSING (truth derives, analyzer does not) ==`)
for (const m of missRows.slice(0, SHOW)) console.log(`   ${m.rel}  ${m.k}`)
console.log(`\n== UNEXPLAINED (analyzer emits, truth does not) ==`)
for (const u of unexpRows.slice(0, SHOW)) console.log(`   ${u.rel}  ${u.k}`)
