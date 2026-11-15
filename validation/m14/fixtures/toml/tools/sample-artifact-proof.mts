/**
 * SAMPLE-ARTIFACT PROOF — why the bounded 400-file toml gate reads 316 unresolved while the SAME
 * analyzer over the whole admitted population reads 5.
 *
 * ## The question this answers
 *
 * `bun run script/m14/incoming-gate.ts toml toml 400` reads:
 *
 *     TOTAL 6274 edges · resolved 5879 · amb 0 · unresolved 316   (references 315 · imports 1)
 *
 * and `bun run script/m14/incoming-gate.ts toml toml 0` (the WHOLE admitted population, SAME
 * analyzer, SAME revision) reads:
 *
 *     TOTAL 26714 edges · resolved 26383 · amb 0 · unresolved 5   (references 0 · imports 5)
 *
 * 315 references are unresolved in the bounded run and 0 in the whole run. A residual that
 * disappears when the population grows is a statement about the POPULATION, not about the
 * analyzer — but "that must be sampling" is an argument, and this programme does not accept
 * arguments where a measurement is possible. So this probe measures it edge by edge:
 *
 *   For every `references` edge the BOUNDED run cannot resolve, does the declaration the edge
 *   names exist in the REAL project key space, and does the file that declares it lie OUTSIDE the
 *   bounded run's file set?
 *
 * If both are yes for every edge, the bounded column is a stride artifact and no analyzer change
 * can address it (the analyzer already emits exactly the target the declaration answers to; the
 * declaring FILE is simply absent from the run). If any edge's target is declared by a file that
 * IS in the run, that edge is a genuine analyzer-side miss and the conclusion flips.
 *
 * ## Method
 *
 *   1. Read the gate's OWN 400-file population from `sample400-list.txt` (produced by running the
 *      gate with `BB_LIST_FILES=1`, which prints the discovered set and exits before parsing).
 *      The list is the gate's, never a re-derived stride: deriving it here would measure this
 *      probe's stride, not the gate's.
 *   2. Parse the WHOLE admitted population (`parseFile(abs, repo, { projectRoot: repo })` — the
 *      identical production-path call `incoming-gate.ts:…` makes) and build each project's key
 *      space: `name` plus the non-empty non-identical `qualifiedName` alias, exactly the gate's
 *      `countKey` rule. Record each declaration's FILE.
 *   3. Parse the 400 sampled files and resolve every `references` edge against the SAMPLE key
 *      space alone (the bounded run's scope), counting resolved / ambiguous / unresolved.
 *   4. For every unresolved-in-sample references edge: look the target up in the FULL key space.
 *      Report how many are declared in the real project and whether every declaring file is
 *      outside the sample set.
 *
 * The key-space rule and the `resolved` predicate (`decls === 1`; `decls > 1` ambiguous; 0
 * unresolved) are transcribed from `incoming-gate.ts`/`incoming-rule.ts`; the sample-count column
 * is CHECKED against the gate's printed table before any conclusion is drawn, so a probe that
 * disagrees with its instrument is reported as probe error, not as a finding.
 *
 * READ-ONLY on the corpus. Writes only the artifact named by --out=.
 *
 *   bun run validation/m14/fixtures/toml/tools/sample-artifact-proof.mts
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(fileURLToPath(new URL("../../../../../", import.meta.url)))
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = ["toml"]
const LIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "sample400-list.txt")
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "sample-artifact-proof.txt")

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const RULE = await import(path.join(ROOT, "script/m14/incoming-rule.ts"))

const repoOf = (f: string): string => path.join(CR, path.relative(CR, f).split(path.sep)[0])
const relOf = (repo: string, f: string): string => path.relative(repo, f).split(path.sep).join("/")

/** THE GATE'S ADMISSION RULE, transcribed from `discoverFiles`: every tracked file under a git
 *  repository at the corpus root, matching the extension, present on disk, under the size cap. */
function discover(): { files: string[]; repos: string[]; absent: number; overCap: number } {
  const files: string[] = []
  const repos: string[] = []
  let absent = 0
  let overCap = 0
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      if (!EXTS.some((e) => low.endsWith(`.${e}`))) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
      } catch { absent++; continue }
      files.push(abs)
    }
    repos.push(name)
  }
  files.sort()
  return { files, repos, absent, overCap }
}

type Decl = { file: string; line: number | null }
type Space = Map<string, Map<string, Decl[]>> // repo -> key -> declarations

const counts = (sp: Space, repo: string, key: string): number => sp.get(repo)?.get(key)?.length ?? 0
const declsOf = (sp: Space, repo: string, key: string): Decl[] => sp.get(repo)?.get(key) ?? []

