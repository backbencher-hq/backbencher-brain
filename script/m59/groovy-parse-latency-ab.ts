// Latency A/B for two groovy grammar builds: parse every file in a list with
// each wasm and report the worst per-file ratios. A grammar change that fixes
// files but multiplies parse time is a production regression — the corpus
// census wall-time is the first sign, this is where the cause is named.
//
// Usage: bun script/m14/tmp/g841-parse-latency-ab.ts <filelist> [--top N]
import * as fs from "node:fs"

const BASE = "/tmp/groovy-baseline.wasm"
const NEW = "/tmp/v1b-groovy.wasm"
const REPO = "$HOME/fixtures/repositories/grails-core"

async function main(): Promise<void> {
  const list = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean)
  const top = process.argv.includes("--top") ? parseInt(process.argv[process.argv.indexOf("--top") + 1]) : 15
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const pB = new P(); pB.setLanguage(await L.load(fs.readFileSync(BASE)))
  const pN = new P(); pN.setLanguage(await L.load(fs.readFileSync(NEW)))
  const rows: Array<{ f: string; b: number; n: number }> = []
  let sumB = 0, sumN = 0
  for (const f of list) {
    let src: string
    try { src = fs.readFileSync(`${REPO}/${f}`, "utf8") } catch { continue }
    // warm the parser on the other input first so neither side gets the cold path
    const t0 = performance.now(); pB.parse(src); const tb = performance.now() - t0
    const t1 = performance.now(); pN.parse(src); const tn = performance.now() - t1
    sumB += tb; sumN += tn
    rows.push({ f, b: tb, n: tn })
  }
  console.log(`files=${rows.length}  total base=${sumB.toFixed(0)}ms  new=${sumN.toFixed(0)}ms  ratio=${(sumN / Math.max(1, sumB)).toFixed(2)}x`)
  const slow = rows.filter((r) => r.n > Math.max(40, r.b * 3)).sort((a, b) => b.n - b.b - (a.n - a.b))
  console.log(`files slower than 3x (and >40ms) under the new build: ${slow.length}`)
  for (const r of slow.slice(0, top)) console.log(`  ${r.b.toFixed(1)}ms -> ${r.n.toFixed(1)}ms  ${(r.n / Math.max(0.01, r.b)).toFixed(1)}x  ${r.f}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
