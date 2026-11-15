// CLJ-DEEP · INSTRUMENT 9 — PERF.
//
// WHY MEASURE IT. Every other instrument here asks a question about CORRECTNESS,
// and a slow analyzer gets a correctness exemption that nothing has written down:
// nobody claims a class is complete if the gate takes an hour. The two linear
// scans this analyzer carries — the order-aware shadow table (`isShadowedAt`) and
// the positional refer segments (`referAt`) — are both O(ranges) PER CALL SITE, and
// the core surface grew from 437 hand-typed names to 723 derived ones in this
// wave, which lengthens the constant every gate that consults it pays. So the cost
// is not a constant: it is a function of how much the lane learned.
//
// WHAT IT REPORTS. Wall time per file, the distribution rather than the mean (a
// mean over a corpus is one pathological file wearing a disguise), throughput in
// relationships per second, and the cost as a function of FILE SIZE, which is the
// only shape that says whether anything is super-linear. A quadratic in file size
// is invisible in a total and obvious in the buckets.
//
// AST only. No regex. Read-only: it times, it never edits.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const argOf = (f: string): string | undefined => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined }

function listFiles(repo: string): string[] {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!existsSync(dir)) return []
  let tracked: string[] = []
  try { tracked = execSync(`git -C ${JSON.stringify(dir)} ls-files`, { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean) } catch { tracked = [] }
  if (tracked.length === 0) {
    const walk = (d: string, acc: string[] = []): string[] => {
      for (const e of readdirSync(d)) {
        if (e === ".git" || e === "target" || e === "node_modules") continue
        const p = path.join(d, e); const st = statSync(p)
        if (st.isDirectory()) walk(p, acc); else if (/\.(clj|cljc|cljs)$/i.test(e)) acc.push(p)
      }
      return acc
    }
    return walk(dir).sort()
  }
  return tracked.filter(f => /\.(clj|cljc|cljs)$/i.test(f)).map(f => path.join(dir, f)).sort()
}

const pct = (xs: number[], p: number): number => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]! : 0)

async function main() {
  const repos = (argOf("--repos") ?? "clojure,clj-kondo,core.async").split(",")
  const outPath = argOf("--out") ?? "/tmp/opencode/clj-perf.json"
  const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const parser = await engine.ASTEngine.getParser("clojure")
  const mod: any = await import(path.join(ROOT, "src/ast/real-clojure-analyzer.ts"))

  const times: number[] = []
  const rows: any[] = []
  let totalSymbols = 0, totalRels = 0, files = 0, threw = 0, bytes = 0
  // SIZE BUCKETS — the only view that shows super-linearity.
  const buckets: Record<string, { files: number; ms: number; rels: number; bytes: number }> = {}
  const bucketOf = (n: number): string => (n < 2_000 ? "<2KB" : n < 10_000 ? "2-10KB" : n < 40_000 ? "10-40KB" : n < 120_000 ? "40-120KB" : ">=120KB")

  for (const repo of repos) {
    for (const file of listFiles(repo)) {
      let content: string
      try { content = readFileSync(file, "utf8") } catch { continue }
      if (content.length > 1_500_000) continue
      let root: any
      try { root = parser.parse(content).rootNode } catch { continue }
      files++; bytes += content.length
      const analyzer = new mod.RealClojureAnalyzer()
      const t0 = performance.now()
      let res: any
      try { res = analyzer.analyze(root, content, file) } catch { threw++; continue }
      const ms = performance.now() - t0
      const ns = (res.symbols ?? []).length
      const nr = (res.relationships ?? []).length
      totalSymbols += ns; totalRels += nr
      times.push(ms)
      rows.push({ repo, file: path.relative(CORPUS_ROOT, file), bytes: content.length, ms: +ms.toFixed(3), symbols: ns, rels: nr })
      const b = bucketOf(content.length)
      const bk = buckets[b] ??= { files: 0, ms: 0, rels: 0, bytes: 0 }
      bk.files++; bk.ms += ms; bk.rels += nr; bk.bytes += content.length
    }
  }

  const totalMs = times.reduce((a, b) => a + b, 0)
  const slowest = rows.slice().sort((a, b) => b.ms - a.ms).slice(0, 12)
  const byRel = rows.filter((r) => r.rels > 0).map((r) => r.ms / r.rels).sort((a, b) => a - b)
  writeFileSync(outPath, JSON.stringify({ repos, files, threw, bytes, totalSymbols, totalRels, totalMs: +totalMs.toFixed(1), times, rows, buckets, slowest }, null, 1))

  console.log(`files=${files} threw=${threw} bytes=${(bytes / 1e6).toFixed(1)}MB symbols=${totalSymbols} relationships=${totalRels}`)
  console.log(`total ${totalMs.toFixed(0)}ms   p50=${pct(times, 0.5).toFixed(2)}ms  p90=${pct(times, 0.9).toFixed(2)}ms  p99=${pct(times, 0.99).toFixed(2)}ms  max=${pct(times, 1).toFixed(1)}ms`)
  console.log(`throughput: ${(totalRels / (totalMs / 1000)).toFixed(0)} relationships/s · ${(bytes / 1e6 / (totalMs / 1000)).toFixed(2)} MB/s`)
  console.log(`ms per relationship: p50=${(byRel[Math.floor(byRel.length * 0.5)] ?? 0).toExponential(2)} p99=${(byRel[Math.floor(byRel.length * 0.99)] ?? 0).toExponential(2)}`)
  console.log("")
  console.log("COST BY FILE SIZE — super-linearity is invisible in a total")
  console.log("  bucket      files   totalMB     ms   ms/KB   rels/KB")
  const order = ["<2KB", "2-10KB", "10-40KB", "40-120KB", ">=120KB"]
  for (const b of order) {
    const v = buckets[b]
    if (!v) continue
    const kb = v.bytes / 1024
    console.log(`  ${b.padEnd(10)} ${String(v.files).padStart(6)} ${(v.bytes / 1e6).toFixed(1).padStart(9)} ${v.ms.toFixed(0).padStart(7)} ${(v.ms / kb).toFixed(2).padStart(8)} ${(v.rels / kb).toFixed(2).padStart(9)}`)
  }
  console.log("")
  console.log("SLOWEST FILES")
  for (const r of slowest) console.log(`  ${String(r.ms).padStart(8)}ms  ${String(r.rels).padStart(6)} rels  ${(r.bytes / 1024).toFixed(0).padStart(6)}KB  ${r.file}`)
  console.log(`\nwritten ${outPath}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
