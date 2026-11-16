// #919: truth-vs-analyzer on the files that carry recovered macro bodies — the
// lane's own comparison (label + normalized target, duplicate-collapsed
// analyzer edges), run where the 17-file lane sample does not reach. The point
// is the #916 test: does the oracle's mirror keep MISSING/unexplained at zero
// on the files the analyzer's recovery actually changes?
//   bun script/m14/tmp/c919-truth.ts [only-affected|all]
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS = "<corpus-root>/bb_tests/repositories"
const MODE = process.argv[2] ?? "only-affected"
const { deriveCppEdges, deriveCppBareUses } = await import(path.join(ROOT, "script", "m14", "differential.ts"))
const { macroDeclaredBody } = await import(path.join(ROOT, "src", "ast", "real-cpp-analyzer.ts"))
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)

const lastSegment = (t: string) => {
  const parts = String(t).split(/::|\./)
  return parts[parts.length - 1] || String(t)
}
const normTarget = (t: string) => lastSegment(t.replace(/<.*$/, "").replace(/\[.*$/, "").trim())

const files: string[] = []
for (const repo of ["fmt", "nlohmann-json"]) {
  const collect = (dir: string) => {
    let entries: any[] = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) collect(p)
      else if (/\.(cpp|cc|cxx|hpp|hh|h)$/.test(e.name)) files.push(p)
    }
  }
  collect(path.join(CORPUS, repo))
}

let checked = 0
let sitesTotal = 0
let truthTotal = 0
let covered = 0
let missing = 0
let analyzerTotal = 0
let unexplained = 0
const missingSamples: string[] = []
const unexplainedSamples: string[] = []
for (const f of files) {
  let src: string
  try { src = readFileSync(f, "utf8") } catch { continue }
  const root = parser.parse(src).rootNode
  let sites = 0
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()!
    if (macroDeclaredBody(n)) sites++
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  }
  if (MODE === "only-affected" && sites === 0) continue
  sitesTotal += sites
  const rel = path.relative(CORPUS, f)
  let res: any
  try { res = await parseFile(f, src, { language: "cpp" }) } catch (e: any) { console.log(`  ! ${rel}: ${e?.message}`); continue }
  checked++
  const truthPairs = new Set<string>()
  for (const e of [...deriveCppEdges(root), ...deriveCppBareUses(root)]) truthPairs.add(`${e.label}|${normTarget(e.target)}`)
  const seen = new Set<string>()
  const analyzerPairs: string[] = []
  for (const r of (res.relationships ?? [])) {
    const label = String(r.type)
    if (label !== "calls" && label !== "uses") continue
    const k = `${label}|${normTarget(String(r.target))}`
    if (seen.has(k)) continue
    seen.add(k)
    analyzerPairs.push(k)
  }
  truthTotal += truthPairs.size
  analyzerTotal += analyzerPairs.length
  for (const t of truthPairs) {
    if (analyzerPairs.includes(t)) covered++
    else { missing++; if (missingSamples.length < 12) missingSamples.push(`${rel}  ${t}`) }
  }
  for (const a of analyzerPairs) {
    const [label, target] = a.split("|")
    const hit = [...truthPairs].some((t) => {
      const i = t.indexOf("|")
      return t.slice(0, i) === label && (normTarget(t.slice(i + 1)) === target || t.slice(i + 1).includes(target))
    })
    if (!hit) { unexplained++; if (unexplainedSamples.length < 12) unexplainedSamples.push(`${rel}  ${a}`) }
  }
  if (sites > 0) console.log(`  ${rel}: bodies=${sites} truth=${truthPairs.size} analyzer=${analyzerPairs.length}`)
}
console.log(`\nfiles=${checked} recovered bodies=${sitesTotal}`)
console.log(`truth pairs=${truthTotal} covered=${covered} MISSING=${missing}`)
console.log(`analyzer pairs=${analyzerTotal} unexplained=${unexplained}`)
if (missingSamples.length) { console.log("\nMISSING samples:"); for (const s of missingSamples) console.log("  " + s) }
if (unexplainedSamples.length) { console.log("\nUNEXPLAINED samples:"); for (const s of unexplainedSamples) console.log("  " + s) }
