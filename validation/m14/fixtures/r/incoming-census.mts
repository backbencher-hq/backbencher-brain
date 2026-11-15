/**
 * R INCOMING CENSUS — the 1,714 unresolved split, with the key-space BUDGET measured rather
 * than assumed, at BOTH scopes.
 *
 * ## Why this instrument exists
 *
 * `npx tsx script/m14/incoming-gate.ts r r 60` reports one line:
 *
 *     FAIL — 175 ambiguous + 1714 unresolved of 3055 edges
 *
 * That number is about ONE STRIDE SAMPLE reso lved against the key space of the files IN THAT RUN,
 * so it answers a question about a sample while reading like a question about the language. The
 * php lane measured what that costs: 53.4% of its sample column was key-space BUDGET (targets
 * whose declaration IS in the corpus, just not in the run), and the unresolved RATE inflated 6.6x
 * (73.5% of edges at 60 files against 11.1% at whole-project scope). fsharp measured 57% and bash
 * 31.5%. R's share is UNKNOWN and is what this instrument measures.
 *
 * ## What it does
 *
 * ONE pass over the whole admitted population (the gate's own discovery rule: `git ls-files` per
 * repository, `.r`, under the gate's size cap, sorted) builds every repository's key space the way
 * the gate builds it — each symbol's `name` AND `qualifiedName` — and keeps the target
 * repository's edges for the project-scope arm. Classification uses the gate's own `classifyEdge`,
 * IMPORTED rather than re-implemented, so the two cannot drift.
 *
 * It prints, and self-checks, both arms:
 *
 *   SAMPLE SCOPE   the gate's stride sample, resolved per project as the gate resolves it, with
 *                  the verdict printed as a MATCH/MISMATCH against the number the gate printed.
 *   PROJECT SCOPE  one whole repository in the key space, which is what production does.
 *
 * and it splits the unresolved column by WHERE A DECLARATION WOULD HAVE BEEN:
 *
 *   keySpaceBudget  declared in the corpus, absent from the run's key space -> NOT a defect
 *   declaredHere    declared in THIS project and still unresolved -> a DEFECT (`classifyEdge`
 *                   makes this structurally impossible for a bare name; a non-zero count means
 *                   a qualified target whose owner is published and whose member is not)
 *   anotherRepo     declared by another admitted repository -> external to this project
 *   nowhere         declared by no admitted file -> external to the corpus (base R, CRAN, a
 *                   package this checkout does not carry)
 *   pathShaped      a FILE path or URI — never a published name, so NEVER a defect
 *
 * A PATH-SHAPED TARGET IS NOT A NAME: that is fleet policy now (the php lane's `require_once
 * 'A.php'` correction), and the split gives it its own bucket rather than letting it inflate the
 * defect column.
 *
 * NO BASE-R TABLE EXISTS in this analyzer (`grep R_BUILTINS src/ast/r-analyzer.ts` finds
 * nothing), so the `nowhere` bucket is NOT subdivided into base-R versus library names here. That
 * sub-split is named as a bound rather than faked with a hand-written list.
 *
 * ## Degraded parses
 *
 * The dart lane lost a whole measurement to an unwritable diagnostics directory silently
 * degrading files to the regex fallback, so `fallback` and `analysisVersion 2.0-basic-fallback`
 * are counted and printed, with a banner when non-zero: a degraded file is not an analyzer
 * measurement.
 *
 * Run: npx tsx validation/m14/fixtures/r/incoming-census.mts [targetRepo] [sampleN]
 *      BB_R_MAX=<n> limits the population for a smoke test (a bounded run, not a census).
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, targetOwner } from "../../../../script/m14/incoming-rule"

const ROOT = process.cwd()
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const TARGET = process.argv[2] ?? "ggplot2"
const SAMPLE_N = Number(process.argv[3] ?? 60)
/** SMOKE LIMIT — a bounded run for checking the instrument, never a census. 0 = the whole
 *  admitted population. Printed with the population so a bounded run cannot be read as one. */
const MAX = Number(process.env.BB_R_MAX ?? 0)

