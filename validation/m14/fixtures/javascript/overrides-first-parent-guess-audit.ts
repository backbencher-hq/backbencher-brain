/**
 * JS `overrides` — HOW MANY `first-parent-guess` ROWS ARE FALSE?
 *
 * ## The clause-1 defect this exists to size
 *
 * `real-javascript-analyzer.ts` emits an `overrides` edge from every member of a class whose base is
 * declared in ANOTHER file, as `reasonCode: "first-parent-guess"`, confidence 0.5,
 * `evidenceClass: inferred` — with no check that the base actually carries the member. Measured by
 * hand on one file: `BaseComponent.dispose -> Config.dispose` is emitted while `Config`
 * (`bootstrap/js/src/util/config.js`) declares `_getConfig`, `_configAfterMerge`, `_mergeConfigObj`,
 * `_typeCheckConfig` and NO `dispose`. The in-file branch (`verified-in-file`) is the only one that
 * verifies anything.
 *
 * The metadata says the analyzer does not know. This instrument says HOW OFTEN IT IS WRONG, over the
 * WHOLE JavaScript population rather than a stride — because a stride reading of a cross-file
 * question is a lower bound by construction, and the fix's falsifier is stated on both sides:
 * the false rows fall to zero AND no true row is lost.
 *
 * ## The three buckets, and why they are three rather than two
 *
 *   TRUE                 a file that declares the base ALSO declares the member
 *   FALSE                files declare the base, and NONE of them declares the member — the edge
 *                        names a member that does not exist on the base: a WRONG EDGE
 *   BASE-NOT-IN-PROJECT  no file in the project declares the base at all (an imported dependency),
 *                        so the guess is neither provable nor refutable from the corpus — reported
 *                        separately rather than folded into either, because moving it into FALSE
 *                        would overstate the defect and into TRUE would hide it.
 *
 * ## Discipline
 *
 * - The population is EVERY admitted `.js/.mjs/.cjs/.jsx` file under the corpus root, walked at run
 *   time (node_modules/.git excluded, >1 MB excluded as the gate does). Not a stride.
 * - The analyzer is the PRODUCTION entry point (`parseFile`), not `analyze()`.
 * - Read-only: nothing is written, no store is touched.
 *
 * Run:  npx tsx validation/m14/fixtures/javascript/overrides-first-parent-guess-audit.ts
 * Env:  BB_CORPUS_ROOT (default /home/ishaq2321/bb_tests/repositories)
 *       BB_JS_AUDIT_MAX=0  bound the draw (0 = whole population)
 */
import { readdirSync, statSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX = Number(process.env.BB_JS_AUDIT_MAX ?? 0)
const EXTS = new Set([".js", ".mjs", ".cjs", ".jsx"])

type F = { repo: string; rel: string; abs: string }
const files: F[] = []
let skippedLarge = 0
for (const repo of readdirSync(CORPUS)) {
  const root = path.join(CORPUS, repo)
  try { if (!statSync(root).isDirectory()) continue } catch { continue }
  const walk = (d: string, depth: number) => {
    if (depth > 20) return
    let ents; try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name === "node_modules" || e.name === ".git") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (!EXTS.has(path.extname(e.name))) continue
      let size = 0
      try { size = statSync(p).size } catch { continue }
      if (size > 1_000_000) { skippedLarge++; continue }
      files.push({ repo, rel: path.relative(root, p), abs: p })
    }
  }
  walk(root, 0)
}
files.sort((a, b) => (a.repo + a.rel).localeCompare(b.repo + b.rel))
const sample = MAX > 0 ? files.slice(0, MAX) : files
console.log(`JS overrides first-parent-guess audit`)
console.log(`corpus ${CORPUS}`)
console.log(`admitted ${files.length} JS files (skipped ${skippedLarge} over 1 MB) · auditing ${sample.length}${MAX > 0 ? "  *** BOUNDED BY BB_JS_AUDIT_MAX — NOT the population ***" : " (WHOLE POPULATION)"}`)

// ── per file: the symbols it declares, and the edges it emits
type Decl = { name: string; owner: string; qual: string; kind: string }
const declsByFile = new Map<string, Decl[]>()
/** file label -> the project (repo) it belongs to */
const fileRepo = new Map<string, string>()
/** repo -> file labels that declare a CLASS-shaped base (the only kind a base can be) */
const basesByRepo = new Map<string, Map<string, string[]>>()
let parsed = 0, degraded = 0, threw = 0
const guesses: { file: string; repo: string; source: string; target: string; conf: number }[] = []
/** repo -> the symbol space the production companion pass builds from */
const symbolsByRepo = new Map<string, any[]>()
/** repo -> absolute paths of the files that published an `overrides` edge */
const guessFilePaths = new Map<string, Set<string>>()
let totalOverrides = 0, inFileVerified = 0, otherOverrides = 0

