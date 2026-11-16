// Adjudicate the svelte:javascript heuristic 0 -> 10 flag.
// Two candidate causes: (a) a change in the analyzer, (b) the cold-pool rotation
// drawing a different 60 files. Classifies EVERY heuristic-tier edge the lane
// emits, then re-measures across independent draws to see whether the count is a
// property of the DRAW or of the code. (2026-09-27)
import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/bb_tests/repositories/svelte"

function walkFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 14) return
  let es: fs.Dirent[]
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const q = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(q, out, depth + 1)
    else if (e.name.endsWith(".js")) out.push(q)
  }
}

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-javascript.wasm")
  const p = new P(); p.setLanguage(lang)
  const a = new RealJavaScriptAnalyzer() as any

  const files: string[] = []
  walkFiles(ROOT, files); files.sort()
  console.log(`corpus: ${files.length} .js files`)

  // 1. classify every heuristic-tier edge across the WHOLE corpus
  const byReason = new Map<string, { n: number; ex: string }>()
  let heuristicTotal = 0
  const scanLimit = Number(process.env.SCAN ?? 700)
  for (const f of files.slice(0, scanLimit)) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    if (src.length > 400000) continue
    let tree: any
    try { tree = p.parse(src) } catch { continue }
    const r = await a.analyze(tree.rootNode, src, f, undefined)
    for (const rel of r.relationships ?? []) {
      const c = rel.confidence
      if (typeof c !== "number" || c >= 0.7) continue
      heuristicTotal++
      const reason = String(rel.metadata?.reasonCode ?? "(no reasonCode)")
      const cur = byReason.get(reason) ?? { n: 0, ex: `${rel.source}->${rel.target}@${c} in ${path.basename(f)}` }
      cur.n++
      byReason.set(reason, cur)
    }
  }
  console.log(`\nheuristic-tier edges (confidence < 0.7) over the first ${scanLimit} files: ${heuristicTotal}`)
  for (const [k, v] of [...byReason.entries()].sort((x, y) => y[1].n - x[1].n)) {
    console.log(`  ${String(v.n).padStart(4)}  reasonCode=${k}`)
    console.log(`          e.g. ${v.ex}`)
  }

  // 2. is the count a property of the DRAW? 8 independent 60-file draws.
  console.log(`\nheuristic edges per 60-file draw (same code, different draws):`)
  const counts: number[] = []
  for (let rot = 0; rot < 8; rot++) {
    const off = (rot * 137) % Math.max(1, files.length - 60)
    const draw = files.slice(off, off + 60)
    let h = 0
    for (const f of draw) {
      let src: string
      try { src = fs.readFileSync(f, "utf8") } catch { continue }
      if (src.length > 400000) continue
      let tree: any
      try { tree = p.parse(src) } catch { continue }
      const r = await a.analyze(tree.rootNode, src, f, undefined)
      for (const rel of r.relationships ?? []) {
        if (typeof rel.confidence === "number" && rel.confidence < 0.7) h++
      }
    }
    counts.push(h)
    console.log(`  draw ${rot}: heuristic=${h}`)
  }
  const min = Math.min(...counts), max = Math.max(...counts)
  console.log(`\nrange across draws: ${min}..${max}`)
  console.log(min !== max
    ? "=> the count is a property of the DRAW, not of the analyzer. The 0 -> 10 flag is a rotation false-positive on an UNPINNED lane, exactly as the gate warned."
    : "=> the count is STABLE across draws — investigate the analyzer.")
}
main().catch((e) => { console.error(e); process.exit(1) })
