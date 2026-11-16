// Review instrument (NOT a gate): resolve EVERY relationship class the CSS
// analyzer emits, and report resolution per CLASS rather than in aggregate.
//
//   bun script/m14/tmp/css-ontology-census.ts [--out <path>]
//
// Why per class. The aggregate finding is "30.1% of stored edges resolve at both
// ends", which is true and useless for deciding anything: it mixes classes with
// opposite characters. The selector→property `uses` edge is 100% unresolvable
// because a CSS property name is not a graph node, while the `var(--x)` edge is
// 100% resolvable because `--x` IS one. A ruling needs the class table.
//
// Both entry points are measured, because they are different questions:
//   engine      — ASTEngine.parseFile: the analyzer's output
//   production  — pool-worker.parseFile: what parallel-indexer actually stores
//
// "resolvable" is computed with the SAME rules parallel-indexer uses to bind a
// relationship to a symbol at insert time (exact name, leaf, `endsWith(:name)`,
// `endsWith(.name)`, qualifiedName), so a row here means what a row there means.

import { ASTEngine } from "../../../src/ast/engine"
import { parseFile as productionParseFile } from "../../../src/ast/pool-worker"
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs"
import { join } from "path"

const ROOT = "<corpus-root>/bb_tests/repositories"
const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined
const REPOS = ["svelte", "grails-core", "scala3", "cython", "go-tools", "mojo", "zig", "cloogle.org", "element-plus", "vue-core", "cargo", "fsharp", "graphql-js"]

function walk(dir: string, out: string[], d = 0): void {
  if (d > 10) return
  let es: string[]
  try { es = readdirSync(dir) } catch { return }
  for (const e of es) {
    if (e === "node_modules" || e === ".git" || e === "target" || e === "dist") continue
    const p = join(dir, e)
    let st: import("fs").Stats
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out, d + 1)
    else if (e.endsWith(".css") && st.size > 0) out.push(p)
  }
}

const leaf = (name: string): string => {
  const noLine = name.replace(/:\d+$/, "")
  const segs = noLine.split(":").filter((s) => s.length > 0)
  const last = segs[segs.length - 1] ?? ""
  const dots = last.split(".")
  return dots[dots.length - 1]
}

function resolves(name: string, syms: { name: string; scope?: string }[]): boolean {
  if (!name) return false
  if (syms.some((s) => s.name === name)) return true
  const l = leaf(name)
  if (syms.some((s) => s.name === l)) return true
  for (const s of syms) {
    if (name.endsWith(`:${s.name}`)) return true
    if (name.endsWith(`.${s.name}`)) return true
    const q = s.scope ? `${s.scope}.${s.name}` : s.name
    if (q && name === q) return true
    if (q && name.endsWith(`:${q}`)) return true
    if (q && q.endsWith(`.${l}`)) return true
  }
  return false
}

/** pool-worker's css branch, verbatim: keeps `contains` only. */
const survivesProduction = (r: any): boolean => (r.type ?? r.relationshipType ?? "") === "contains"

type Row = { total: number; bothEnds: number; srcOnly: number; tgtOnly: number; neither: number; sampleNames: Set<string> }

function classify(rows: Map<string, Row>, type: string, src: string, tgt: string, syms: { name: string; scope?: string }[]): void {
  const key = type
  let row = rows.get(key)
  if (!row) { row = { total: 0, bothEnds: 0, srcOnly: 0, tgtOnly: 0, neither: 0, sampleNames: new Set() }; rows.set(key, row) }
  const sOk = resolves(src, syms)
  const tOk = resolves(tgt, syms)
  row.total++
  if (sOk && tOk) { row.bothEnds++; if (row.sampleNames.size < 6) row.sampleNames.add(`${src} -> ${tgt}`) }
  else if (sOk) row.srcOnly++
  else if (tOk) row.tgtOnly++
  else row.neither++
}

async function main() {
  await ASTEngine.init?.()
  const files: string[] = []
  for (const r of REPOS) walk(join(ROOT, r), files)
  files.sort()

  const engineRows = new Map<string, Row>()
  const prodRows = new Map<string, Row>()
  const dropped: Record<string, number> = {}
  let engTotal = 0, engBoth = 0, prodTotal = 0, prodBoth = 0

  for (const f of files) {
    const content = readFileSync(f, "utf8")
    let e: any, p: any
    try { e = await ASTEngine.parseFile(f, content) } catch { continue }
    try { p = await productionParseFile(f) } catch { /* engine row still valid */ }
    const syms = (e?.symbols ?? []).map((s: any) => ({ name: s.name, scope: s.scope }))

    for (const r of e?.relationships ?? []) {
      engTotal++
      const before = engineRows.get(r.type)?.bothEnds ?? 0
      classify(engineRows, r.type, String(r.source ?? ""), String(r.target ?? ""), syms)
      engBoth += engineRows.get(r.type)!.bothEnds - before
      if (!survivesProduction(r)) dropped[r.type] = (dropped[r.type] ?? 0) + 1
    }
    if (p) {
      for (const r of p.relationships ?? []) {
        prodTotal++
        const before = prodRows.get(r.type)?.bothEnds ?? 0
        classify(prodRows, r.type, String(r.source ?? ""), String(r.target ?? ""), syms)
        prodBoth += prodRows.get(r.type)!.bothEnds - before
      }
    }
  }

  const table = (rows: Map<string, Row>) =>
    [...rows.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([type, r]) => ({
        type,
        total: r.total,
        resolvesBothEnds: r.bothEnds,
        pctBothEnds: +((r.bothEnds / Math.max(1, r.total)) * 100).toFixed(1),
        sourceOnly: r.srcOnly,
        targetOnly: r.tgtOnly,
        neitherEnd: r.neither,
        sampleResolvable: [...r.sampleNames],
      }))

  const artifact = {
    instrument: "css-ontology-census",
    purpose:
      "Per-CLASS resolvability for every relationship the CSS analyzer emits, measured on both entry points. An aggregate rate mixes classes with opposite characters and cannot decide a ruling: the selector→property `uses` edge is unresolvable because a CSS property name is not a graph node, while the var() edge is resolvable because the custom property IS one.",
    resolutionRules: "parallel-indexer's own insert-time binding rules (exact name, leaf, endsWith(:name), endsWith(.name), qualifiedName).",
    productionFilter: "pool-worker.ts filterNoiseRelationships, css branch: keeps `contains` only.",
    corpora: REPOS,
    filesMeasured: files.length,
    enginePath: { total: engTotal, resolvesBothEnds: engBoth, pct: +((engBoth / Math.max(1, engTotal)) * 100).toFixed(1), byClass: table(engineRows) },
    productionPath: { total: prodTotal, resolvesBothEnds: prodBoth, pct: +((prodBoth / Math.max(1, prodTotal)) * 100).toFixed(1), byClass: table(prodRows) },
    droppedByProductionFilter: dropped,
  }
  const text = JSON.stringify(artifact, null, 2)
  if (OUT && OUT !== "undefined") { writeFileSync(OUT, text + "\n"); process.stderr.write(`wrote ${OUT}\n`) }
  console.log(text)
}
main().catch((e) => { console.error(e); process.exit(1) })
