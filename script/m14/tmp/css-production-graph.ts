// Review instrument (NOT a gate): measure the graph a CSS user actually gets.
//
//   bun script/m14/tmp/css-production-graph.ts [--sample N] [--out <path>]
//
// Emits the BEFORE/AFTER artifact for the CSS lane's ontology wave. The sample
// is a seeded pick per lane, so a re-run at the same seed draws the SAME files —
// which is the only thing that makes a before/after a measurement rather than a
// story (the #859 SAMPLE DRIFT lesson, applied to this instrument up front).
//
// The analyzer path (ASTEngine.parseFile) and the PRODUCTION path
// (pool-worker.parseFile, which parallel-indexer actually calls) are not the
// same function. pool-worker applies filterNoiseRelationships, which for
// css/scss/sass keeps `contains` ONLY. So the honest question is not "what does
// the analyzer emit" but "of what survives to the store, how much resolves at
// both ends".
//
// Resolution rules are copied from parallel-indexer.ts's insert path
// (nameToSymbol exact, then leaf, then `endsWith(:name)` / `endsWith(.name)` /
// qualifiedName endsWith) so "resolves" here means the same thing it means at
// insert time. Disclosed: the store also carries an unresolved row as
// source_external/target_external, so a non-resolving edge is not LOST — it is
// stored and unjoinable. This instrument reports both numbers.

import { ASTEngine } from "../../../src/ast/engine"
import { readdirSync, statSync, readFileSync } from "fs"
import { join } from "path"

const ROOT = "<corpus-root>/bb_tests/repositories"
const argv = process.argv.slice(2)
const SAMPLE = Number(argv[argv.indexOf("--sample") + 1] || 40)

const LANES = ["svelte", "element-plus", "vue-core", "grails-core", "go-tools", "graphql-js", "mojo", "scala3", "zig", "cython", "cloogle.org", "cargo", "fsharp"]

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
function seededPick<T>(items: T[], seed: string): T[] {
  const out = items.slice(); let s = fnv1a(seed) || 1
  const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000 }
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = out[i]; out[i] = out[j]; out[j] = t }
  return out
}
function walk(dir: string, ext: string, out: string[], d = 0): void {
  if (d > 8) return
  let es: string[]; try { es = readdirSync(dir) } catch { return }
  for (const e of es) {
    if (e === "node_modules" || e === ".git" || e === "target" || e === "dist") continue
    const p = join(dir, e); let st: import("fs").Stats
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, ext, out, d + 1)
    else if (e.endsWith(ext) && st.size > 0) out.push(p)
  }
}

// pool-worker.ts:372 extractLeaf, verbatim.
const extractLeaf = (name: string): string => {
  const noLine = name.replace(/:\d+$/, "")
  const segs = noLine.split(":").filter((s) => s.length > 0)
  const last = segs[segs.length - 1] ?? ""
  const dots = last.split(".")
  return dots[dots.length - 1]
}