// ---------------------------------------------------------------- population (the gate's rule)
const admittedAll: { abs: string; repo: string; rel: string }[] = []
let absent = 0
let overCap = 0
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".r")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) { overCap++; continue } } catch { absent++; continue }
    admittedAll.push({ abs, repo: name, rel })
  }
}
admittedAll.sort((a, b) => (a.abs < b.abs ? -1 : 1))
const admitted = MAX > 0 ? admittedAll.slice(0, MAX) : admittedAll
console.log(`admitted .R files ${admittedAll.length} across ${new Set(admittedAll.map((a) => a.repo)).size} repos; excluded ${absent} absent + ${overCap} over cap`)
if (MAX > 0) console.log(`*** BOUNDED SMOKE RUN: BB_R_MAX=${MAX} -> analysing ${admitted.length} files. THIS IS NOT A CENSUS. ***`)
console.log(`target project "${TARGET}" (${admittedAll.filter((a) => a.repo === TARGET).length} admitted files)`)

// ---------------------------------------------------------------- key spaces (one pass)
type KS = { decl: Map<string, number>; kinds: Map<string, Set<string>>; files: Map<string, Set<string>>; owners: Map<string, Set<string>> }
const newKS = (): KS => ({ decl: new Map(), kinds: new Map(), files: new Map(), owners: new Map() })
const addSym = (ks: KS, key: string, kind: string, file: string, owner: string) => {
  ks.decl.set(key, (ks.decl.get(key) ?? 0) + 1)
  let s = ks.kinds.get(key); if (!s) ks.kinds.set(key, (s = new Set())); s.add(kind)
  let f = ks.files.get(key); if (!f) ks.files.set(key, (f = new Set())); f.add(file)
  let o = ks.owners.get(key); if (!o) ks.owners.set(key, (o = new Set())); o.add(`${file}#${owner}`)
}
const byRepo = new Map<string, KS>()
const targetEdges: { label: string; tgt: string; claim: any }[] = []
let parsed = 0
let degraded = 0
const edgesPerRepo = new Map<string, number>()
let edgesAll = 0
for (const f of admitted) {
  let res: any
  try { res = await parseFile(f.abs, "r") } catch { continue }
  if (!res?.success) continue
  parsed++
  if (res.fallback === true || res.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
  let ks = byRepo.get(f.repo); if (!ks) byRepo.set(f.repo, (ks = newKS()))
  for (const s of res.symbols ?? []) {
    const n = String(s?.name ?? "")
    if (n.length === 0) continue
    const kind = String(s?.kind ?? "")
    const owner = String(s?.ownerName ?? "")
    addSym(ks, n, kind, f.rel, owner)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== n) addSym(ks, q, kind, f.rel, owner)
  }
  const rels = res.relationships ?? []
  edgesAll += rels.length
  edgesPerRepo.set(f.repo, (edgesPerRepo.get(f.repo) ?? 0) + rels.length)
  if (f.repo !== TARGET) continue
  for (const r of rels) {
    const tgt = String(r?.target ?? "")
    if (tgt) targetEdges.push({ label: String(r?.type ?? ""), tgt, claim: externalClaimOf(r) })
  }
}
console.log(`parsed ${parsed}/${admitted.length}; ${edgesAll} edges across the population; ${targetEdges.length} edges in "${TARGET}"`)
console.log(`degraded (regex fallback / analyzer fallback): ${degraded}${degraded > 0 ? "   *** A DEGRADED FILE IS NOT AN ANALYZER MEASUREMENT — re-run when the diagnostics path is writable ***" : ""}`)
const targetKS = byRepo.get(TARGET) ?? newKS()
console.log(`"${TARGET}" key space: ${targetKS.decl.size} keys`)

// ---------------------------------------------------------------- classification helpers
const isIdentifierLike = (t: string) => /^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(t)
const isFilenameLike = (t: string) => t.startsWith("__") || t.includes("/") || t.includes("\\") || /\.[A-Za-z0-9]{1,6}$/.test(t)
const shapeOf = (t: string): string => {
  if (isFilenameLike(t)) return "path-shaped"
  if (t.includes("::")) return "pkg::name"
  if (t.includes("$") || t.includes("@")) return "member-access"
  if (t.includes(".")) return "dotted"
  if (isIdentifierLike(t)) return "bare"
  return "other-non-identifier"
}
const MEMBER_KINDS = new Set(["method", "property", "function"])
const ambClass = (ks: KS, name: string): string => {
  const files = ks.files.get(name)?.size ?? 0
  const owners = ks.owners.get(name) ?? new Set<string>()
  const ownerNames = new Set([...owners].map((o) => o.slice(o.indexOf("#") + 1)))
  const kinds = ks.kinds.get(name) ?? new Set<string>()
  if (files > 1) return "multiFile"
  if (ownerNames.size > 1) return "oneFileDiffOwner"
  if (kinds.size > 1) return "oneFileSameOwnerDiffKind"
  return "sameKind"
}

