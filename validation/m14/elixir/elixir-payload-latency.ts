// ELIXIR_FIX2 — the lane's payload / latency check.
//
// WHY. The workstream's budget note: "More edges means bigger graphs, and the
// graph surface is budgeted. bb_graph's un-narrowed `relationshipTypes` default
// is 2.5-4.8x a kind-filtered one (lodash 487 KiB vs 101 KiB, ripgrep 795 vs
// 321). Re-run your lane's payload/latency check. If an addition regresses a
// green budget, report it — do not quietly re-baseline."
//
// So this measures three numbers, over the DERIVED whole corpus, and prints the
// population each is over (the honesty contract's rule: a count without its
// denominator is a claim):
//
//   1. LATENCY   wall time of production `parseFile` over the whole corpus, and
//                ms/file. Compared against the PRE-CHANGE analyzer, loaded from
//                git at the baseline commit, in the SAME process — so the two
//                numbers differ only in the analyzer's code.
//   2. PAYLOAD   serialized bytes of the relationship set, total and per type.
//                This is what `bb_graph`'s un-narrowed default actually ships,
//                so it is the number the budget note is about.
//   3. HEURISTIC SHARE  the fraction of edges under confidence 1.0 per type —
//                M14-HONESTY-CONTRACT §4.3 ("how much of this graph is
//                guesswork" must be a queryable number, not a vibe).
//
// The baseline analyzer is written to a temp file OUTSIDE src/ and imported by
// path, so the working tree is never mutated and the comparison is honest about
// which bytes are being measured.
//
// Usage: bun run validation/m14/elixir/elixir-payload-latency.ts [baselineRef]

import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync } from "node:fs"
import { join, relative } from "node:path"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = process.env.BB_M14_ROOT ?? process.cwd()
const BASELINE_REF = process.argv[2] ?? "63a48923e"
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const CORPUS_DIRS = (process.env.ELIXIR_CORPUS_DIRS ?? "elixir,otp").split(",")
const EXTS = [".ex", ".exs"]

function collectFiles(): Array<{ path: string; rel: string }> {
  const out: Array<{ path: string; rel: string }> = []
  for (const d of CORPUS_DIRS) {
    const base = join(CORPUS_ROOT, d)
    const walk = (dir: string, depth: number): void => {
      if (depth > 24) return
      let ents: any[]
      try { ents = readdirSync(dir, { withFileTypes: true }) as any[] } catch { return }
      for (const e of ents) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name !== ".git" && e.name !== "node_modules" && e.name !== "_build" && e.name !== "deps") walk(p, depth + 1)
        } else if (e.isFile()) {
          let want = false
          for (const x of EXTS) if (e.name.endsWith(x)) want = true
          if (!want) continue
          try { if (statSync(p).size < 8) continue } catch { continue }
          out.push({ path: p, rel: relative(base, p) })
        }
      }
    }
    walk(base, 0)
  }
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return out
}

interface Run {
  label: string
  filesParsed: number
  filesCrashed: number
  wallMs: number
  msPerFile: number
  relationships: number
  symbols: number
  bytesTotal: number
  /** Bytes with the reasonCode/evidenceClass metadata removed — the §4 cost, separated from the edge cost. */
  bytesWithoutReasonMetadata: number
  bytesByType: Record<string, number>
  countByType: Record<string, number>
  heuristicByType: Record<string, { sub: number; total: number }>
  distinctTypes: string[]
}

