/**
 * The VB DIFFERENTIAL — LANE-OWNED. Compares the analyzer against `vb-truth-oracle.ts`
 * on real corpus files and prints, per label, what agrees, what the analyzer missed,
 * and what it published that nothing explains.
 *
 * ## Why the lane needs its own runner
 *
 * `script/m14/differential.ts` has no `lang === "vb"` block at HEAD (measured:
 * `git show HEAD:script/m14/differential.ts | grep -c 'lang === "vb"'` returns 0,
 * while at b0c1d19ce it returns 2, and b0c1d19ce is an ancestor of HEAD). The
 * oracle was lost in the 2026-10-01 reflog-archive recovery, `vb` fell out of
 * `verify-oracle-coverage.ts`'s table entirely, and the lane doc's F5 numbers have
 * had nothing behind them since. This runner is the lane's seat.
 *
 * ## WHAT THE COMPARISON CAN AND CANNOT PROVE
 *
 * It is a SET comparison over (label, source, target) with the LINE carried
 * alongside so a disagreement is checkable at a site rather than only in aggregate.
 * It CANNOT see a grammar bug, because both sides walk the same tree with the same
 * parser. It CAN see a disagreement about which node names the thing, which name a
 * dotted path reduces to, which shape carries a field, and whether an edge is
 * published at all — and every defect this lane has found was of that kind.
 *
 * `UNEXPLAINED` is an edge the analyzer published that the oracle derives no row
 * for. Under the workstream's fabrication rule an unexplained edge is counted
 * against the analyzer, so the number is reported rather than argued with, and the
 * largest classes are DRAWN with file, line, source and target.
 *
 * Population is DERIVED by walking the corpus directory and printed with every
 * count, per the honesty contract's population rule.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { getParser } from "../../src/ast/engine"
import { default as RealVbAnalyzer } from "../../src/ast/real-vb-analyzer"
import { deriveVbTruth, VB_ORACLE_LABELS } from "./vb-truth-oracle"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.VB_CORPUS ?? "roslyn-vb"
const DIR = join(CORPUS_ROOT, REPO)
const LIMIT = Number(process.env.VB_NFILES ?? 200)
const MAX_DRAWS = Number(process.env.VB_DRAWS ?? 8)

function hasSuffix(s: string, suffix: string): boolean {
  return s.length >= suffix.length && s.lastIndexOf(suffix) === s.length - suffix.length
}
function derive(dir: string, ext: string, want: number): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    if (out.length >= want || depth > 24) return
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      if (out.length >= want) return
      if (e.name === "node_modules" || e.name === ".git") continue
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (!hasSuffix(e.name, ext)) continue
      try { if (statSync(p).isFile()) out.push(p) } catch {}
    }
  }
  walk(dir, 0)
  return out
}
const allOnDisk = derive(DIR, ".vb", Number.MAX_SAFE_INTEGER)
// VB_OFFSET exists because a single 1,200-file run in one process died with
// "RuntimeError: Out of bounds memory access" from the tree-sitter WASM at file ~300.
// That is the harness's own documented hazard — `resumable-walk.ts` records nim, scss
// and hcl each losing a whole corpus walk to one file — and the honest response is to
// measure in CHUNKS in separate processes rather than to shrink the sample and report
// the smaller number as though it were the whole. Each chunk prints its own
// population, and the totals below are the sum of the chunks.
const OFFSET = Number(process.env.VB_OFFSET ?? 0)
const files = LIMIT > 0 ? allOnDisk.slice(OFFSET, OFFSET + LIMIT) : allOnDisk

console.log("=".repeat(96))
console.log("VB DIFFERENTIAL — analyzer vs lane-owned oracle")
console.log(`population DERIVED by directory walk: ${allOnDisk.length} .vb files on disk`)
console.log(`population MEASURED this run:        ${files.length} (offset ${OFFSET} of ${allOnDisk.length} on disk)`)
console.log(`oracle labels: ${VB_ORACLE_LABELS.join(" ")}`)
console.log("comparand key: (label, source, target) — the line is carried for a checkable site")
console.log("=".repeat(96) + "\n")

const parser = await getParser("vb")

type Stat = { truth: number; emitted: number; both: number; missing: number; unexplained: number; linesAgree: number; linesDiffer: number }
const stats = new Map<string, Stat>()
for (const l of VB_ORACLE_LABELS) {
  stats.set(l, { truth: 0, emitted: 0, both: 0, missing: 0, unexplained: 0, linesAgree: 0, linesDiffer: 0 })
}
const draws: Record<string, string[]> = {}
function draw(k: string, s: string): void {
  draws[k] ??= []
  if (draws[k].length < MAX_DRAWS) draws[k].push(s)
}
const declinedTotal: Record<string, number> = {}
let filesOk = 0
let filesFailed = 0

for (const abs of files) {
  const rel = abs.slice(DIR.length + 1)
  let content: string
  try { content = readFileSync(abs, "utf8") } catch { filesFailed++; continue }
  let tree: any
  try { tree = await parser.parse(content) } catch { filesFailed++; continue }
  const truth = deriveVbTruth(tree.rootNode)
  const res: any = new RealVbAnalyzer().analyze(tree.rootNode, content, abs)
  filesOk++
  for (const k of Object.keys(truth.declined)) declinedTotal[k] = (declinedTotal[k] ?? 0) + truth.declined[k]

  const truthByKey = new Map<string, number[]>()
  for (const r of truth.rows) {
    const key = `${r.label}|${r.from}|${r.target}`
    const st = stats.get(r.label)
    if (!st) continue
    // ONE unit throughout: a DISTINCT (label, source, target) key. Counting truth
    // ROWS against distinct EMITTED keys made the four columns disagree by
    // construction — 153 truth rows over 130 keys read as "23 rows missing" when
    // nothing was missing. Sites per key are reported separately.
    if (!truthByKey.has(key)) { truthByKey.set(key, []); st.truth++ }
    truthByKey.get(key)!.push(r.line)
  }
  const emittedByKey = new Map<string, number[]>()
  for (const e of (res.relationships ?? [])) {
    const label = String(e?.type ?? "")
    const st = stats.get(label)
    if (!st) continue
    st.emitted++
    const key = `${label}|${e.source}|${e.target}`
    if (!emittedByKey.has(key)) emittedByKey.set(key, [])
    emittedByKey.get(key)!.push(e?.line_number ?? 0)
  }
  for (const [key, lines] of truthByKey) {
    const st = stats.get(key.split("|")[0])!
    const el = emittedByKey.get(key)
    if (el) {
      st.both++
      // ORDER-INDEPENDENT site check: the analyzer deduplicates `uses` per
      // (source, target) keeping the FIRST site in ITS traversal order, and this
      // oracle keeps its own first in a stack order, so "is the emitted line the
      // first truth line" compares two traversal orders rather than two decisions
      // and reports 26 phantom line disagreements per 40 files. The honest test is
      // whether the emitted line is a line the oracle actually found the read on.
      if (el.some((l) => lines.includes(l))) st.linesAgree++
      else { st.linesDiffer++; draw(`line-differs:${key.split("|")[0]}`, `${rel}: truth site lines ${lines.slice(0, 5).join(",")} vs emitted L${el[0]}  ${key.replace(/\|/g, " -> ")}`) }
    } else {
      st.missing++
      draw(`missing:${key.split("|")[0]}`, `${rel}: ${key.replace(/\|/g, " -> ")} (truth L${lines[0]})`)
    }
  }
  for (const [key, el] of emittedByKey) {
    if (truthByKey.has(key)) continue
    const st = stats.get(key.split("|")[0])!
    st.unexplained++
    draw(`unexplained:${key.split("|")[0]}`, `${rel}:${el[0]}  ${key.replace(/\|/g, " -> ")}`)
  }
  tree.delete?.()
  if ((filesOk % 100) === 0) process.stderr.write(`  ...${filesOk}\n`)
}

const pct = (x: number, of: number): string => (of === 0 ? "—" : `${((x / of) * 100).toFixed(1)}%`)
console.log(`files compared ${filesOk}   failed ${filesFailed}\n`)
console.log("label          truth  emitted   both  missing  unexplained  cov%   unexpl%   line agree / differ")
console.log("-".repeat(108))
for (const l of VB_ORACLE_LABELS) {
  const s = stats.get(l)!
  const denom = s.truth + s.unexplained
  console.log(
    l.padEnd(14) +
    String(s.truth).padStart(6) + String(s.emitted).padStart(9) + String(s.both).padStart(7) +
    String(s.missing).padStart(9) + String(s.unexplained).padStart(13) +
    pct(s.both, denom).padStart(7) + pct(s.unexplained, denom).padStart(10) +
    `   ${s.linesAgree} / ${s.linesDiffer}`,
  )
}
console.log("-".repeat(108))
let T = 0, E = 0, B = 0, M = 0, U = 0
for (const l of VB_ORACLE_LABELS) { const s = stats.get(l)!; T += s.truth; E += s.emitted; B += s.both; M += s.missing; U += s.unexplained }
console.log(`TOTAL         ${String(T).padStart(6)}${String(E).padStart(9)}${String(B).padStart(7)}${String(M).padStart(9)}${String(U).padStart(13)}   coverage vs truth+unexplained: ${pct(B, T + U)}   unexplained: ${pct(U, T + U)}`)
console.log(`\nORACLE DECLINED (counted, never guessed): ${Object.keys(declinedTotal).map((k) => `${k}:${declinedTotal[k]}`).join("  ") || "(none)"}`)

for (const k of Object.keys(draws).sort()) {
  console.log(`\n--- ${k} (${draws[k].length} draws, cap ${MAX_DRAWS}) ---`)
  for (const d of draws[k]) console.log(`  ${d}`)
}
console.log(`\nDONE. Population DERIVED: ${allOnDisk.length} .vb on disk; MEASURED: ${files.length}; compared: ${filesOk}`)