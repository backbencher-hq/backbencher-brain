/**
 * NIM ORACLE CROSS-CHECK — question 3 ("does an independent oracle agree?")
 * and the DERIVATION measurement, run on real corpus through production
 * `parseFile`.
 *
 * ## Why this exists when the shared differential cannot be used
 *
 * `script/m14/differential.ts` cannot run this lane at all:
 *
 *   $ npx tsx script/m14/differential.ts --lang nim
 *   [lane] SKIP nim: no corpus repo mapped in LANG_REPOS and none checked out
 *   — declared unrun, not measured
 *   probe run (--lang nim): measured 0 lane(s)
 *
 * `LANG_REPOS` (script/m14/differential.ts:393) has no `nim` key, and the file
 * carries no import of the lane's oracle module. The oracle itself is NOT
 * missing — `script/m14/nim-truth-oracle.ts` (909 lines, `deriveNimEdges`) is
 * present, and it is reachable: it is imported by `script/m14/tmp/oracle-mirror/
 * differential.ts`, which is a mirror, not the live harness. Both gaps are in
 * shared machinery (workstream §8), so both are reported rather than edited, and
 * this script runs the oracle directly so that "correct?" is answered with a
 * number instead of an assumption.
 *
 * ## What is compared, and what the comparison can and cannot show
 *
 * Per file: `parseFile(path, dir)` for the analyzer side and `deriveNimEdges(root,
 * symbols)` on the same parse tree for the oracle side. Matching is
 * SITE-AGNOSTIC (label + normalized target), the comparison shape the oracle's
 * own header documents, because the analyzer side is deduped per
 * (label,target) while the truth side is not.
 *
 * The declared limit, stated here because it is real: both sides walk the SAME
 * grammar. A grammar fact both get wrong is invisible to this script, so a
 * passing row means "the two derivations agree", never "the edge is true".
 * That is the same limit the workstream records for every lane oracle.
 *
 * ## The two numbers that matter for DERIVATION
 *
 *   MISSING      analyzer emits it, the oracle derives none — a possible defect
 *   UNEXPLAINED  the oracle derives it, the analyzer emits none — a possible gap
 *
 * and per label, whether the ORACLE emitted anything at all. A label with zero
 * oracle edges cannot be adjudicated however many analyzer edges it has, and
 * that is exactly what a DERIVATION finding is.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { getParser } from "../../../../script/m14/run-fixtures"
import { deriveNimEdges } from "../../../../script/m14/nim-truth-oracle"
import { RealNimAnalyzer } from "../../../../src/ast/real-nim-analyzer"

const ANALYZER = path.resolve((import.meta as any).dirname ?? ".", "../../../../src/ast/real-nim-analyzer.ts")
const analyzerHash = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
const HASH_BEFORE = analyzerHash()

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = process.argv[2] && process.argv[2].endsWith(".json") ? process.argv[2] : null
const LIMIT = Number(process.env.BB_NIM_ORACLE_FILES ?? 400)
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
// `src/ast/language-detection.ts` routes nim, nims and nimble all to the nim
// analyzer, so those three are the corpus extensions and this is a list, not a
// pattern.
const NIM_EXTS = ["nim", "nims", "nimble"]

/** Same normalization the oracle's own key uses. */
// Strip the backtick delimiters a name may carry, by CHARACTER and not by
// pattern: an operator name is one backtick-wrapped token, so testing the first
// and last code unit is the whole rule and cannot match anything else.
const norm = (s: unknown): string => {
  const t = String(s ?? "").trim()
  const B = String.fromCharCode(96)
  return t.length >= 2 && t.startsWith(B) && t.endsWith(B) ? t.slice(1, -1) : t
}