function countKey(sp: Space, repo: string, key: string, file: string, line: number | null) {
  let byKey = sp.get(repo)
  if (!byKey) sp.set(repo, (byKey = new Map()))
  const at = byKey.get(key)
  if (!at) byKey.set(key, [{ file, line }])
  else if (!at.some((d) => d.file === file && d.line === line)) at.push({ file, line })
}

/** The gate's key rule: `name` AND the qualifiedName alias when it is non-empty and differs. */
function indexSymbols(sp: Space, repo: string, file: string, symbols: any[]) {
  for (const s of symbols) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const line = Number(s?.range?.startLine ?? s?.range?.start_line ?? s?.range?.line_start ?? s?.line_start ?? s?.lineStart ?? s?.startLine ?? s?.line ?? 0) || null
    countKey(sp, repo, name, file, line)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) countKey(sp, repo, q, file, line)
  }
}

const out: string[] = []
const say = (s: string) => { out.push(s); console.log(s) }

// ── STEP 1 — the gate's own bounded population ───────────────────────────────────────────────────
const listText = readFileSync(LIST, "utf8")
const sampleFiles = listText.split("\n").filter((l) => l.startsWith("BB_LIST_FILES_FILE: ")).map((l) => l.slice("BB_LIST_FILES_FILE: ".length).trim())
const listHeader = listText.split("\n").find((l) => l.startsWith("BB_LIST_FILES: ")) ?? ""
const sampleSet = new Set(sampleFiles)
say(`BOUNDED POPULATION — the gate's own, read from ${path.basename(LIST)}: ${sampleFiles.length} files`)
say(`  header: ${listHeader}`)

// ── STEP 2 — parse the whole population; build the FULL and the SAMPLE key spaces ───────────────
const pop = discover()
say(`WHOLE ADMITTED POPULATION — ${pop.files.length} .toml files across ${pop.repos.length} repos (absent ${pop.absent}, over cap ${pop.overCap})`)

