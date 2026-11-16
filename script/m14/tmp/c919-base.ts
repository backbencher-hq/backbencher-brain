// #919: the SAME comparison (lane semantics: label + normalized target,
// duplicate-collapsed analyzer edges) run twice on the affected files —
// baseline (HEAD analyzer + HEAD oracle) and after (this change's analyzer +
// mirrored oracle) — so the class's effect on MISSING/unexplained is measured
// rather than argued. Raw `analyze()` on both sides (parseFile post-processing
// is not part of this comparison; symmetry is what matters here).
//   bun script/m14/tmp/c919-base.ts
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS = "<corpus-root>/bb_tests/repositories"
const { RealCppAnalyzer, macroDeclaredBody } = await import(path.join(ROOT, "src", "ast", "real-cpp-analyzer.ts"))
const { RealCppAnalyzer: BaseAnalyzer } = await import(path.join(ROOT, "src", "ast", "cpp-baseline-analyzer.ts"))
const after = await import(path.join(ROOT, "script", "m14", "differential.ts"))
const base = await import(path.join(ROOT, "script", "m14", "cpp-baseline-differential.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)

const lastSegment = (t: string) => { const p = String(t).split(/::|\./); return p[p.length - 1] || String(t) }
const norm = (t: string) => lastSegment(t.replace(/<.*$/, "").replace(/\[.*$/, "").trim())
const pairs = (rels: any[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of rels) {
    const label = String(r.type)
    if (label !== "calls" && label !== "uses") continue
    const k = `${label}|${norm(String(r.target))}`
    if (!seen.has(k)) { seen.add(k); out.push(k) }
  }
  return out
}
const truthPairs = (edges: any[]): string[] => {
  const out = new Set<string>()
  for (const e of edges) out.add(`${e.label}|${norm(e.target)}`)
  return [...out]
}
const compare = (truth: string[], an: string[]) => {
  let missing = 0, unexplained = 0
  const mS: string[] = [], uS: string[] = []
  for (const t of truth) {
    if (!an.includes(t)) { missing++; if (mS.length < 6) mS.push(t) }
  }
  for (const a of an) {
    const i = a.indexOf("|")
    const label = a.slice(0, i), target = a.slice(i + 1)
    const hit = truth.some((t) => { const j = t.indexOf("|"); return t.slice(0, j) === label && (norm(t.slice(j + 1)) === target || t.slice(j + 1).includes(target)) })
    if (!hit) { unexplained++; if (uS.length < 6) uS.push(a) }
  }
  return { missing, unexplained, mS, uS }
}

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

const a1 = new RealCppAnalyzer(); const b1 = new BaseAnalyzer()
let nFiles = 0, nBodies = 0
const tot = { bm: 0, bu: 0, am: 0, au: 0 }
const bmS: string[] = [], buS: string[] = [], amS: string[] = [], auS: string[] = []
for (const f of files) {
  let src: string
  try { src = readFileSync(f, "utf8") } catch { continue }
  const root = parser.parse(src).rootNode
  let bodies = 0
  const st: any[] = [root]
  while (st.length) { const n = st.pop()!; if (macroDeclaredBody(n)) bodies++; for (let i = 0; i < n.childCount; i++) st.push(n.child(i)) }
  if (bodies === 0) continue
  nFiles++; nBodies += bodies
  const rel = path.relative(CORPUS, f)
  const afterRes: any = a1.analyze(root, src, f)
  const baseRes: any = b1.analyze(root, src, f)
  const cb = compare(truthPairs([...base.deriveCppEdges(root), ...base.deriveCppBareUses(root)]), pairs(baseRes.relationships ?? []))
  const ca = compare(truthPairs([...after.deriveCppEdges(root), ...after.deriveCppBareUses(root)]), pairs(afterRes.relationships ?? []))
  tot.bm += cb.missing; tot.bu += cb.unexplained; tot.am += ca.missing; tot.au += ca.unexplained
  for (const x of cb.mS) bmS.push(`${rel} ${x}`)
  for (const x of cb.uS) buS.push(`${rel} ${x}`)
  for (const x of ca.mS) amS.push(`${rel} ${x}`)
  for (const x of ca.uS) auS.push(`${rel} ${x}`)
  if (cb.missing || cb.unexplained || ca.missing || ca.unexplained) {
    console.log(`  ${rel}: bodies=${bodies} baseline(M=${cb.missing},U=${cb.unexplained}) after(M=${ca.missing},U=${ca.unexplained})`)
  }
}
console.log(`\nfiles with recovered bodies: ${nFiles} (bodies=${nBodies})`)
console.log(`BASELINE  MISSING=${tot.bm} unexplained=${tot.bu}`)
console.log(`AFTER     MISSING=${tot.am} unexplained=${tot.au}`)
console.log(`\nbaseline MISSING: ${bmS.slice(0, 8).join(" | ")}`)
console.log(`after    MISSING: ${amS.slice(0, 8).join(" | ")}`)
console.log(`baseline UNEXPLAINED: ${buS.slice(0, 8).join(" | ")}`)
console.log(`after    UNEXPLAINED: ${auS.slice(0, 8).join(" | ")}`)