const files: { abs: string; dir: string }[] = []
const reposWalked: string[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  let admitted = 0
  for (const rel of tracked) {
    if (!NIM_EXTS.includes(path.extname(rel).slice(1).toLowerCase())) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    files.push({ abs, dir })
    admitted++
  }
  reposWalked.push(`${e}=${admitted}`)
}
// NO EARLY BREAK, and its removal is the fix rather than a cleanup.
//
// This loop used to carry `if (files.length >= LIMIT * 4) break`, a cap on
// DISCOVERY rather than on the sample. It looked like a bounded walk and was
// not one: it stopped partway through `readdirSync` order, so the sample was
// drawn from whichever repositories came first and the rest of the corpus was
// never offered to it. Measured, not argued — with the corpus at 6,063 admitted
// files this instrument discovered 4,075 and every one of its ten rows came back
// BYTE-IDENTICAL to the run before `nim-lang/nimony` was cloned, `implements`
// included, which is the signature of a walk that did not move.
//
// The failure mode is worse than a slow walk. A truncated sample is
// indistinguishable from a stable one: the artifact is digest-pinned, the exit
// code is 0, and the numbers are plausible, so the instrument reads as
// reproducible evidence about a corpus it never looked at. `LIMIT` is a bound on
// how many files get PARSED, which is the expensive part; bounding discovery by
// the same number only makes the sample unrepresentative. So discovery now walks
// every repo and `LIMIT` does the one job it names.
const stride = Math.max(1, Math.floor(files.length / LIMIT))
const sample = files.filter((_, i) => i % stride === 0).slice(0, LIMIT)

const parser = await getParser("nim")
const analyzer = new RealNimAnalyzer()
const analyzerCounts: Record<string, Set<string>> = {}
const truthCounts: Record<string, Set<string>> = {}
for (const t of ALL_TYPES) { analyzerCounts[t] = new Set(); truthCounts[t] = new Set() }
let parsed = 0, parseErr = 0, truthThrew = 0
const missingSamples: string[] = []
/** Misses in a label the oracle DOES derive — the only ones a defect could hide
 *  in. A miss in a label with no oracle is that label's DERIVATION finding, not
 *  a disagreement, and the two are reported separately so they cannot be added. */
const missingAuditedSamples: string[] = []
const unexplainedSamples: string[] = []
let missing = 0, unexplained = 0
const perLabelMissing: Record<string, number> = {}
const perLabelUnexplained: Record<string, number> = {}
const perFile: { file: string; label: string; targets: string[] }[] = []

for (const f of sample) {
  let res: any
  try { res = await parseFile(f.abs, f.dir) } catch { parseErr++; continue }
  if (!res || res.fallback) { parseErr++; continue }
  parsed++
  let tree: any
  try { tree = parser.parse(readFileSync(f.abs, "utf8")) } catch { truthThrew++; continue }
  const aEdges: { type: string; target: string }[] = res.relationships ?? []
  // The oracle takes the ANALYZER's symbol list by contract — its header says so,
  // because ownership assignment is shared ground truth rather than what the
  // differential audits. It must therefore be the list WITH metadata: the
  // pipeline route drops `symbol.metadata` (its own mapping keeps `name`,
  // `kind`, `range` and drops the rest), and the oracle's `extends` and
  // `overrides` derivations read `s.metadata.nimInherits` from it. Feeding it
  // the pipeline's stripped list silently disables both — measured: 20 analyzer
  // `extends` targets against 0 oracle ones, which reads as "the oracle derives
  // no inheritance" when the oracle does exactly that.
  const source = readFileSync(f.abs, "utf8")
  let rawSymbols: any[] = res.symbols ?? []
  try { rawSymbols = analyzer.analyze(tree.rootNode, source, f.abs).symbols ?? rawSymbols } catch { /* keep the pipeline list */ }
  let tEdges: { label: string; target: string }[]
  try { tEdges = deriveNimEdges(tree.rootNode, rawSymbols) } catch { truthThrew++; continue }
  for (const x of aEdges) {
    const t = String(x.type)
    if (analyzerCounts[t]) analyzerCounts[t].add(`${norm(x.target)}`)
  }
  for (const x of tEdges) {
    const t = String(x.label)
    if (truthCounts[t]) truthCounts[t].add(`${norm(x.target)}`)
  }
  const rel = path.relative(CR, f.abs)
  for (const t of ALL_TYPES) {
    const a = new Set(aEdges.filter((x) => String(x.type) === t).map((x) => norm(x.target)))
    const o = new Set(tEdges.filter((x) => String(x.label) === t).map((x) => norm(x.target)))
    for (const target of a) if (!o.has(target)) {
      missing++
      perLabelMissing[t] = (perLabelMissing[t] ?? 0) + 1
      if (missingSamples.length < 12) missingSamples.push(`${rel} ${t} -> ${target}`)
      if (o.size > 0 && missingAuditedSamples.length < 20) missingAuditedSamples.push(`${rel} ${t} -> ${target}`)
    }
    for (const target of o) if (!a.has(target)) {
      unexplained++
      perLabelUnexplained[t] = (perLabelUnexplained[t] ?? 0) + 1
      if (unexplainedSamples.length < 12) unexplainedSamples.push(`${rel} ${t} -> ${target}`)
    }
    if (a.size !== o.size || [...a].some((x) => !o.has(x)) || [...o].some((x) => !a.has(x))) {
      perFile.push({ file: rel, label: t, targets: [...a].filter((x) => !o.has(x)).slice(0, 5) })
    }
  }
}

