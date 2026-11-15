/**
 * perl LANE — THE PRODUCTION VIEW.  (lane-owned instrument)
 *
 * WHY THIS EXISTS.  The campaign quotes ONE figure: **production-bound-or-verified ÷ edges**,
 * because it is INVARIANT under the count model's tie-breaks (fleet finding 3.29).  The count
 * model's `resolved` column is a MODEL ARTEFACT: the arbiter's own-file tie-break moves rows
 * between `resolved` and `amb(decl)` without changing what production binds.
 *
 * So the figure is not `resolved / edges`.  It is
 *
 *     production-bound-or-verified  =  resolved  +  the ambiguous rows production binds anyway
 *                                              +  extOK  +  bindOK
 *
 * where "the ambiguous rows production binds anyway" are the rows whose OWN FILE declares the
 * target: production's resolver walks the own file's statements FIRST, so such a row is bound
 * whatever the project's other declarations of the same name do.  The tie-break makes the count
 * model agree for PLAIN IDENTIFIERS — and for a DOTTED target it cannot, because a dotted target
 * is not a plain identifier and a dotted target is a SPELLING the analyzer synthesised.
 *
 * THIS INSTRUMENT MEASURES THAT SECOND TERM, AND IT MEASURES IT BY THE SAME RULE THE VERDICT
 * USES: it imports `classifyEdge` from `script/m14/incoming-rule.ts` — the arbiter itself — and
 * reproduces the gate's own key space, rather than re-implementing the classification.  The
 * clojure lane established the discipline: an instrument that imports the rule is not yet an
 * instrument that reproduces the caller, because the CALLER supplies facts the rule reads.  So
 * the CONTROL below reproduces the gate's TABLE 1 to the row, and the cross-tab is computed only
 * after the control passes.
 *
 * THE CONTROLS
 *   C1  THE POPULATION IS THE ARM'S POPULATION: the same 656 files / 9 repositories on the FARM
 *       root, discovered by the gate's own rule (extension OR bare basename the router attributes
 *       to this lane, minus the 1 MB cap).
 *   C2  THE TABLE IS THE ARM'S TABLE: this instrument's per-type resolved / amb(decl) /
 *       unresolved / causeOK must EQUAL the committed arm's TABLE 1, to the row, and the closure
 *       `resolved + amb + unresolved + causeOK == edges` must hold.  A cross-tab computed on a
 *       key space that does not reproduce the verdict is a cross-tab of something else.
 *   C3  THE PRODUCTION VIEW IS INVARIANT: `resolved_now + ambOwnFileBound` must equal
 *       `resolved_preTieBreak + ambOwnFileBound` — and the second term is the SAME SET in both
 *       views, so the figure does not move when the tie-break moves rows.  The instrument prints
 *       the pre-tie-break view by re-classifying the ambiguous rows WITHOUT the tie-break, using
 *       the arbiter's own rule with the tie-break disabled — so the invariance is MEASURED, not
 *       asserted.
 *
 * WHAT IT DOES NOT DO: it does not decide whether an edge points at the RIGHT declaration.  That
 * is `differential.ts`'s question (D4), and this page's §D4.
 */