const full: Space = new Map()
const sample: Space = new Map()
/** workspace-inheritance references seen in the SAMPLE files, by their source file */
const sampleRefs: { file: string; line: number | null; target: string; meta: any }[] = []
/** every `references`/`imports` edge of the WHOLE population, for STEP 6/7 */
const wholeEdges: { type: string; file: string; line: number | null; target: string; meta: any }[] = []
let parsed = 0
let failed = 0
let sampleParsed = 0
let sampleAbsent = 0
for (const abs of pop.files) {
  const repo = repoOf(abs)
  let r: any
  try { r = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  indexSymbols(full, repo, abs, Array.isArray(r.symbols) ? r.symbols : [])
  const inSample = sampleSet.has(abs)
  if (inSample) {
    sampleParsed++
    indexSymbols(sample, repo, abs, Array.isArray(r.symbols) ? r.symbols : [])
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    // `parseFile`'s relationships already carry the canonical type spelling the gate's
    // `ontologyName` normalises to — proven by the STEP 3 check below, which reproduces the gate's
    // references row exactly (397 / 82 / 0 / 315).
    const type = String(rel?.type ?? rel?.relationshipType ?? "")
    if (type !== "references" && type !== "imports") continue
    const e = {
      type,
      file: abs,
      line: Number(rel?.line_number ?? rel?.lineNumber ?? rel?.line ?? 0) || null,
      target: String(rel?.target ?? rel?.to ?? ""),
      meta: rel?.metadata ?? {},
      rel,
    }
    wholeEdges.push(e)
    if (inSample && type === "references") sampleRefs.push(e)
  }
  if (parsed % 500 === 0) process.stderr.write(`  … ${parsed}/${pop.files.length} parsed\n`)
}
// files named in the gate's list but absent from disk would be an admission-rule disagreement;
// report it rather than silently shrinking the sample.
for (const f of sampleFiles) if (!pop.files.includes(f)) sampleAbsent++
say(`PARSED — whole ${parsed}/${pop.files.length} (failed ${failed}) · of the gate's ${sampleFiles.length} bounded files, ${sampleParsed} parsed here (missing from this probe's discovery: ${sampleAbsent})`)
say("")

// ── STEP 3 — resolve the sample's `references` edges against the SAMPLE key space ───────────────
type Res = { resolved: number; ambiguous: number; unresolved: number; unplaced: number }
const sampleRes: Res = { resolved: 0, ambiguous: 0, unresolved: 0, unplaced: 0 }
const fullRes: Res = { resolved: 0, ambiguous: 0, unresolved: 0, unplaced: 0 }
/** every references edge in the bounded run that the bounded run cannot resolve */
const unresolvedInSample: { file: string; repo: string; line: number | null; target: string; declsInFull: Decl[]; workspaceRef: boolean }[] = []
for (const e of sampleRefs) {
  const repo = repoOf(e.file)
  const nSample = counts(sample, repo, e.target)
  if (nSample === 1) sampleRes.resolved++
  else if (nSample > 1) sampleRes.ambiguous++
  else sampleRes.unresolved++
  const nFull = counts(full, repo, e.target)
  if (nFull === 1) fullRes.resolved++
  else if (nFull > 1) fullRes.ambiguous++
  else fullRes.unresolved++
  if (nSample === 0) unresolvedInSample.push({
    file: e.file,
    repo,
    line: e.line,
    target: e.target,
    declsInFull: declsOf(full, repo, e.target),
    workspaceRef: e.meta?.isWorkspaceInheritance === true,
  })
}
say("STEP 3 — the bounded run's `references` row, re-derived from the bounded run's own file set")
say(`  references edges in the bounded population: ${sampleRefs.length}`)
say(`  resolved (exactly ONE declaration in the SAMPLE key space):  ${sampleRes.resolved}`)
say(`  ambiguous (MORE than one):                                  ${sampleRes.ambiguous}`)
say(`  unresolved (NOTHING in the SAMPLE key space):               ${sampleRes.unresolved}`)
say(`  [same edges against the WHOLE key space: resolved ${fullRes.resolved} · ambiguous ${fullRes.ambiguous} · unresolved ${fullRes.unresolved}]`)
say("")
say("CHECK AGAINST THE GATE — the bounded gate prints references 397 edges · 82 resolved · 0 ambiguous · 315 unresolved.")
say(`  edge count ${sampleRefs.length === 397 ? "MATCH" : `MISMATCH (${sampleRefs.length} vs 397)`} · resolved ${sampleRes.resolved === 82 ? "MATCH" : `MISMATCH (${sampleRes.resolved} vs 82)`} · ambiguous ${sampleRes.ambiguous === 0 ? "MATCH" : `MISMATCH (${sampleRes.ambiguous} vs 0)`} · unresolved ${sampleRes.unresolved === 315 ? "MATCH" : `MISMATCH (${sampleRes.unresolved} vs 315)`}`)
say("")

// ── STEP 4 — for each unresolved-in-sample edge, WHERE is its declaration? ─────────────────────
let declaredInFull = 0
let declaredOnlyOutsideSample = 0
let declaredInsideSample = 0
let nowhere = 0
let wsRefs = 0
const byWorkspaceRootFile = new Map<string, number>()
const rows: string[] = []
for (const u of unresolvedInSample) {
  if (u.workspaceRef) wsRefs++
  if (u.declsInFull.length === 0) { nowhere++; continue }
  declaredInFull++
  const outside = u.declsInFull.every((d) => !sampleSet.has(d.file))
  if (outside) declaredOnlyOutsideSample++
  else declaredInsideSample++
  for (const d of u.declsInFull) {
    const k = `${relOf(CR, d.file)}`
    byWorkspaceRootFile.set(k, (byWorkspaceRootFile.get(k) ?? 0) + 1)
  }
  if (rows.length < 25) {
    const rel = relOf(u.repo, u.file)
    const declFiles = u.declsInFull.map((d) => `${relOf(CR, d.file)}:${d.line}`).join(" , ")
    rows.push(`  ${rel}:${u.line}  target=${JSON.stringify(u.target)}  isWorkspaceInheritance=${u.workspaceRef}  declares-in=${declFiles}  outside-sample=${outside}`)
  }
}
say(`STEP 4 — of the ${unresolvedInSample.length} references edges the BOUNDED run cannot resolve:`)
say(`  target declared in the REAL project key space:              ${declaredInFull}`)
say(`     of those, every declaring file is OUTSIDE the bounded run: ${declaredOnlyOutsideSample}`)
say(`     of those, a declaring file is INSIDE the bounded run:     ${declaredInsideSample}   <-- would be a GENUINE analyzer miss`)
say(`  target declared NOWHERE in the whole population:           ${nowhere}`)
say(`  carry metadata.isWorkspaceInheritance:                     ${wsRefs}`)
say("")
say("  per-edge detail (first 25):")
for (const r of rows) say(r)
if (rows.length < unresolvedInSample.length) say(`  … ${unresolvedInSample.length - rows.length} more (all counted above)`)
say("")
say("  declaring files for the unresolved-in-sample targets, by count:")
for (const [f, n] of [...byWorkspaceRootFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) say(`    ${n}  ${f}`)
say("")

// ── STEP 4b — THE FORBIDDEN FIX, PRICED: rebase the target onto its leaf ────────────────────────
// The brief names the trap: "rebasing into a basename-stem target mass-moves edges from unresolved
// into collRes — from no answer to a tie-break the indexer measures ~75% wrong." This lane does not
// walk that road; this step PRICES it on the same 315 edges so a future reader cannot mistake the
// refusal for caution. For each unresolved-in-sample target, the leaf is the last dot segment (for
// the workspace targets that is the INHERITED FIELD, e.g. "edition"); the table below counts how
// many declarations in the sample and in the whole key space answer that leaf.
const leafTally = (space: Space, repo: string, target: string) => {
  const leaf = target.split(".").pop() ?? target
  const n = counts(space, repo, leaf)
  return { leaf, n }
}
let leaf0Sample = 0, leaf1Sample = 0, leafN_Sample = 0, leaf0Full = 0, leaf1Full = 0, leafN_Full = 0
const leafExamples: string[] = []
for (const u of unresolvedInSample) {
  const s1 = leafTally(sample, u.repo, u.target)
  const f1 = leafTally(full, u.repo, u.target)
  if (s1.n === 0) leaf0Sample++; else if (s1.n === 1) leaf1Sample++; else leafN_Sample++
  if (f1.n === 0) leaf0Full++; else if (f1.n === 1) leaf1Full++; else leafN_Full++
  if (leafExamples.length < 10) leafExamples.push(`  ${JSON.stringify(u.target)} -> leaf ${JSON.stringify(s1.leaf)}: declarations in SAMPLE ${s1.n}, in WHOLE project ${f1.n}`)
}
say("STEP 4b — THE FORBIDDEN REBASE, PRICED: leaf = last dot segment of each unresolved-in-sample target")
say(`  in the SAMPLE key space:  leaf names 0 declarations ${leaf0Sample} · exactly 1 ${leaf1Sample} · MORE THAN ONE ${leafN_Sample}`)
say(`  in the WHOLE key space:   leaf names 0 declarations ${leaf0Full} · exactly 1 ${leaf1Full} · MORE THAN ONE ${leafN_Full}`)
for (const r of leafExamples) say(r)
say(`  AN EDGE WHOSE LEAF ANSWERS NOTHING IS NOT A RESOLUTION, IT IS A DIFFERENT UNRESOLVED TARGET. And a leaf that`)
say(`  answers MORE THAN ONE declaration is a collRes pick — the tie-break class the indexer measures ~75% wrong.`)
say("")

// ── STEP 5 — the DECLARED-CAUSE channel, run rather than assumed ────────────────────────────────
// The brief's fleet-wide cause (a) is "the lane computes the reason and publishes it on a key the
// gate does not read". The gate DOES read one cause key: `baseBeyondRunScope`. This step asks the
// gate's own rule whether toml's 5 whole-population unresolved edges could legitimately use it —
// by calling `classifyEdge` with the claim, which is the arbiter's own test, not a reading of it.
const CAUSE = RULE.CAUSE_CLAIM_KEY as string
const emptyDecl = new Map<string, number>()
const emptyKinds = new Map<string, Set<string>>()
const oneTarget = new Map<string, number>([["dependency", 0]])
say("STEP 5 — the DECLARED-CAUSE channel (`baseBeyondRunScope`), exercised through `classifyEdge`:")
for (const tgt of ["dependency", "SubProjectB"]) {
  const withClaim = RULE.classifyEdge(emptyDecl, emptyKinds, tgt, { kind: "cause", base: tgt, conflict: false })
  say(`  target=${JSON.stringify(tgt)}  metadata.${CAUSE}=${JSON.stringify(tgt)}  ->  outcome=${withClaim.outcome}  (targetOwner=${JSON.stringify(RULE.targetOwner(tgt))})`)
}
say("  A bare target has NO owner, so `owner === base` cannot hold and the claim is REFUTED. Publishing the")
say("  reason on the cause key would move these edges from `unresolved` to `causeREFUTED`, which the gate")
say("  counts AGAINST the lane (causeFAIL) — a laundered cause is worse than an honest gap.")
say("")
say("  (targetOwner is exposed so this arm cannot silently go stale: " + typeof RULE.targetOwner + ")")
say("")

// ── STEP 6 — the WHOLE population's residual, edge by edge (the number the verdict is about) ────
// Collected during the full parse: every `imports` edge the whole key space does not answer. This is
// the 5 the whole-population gate prints, and the reason this probe can locate them while the gate's
// worklist caps at 25 names is that it keeps every edge rather than a sample.
const fullImportsUnresolved: { file: string; repo: string; line: number | null; target: string; md: any }[] = []
let importsTotal = 0
let importsClaimed = 0
let importsUnclaimed = 0
for (const e of wholeEdges) {
  if (e.type !== "imports") continue
  importsTotal++
  const repo = repoOf(e.file)
  // THE GATE'S OWN CLAIM PREDICATE, not a re-reading of the metadata: an edge with a claim the rule
  // can verify is extOK, not unresolved. Unresolved = names nothing AND carries no claim.
  const claim = RULE.externalClaimOf((e as any).rel)
  if (claim !== null) { importsClaimed++; continue }
  importsUnclaimed++
  if (counts(full, repo, e.target) > 0) continue
  fullImportsUnresolved.push({ file: e.file, repo, line: e.line, target: e.target, md: e.meta })
}
say(`STEP 6 — WHOLE-POPULATION \`imports\`: ${importsTotal} edges · ${importsClaimed} carry a claim · ${importsUnclaimed} carry none`)
say(`         UNRESOLVED (names nothing in the project key space AND carries no claim): ${fullImportsUnresolved.length} edges (the gate prints 5)`)
for (const u of fullImportsUnresolved) {
  const md = u.md ?? {}
  const claim = typeof md.importProjectFile === "string" ? `importProjectFile=${md.importProjectFile}` : typeof md.sourcePathClaim !== "undefined" ? "sourcePathClaim" : "none"
  say(`  ${relOf(u.repo, u.file)}:${u.line}  target=${JSON.stringify(u.target)}  claim=${claim}  isPathDependency=${md.isPathDependency === true}`)
}
say("")
const wholeRefs = wholeEdges.filter((e) => e.type === "references")
const wholeRefsUnresolved: typeof fullImportsUnresolved = []
let refsResolvedUniquely = 0
for (const e of wholeRefs) {
  const repo = repoOf(e.file)
  const n = counts(full, repo, e.target)
  if (n === 0) wholeRefsUnresolved.push({ file: e.file, repo, line: e.line, target: e.target, md: e.meta })
  else if (n === 1) refsResolvedUniquely++
}
say(`STEP 6b — WHOLE-POPULATION \`references\` residual: ${wholeRefsUnresolved.length} edges (the gate prints 0) of ${wholeRefs.length}; ${refsResolvedUniquely} resolve to exactly one declaration in their own project.`)
say("")

// ── STEP 7 — the hand-read population: cross-file workspace-inheritance references ───────────────
// STEP 5 of the lane brief asks for ten edges read by hand against the declaration they MEAN. This
// lane lands no new edge (the residual is a population artifact plus a ruled boundary), so the ten
// are taken from the highest-risk class the lane ALREADY resolves — the file-crossing
// `arbitraryTwin` references the gate's intent block counts (1,085 whole population, `ofWhich` 0).
// Every row carries the member's own line and the ROOT MANIFEST line its target names, so the check
// is "does the root declare the inherited path at this line", not "did the name match".
const crossFile = wholeEdges
  .filter((e) => e.type === "references" && e.meta?.isWorkspaceInheritance === true)
  .map((e) => {
    const repo = repoOf(e.file)
    const decl = declsOf(full, repo, e.target)
    const sameFile = decl.some((d) => d.file === e.file)
    return { ...e, repo, decl, sameFile }
  })
  .filter((e) => e.decl.length === 1 && !e.sameFile)
  .sort((a, b) => relOf(CR, a.file).localeCompare(relOf(CR, b.file)) || (a.line ?? 0) - (b.line ?? 0))
const stride = Math.max(1, Math.floor(crossFile.length / 10))
const ten = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => crossFile[Math.min(i * stride, crossFile.length - 1)]).filter(Boolean)
say(`STEP 7 — the hand-read population: ${crossFile.length} file-crossing workspace-inheritance references resolve to exactly ONE declaration in a DIFFERENT file; stride ${stride}, 10 taken`)
for (const e of ten) {
  const d = e.decl[0]
  say(`  ${relOf(CR, e.file)}:${e.line}  ->  target=${JSON.stringify(e.target)}  =>  ${relOf(CR, d.file)}:${d.line}  inheritedPath=${JSON.stringify(e.meta?.inheritedPath)}  inheritedFrom=${JSON.stringify(e.meta?.inheritedFrom)}`)
}
say("")

writeFileSync(OUT, out.join("\n") + "\n")
console.log(`\nwrote ${OUT}`)