console.log(`nim oracle cross-check — production parseFile vs script/m14/nim-truth-oracle.ts`)
console.log(`analyzer    : ${path.relative(process.cwd(), ANALYZER)} sha256:${HASH_BEFORE.slice(0, 16)}`)
console.log(`corpus       : ${CR}`)
const nimRepos = reposWalked.filter((r) => !r.endsWith("=0"))
console.log(`discovered   : ${files.length} admitted files over ${nimRepos.length} of ${reposWalked.length} git repos walked [${nimRepos.join(", ")}]`)
console.log(`sampled      : ${sample.length} of ${files.length} discovered (deterministic every-${stride}th, LIMIT=${LIMIT})`)
console.log(`parsed       : ${parsed}   parse failures: ${parseErr}   oracle threw: ${truthThrew}`)
console.log(`MISSING (analyzer emits, oracle derives none): ${missing}`)
console.log(`UNEXPLAINED (oracle derives, analyzer emits none): ${unexplained}`)
console.log(``)
console.log(`label           analyzer-targets   oracle-targets   adjudicated?`)
console.log(`----------------------------------------------------------------------`)
const rows: Record<string, unknown>[] = []
for (const t of ALL_TYPES) {
  const a = analyzerCounts[t].size, o = truthCounts[t].size
  const verdict = o === 0 ? (a === 0 ? "neither emits any" : `NO ORACLE — ${a} analyzer targets unaudited (DERIVATION)`) : "compared"
  const miss = perLabelMissing[t] ?? 0, unexp = perLabelUnexplained[t] ?? 0
  console.log(`${t.padEnd(15)} ${String(a).padStart(15)} ${String(o).padStart(16)}   ${verdict}${o === 0 ? "" : `  [missing ${miss}, unexplained ${unexp}]`}`)
  rows.push({ label: t, analyzerTargets: a, oracleTargets: o, missing: miss, unexplained: unexp, verdict })
}
if (missingSamples.length) {
  console.log(`\nMISSING samples:`)
  for (const s of missingSamples) console.log(`  ${s}`)
}
if (unexplainedSamples.length) {
  console.log(`\nUNEXPLAINED samples:`)
  for (const s of unexplainedSamples) console.log(`  ${s}`)
}
const HASH_AFTER = analyzerHash()
console.log(`\nanalyzer sha256 after the walk : ${HASH_AFTER.slice(0, 16)}${HASH_AFTER === HASH_BEFORE ? "  (unchanged — every number above is tied to this analyzer state)" : "  CHANGED DURING THE RUN — the numbers above are a MIXTURE of two analyzer states and are not reproducible"}`)
if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(), corpusRoot: CR, sampled: sample.length, discovered: files.length,
    reposWalked: nimRepos,
    analyzerSha256: HASH_AFTER, analyzerStableDuringRun: HASH_AFTER === HASH_BEFORE,
    stride, parsed, parseErr, oracleThrew: truthThrew, missing, unexplained, perLabel: rows,
    perLabelMissing, perLabelUnexplained, missingAuditedSamples,
    missingSamples, unexplainedSamples,
    declaredLimit: "both sides walk the same grammar; agreement is not truth",
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}