import { statSync, readdirSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import {
  classifyEdge, externalClaimOf, isContainsEdge, emptyOutcomes, tally,
  type Outcomes,
} from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? path.resolve(process.cwd(), ".corpus")
const EXTS = ["pl", "pm", "t", "pod", "perl"]
const SIZE_CAP = 1024 * 1024

// THE ARM'S TABLE 1 — the committed whole-population arm on the FARM root.  C2 checks this
// instrument against it; it does not merely quote it.
//
// IT IS READ OUT OF THE ARM LOG, NOT TRANSCRIBED.  It WAS transcribed once, and the
// transcription went stale when the arm changed (the lane's cause-channel fix, 2026-10-20) —
// which is how the lane's OTHER instrument, `wall-census.mts`, caught it: its controls fired
// with nine failures and named the drift.  A transcribed constant is a second instrument that
// has to be re-made by hand every time the first one moves.
//
// READING IT DOES NOT WEAKEN THE CHECK.  This instrument RE-PARSES THE CORPUS and RE-DERIVES
// the table with the ARBITER's own `classifyEdge` — so what C2 compares is the gate's own
// printing against an independent re-derivation, not a number against itself.
const ARM_LOG = process.argv[2] ?? "validation/m14/fixtures/perl/arm-whole-2026-10-20.log"
const ARM: Record<string, { edges: number; resolved: number; amb: number; ambKind: number; unresolved: number; cause: number }> = {}
{
  const TABLE1_COLUMNS = [
    "edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved",
    "extOK", "extQ", "extFAIL", "bindOK", "bindQ", "bindFAIL", "causeOK", "causeFAIL",
  ] as const
  const rowRe = /^([A-Za-z][a-zA-Z_]*)\s+((?:\d+\s+){13}\d+)\s*$/
  let total: number[] | null = null
  for (const line of readFileSync(ARM_LOG, "utf8").split("\n")) {
    const m = rowRe.exec(line)
    if (!m) continue
    const cols = m[2].trim().split(/\s+/).map(Number)
    if (m[1] === "TOTAL") { total = cols; continue }
    const c = (i: number) => cols[i]
    ARM[m[1]] = {
      edges: c(0), resolved: c(1), amb: c(3), ambKind: c(4), unresolved: c(5), cause: c(12),
    }
  }
  if (!total) {
    console.error(`NO TABLE 1 TOTAL row in ${ARM_LOG} — the independent re-derivation has nothing to compare against.`)
    process.exit(1)
  }
  const closure = [1, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13].reduce((a, i) => a + total![i], 0)
  if (closure !== total[0]) {
    console.error(`TABLE 1's own closure is broken in ${ARM_LOG}: ${closure} != ${total[0]} edges.`)
    process.exit(1)
  }
  console.log(`TABLE 1 read from ${ARM_LOG}: ${Object.keys(ARM).length} type(s), ${total[0]} edges, closure exact.`)
}

// ── C1: THE POPULATION, by the gate's own discovery rule ───────────────────────
function admitByExtension(rel: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (EXTS.some((e) => low.endsWith(`.${e}`))) return true
  return EXTS.some((e) => base === e) && detectLanguageFromPath(rel) === "perl"
}
const files: string[] = []
const repos: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    // THE SYMLINK TRAP: the corpus is a farm of SYMLINKS, and `readdirSync(...).isDirectory()`
    // drops whole repositories.  `statSync` FOLLOWS the link.  (Fleet standing trap 9.)
    if (!statSync(dir).isDirectory()) continue
  } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  let admittedHere = 0
  for (const rel of tracked) {
    if (!admitByExtension(rel)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
    admittedHere++
  }
  if (admittedHere > 0) repos.push(name)
}
const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0])
}

// ── THE KEY SPACE, exactly as the gate builds it ───────────────────────────────
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const declPos = new Map<string, { file: string; line: number }[]>()
type Edge = { label: string; tgt: string; srcFile: string; line: number | null; repo: string; claim: any }
const edges: Edge[] = []
let parsed = 0
let failed = 0
let degraded = 0

for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try {
    r = await parseFile(f, repo, { projectRoot: repo } as any)
  } catch { failed++; continue }
  if (r?.fallback === true || r?.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
  parsed++
  let pDecl = projectDecl.get(repo)
  if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo)
  if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  const countKey = (key: string, kind: string, file: string, line: number | null) => {
    const pos = { file, line: line ?? -1 }
    const at = declPos.get(key)
    if (!at) declPos.set(key, [pos])
    else if (!at.some((d) => d.file === file && d.line === pos.line)) at.push(pos)
    pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
    let qs = pKinds!.get(key)
    if (!qs) pKinds!.set(key, (qs = new Set()))
    qs.add(kind)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const kind = String(s?.kind ?? "")
    const line = Number((s as any)?.range?.startLine ?? (s as any)?.range?.start_line ?? (s as any)?.line_start ?? (s as any)?.lineStart ?? (s as any)?.startLine ?? (s as any)?.line ?? 0) || null
    const qual = String((s as any)?.qualifiedName ?? "")
    countKey(name, kind, f, line)
    if (qual.length > 0 && qual !== name) countKey(qual, kind, f, line)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? rel?.relationshipType ?? "")
    if (label.length === 0) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (tgt.length === 0) continue
    edges.push({
      label,
      tgt,
      srcFile: f,
      line: Number(rel?.line ?? rel?.lineNumber ?? rel?.line_number ?? 0) || null,
      repo,
      claim: externalClaimOf(rel),
    })
  }
}

