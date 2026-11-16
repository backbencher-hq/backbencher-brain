/**
 * READ-ONLY PROBE — a 200-file deep draw, per-file verdict.
 *
 * Aggregate rates hide which files are bad, and a lane that only ever reports
 * percentages cannot tell "uniformly 99.8%" from "180 perfect files and 20
 * disasters". So: draw 200 bash files DETERMINISTICALLY (hash-ordered on
 * content, so the same draw is reproducible and not a favour to whatever the
 * filesystem returned first) and give each one a verdict.
 *
 * The verdict is decided by the STRICTEST applicable question, in this order:
 *
 *   FAIL  the analyzer asserted something the independent oracle does not
 *         corroborate (a fabrication), or emitted an edge with no line, or
 *         emitted an edge whose source is not a symbol. These are the three
 *         ways an edge can be a lie, and none of them is a matter of taste.
 *   DEFER the file did not parse cleanly, or its only gaps are truth-only rows
 *         in a shape this lane has ruled out of scope (zsh dialect, autoconf).
 *         Stated, not hidden, and never counted as a pass.
 *   PASS  every one of the three failure conditions absent.
 *
 * Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"
import { deriveBashEdges } from "../differential"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const REPOS = (process.env.BB_REPOS ?? "nvm,rbenv,ohmyzsh,otp,fsharp").split(",").map((x) => x.trim()).filter(Boolean)
const N = Number(process.env.BB_N ?? 200)

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(process.cwd(), "wasm/tree-sitter-bash.wasm"))))

type Cand = { repo: string; rel: string; abs: string; text: string; h: string }
const pool: Cand[] = []
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim().split("\n").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (text.length > 512 * 1024) continue
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    pool.push({ repo, rel, abs, text, h: createHash("sha256").update(text).digest("hex") })
  }
}
pool.sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.repo.localeCompare(b.repo)))
const draw = pool.slice(0, N)
console.log(`eligible bash files: ${pool.length}   drawn: ${draw.length}   (hash-ordered, reproducible)\n`)

type V = { v: "PASS" | "FAIL" | "DEFER"; why: string }
const verdicts: { file: string; v: V }[] = []
let totTruth = 0, totCovered = 0, totMissing = 0, totUnexplained = 0

for (const c of draw) {
  const tree = parser.parse(c.text)
  const errNodes = (() => { let n = 0; const v = (x: any) => { if (x.type === "ERROR" || x.isMissing) n++; for (let i = 0; i < x.childCount; i++) v(x.child(i)) }; if (tree) v(tree.rootNode); return n })()
  const truthEdges = tree ? deriveBashEdges(tree.rootNode as any, path.basename(c.rel)) : []
  tree?.delete?.()
  let r: any = { symbols: [], relationships: [] }
  try { r = await parseFile(c.abs, path.join(CR, c.repo)) } catch { }
  const syms = r.symbols ?? []
  const rels = r.relationships ?? []
  const declared = new Set(syms.map((s: any) => String(s.name)))
  const norm = rels.map((x: any) => ({ label: String(x.type ?? x.relationshipType ?? "").toLowerCase(), target: String(x.target ?? x.to ?? "").trim() }))

  let unlined = 0, badSource = 0
  for (const x of rels) {
    if (!(typeof x.line_number === "number" && x.line_number > 0)) unlined++
    if (!declared.has(String(x.source ?? x.from ?? ""))) badSource++
  }
  const covered = truthEdges.filter((te) => norm.some((r) => r.label === te.label.toLowerCase() && r.target === te.target.trim())).length
  const unexplained = norm.filter((r) => !truthEdges.some((te) => te.label.toLowerCase() === r.label && te.target.trim() === r.target)).length
  const missing = truthEdges.length - covered
  totTruth += truthEdges.length; totCovered += covered; totMissing += missing; totUnexplained += unexplained

  const reasons: string[] = []
  let v: V["v"] = "PASS"
  if (unexplained > 0) { v = "FAIL"; reasons.push(`${unexplained} unexplained edge(s)`) }
  if (unlined > 0) { v = "FAIL"; reasons.push(`${unlined} edge(s) with no line`) }
  if (badSource > 0) { v = "FAIL"; reasons.push(`${badSource} edge source(s) not a symbol`) }
  if (v === "PASS" && (errNodes > 0 || missing > 0)) {
    v = "DEFER"
    if (errNodes > 0) reasons.push(`${errNodes} ERROR/MISSING node(s)`)
    if (missing > 0) reasons.push(`${missing} truth-only row(s)`)
  }
  verdicts.push({ file: `${c.repo}/${c.rel}`, v: { v, why: reasons.join("; ") || "all truth corroborated; every edge lined and symbol-sourced" } })
}

const tally = { PASS: 0, FAIL: 0, DEFER: 0 } as Record<string, number>
for (const x of verdicts) tally[x.v.v]++
console.log(`=== verdict tally over ${draw.length} files ===`)
for (const k of ["PASS", "FAIL", "DEFER"]) console.log(`  ${k.padEnd(6)} ${String(tally[k]).padStart(4)}  (${((100 * tally[k]) / draw.length).toFixed(1)}%)`)
console.log(`\n=== aggregate over the draw ===`)
console.log(`  truth=${totTruth} covered=${totCovered} (${((100 * totCovered) / totTruth).toFixed(1)}%) MISSING=${totMissing} UNEXPLAINED=${totUnexplained}`)

const fails = verdicts.filter((x) => x.v.v === "FAIL")
if (fails.length) { console.log(`\n=== every FAIL (${fails.length}) ===`); for (const f of fails) console.log(`  ${f.file}\n      ${f.v.why}`) }
const defers = verdicts.filter((x) => x.v.v === "DEFER")
console.log(`\n=== DEFER breakdown (${defers.length}) ===`)
const byWhy = new Map<string, number>()
for (const d of defers) { const k = d.v.why.replace(/\d+/g, "N"); byWhy.set(k, (byWhy.get(k) ?? 0) + 1) }
for (const [k, n] of [...byWhy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${String(n).padStart(3)}  ${k}`)
// A DEFER count is a shrug until it is attributed. Most of this corpus is zsh
// routed into the bash lane because there is no zsh analyzer, and a zsh file
// failing to parse under a bash grammar is a DISCLOSED dialect boundary rather
// than a lane defect. Reporting "34% DEFER" without that split would let a
// reader assume the bash lane is deferring a third of its real work.
console.log(`\n=== DEFER attributed ===`)
type Cause = "zsh dialect (declared, no zsh analyzer)" | "autoconf/m4 expanded" | "bash-dialect limit" | "truth-only rows only"
const causeOf = (f: string, why: string): Cause => {
  if (why.includes("ERROR/MISSING") && (f.endsWith(".zsh") || f.endsWith(".zsh-theme") || f.includes("ohmyzsh/"))) return "zsh dialect (declared, no zsh analyzer)"
  if (/autoconf|install-sh|configure|libtool|m4/.test(f)) return "autoconf/m4 expanded"
  if (why.includes("ERROR/MISSING")) return "bash-dialect limit"
  return "truth-only rows only"
}
const causeTally = new Map<Cause, number>()
for (const d of defers) { const k = causeOf(d.file, d.v.why); causeTally.set(k, (causeTally.get(k) ?? 0) + 1) }
for (const [k, n] of [...causeTally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`)
const zsh = (causeTally.get("zsh dialect (declared, no zsh analyzer)") ?? 0) + (causeTally.get("autoconf/m4 expanded") ?? 0)
console.log(`\n  DEFERs attributable to a DECLARED out-of-scope dialect: ${zsh} of ${defers.length}`)
console.log(`  in-scope DEFER rate: ${(((defers.length - zsh) / draw.length) * 100).toFixed(1)}% of the draw`)
console.log(`\n=== the in-scope DEFERs, in full (the only ones that could be lane defects) ===`)
for (const d of defers) {
  const k = causeOf(d.file, d.v.why)
  if (k === "zsh dialect (declared, no zsh analyzer)") continue
  console.log(`  [${k}] ${d.file}\n      ${d.v.why}`)
}
