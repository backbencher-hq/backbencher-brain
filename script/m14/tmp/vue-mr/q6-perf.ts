// Q6 — PERF. Where does a .vue file's time actually go, and does the vue
// analyzer's own work (as opposed to the seam + sub-analyzer) justify its cost?
import * as fs from "fs"
import * as path from "path"
import { loadAvg1 } from "./loadavg"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"

function filesUnder(root: string, exts: string[], limit: number): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    if (out.length >= limit) return
    let es: fs.Dirent[]
    try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of es) {
      if (out.length >= limit) return
      if (e.name === ".git" || e.name === "node_modules" || e.name === "dist") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}
async function timeIt(label: string, fn: () => Promise<any> | any, runs = 5) {
  for (let i = 0; i < 2; i++) await fn() // warmup
  let best = Number.POSITIVE_INFINITY
  let n = 0
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    await fn()
    const dt = performance.now() - t0
    if (dt < best) best = dt
    n++
  }
  console.log(`  ${label.padEnd(52)} ${best.toFixed(1)} ms  (min of ${runs})`)
  return best
}

async function main() {
  const { ASTEngine } = await import(path.join(process.cwd(), "src/ast/engine.ts"))
  const vueFiles = [...filesUnder(`${CORPUS}/element-plus`, [".vue"], 200), ...filesUnder(`${CORPUS}/vue-element-admin`, [".vue"], 131)]
  const srcs = vueFiles.map((f) => [f, fs.readFileSync(f, "utf8")] as const)
  console.log(`loadAvg1 at measure: ${loadAvg1().toFixed(2)}`)
  console.log(`files: ${srcs.length}`)

  console.log("\n=== Q6.1  end-to-end parseFile, .vue ===")
  const total = await timeIt("parseFile over all .vue", async () => {
    for (const [f, s] of srcs) await ASTEngine.parseFile(f, s)
  }, 3)
  console.log(`  per file: ${(total / srcs.length).toFixed(2)} ms`)

  // The same bodies as .ts — isolates the SFC seam's cost from the analyzer's.
  console.log("\n=== Q6.2  the same SCRIPT bodies measured as standalone .ts/.js ===")
  const bodies = srcs.map(([f, s]) => {
    const m = /<script[^>]*>([\s\S]*?)<\/script>/.exec(s)
    return [f.replace(/\.vue$/, ".ts"), m ? m[1] : ""] as const
  }).filter(([, b]) => b.trim().length > 0)
  const tsTotal = await timeIt(`parseFile over the extracted bodies (.ts)  n=${bodies.length}`, async () => {
    for (const [f, s] of bodies) await ASTEngine.parseFile(f, s)
  }, 3)
  console.log(`  per body: ${(tsTotal / bodies.length).toFixed(2)} ms`)
  console.log(`  → the SFC seam + vue analyzer cost on top of the script parse: ${(((total / srcs.length) - (tsTotal / bodies.length))).toFixed(2)} ms/file`)

  console.log("\n=== Q6.3  cost by file SIZE (is it linear in input?) ===")
  const buckets: Array<[string, number, number]> = [["<500B", 0, 500], ["500B-1KB", 500, 1024], ["1-5KB", 1024, 5120], ["5-20KB", 5120, 20480], [">20KB", 20480, 1 << 30]]
  for (const [label, lo, hi] of buckets) {
    const set = srcs.filter(([, s]) => s.length >= lo && s.length < hi)
    if (!set.length) { console.log(`  ${label.padEnd(52)} (no files)`); continue }
    const t = await timeIt(`${label}  n=${set.length}`, async () => {
      for (const [f, s] of set) await ASTEngine.parseFile(f, s)
    }, 3)
    console.log(`  ${"".padEnd(52)}   ${(t / set.length).toFixed(2)} ms/file`)
  }

  console.log("\n=== Q6.4  the analyzer's own work, measured INSIDE the production path ===")
  // Rather than hand-building a context (whose trees web-tree-sitter frees out from
  // under you), wrap the analyzer's own analyze() and time only that call. Same
  // code, same trees, same context — the subtraction is the engine's own cost.
  const mod: any = await import(path.join(process.cwd(), "src/ast/real-vue-analyzer.ts"))
  const proto = mod.RealVueAnalyzer.prototype
  const orig = proto.analyze
  let analyzeMs = 0
  let n = 0
  proto.analyze = function (...args: any[]) {
    const t0 = performance.now()
    try { return orig.apply(this, args) } finally { analyzeMs += performance.now() - t0; n++ }
  }
  const sample = srcs.slice(0, 120)
  const tP = await timeIt(`parseFile over ${sample.length} .vue (analyze() timed inside)`, async () => {
    analyzeMs = 0; n = 0
    for (const [f, s] of sample) await ASTEngine.parseFile(f, s)
  }, 3)
  console.log(`  full path:   ${(tP / sample.length).toFixed(2)} ms/file`)
  console.log(`  analyze():   ${(analyzeMs / sample.length).toFixed(2)} ms/file  (${((analyzeMs / tP) * 100).toFixed(1)}% of the path)`)
  console.log(`  grammar+engine: ${(((tP - analyzeMs) / sample.length)).toFixed(2)} ms/file`)
  console.log("\n=== Q6.5  the sub-analyzer share of analyze() (delegated script work) ===")
  const jm: any = await import(path.join(process.cwd(), "src/ast/real-javascript-analyzer.ts"))
  const tm: any = await import(path.join(process.cwd(), "src/ast/real-typescript-analyzer.ts"))
  let subMs = 0, subN = 0
  for (const [m, label] of [[jm, "js"], [tm, "ts"]] as const) {
    const p2 = m.RealJavaScriptAnalyzer?.prototype ?? m.RealTypeScriptAnalyzer?.prototype
    if (!p2) continue
    const o2 = p2.analyze
    p2.analyze = function (...args: any[]) {
      const t0 = performance.now()
      try { return o2.apply(this, args) } finally { subMs += performance.now() - t0; subN++; }
    }
  }
  analyzeMs = 0
  await timeIt(`parseFile over ${sample.length} .vue (both halves timed)`, async () => {
    analyzeMs = 0; subMs = 0; subN = 0
    for (const [f, s] of sample) await ASTEngine.parseFile(f, s)
  }, 3)
  console.log(`  vue analyze(): ${(analyzeMs / sample.length).toFixed(2)} ms/file`)
  console.log(`  sub-analyzer:  ${(subMs / sample.length).toFixed(2)} ms/file over ${subN} delegation(s) — ${((subMs / Math.max(analyzeMs, 1e-9)) * 100).toFixed(1)}% of vue analyze()`)
  console.log(`  vue's OWN work: ${((analyzeMs - subMs) / sample.length).toFixed(2)} ms/file`)
  proto.analyze = orig

  console.log("\n=== Q6.6  LOAD-STABILITY: is the cost real work or a busy scheduler? ===")
  const { execSync } = await import("child_process")
  const burn = () => { let x = 0; for (let i = 0; i < 4e7; i++) x += i % 7; return x }
  for (const when of ["now", "after a 20ms pure-CPU burn"]) {
    const l0 = loadAvg1()
    if (when !== "now") { const t0 = performance.now(); while (performance.now() - t0 < 20) burn() }
    const t0 = performance.now(); const v = burn(); const dt = performance.now() - t0
    console.log(`  loadAvg1=${l0.toFixed(2)}  20ms-class burn measured ${dt.toFixed(1)} ms (${when})  [sink=${v % 3}]`)
  }
  console.log(`  → scheduler inflation factor at this load: ~${(loadAvg1() > 0 ? "see above" : "0")}`)
}
main()