function report(label: string, edges: { label: string; tgt: string; claim: any }[], ks: KS, allKS: Map<string, KS>, selfCheck?: { resolved: number; amb: number; unres: number; edges: number }) {
  const counts = new Map<string, number>()
  const rawCounts = new Map<string, number>()
  const ambNames = new Map<string, number>()
  const unresNames = new Map<string, number>()
  const where = { keySpaceBudget: 0, declaredHere: 0, anotherRepo: 0, nowhere: 0, pathShaped: 0 }
  const shapes = new Map<string, number>()
  const defectNames: string[] = []
  for (const e of edges) {
    const c = classifyEdge(ks.decl, ks.kinds, e.tgt, e.claim)
    counts.set(c.outcome, (counts.get(c.outcome) ?? 0) + 1)
    if (c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") ambNames.set(e.tgt, (ambNames.get(e.tgt) ?? 0) + 1)
    const raw = classifyEdge(ks.decl, ks.kinds, e.tgt, null)
    rawCounts.set(raw.outcome, (rawCounts.get(raw.outcome) ?? 0) + 1)
    if (raw.outcome !== "unresolved") continue
    unresNames.set(e.tgt, (unresNames.get(e.tgt) ?? 0) + 1)
    const sh = shapeOf(e.tgt)
    shapes.set(sh, (shapes.get(sh) ?? 0) + 1)
    if (sh === "path-shaped") { where.pathShaped++; continue }
    const inThis = (ks.decl.get(e.tgt) ?? 0) > 0
    const owner = targetOwner(e.tgt)
    const ownerHere = owner !== null && (ks.decl.get(owner) ?? 0) > 0
    const inOther = [...allKS].some(([r, other]) => r !== TARGET && ((other.decl.get(e.tgt) ?? 0) > 0 || (owner !== null && (other.decl.get(owner) ?? 0) > 0)))
    if (inThis || ownerHere) { where.declaredHere++; if (defectNames.length < 20) defectNames.push(e.tgt) }
    else if (inOther) where.anotherRepo++
    else where.nowhere++
  }
  const sumRaw = [...rawCounts.values()].reduce((a, b) => a + b, 0)
  console.log(`\n=== ${label} — ${edges.length} edges ===`)
  console.log(`  AS THE GATE CLASSIFIES IT (claims applied): ${[...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
  console.log(`  CLAIMS IGNORED: ${[...rawCounts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
  const unresolvedRaw = rawCounts.get("unresolved") ?? 0
  console.log(`  UNRESOLVED (claims ignored): ${unresolvedRaw} edges over ${unresNames.size} distinct names`)
  console.log(`    key-space BUDGET (declared in corpus, absent from this run's key space): ${where.keySpaceBudget}`)
  console.log(`    declared in THIS project (would be a DEFECT): ${where.declaredHere}${defectNames.length ? `  [${[...new Set(defectNames)].join(" ")}]` : ""}`)
  console.log(`    declared in ANOTHER repo: ${where.anotherRepo}`)
  console.log(`    declared NOWHERE in the corpus: ${where.nowhere}`)
  console.log(`    path-shaped (a FILE reference, never a defect): ${where.pathShaped}`)
  console.log(`    shapes: ${[...shapes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")}`)
  const amb = [...ambNames.values()].reduce((a, b) => a + b, 0)
  if (amb > 0) {
    const byClass = new Map<string, { names: number; edges: number }>()
    for (const [n, c] of ambNames) {
      const k = ambClass(ks, n)
      const cur = byClass.get(k) ?? { names: 0, edges: 0 }
      cur.names++; cur.edges += c
      byClass.set(k, cur)
    }
    console.log(`  AMBIGUOUS: ${amb} edges over ${ambNames.size} distinct names`)
    for (const [k, v] of [...byClass].sort((a, b) => b[1].edges - a[1].edges)) {
      console.log(`    ${k.padEnd(24)} ${String(v.names).padStart(4)} names ${String(v.edges).padStart(5)} edges`)
    }
    console.log(`    top: ${[...ambNames].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n}(${c})`).join(" ")}`)
  }
  const topUn = [...unresNames].sort((a, b) => b[1] - a[1]).slice(0, 12)
  console.log(`    top unresolved: ${topUn.map(([n, c]) => `${n}(${c})`).join(" ")}`)
  if (selfCheck) {
    const ok = (counts.get("resolved") ?? 0) === selfCheck.resolved &&
      ((counts.get("ambDeclOnly") ?? 0) + (counts.get("ambBoth") ?? 0)) === selfCheck.amb &&
      (counts.get("unresolved") ?? 0) === selfCheck.unres && sumRaw === selfCheck.edges
    console.log(`  SELF-CHECK vs the gate (${selfCheck.resolved} resolved / ${selfCheck.amb} ambiguous / ${selfCheck.unres} unresolved / ${selfCheck.edges} edges): ${ok ? "MATCH" : "*** MISMATCH — this instrument is not measuring the gate's sample ***"}`)
  }
  return {
    outcomes: Object.fromEntries(counts), rawOutcomes: Object.fromEntries(rawCounts),
    unresolvedRaw, unresolvedNames: unresNames.size, where, shapes: Object.fromEntries(shapes),
    ambiguousEdges: amb, ambiguousNames: ambNames.size, defectNames: [...new Set(defectNames)],
    topUnresolved: Object.fromEntries(topUn),
  }
}

// ---------------------------------------------------------------- SCOPE A: the gate's stride
const total = admitted.length
const stride = SAMPLE_N > 0 && total > SAMPLE_N ? Math.max(1, Math.floor(total / SAMPLE_N)) : 1
const sample: typeof admitted = []
for (let i = 0; i < admitted.length && sample.length < SAMPLE_N; i += stride) sample.push(admitted[i])
const sampleKS = new Map<string, KS>()
const sampleEdgesByRepo = new Map<string, { label: string; tgt: string; claim: any }[]>()
for (const f of sample) {
  let res: any
  try { res = await parseFile(f.abs, "r") } catch { continue }
  if (!res?.success) continue
  let ks = sampleKS.get(f.repo); if (!ks) sampleKS.set(f.repo, (ks = newKS()))
  for (const s of res.symbols ?? []) {
    const n = String(s?.name ?? ""); if (!n) continue
    const kind = String(s?.kind ?? "")
    const owner = String(s?.ownerName ?? "")
    addSym(ks, n, kind, f.rel, owner)
    const q = String(s?.qualifiedName ?? "")
    if (q && q !== n) addSym(ks, q, kind, f.rel, owner)
  }
  let list = sampleEdgesByRepo.get(f.repo); if (!list) sampleEdgesByRepo.set(f.repo, (list = []))
  for (const r of res.relationships ?? []) {
    const tgt = String(r?.target ?? "")
    if (tgt) list.push({ label: String(r?.type ?? ""), tgt, claim: externalClaimOf(r) })
  }
}
/** the sample's per-project verdict counts, summed — the numbers the gate printed */
const sampleTotals = new Map<string, number>()
const sampleAllEdges: { label: string; tgt: string; claim: any }[] = []
for (const [, list] of sampleEdgesByRepo) sampleAllEdges.push(...list)
for (const [repo, list] of sampleEdgesByRepo) {
  const ks = sampleKS.get(repo)!
  for (const e of list) {
    const c = classifyEdge(ks.decl, ks.kinds, e.tgt, e.claim)
    sampleTotals.set(c.outcome, (sampleTotals.get(c.outcome) ?? 0) + 1)
  }
}
console.log(`\n=== SCOPE A — the gate's ${SAMPLE_N}-file stride sample (per-project key space DRAWN BY THE SAMPLE) ===`)
console.log(`  AS THE GATE CLASSIFIES IT: ${[...sampleTotals].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
{
  const resolved = sampleTotals.get("resolved") ?? 0
  const amb = (sampleTotals.get("ambDeclOnly") ?? 0) + (sampleTotals.get("ambBoth") ?? 0)
  const unres = sampleTotals.get("unresolved") ?? 0
  const edges = [...sampleTotals.values()].reduce((a, b) => a + b, 0)
  // ONLY THE THREE NUMBERS THE GATE'S LINE STATES ARE ASSERTED. `resolved` is NOT asserted
  // against a remembered value: the gate prints resolved only in its table, and inventing the
  // number to check it against is how a self-check certifies itself instead of the instrument.
  const ok = amb === 175 && unres === 1714 && edges === 3055
  console.log(`  SELF-CHECK vs \`incoming-gate.ts r r ${SAMPLE_N}\` (175 ambiguous / 1714 unresolved / 3055 edges — the supervisor's refreshed run): ${ok ? "MATCH" : "*** MISMATCH — this instrument is not measuring the gate's sample ***"}`)
  console.log(`  resolved (computed): ${resolved} — implied 1166 only if no edge carries an external/binding/cause claim; this lane's marker columns are printed below`)
}

// ---------------------------------------------------------------- SCOPE A-2: the BUDGET split
// The gate's sample column is classified against the SAMPLE's key space (above, reproducing the
// gate). The BUDGET question is a different one: of those unresolved edges, how many name a
// declaration that IS in the corpus — the same repository, in a file the stride did not draw, or
// another repository — and would resolve if the run had the file? That can only be asked against
// the WHOLE-corpus key space, so it is asked separately rather than conflated with the verdict.
{
  const budget = { keySpaceBudget: 0, anotherRepo: 0, nowhere: 0, pathShaped: 0, declaredHere: 0 }
  const budgetNames = new Map<string, number>()
  const budgetShapes = new Map<string, number>()
  let unresolvedSample = 0
  for (const [repo, list] of sampleEdgesByRepo) {
    const sampleK = sampleKS.get(repo)!
    const wholeK = byRepo.get(repo) ?? newKS()
    for (const e of list) {
      if (classifyEdge(sampleK.decl, sampleK.kinds, e.tgt, null).outcome !== "unresolved") continue
      unresolvedSample++
      budgetNames.set(e.tgt, (budgetNames.get(e.tgt) ?? 0) + 1)
      const sh = shapeOf(e.tgt)
      budgetShapes.set(sh, (budgetShapes.get(sh) ?? 0) + 1)
      if (sh === "path-shaped") { budget.pathShaped++; continue }
      const owner = targetOwner(e.tgt)
      const inOwnRepo = (wholeK.decl.get(e.tgt) ?? 0) > 0 || (owner !== null && (wholeK.decl.get(owner) ?? 0) > 0)
      const inOther = [...byRepo].some(([r, other]) => r !== repo && ((other.decl.get(e.tgt) ?? 0) > 0 || (owner !== null && (other.decl.get(owner) ?? 0) > 0)))
      if (inOwnRepo) { budget.keySpaceBudget++; budget.declaredHere++ }
      else if (inOther) budget.anotherRepo++
      else budget.nowhere++
    }
  }
  const pct = (n: number) => unresolvedSample ? `${((n / unresolvedSample) * 100).toFixed(1)}%` : "0%"
  console.log(`\n=== SCOPE A-2 — THE KEY-SPACE BUDGET (claims ignored: ${unresolvedSample} unresolved over ${budgetNames.size} distinct names) ===`)
  console.log(`    key-space BUDGET (declared in the SAME repo, in a file the stride did not draw): ${budget.keySpaceBudget}  (${pct(budget.keySpaceBudget)})`)
  console.log(`    declared in ANOTHER repo (external to this project, in corpus): ${budget.anotherRepo}  (${pct(budget.anotherRepo)})`)
  console.log(`    declared NOWHERE in the corpus (base R / CRAN / not carried): ${budget.nowhere}  (${pct(budget.nowhere)})`)
  console.log(`    path-shaped (a FILE reference, never a defect): ${budget.pathShaped}  (${pct(budget.pathShaped)})`)
  console.log(`    RESOLVES WITH A BIGGER KEY SPACE: ${budget.keySpaceBudget + budget.anotherRepo} of ${unresolvedSample} (${pct(budget.keySpaceBudget + budget.anotherRepo)}) — the rest names nothing this corpus declares`)
  console.log(`    shapes: ${[...budgetShapes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")}`)
  ;(globalThis as any).__budget = { unresolvedSample, ...budget, distinctNames: budgetNames.size, shapes: Object.fromEntries(budgetShapes) }
}

// ---------------------------------------------------------------- SCOPE B: whole target repo
const projectReport = report(
  `SCOPE B — whole project "${TARGET}" (${targetEdges.length} edges, its own complete key space)`,
  targetEdges, targetKS, byRepo,
)

const artifact = {
  generatedAt: new Date().toISOString(),
  corpusRoot: CR,
  targetProject: TARGET,
  bounded: MAX > 0 ? { BB_R_MAX: MAX, analysed: admitted.length, admitted: admittedAll.length } : null,
  population: { admitted: admittedAll.length, repos: new Set(admittedAll.map((a) => a.repo)).size, parsed, degraded, edgesAll, targetEdges: targetEdges.length },
  sampleScope: { n: sample.length, outcomes: Object.fromEntries(sampleTotals), edges: sampleAllEdges.length, budget: (globalThis as any).__budget ?? null },
  projectScope: projectReport,
}
const outPath = path.join(ROOT, "validation/m14/fixtures/r/incoming-census.json")
writeFileSync(outPath, JSON.stringify(artifact, null, 2))
console.log(`\nartifact: validation/m14/fixtures/r/incoming-census.json`)