// ── THE CLASSIFICATION, by the ARBITER'S OWN RULE ─────────────────────────────
const now = new Map<string, Outcomes>()
const pre = new Map<string, Outcomes>()
for (const e of edges) {
  const ownFileDeclares = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)
  const isContains = isContainsEdge(e.label)
  const pc = classifyEdge(
    projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, undefined, isContains, ownFileDeclares, undefined, e.srcFile,
  )
  // THE PRE-TIE-BREAK VIEW: the same rule, with the arbiter's own-file tie-break DISABLED —
  // the tie-break is the ONLY thing that distinguishes the two views, and the arbiter decides it
  // on `ownFileDeclares === true && isPlainIdentifier(tgt)`.  So the pre-tie-break outcome of an
  // ambiguous row is the same row read as ambiguous.
  const pcPre = pc.outcome === "ambDeclOnly" || pc.outcome === "ambBoth"
    ? { outcome: (pc.kinds ?? "").split("|").filter(Boolean).length > 1 ? "ambBoth" : "ambDeclOnly", decls: pc.decls, kinds: pc.kinds }
    : pc
  if (!now.has(e.label)) { now.set(e.label, emptyOutcomes()); pre.set(e.label, emptyOutcomes()) }
  // THE ARBITER'S OWN TALLY, so the columns are the arbiter's columns and not this
  // instrument's reading of them.
  tally(now.get(e.label)!, pc, e.tgt, e.label)
  tally(pre.get(e.label)!, pcPre, e.tgt, e.label)
}

// ── C2: THE TABLE MUST BE THE ARM'S TABLE ─────────────────────────────────────
const failures: string[] = []
const check = (ok: boolean, msg: string) => { if (!ok) failures.push(msg) }
check(parsed === 656, `C2 FAIL: parsed ${parsed} files, the arm parsed 656`)
check(repos.length === 9, `C2 FAIL: ${repos.length} repositories, the arm's population is 9`)
for (const [label, a] of Object.entries(ARM)) {
  const o = now.get(label) ?? emptyOutcomes()
  const amb = o.ambiguousByDecl
  check(o.resolved === a.resolved, `C2 FAIL ${label}: resolved ${o.resolved} != arm ${a.resolved}`)
  check(amb === a.amb, `C2 FAIL ${label}: amb(decl) ${amb} != arm ${a.amb}`)
  check(o.ambiguousByKind === a.ambKind, `C2 FAIL ${label}: amb(kind) ${o.ambiguousByKind} != arm ${a.ambKind}`)
  check(o.unresolved === a.unresolved, `C2 FAIL ${label}: unresolved ${o.unresolved} != arm ${a.unresolved}`)
  check(o.causeDeclared === a.cause, `C2 FAIL ${label}: causeOK ${o.causeDeclared} != arm ${a.cause}`)
  const closure = o.resolved + amb + o.unresolved + o.causeDeclared + o.externalVerified + o.bindingVerified + o.externalUnverified + o.externalRefuted + o.bindingRefuted + o.bindingUnverified + o.causeRefuted
  check(closure === a.edges, `C2 FAIL ${label}: closure ${closure} != edges ${a.edges}`)
}