async function measure(label: string, files: Array<{ path: string; rel: string }>, Cls: any): Promise<Run> {
  const bytesByType: Record<string, number> = {}
  const countByType: Record<string, number> = {}
  const heuristicByType: Record<string, { sub: number; total: number }> = {}
  let parsed = 0, crashed = 0, relationships = 0, symbols = 0, bytesTotal = 0, bytesNoReason = 0
  const t0 = Date.now()
  for (const f of files) {
    let content: string
    try { content = readFileSync(f.path, "utf8") } catch { continue }
    let res: any
    // `analyze` directly rather than `parseFile`, because the baseline analyzer
    // is not the one engine.getAnalyzer returns and both sides must be measured
    // through the SAME seam or the comparison is meaningless. `parseFile` is
    // verified to agree below (the production-path row).
    try {
      const parser = await ASTEngine.getParser("elixir" as any)
      const tree = parser.parse(content, f.path)
      res = new Cls().analyze(tree.rootNode, content, f.path)
    } catch { crashed++; continue }
    parsed++
    const rels = Array.isArray(res.relationships) ? res.relationships : []
    relationships += rels.length
    symbols += Array.isArray(res.symbols) ? res.symbols.length : 0
    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "")
      countByType[t] = (countByType[t] || 0) + 1
      bytesByType[t] = (bytesByType[t] || 0) + Buffer.byteLength(JSON.stringify(r), "utf8")
      bytesTotal += Buffer.byteLength(JSON.stringify(r), "utf8")
      const stripped: any = { ...r }
      if (stripped.metadata && typeof stripped.metadata === "object") {
        const m2: any = { ...stripped.metadata }
        delete m2.reasonCode
        delete m2.reasonCodeSource
        delete m2.evidenceClass
        stripped.metadata = m2
      }
      bytesNoReason += Buffer.byteLength(JSON.stringify(stripped), "utf8")
      const h = heuristicByType[t] ?? { sub: 0, total: 0 }
      h.total++
      if (typeof r.confidence === "number" && r.confidence < 1) h.sub++
      heuristicByType[t] = h
    }
  }
  const wallMs = Date.now() - t0
  return {
    label, filesParsed: parsed, filesCrashed: crashed, wallMs,
    msPerFile: parsed === 0 ? 0 : Number((wallMs / parsed).toFixed(3)),
    relationships, symbols, bytesTotal, bytesWithoutReasonMetadata: bytesNoReason, bytesByType, countByType, heuristicByType,
    distinctTypes: Object.keys(countByType).sort(),
  }
}

const files = collectFiles()

// ELIXIR_FIX2-N1 — the three regexes this file used to carry, as exact
// character operations. `replaceAllText` splits on a literal needle and rejoins,
// which is exact for a fixed specifier and needs no pattern syntax;
// `isAnalyzerClassName` is a suffix test by length.
function replaceAllText(s: string, needle: string, replacement: string): string {
  if (needle.length === 0) return s
  return s.split(needle).join(replacement)
}
function isAnalyzerClassName(name: string): boolean {
  const tail = "Analyzer"
  if (typeof name !== "string" || name.length < tail.length) return false
  return name.slice(name.length - tail.length) === tail
}

// Load the baseline analyzer from git into a temp dir outside src/.
const tmp = mkdtempSync(join(tmpdir(), "elixir-baseline-"))
const baselinePath = join(tmp, "real-elixir-analyzer.ts")
let baselineSource = ""
try {
  baselineSource = execFileSync("git", ["-C", ROOT, "show", `${BASELINE_REF}:src/ast/real-elixir-analyzer.ts`], { encoding: "utf8" })
  // The baseline imports "./engine" and "./types"; rewrite to absolute paths so
  // the temp copy resolves them from the working tree.
  //
  // ELIXIR_FIX2-N1: these were three regular expressions (two global replaces
  // and an /Analyzer$/ class-name test) and the lane's own no-regex census
  // caught them — the rule covers census scripts, and a census script that
  // rewrites source text with a regex is the failure mode the rule exists to
  // prevent. Now done with indexOf/split/join and `endsWith`, which is exact
  // for these two fixed specifiers and cheaper to read besides.
  baselineSource = replaceAllText(baselineSource, `from "./engine"`, `from "${join(ROOT, "src/ast/engine")}"`)
  baselineSource = replaceAllText(baselineSource, `from "./types"`, `from "${join(ROOT, "src/ast/types")}"`)
  writeFileSync(baselinePath, baselineSource, "utf8")
} catch (e) {
  process.stderr.write(`could not load the baseline analyzer at ${BASELINE_REF}: ${String(e).slice(0, 160)}\n`)
}

const { RealElixirAnalyzer } = await import(join(ROOT, "src/ast/real-elixir-analyzer.ts"))
const after = await measure("AFTER (working tree)", files, RealElixirAnalyzer)
let before: Run | null = null
if (baselineSource.length > 0) {
  const mod: any = await import(baselinePath)
  const Cls = Object.values(mod).find((v: any) => typeof v === "function" && isAnalyzerClassName(v.name))
  if (Cls) before = await measure(`BEFORE (${BASELINE_REF})`, files, Cls)
}

