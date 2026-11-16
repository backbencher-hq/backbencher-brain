// FULL-CORPUS index: the real ceiling for `overrides`, plus the perf baseline.
//
// The 400-file simulation resolved only 71 of 677 blind guesses, and the reason
// is index COVERAGE, not the algorithm: the index was built from the same 400
// files it was asked to resolve, while the ancestors that actually declare the
// methods (`IterableOps`, `Iterable`, `SortedSetFactoryDefaults`) are declared in
// other files of the library. 606 guesses stayed unresolved at depth 12.
//
// So this builds the index over the WHOLE corpus and asks the same question again,
// on the same 400-file draw. Two numbers matter:
//   correctness — how many of the 677 guesses resolve once coverage is total
//   perf        — what a full-corpus parse costs, since "best perf" is a goal and
//                 every number so far came from a 60-file sample at 4ms/file
//
// The index is written to /tmp so a later run can skip the parse. Parsed symbols
// are NOT cached wholesale (too large); only the two derived indices are.

import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
import { mergeSymbolsIntoOverrideCompanion } from "../../../src/ast/override-context"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "<corpus-root>/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"
const drawFile = process.argv[3]
const LIMIT = Number(process.argv[4] ?? 400)
const INDEX_CACHE = `/tmp/opencode/${repo}-override-index.json`
const MAX_DEPTH = 16

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  const analyzer = new RealScalaAnalyzer()

  // ── PERF BASELINE: full-corpus parse + analyze ────────────────────────────
  const all = walk(path.join(CORPUS, repo)).sort()
  console.log(`# full-corpus override index — ${all.length} ${repo} files\n`)
  console.log(`## perf baseline (this is the number the 60-file sample never gave)`)
  const t0 = performance.now()
  let ok = 0
  let damaged = 0
  let bytes = 0
  let slowest = { ms: 0, file: "" }
  const companion = new Map<string, Set<string>>()
  const hierarchy = new Map<string, Set<string>>()
  const perFileMs: number[] = []
  for (const f of all) {
    const src = fs.readFileSync(f, "utf8")
    bytes += src.length
    const fs0 = performance.now()
    let res: any
    try {
      const root = parser.parse(src).rootNode
      if (root.hasError) damaged++
      res = analyzer.analyze(root, src, f)
    } catch { continue }
    const ms = performance.now() - fs0
    perFileMs.push(ms)
    if (ms > slowest.ms) slowest = { ms, file: f }
    ok++
    mergeSymbolsIntoOverrideCompanion(companion as any, res.symbols ?? [])
    for (const s of res.symbols ?? []) {
      if (!s?.name) continue
      const sup = (s.metadata?.superTypes ?? []).map(String)
      if (!sup.length) continue
      let set = hierarchy.get(s.name)
      if (!set) { set = new Set(); hierarchy.set(s.name, set) }
      for (const t of sup) set.add(t)
    }
    if (ok % 2000 === 0) process.stderr.write(`  ...${ok}/${all.length}\n`)
  }
  const total = performance.now() - t0
  perFileMs.sort((a, b) => a - b)
  const pct = (p: number): number => perFileMs[Math.floor(perFileMs.length * p)] ?? 0
  console.log(`- files parsed+analyzed: ${ok}/${all.length}  (skipped ${all.length - ok})`)
  console.log(`- corpus bytes: ${(bytes / 1e6).toFixed(1)} MB`)
  console.log(`- **total wall: ${(total / 1000).toFixed(1)}s = ${(total / ok).toFixed(2)} ms/file**`)
  console.log(`- per-file median ${pct(0.5).toFixed(2)}ms  p90 ${pct(0.9).toFixed(2)}ms  p99 ${pct(0.99).toFixed(2)}ms  max ${perFileMs[perFileMs.length - 1]?.toFixed(1)}ms`)
  console.log(`- slowest file: ${slowest.file.replace(path.join(CORPUS, repo) + "/", "")} at ${slowest.ms.toFixed(1)}ms`)
  console.log(`- damaged parses: ${damaged} (${((damaged / ok) * 100).toFixed(1)}%)`)
  console.log(`- index: ${companion.size} owner types / ${[...companion.values()].reduce((a, s) => a + s.size, 0)} method names`)
  console.log(`- hierarchy: ${hierarchy.size} types carry supertypes`)

  fs.writeFileSync(INDEX_CACHE, JSON.stringify({
    companion: [...companion].map(([k, v]) => [k, [...v]]),
    hierarchy: [...hierarchy].map(([k, v]) => [k, [...v]]),
  }))

  // ── CORRECTNESS: same question, full coverage ─────────────────────────────
  const files = fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, LIMIT)
  const hierOf = (t: string): string[] => [...(hierarchy.get(t) ?? [])]
  const declaring = (method: string, parents: string[]): string => {
    const seen = new Set<string>()
    let frontier = [...parents]
    let d = 0
    while (frontier.length && d < MAX_DEPTH) {
      const next: string[] = []
      for (const t of frontier) {
        if (!t || seen.has(t)) continue
        seen.add(t)
        if (companion.get(t)?.has(method)) return t
        next.push(...hierOf(t))
      }
      frontier = [...new Set(next)]
      d++
    }
    return ""
  }

  let guesses = 0
  let resolvable = 0
  let wrongToday = 0
  const byDepth = new Map<number, number>()
  for (const f of files) {
    const fp = path.join(CORPUS, repo, f)
    if (!fs.existsSync(fp)) continue
    const src = fs.readFileSync(fp, "utf8")
    let res: any
    try { res = analyzer.analyze(parser.parse(src).rootNode, src, fp) } catch { continue }
    for (const r of (res.relationships ?? [])) {
      if (String(r.type) !== "overrides" || r.metadata?.reasonCode !== "first-supertype-guess") continue
      guesses++
      const method = String(r.source).split(".").pop() ?? ""
      const owner = String(r.source).slice(0, String(r.source).length - method.length - 1)
      const sym = (res.symbols ?? []).find((s: any) => s?.name === owner)
      const parents = (sym?.metadata?.superTypes ?? []).map(String)
      if (!parents.length) continue
      const first = parents[0]
      const d = declaring(method, parents)
      if (d) {
        resolvable++
        if (d !== first) wrongToday++
        let depth = 0
        let fr = [...parents]
        const sn = new Set<string>()
        while (fr.length && depth < MAX_DEPTH && fr[0] !== d) {
          const nx: string[] = []
          for (const t of fr) { if (sn.has(t)) continue; sn.add(t); nx.push(...hierOf(t)) }
          fr = [...new Set(nx)]
          depth++
        }
        byDepth.set(depth, (byDepth.get(depth) ?? 0) + 1)
      }
    }
  }
  console.log(`\n## correctness with FULL coverage (same ${files.length}-file draw)`)
  console.log(`- first-supertype guesses: ${guesses}`)
  console.log(`- **resolvable: ${resolvable} (${((resolvable / guesses) * 100).toFixed(1)}%)** — was 71 (10.5%) with a draw-sized index`)
  console.log(`- **demonstrably wrong today: ${wrongToday} (${((wrongToday / guesses) * 100).toFixed(1)}%)** — the first supertype does not declare the method`)
  console.log(`- still unresolved at depth ${MAX_DEPTH}: ${guesses - resolvable}`)
  console.log(`- winning-ancestor depth: ${[...byDepth].sort((a, b) => a[0] - b[0]).map(([d, n]) => `d${d}=${n}`).join(" ")}`)
}
main().catch((e) => { console.error(e); process.exit(1) })