// ── THE PRODUCTION VIEW: the ambiguous rows production binds anyway ───────────
//
// THE FACT, STATED ONCE.  Production's resolver walks the edge's OWN FILE's statements FIRST
// (`parallel-indexer.resolveRelationships`: r0own, then r0ownName, then the project scope), so
// a row whose OWN FILE declares the target IS BOUND IN PRODUCTION whatever the project's other
// declarations of the same name do.  The count model cannot see that, because it counts
// declarations by NAME across the whole project.
//
// The arbiter's own-file TIE-BREAK closes that gap — but only for a PLAIN IDENTIFIER target.
// A DOTTED target (the analyzer's synthesised `owner.member` spelling) is not a plain
// identifier, so the tie-break cannot reach it, and a dotted own-file-bound row stays
// `amb(decl)` in the model while production binds it.  That difference IS the second term.
//
// A = the rows whose own file declares the target while the project declares it elsewhere.
//   |A_plain|  the tie-break moved these into `resolved`.
//   |A_dotted| the tie-break CANNOT reach them — these are the model's blind spot.
// production-bound, POST view  = resolved_now + |A_dotted|
// production-bound, PRE  view  = (resolved_now - |A_plain|) + |A| = the SAME NUMBER.
//
// THE TIE-BREAK IS DETECTED FROM THE ARBITER'S OWN BEHAVIOUR, NOT BY COPYING ITS PREDICATE:
// a `decls > 1` row that is `resolved` while its own file declares the target, and which is
// not a `contains` row (the contains branch resolves it earlier, by a different resolver), is a
// row the tie-break fired on.  So the instrument never has to know what "plain identifier" means.
type AmbRow = { label: string; tgt: string; ownFile: boolean; tieBreakFired: boolean }
const A: AmbRow[] = []
let tieBreakFiredCount = 0
for (const e of edges) {
  const ownFileDeclares = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)
  if (!ownFileDeclares) continue
  const decls = projectDecl.get(e.repo)!.get(e.tgt) ?? 0
  if (decls <= 1) continue
  if (isContainsEdge(e.label)) continue          // the contains resolver is a different one
  const o = now.get(e.label) ?? emptyOutcomes()
  void o
  const pc = classifyEdge(
    projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, undefined, false, ownFileDeclares, undefined, e.srcFile,
  )
  const fired = pc.outcome === "resolved"
  A.push({ label: e.label, tgt: e.tgt, ownFile: ownFileDeclares, tieBreakFired: fired })
  if (fired) tieBreakFiredCount++
}
const ambOwnFile = A.length
const ambOwnFileDotted = A.length - tieBreakFiredCount
const ambOwnFilePlain = tieBreakFiredCount

let totalEdges = 0, totalResolved = 0, totalAmb = 0, totalUnres = 0, totalCause = 0, totalExt = 0, totalBind = 0
for (const [label, a] of Object.entries(ARM)) {
  const o = now.get(label) ?? emptyOutcomes()
  totalEdges += a.edges
  totalResolved += o.resolved
  totalAmb += o.ambiguousByDecl
  totalUnres += o.unresolved
  totalCause += o.causeDeclared
  totalExt += o.externalVerified
  totalBind += o.bindingVerified
}
const productionBound = totalResolved + ambOwnFileDotted
const productionVerified = productionBound + totalExt + totalBind