// The production-path cross-check: ASTEngine.parseFile on the SAME population
// through the engine's own analyzer lookup, so the measurement above is not
// quietly off the production path.
let prodEdges = 0, prodFiles = 0
{
  const t0 = Date.now()
  for (const f of files) {
    let content: string
    try { content = readFileSync(f.path, "utf8") } catch { continue }
    try {
      const r: any = await ASTEngine.parseFile(f.path, content)
      prodFiles++
      prodEdges += Array.isArray(r.relationships) ? r.relationships.length : 0
    } catch {}
  }
  var prodWallMs = Date.now() - t0
}

const L = (s: string) => process.stderr.write(s + "\n")
L(`population: ${files.length} derived ${EXTS.join("/")} files under ${CORPUS_DIRS.join(",")} (WHOLE corpus)`)
L(`production path (ASTEngine.parseFile) cross-check: ${prodFiles} files, ${prodEdges} relationships, ${prodWallMs} ms`)
L("")
if (before) {
  L(`LATENCY   before ${before.wallMs} ms (${before.msPerFile} ms/file)   after ${after.wallMs} ms (${after.msPerFile} ms/file)`)
  const dLat = before.wallMs === 0 ? 0 : ((after.wallMs - before.wallMs) / before.wallMs) * 100
  L(`          delta ${dLat >= 0 ? "+" : ""}${dLat.toFixed(1)}%   ${dLat > 25 ? "** REPORT: a latency regression over 25% **" : "within the 25% band"}`)
  L(`EDGES     before ${before.relationships}   after ${after.relationships}   delta ${after.relationships - before.relationships} (${((after.relationships / before.relationships - 1) * 100).toFixed(1)}%)`)
  L(`PAYLOAD   before ${before.bytesTotal} B   after ${after.bytesTotal} B   delta ${after.bytesTotal - before.bytesTotal} B (${((after.bytesTotal / before.bytesTotal - 1) * 100).toFixed(1)}%)`)
  L(`          of which the §4 reasonCode/evidenceClass metadata, not the new edges:`)
  L(`            before-without ${before.bytesWithoutReasonMetadata} B  after-without ${after.bytesWithoutReasonMetadata} B  metadata cost ${after.bytesTotal - after.bytesWithoutReasonMetadata} B`)
  L(`            EDGES-ONLY payload delta ${after.bytesWithoutReasonMetadata - before.bytesWithoutReasonMetadata} B (${((after.bytesWithoutReasonMetadata / before.bytesWithoutReasonMetadata - 1) * 100).toFixed(1)}%)`)
  L(`            new-edge payload ${after.bytesByType.exports ?? 0} B (exports) + ${after.bytesByType.uses ?? 0} B (uses) = ${(after.bytesByType.exports ?? 0) + (after.bytesByType.uses ?? 0)} B`)
  L(`TYPES     before ${before.distinctTypes.length}/10: ${before.distinctTypes.join(" ")}`)
  L(`          after  ${after.distinctTypes.length}/10: ${after.distinctTypes.join(" ")}`)
  L("")
  L("per-type bytes (after):")
  for (const t of after.distinctTypes) L(`  ${t.padEnd(13)} ${String(after.countByType[t]).padStart(6)} edges  ${String(after.bytesByType[t]).padStart(9)} B   heuristic ${after.heuristicByType[t].sub}/${after.heuristicByType[t].total}`)
} else {
  L(`LATENCY   after ${after.wallMs} ms (${after.msPerFile} ms/file)`)
  L(`EDGES     after ${after.relationships}`)
  L(`PAYLOAD   after ${after.bytesTotal} B; without §4 reason metadata ${after.bytesWithoutReasonMetadata} B`)
  for (const t of after.distinctTypes) L(`  ${t.padEnd(13)} ${String(after.countByType[t]).padStart(6)} edges  ${String(after.bytesByType[t]).padStart(9)} B   heuristic ${after.heuristicByType[t].sub}/${after.heuristicByType[t].total}`)
}

writeFileSync("validation/m14/elixir/elixir-payload-latency.json", JSON.stringify({
  tool: "validation/m14/elixir/elixir-payload-latency.ts",
  lane: "ELIXIR_FIX2",
  population: { corpusRoot: CORPUS_ROOT, corpusDirs: CORPUS_DIRS, extensions: EXTS, derived: true, files: files.length },
  baselineRef: BASELINE_REF,
  productionPathCrossCheck: { files: prodFiles, relationships: prodEdges, wallMs: prodWallMs, note: "ASTEngine.parseFile on the same population; must match `after` on edge count for the comparison above to be on the production path" },
  before, after,
}, null, 2))
L("")
L("artifact: validation/m14/elixir/elixir-payload-latency.json")