for (const f of sample) {
  let r: any
  try { r = await parseFile(f.abs, path.dirname(f.abs)) } catch { threw++; continue }
  if (r?.fallback) { degraded++; continue }
  parsed++
  const label = `${f.repo}/${f.rel}`
  fileRepo.set(label, f.repo)
  const decls: Decl[] = []
  for (const s of (r?.symbols ?? []) as any[]) {
    const nm = String(s?.name ?? "")
    if (!nm) continue
    decls.push({ name: nm, owner: String(s?.ownerName ?? ""), qual: String(s?.qualifiedName ?? ""), kind: String(s?.kind ?? "") })
  }
  declsByFile.set(label, decls)
  {
    const arr = symbolsByRepo.get(f.repo) ?? []
    for (const d of decls) arr.push({ name: d.name, ownerName: d.owner, kind: d.kind })
    symbolsByRepo.set(f.repo, arr)
  }
  for (const d of decls) {
    if (d.kind !== "class" && d.kind !== "interface") continue
    let m = basesByRepo.get(f.repo)
    if (!m) { m = new Map(); basesByRepo.set(f.repo, m) }
    const list = m.get(d.name) ?? []
    list.push(label)
    m.set(d.name, list)
  }
  for (const x of (r?.relationships ?? []) as any[]) {
    if (String(x?.type ?? x?.relationshipType ?? "").toLowerCase() !== "overrides") continue
    totalOverrides++
    const md = (x?.metadata ?? {}) as any
    if (md.reasonCode === "verified-in-file") { inFileVerified++; continue }
    if (md.reasonCode === "first-parent-guess") {
      guesses.push({ file: label, repo: f.repo, source: String(x.source ?? ""), target: String(x.target ?? ""), conf: confOf(x) })
      let set = guessFilePaths.get(f.repo)
      if (!set) { set = new Set(); guessFilePaths.set(f.repo, set) }
      set.add(f.abs)
    } else otherOverrides++
  }
}
function confOf(x: any): number { return Number(x?.confidence ?? 0) }
console.log(`parsed ${parsed}/${sample.length} · degraded ${degraded} · threw ${threw}`)
console.log(`overrides edges: ${totalOverrides} = verified-in-file ${inFileVerified} + first-parent-guess ${guesses.length} + other ${otherOverrides}`)

// ── classify every guess against the project it was emitted in
const buckets = { true: 0, false: 0, baseNotInProject: 0, malformed: 0 }
const falseExamples: string[] = []
const trueExamples: string[] = []
const missingBaseExamples: string[] = []
for (const g of guesses) {
  const dot = g.target.lastIndexOf(".")
  if (dot <= 0) { buckets.malformed++; continue }
  const base = g.target.slice(0, dot)
  const member = g.target.slice(dot + 1)
  const baseFiles = basesByRepo.get(g.repo)?.get(base) ?? []
  if (baseFiles.length === 0) {
    buckets.baseNotInProject++
    if (missingBaseExamples.length < 5) missingBaseExamples.push(`${g.file}: ${g.source} -> ${g.target}`)
    continue
  }
  const declared = baseFiles.some((bf) => (declsByFile.get(bf) ?? []).some((d) =>
    d.qual === g.target || (d.name === member && d.owner === base)))
  if (declared) {
    buckets.true++
    if (trueExamples.length < 5) trueExamples.push(`${g.file}: ${g.source} -> ${g.target} (base in ${baseFiles[0]})`)
  } else {
    buckets.false++
    if (falseExamples.length < 8) falseExamples.push(`${g.file}: ${g.source} -> ${g.target}  (base ${base} declared in ${baseFiles.length} file(s), member absent)`)
  }
}