// pool-worker.ts:405 css branch, verbatim.
function survivesFilter(r: any): boolean {
  const target = r.target || r.targetId || r.to || r.toSymbol || ""
  if (!target) return true
  if (target.length > 200 || target.includes("\n")) return false
  const leaf = extractLeaf(target)
  if (leaf.length > 80 || leaf.length < 1) return false
  if (/[{}`<>\n\r\t]/.test(leaf)) return false
  if (leaf.startsWith(" ") || leaf.includes("  ")) return false
  return (r.type || r.relationshipType || "") === "contains"
}

function resolves(name: string, symbols: any[]): boolean {
  if (symbols.some((s) => s.name === name)) return true
  const leaf = extractLeaf(name)
  if (symbols.some((s) => s.name === leaf)) return true
  for (const s of symbols) {
    if (name.endsWith(`:${s.name}`)) return true
    if (name.endsWith(`.${s.name}`)) return true
    const q = s.qualifiedName || (s.scope ? `${s.scope}.${s.name}` : s.name)
    if (q && name === q) return true
    if (q && name.endsWith(`:${q}`)) return true
    if (q && q.endsWith(`.${leaf}`)) return true
  }
  return false
}

async function main() {
  await ASTEngine.init?.()
  const T = { files: 0, sym: 0, emitted: 0, kept: 0, bothEnds: 0, srcOk: 0, tgtOk: 0, selfEdges: 0, withLine: 0, complexityAllOne: 0, symTotal: 0 }
  const keptShapes: Record<string, number> = {}
  const unresShapes: Record<string, number> = {}
  const drawn: string[] = []

  for (const lane of LANES) {
    const files: string[] = []
    walk(join(ROOT, lane), ".css", files)
    files.sort()
    if (!files.length) continue
    for (const f of seededPick(files, `css-prod:${lane}`).slice(0, SAMPLE).sort()) {
      drawn.push(f)
      const content = readFileSync(f, "utf8")
      let res: any
      try { res = await ASTEngine.parseFile(f, content) } catch { continue }
      T.files++
      const syms = res.symbols ?? []
      T.sym += syms.length
      T.symTotal += syms.length
      for (const s of syms) {
        const c = s.complexity ?? s.metadata?.complexity
        if (c === undefined || c === 1) T.complexityAllOne++
      }
      for (const r of res.relationships ?? []) {
        T.emitted++
        if ((r.line_number ?? r.line) != null) T.withLine++
        if (!survivesFilter(r)) continue
        T.kept++
        const src = String(r.source ?? "unknown")
        const tgt = String(r.target ?? "unknown")
        if (src === tgt) T.selfEdges++
        const sOk = resolves(src, syms)
        const tOk = resolves(tgt, syms)
        if (sOk) T.srcOk++
        if (tOk) T.tgtOk++
        if (sOk && tOk) {
          T.bothEnds++
          const shape = `${tgt.startsWith("@") ? "@atrule" : tgt.startsWith(".") ? "dotted" : tgt.startsWith("#") ? "hashed" : tgt === "*" ? "universal" : "other"}`
          keptShapes[shape] = (keptShapes[shape] ?? 0) + 1
        } else {
          const missing = !sOk && !tOk ? "both" : !sOk ? "source" : "target"
          const key = `${missing}: ${src.length > 34 ? src.slice(0, 34) + "…" : src} -> ${tgt.length > 26 ? tgt.slice(0, 26) + "…" : tgt}`
          unresShapes[key] = (unresShapes[key] ?? 0) + 1
        }
      }
    }
  }

  const pct = (n: number, d: number) => (d === 0 ? "0.0" : ((n / d) * 100).toFixed(1))
  const out = {
    instrument: "css-production-graph",
    purpose:
      "What a CSS user actually gets: the analyzer path (ASTEngine.parseFile) and the PRODUCTION path (pool-worker.parseFile, which parallel-indexer actually calls) are not the same function. pool-worker applies filterNoiseRelationships, which for css/scss/sass keeps `contains` ONLY.",
    sampling: {
      rule: "seeded pick per lane (FNV-1a + seeded Fisher-Yates), sorted, first N",
      samplePerLane: SAMPLE,
      lanes: LANES,
      filesMeasured: T.files,
      fileList: drawn,
    },
    resolutionRules:
      "Copied from parallel-indexer.ts's insert path: nameToSymbol exact, then leaf, then endsWith(:name) / endsWith(.name) / qualifiedName equality and endsWith. Disclosed: the store also carries an unresolved row as source_external/target_external, so a non-resolving edge is not LOST — it is stored and unjoinable. Both numbers are reported.",
    filterRules:
      "Copied verbatim from src/ast/pool-worker.ts:372 extractLeaf and :380-409 filterNoiseRelationships (the css branch keeps `contains` only).",
    analyzerOutput: { symbols: T.sym, relationshipsEmitted: T.emitted, withLine: T.withLine, linePct: `${pct(T.withLine, T.emitted)}%` },
    productionFilter: { survived: T.kept, droppedByPoolWorker: T.emitted - T.kept, dropPct: `${pct(T.emitted - T.kept, T.emitted)}%` },
    storedGraph: {
      bothEndsResolve: T.bothEnds,
      pctOfStored: `${pct(T.bothEnds, T.kept)}%`,
      pctOfEmitted: `${pct(T.bothEnds, T.emitted)}%`,
      sourceResolves: `${pct(T.srcOk, T.kept)}%`,
      targetResolves: `${pct(T.tgtOk, T.kept)}%`,
      storedUnjoinable: T.kept - T.bothEnds,
      selfEdges: T.selfEdges,
    },
    complexity: { symbols: T.symTotal, withComplexityOneOrAbsent: T.complexityAllOne, pctVacuous: `${pct(T.complexityAllOne, T.symTotal)}%` },
    resolvableEdgeTargetShapes: keptShapes,
    topUnresolvableShapes: Object.entries(unresShapes).sort((a, b) => b[1] - a[1]).slice(0, 25),
  }
  const outPath = argv[argv.indexOf("--out") + 1]
  const text = JSON.stringify(out, null, 2)
  if (outPath && outPath !== "undefined") {
    const { writeFileSync } = await import("fs")
    writeFileSync(outPath, text + "\n")
    process.stderr.write(`wrote ${outPath}\n`)
  }
  console.log(text)
}
main().catch((e) => { console.error(e); process.exit(1) })