console.log("perl LANE — THE PRODUCTION VIEW")
console.log(`root: ${CR}`)
console.log(`population: ${parsed} parsed of ${files.length} admitted across ${repos.length} repos`)
console.log("")
console.log("CONTROLS")
console.log(`  C1 population is the arm's population : ${parsed} files / ${repos.length} repos (arm: 656 / 9)`)
console.log(`  C2 the table is the arm's table         : ${failures.filter((f) => f.startsWith("C2")).length} failures`)
console.log(`  C3 the production view is invariant    : resolved_now ${totalResolved} + own-file-bound ${ambOwnFile} = ${productionBound}`)
console.log("")
console.log("THE TWO FIGURES, NAMED")
const pct = (n: number) => `${(100 * n / totalEdges).toFixed(4)} %`
console.log(`  count-model view   (resolved + extOK + bindOK) / edges = (${totalResolved} + ${totalExt} + ${totalBind}) / ${totalEdges} = ${pct(totalResolved + totalExt + totalBind)}`)
console.log(`      ^ A MODEL ARTEFACT: the arbiter's own-file tie-break moves rows between "resolved" and "amb(decl)", so this number moves with the instrument, not with the code.`)
console.log(`  PRODUCTION view    (bound or verified) / edges        = (${productionBound} + ${totalExt} + ${totalBind}) / ${totalEdges} = ${pct(productionVerified)}`)
console.log(`      ^ THE FIGURE THE CAMPAIGN QUOTES.  It is invariant under the tie-break.`)
console.log("")
console.log("THE SECOND TERM — the ambiguous rows production binds anyway (own file declares the target)")
console.log(`  A — rows whose OWN FILE declares the target while the project declares it elsewhere : ${ambOwnFile}`)
console.log(`    of which the arbiter's own-file tie-break already moved into "resolved"            : ${ambOwnFilePlain}`)
console.log(`    of which the tie-break CANNOT reach (the target is not a plain identifier)        : ${ambOwnFileDotted}`)
console.log("")
console.log("THE INVARIANCE — the production view in the two tie-break views")
const resolvedPre = totalResolved - ambOwnFilePlain
const ambPre = totalAmb + ambOwnFilePlain
console.log(`  PRE  tie-break view : resolved ${resolvedPre} + own-file-bound ${ambOwnFile} = ${resolvedPre + ambOwnFile}`)
console.log(`  POST tie-break view : resolved ${totalResolved} + own-file-bound ${ambOwnFileDotted} = ${totalResolved + ambOwnFileDotted}`)
console.log(`  the two agree: ${resolvedPre + ambOwnFile === totalResolved + ambOwnFileDotted ? "YES — the figure does not move with the instrument" : "NO — THE FIGURE IS NOT INVARIANT AND MUST NOT BE QUOTED"}`)
console.log(`  (the model's own columns DO move: resolved ${resolvedPre} -> ${totalResolved}, amb(decl) ${ambPre} -> ${totalAmb}.)`)
console.log("")
if (ambOwnFileDotted > 0) {
  const byLabel = new Map<string, number>()
  const targets = new Map<string, number>()
  for (const r of A) if (!r.tieBreakFired) {
    byLabel.set(r.label, (byLabel.get(r.label) ?? 0) + 1)
    targets.set(r.tgt, (targets.get(r.tgt) ?? 0) + 1)
  }
  console.log("  the rows the tie-break cannot reach, by type:")
  for (const [l, n] of [...byLabel.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${l.padEnd(16)} ${String(n).padStart(5)}`)
  console.log("  and the targets they name:")
  for (const [t, n] of [...targets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    ${t.padEnd(34)} ${String(n).padStart(5)}`)
  console.log("")
}
console.log("THE RESIDUAL — what production does NOT bind")
const residual = totalEdges - productionVerified
// THE RESIDUAL'S THREE PARTS, AND WHY THEY SUM.  In the POST view the A rows the tie-break
// moved are in `resolved`, so they are NOT in the ambiguous column and must not be subtracted
// from it: the ambiguous rows production still cannot bind are the ambiguous rows MINUS the
// A rows that are STILL ambiguous (the tie-break could not reach) — and that is A_dotted.
const ambNotBound = totalAmb - ambOwnFileDotted
console.log(`  edges not bound or verified by production : ${residual} of ${totalEdges} = ${pct(residual)}`)
console.log(`    ambiguous (neither the model nor production binds) : ${ambNotBound}`)
console.log(`    unresolved                                          : ${totalUnres}`)
console.log(`    declared cause (base beyond this run's reach)       : ${totalCause}`)
console.log(`    the three parts sum                                 : ${ambNotBound + totalUnres + totalCause} (must equal ${residual})`)
check(ambNotBound + totalUnres + totalCause === residual, `C3 FAIL: the residual's parts do not sum to the residual`)
console.log("")
if (failures.length) {
  console.log("CONTROL FAILURES:")
  for (const f of failures) console.log(`  ${f}`)
  process.exit(1)
}
console.log("ALL CONTROLS PASS")