console.log(`\nTHE SPLIT, whole population of guesses (${guesses.length}):`)
console.log(`  TRUE                ${buckets.true}`)
console.log(`  FALSE               ${buckets.false}   <- the clause-1 violation: the base exists and does not carry the member`)
console.log(`  BASE-NOT-IN-PROJECT ${buckets.baseNotInProject}   (external base: neither provable nor refutable here)`)
console.log(`  MALFORMED target    ${buckets.malformed}`)
const denom = buckets.true + buckets.false
console.log(`  of the CLASSIFIABLE guesses (${denom}): FALSE rate ${denom ? ((100 * buckets.false) / denom).toFixed(1) : "n/a"}%`)
console.log(`\nFALSE examples:`)
for (const e of falseExamples) console.log(`  ${e}`)
console.log(`\nTRUE examples:`)
for (const e of trueExamples) console.log(`  ${e}`)
console.log(`\nBASE-NOT-IN-PROJECT examples:`)
for (const e of missingBaseExamples) console.log(`  ${e}`)
// ── PHASE 2 — WHAT THE PRODUCTION COMPANION PASS ACTUALLY DOES, run for JavaScript
//
// The pass (`src/ast/override-companion-pass.ts`) is language-parameterised and the batch indexer
// runs it for `["perl", "python"]` (parallel-indexer.ts:6349). JavaScript is NOT in that list, so
// the analyzer's `overrideCompanion` is undefined in production and the guess branch always fires.
// The JS analyzer is otherwise FULLY WIRED: `analyze(rootNode, content, filePath, context?)` takes
// the engine's `AnalyzeContext` and forwards `context?.overrideCompanion`
// (real-javascript-analyzer.ts:1401). This phase runs the pass's own algorithm for JS — build the
// companion from the project's symbol space, re-parse only the files that published an `overrides`
// edge — so the fix's effect is MEASURED rather than argued.
{
  const { buildOverrideCompanion } = await import("../../../../src/ast/override-context")
  let confirmed = 0, stillGuess = 0, withdrawn = 0, beforeGuesses = 0, refiled = 0, errs = 0, owners = 0
  for (const [repo, paths] of guessFilePaths) {
    const companion = buildOverrideCompanion(symbolsByRepo.get(repo) ?? [])
    if (companion.size === 0) continue
    owners += companion.size
    for (const abs of paths) {
      const beforeEdges = (declsByFile.size, 0) // counted below from the re-parse's own rows
      void beforeEdges
      let r2: any
      try { r2 = await parseFile(abs, path.dirname(abs), { overrideCompanion: companion } as any) } catch { errs++; continue }
      refiled++
      const rows = ((r2?.relationships ?? []) as any[]).filter((x) => String(x?.type ?? "").toLowerCase() === "overrides")
      const g = rows.filter((x) => (x?.metadata ?? {}).reasonCode === "first-parent-guess").length
      const v = rows.filter((x) => (x?.metadata ?? {}).reasonCode !== "first-parent-guess").length
      stillGuess += g
      confirmed += v
    }
  }
  // Every guess this run saw either survives as a guess, is CONFIRMED (the base declares the
  // member), or is WITHDRAWN. All three are subtracted; an earlier version subtracted only the
  // still-guess and reported 100% withdrawn, which the confirmed count beside it already refuted.
  beforeGuesses = guesses.length
  withdrawn = beforeGuesses - stillGuess - confirmed
  console.log(`\nPHASE 2 — THE PRODUCTION COMPANION PASS, RUN FOR JAVASCRIPT (its own algorithm):`)
  console.log(`  owners in the companion      ${owners}`)
  console.log(`  files re-analyzed            ${refiled}  (only files that published an overrides edge)`)
  console.log(`  errors                       ${errs}`)
  console.log(`  BEFORE  first-parent-guess   ${beforeGuesses}`)
  console.log(`  AFTER   confirmed            ${confirmed}   <- the base IS in the project and DECLARES the member: kept, at 0.95`)
  console.log(`  AFTER   withdrawn            ${withdrawn}   <- the base is in the project and does NOT declare it: the edge DISAPPEARS`)
  console.log(`  AFTER   still a guess        ${stillGuess}   <- the base is outside the project: unchanged, still declared suspicion`)
  const pct = (n: number) => beforeGuesses ? ((100 * n) / beforeGuesses).toFixed(1) + "%" : "n/a"
  console.log(`  split: confirmed ${pct(confirmed)} · withdrawn ${pct(withdrawn)} · still-a-guess ${pct(stillGuess)}`)
  console.log(`  perl's measured split for the same machinery: 20.1% · 75.6% · 4.3% (override-companion-pass.ts header, 5,774 files)`)
}

console.log(`\nFALSIFIER for any fix: FALSE -> 0 and TRUE unchanged. A fix that drops rows the base DOES carry`)
console.log(`has traded one clause-1 violation for another, and this instrument is what says so.`)
