/**
 * STORE BINDING TRUTH — what the REAL indexer binds each HCL edge to.
 *
 * ## Why this file exists
 *
 * `ontology-coverage-gate.ts`/`incoming-gate.ts` classify an edge by a NAME-MATCH count computed in
 * TypeScript: a target is `amb(decl)` when N declarations in the project share its name or
 * qualifiedName. That is a MODEL of resolution, not resolution. The graph a consumer walks is
 * `brain_relationship.target_symbol_id`, written by SQL in `parallel-indexer.ts`, and its rules are
 * not the model's:
 *
 *   contains      resolved at INSERT time by (name, the edge's OWN FILE first, then LINE)
 *                 — `resolveContainsTargetStmt`, kept eager while every other type defers;
 *   pass 1        `target_external = qualified_name` exact, INSERT OR IGNORE (duplicate qname → MIN(id));
 *   pass 2        `target_external = name`, when that name is unique project-wide;
 *   pass I13      for NON-`contains` rows whose target has no `.` and no `:`, a name-match rebind
 *                 ranked (declaration, same-file, same-language, id) — a DOTTED target is excluded.
 *
 * So an edge whose target repeats across a repository can still bind to its own file's declaration,
 * while the gate's model calls it ambiguous. That matters here because HCL's residual is dominated
 * by exactly that shape (contains amb(decl) 68,299), and the proposed fix — file-scoping the lane's
 * PUBLIC qualified name, which every fixture pin moves with — is only justified if the STORE also
 * fails to bind. This file answers that with the store's own columns.
 *
 * ## Discipline
 *
 * - REAL indexer, REAL store: production `indexProjectParallel`, then SQL over `brain_relationship`
 *   joined to `brain_symbol`/`brain_file`. No modelled SQL, no predicted bindings.
 * - ONE PROJECT, so the two numbers can be compared: the draw is every tracked HCL file of ONE
 *   repository (`BB_CLEAN_TRUTH_REPOS`, default `terraform`), copied into a scratch project, whose id
 *   is derived by production's own `getProjectId`.
 * - The corpus is copied, never written; the scratch project and its database are removed on exit.
 * - A BROKEN STORE IS DISCLOSED, NOT READ THROUGH: if the store holds zero symbols for the project,
 *   the run says so and exits 2 rather than printing binding numbers derived from nothing.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/hcl/tools/store-binding-truth.clean.mts
 *   BB_CLEAN_TRUTH_REPOS=terragrunt npx tsx …   # another project
 *   BB_CLEAN_TRUTH_MAX=800 npx tsx …            # bound the draw (the gate's --repo run is then the
 *                                             # comparison population, not the whole repository)
 *   BB_CLEAN_TRUTH_OUT=…                        # write the full report as JSON
 *
 * `BB_DATA_DIR` is REQUIRED unless the default `~/.bb` is writable by the caller: the indexer writes
 * `projects/<id>/brain.db`, and this process only needs that inside a scratch area. Measured in a
 * sandboxed session: without the override the run dies with `ENOENT: mkdir ~/.bb/projects/<id>`,
 * which reads like a missing database and is a missing PERMISSION.
 */
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"

const REPO_ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = (process.env.BB_CLEAN_TRUTH_REPOS ?? "terraform").split(",").map((s) => s.trim()).filter(Boolean)
const MAX = Number(process.env.BB_CLEAN_TRUTH_MAX ?? 0)
const SIZE_CAP = 1024 * 1024 // the engine's own admission cap
const OUT = process.env.BB_CLEAN_TRUTH_OUT ?? ""
// NIM variant — cross-lane measurement. Instruction: "do not edit nim's files; measure and report".
// Placed in this lane's tools dir because it is this lane's instrument, adapted (extensions + env
// names only); the population is nim because it carries the programme's largest `arbitraryTwin`
// population (calls 70,223 of 118,262 edges) and hcl's own twin count is 0.
// CLEAN variant — the SECOND population for the pre-registered twin buckets (docs/analyzers/history/hcl-lane-notes.md
// §8 Cause 20/21). The Lead asked for a second population because nim is the CLEANEST one
// (leafReduced 0 in every type) and a verdict there is not yet evidence for lanes where leaf
// reduction does the binding. Clean is chosen because it carries references twin 6,650.
const EXTENSIONS = [".icl", ".dcl"]

// ───────────────────────────────────────────────────────────── corpus discovery (one project)
type FileRow = { repo: string; rel: string; abs: string }
const rows: FileRow[] = []
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  if (!existsSync(dir)) { console.error(`no such repo: ${dir}`); continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const lower = rel.toLowerCase()
    if (!EXTENSIONS.some((x) => lower.endsWith(x))) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    rows.push({ repo, rel, abs })
  }
}
rows.sort((a, b) => (a.repo === b.repo ? (a.rel < b.rel ? -1 : 1) : a.repo < b.repo ? -1 : 1))
const admitted = rows.length
// A BOUNDED DRAW IS A STRIDE, NOT A PREFIX: the first N paths of a repository are one directory
// subtree (terragrunt's are `.circleci`/`cli`/`config`), so a prefix measures a different population
// from the one the lane claims. Same rule the firing-check learned the hard way.
const sample = (() => {
  if (MAX <= 0 || rows.length <= MAX) return rows
  const stride = rows.length / MAX
  const out: FileRow[] = []
  for (let i = 0; i < MAX; i++) out.push(rows[Math.floor(i * stride)])
  return out
})()
const DRAW = (() => {
  const h = createHash("sha256")
  for (const f of sample) {
    let size = -1
    try { size = statSync(f.abs).size } catch { /* vanished */ }
    h.update(`${f.repo}/${f.rel} ${size}\n`)
  }
  return h.digest("hex").slice(0, 16)
})()

// ───────────────────────────────────────────────────── scratch project + production index
const root = mkdtempSync(path.join(tmpdir(), "bb-hcl-truth-"))
let copied = 0
for (const f of sample) {
  const dest = path.join(root, f.repo, f.rel)
  mkdirSync(path.dirname(dest), { recursive: true })
  try { cpSync(f.abs, dest); copied++ } catch { /* a file that will not copy cannot be indexed */ }
}
console.log(`store binding truth — hcl, project(s) ${REPOS.join(",")}`)
console.log(`  draw ${DRAW}  files ${copied} of ${admitted} admitted  scratch ${root}`)

const t0 = Date.now()
const { indexProjectParallel, discoverIndexableFiles } = await import(`${REPO_ROOT}/src/ast/parallel-indexer.ts`)
const { BrainDatabase } = await import(`${REPO_ROOT}/src/brain/database.ts`)
const { getProjectId } = await import(`${REPO_ROOT}/src/cli/index.ts`)

/**
 * THE ELIGIBLE SET — what the indexer WOULD index, from its own discovery function.
 *
 * This is not bookkeeping: the gate builds its population from `git ls-files` + the language router,
 * while production's discovery applies its own rules, and the difference is enormous in exactly the
 * repositories this lane measures. The indexer carries a built-in ignore for test-data directories
 * whose name is `testData` (glob-star, slash, name, slash, glob-star), and the `ignore` package
 * matches it CASE-INSENSITIVELY — measured: an ignore list holding that one glob reports
 * `ignored=true` for `testdata/x.tf` AND for `a/testData/b.tf`. So every lowercase `testdata`
 * directory is skipped too, and terraform keeps the bulk of its `.tf`/`.hcl` files under
 * `internal/.../testdata/...`. A gate number over those files is a number about a population the
 * store never sees, so the two are only comparable over this set.
 */
const eligible = new Set(await discoverIndexableFiles(root))
const eligibleSample = sample.filter((f) => eligible.has(path.join(root, f.repo, f.rel)))
const excludedSegments = new Map<string, number>()
for (const f of sample) {
  if (eligible.has(path.join(root, f.repo, f.rel))) continue
  const segs = f.rel.split("/")
  const named = segs.find((s) => s.toLowerCase() === "testdata") ?? segs.find((s) => s.startsWith(".")) ?? segs[0]
  excludedSegments.set(named, (excludedSegments.get(named) ?? 0) + 1)
}
console.log(`  indexer-eligible ${eligibleSample.length} of ${copied} copied (${eligible.size} paths discovered); ` +
  `top exclusions ${[...excludedSegments.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k}=${n}`).join(" ")}`)
if (eligibleSample.length === 0) {
  console.error("REFUSING to measure: the indexer's own discovery admits NONE of the drawn files, so the store " +
    "would hold nothing and every binding number below would be about an empty index.")
  rmSync(root, { recursive: true, force: true })
  process.exit(2)
}

const PID = getProjectId(root)
let stats: any
try {
  stats = await indexProjectParallel(PID as any, root, {})
} catch (e) {
  console.error(`index failed: ${(e as Error)?.message ?? e}`)
  rmSync(root, { recursive: true, force: true })
  process.exit(2)
}
const indexMs = Date.now() - t0
const raw = await BrainDatabase.getRawInstance(PID as any)

// ──────────────────────────────────────────────────────────────── store health, first
const symCount = (raw.prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE project_id = ?").get(PID) as any)?.c ?? 0
const fileCount = (raw.prepare("SELECT COUNT(*) AS c FROM brain_file WHERE project_id = ?").get(PID) as any)?.c ?? 0
if (symCount === 0) {
  console.error(`BROKEN STORE: 0 symbols stored for project ${PID} (${copied} files copied, index reported ` +
    `${stats?.symbols ?? "?"} symbols) — refusing to print binding numbers derived from an empty store.`)
  rmSync(root, { recursive: true, force: true })
  process.exit(2)
}

// ──────────────────────────────────────────────────────────────── read the store's own verdict
type Row = {
  type: string
  target_external: string | null
  source_bound: number
  target_bound: number
  same_file: number | null
  tgt_name: string | null
  tgt_qname: string | null
  tgt_line: number | null
  src_file_id: number | null
  tgt_file_id: number | null
  line_number: number | null
  own_file_answers: number | null
  own_file_answers_on_line: number | null
  any_file_answers: number | null
  reaching_bound_import: number | null
  source_unbound_imports: number | null
  anchored_imports_in_source_file: number | null
  project_unanchored_imports: number | null
}
const storeRows = raw.prepare(`
  SELECT r.relationship_type AS type,
         r.target_external AS target_external,
         CASE WHEN r.source_symbol_id IS NULL THEN 0 ELSE 1 END AS source_bound,
         CASE WHEN r.target_symbol_id IS NULL THEN 0 ELSE 1 END AS target_bound,
         CASE WHEN ss.file_id = ts.file_id THEN 1 ELSE 0 END AS same_file,
         ts.name AS tgt_name,
         ts.qualified_name AS tgt_qname,
         ts.line_start AS tgt_line,
         ss.file_id AS src_file_id,
         ts.file_id AS tgt_file_id,
         r.line_number AS line_number,
         /** DOES A DECLARATION IN THE EDGE'S OWN FILE ANSWER TO THE TARGET? This is the question a
          *  file-scoped identity would answer YES to, and the price of the lever is the population
          *  where it is YES while the store bound elsewhere (or nowhere). */
         (SELECT COUNT(*) FROM brain_symbol x
            WHERE x.project_id = r.project_id AND x.file_id = ss.file_id
              AND (x.name = r.target_external OR x.qualified_name = r.target_external)) AS own_file_answers,
         (SELECT COUNT(*) FROM brain_symbol x
            WHERE x.project_id = r.project_id AND x.file_id = ss.file_id AND x.line_start = r.line_number
              AND (x.name = r.target_external OR x.qualified_name = r.target_external)) AS own_file_answers_on_line,
         /** DOES ANY DECLARATION IN THE PROJECT ANSWER, in any file? This is the TWIN split: a row with
          *  a twin has a binding order can move; a row with NO candidate anywhere is not an order
          *  artifact at all and is either a genuinely external name or an unanswerable target. */
         (SELECT COUNT(*) FROM brain_symbol x
            WHERE x.project_id = r.project_id
              AND (x.name = r.target_external OR x.qualified_name = r.target_external)) AS any_file_answers,
         /** REACHABLE: a BOUND imports row from the source file reaches the bound declaration's file. */
         (SELECT COUNT(*) FROM brain_relationship i
            JOIN brain_symbol i_src ON i_src.id = i.source_symbol_id
            JOIN brain_symbol i_tgt ON i_tgt.id = i.target_symbol_id
            WHERE i.project_id = r.project_id AND i.relationship_type = 'imports'
              AND i_src.file_id = ss.file_id AND i_tgt.file_id = ts.file_id) AS reaching_bound_import,
         /** UNDECIDABLE'S EVIDENCE: the source file has an imports row that is itself UNBOUND, so
          *  reachability cannot be established either way. Mandatory rather than tidy — on nim's own run
          *  imports are 973 bound of 2,021, i.e. the reachability evidence is half-missing. */
         (SELECT COUNT(*) FROM brain_relationship i
            JOIN brain_symbol i_src ON i_src.id = i.source_symbol_id
            WHERE i.project_id = r.project_id AND i.relationship_type = 'imports'
              AND i_src.file_id = ss.file_id AND i.target_symbol_id IS NULL) AS source_unbound_imports,
         /** ANCHORING RULE (the fix chosen in §8 Cause 21): the question is "can this source FILE reach
          *  that declaration's file", so the unit is the FILE. brain_relationship has NO source-file
          *  column — only a nullable source_symbol_id — so a row whose source symbol is missing cannot be
          *  attributed to a file at all. These two columns make that limit explicit instead of silent. */
         (SELECT COUNT(*) FROM brain_relationship i
            JOIN brain_symbol i_src ON i_src.id = i.source_symbol_id
            WHERE i.project_id = r.project_id AND i.relationship_type = 'imports'
              AND i_src.file_id = ss.file_id) AS anchored_imports_in_source_file,
         (SELECT COUNT(*) FROM brain_relationship i
            WHERE i.project_id = r.project_id AND i.relationship_type = 'imports'
              AND i.source_symbol_id IS NULL) AS project_unanchored_imports
  FROM brain_relationship r
  LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
  LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
  WHERE r.project_id = ?
`).all(PID) as unknown as Row[]

type TypeRow = {
  edges: number; sourceUnbound: number; targetUnbound: number; bound: number
  boundSameFile: number; boundOtherFile: number; boundNameExact: number; boundQnameExact: number
  boundNeedsLeafReduction: number; withLine: number
  /** INTENT: the bound target is in the edge's OWN file AND on the edge's own line. For HCL's
   *  `contains` and `exports` the analyzer writes the edge on the TARGET SYMBOL's own start line, so
   *  this is the declaration the edge was about — an off-line or cross-file binding is the arbitrary
   *  pick `resolveTargetStmt`'s lexicographic `s.id` ordering produces (37,318 of 49,729 measured by
   *  another lane). Reported per type; for `references` the edge line is the READ SITE, so the
   *  same-line half is not an intent test there and only the file half is read. */
  boundSameFileSameLine: number
  boundSameFileOffLine: number
  boundOtherFileSameLine: number
  boundOtherFileOffLine: number
  /** THE PRICE OF THE NAME-SPACE LEVER: the edge's own file answers to the target, but the store
   *  bound to ANOTHER file or to nothing — a file-scoped identity would move these. */
  scopedWouldMove: number
  /** OF `scopedWouldMove`: the target spelling is answered by EXACTLY ONE declaration in the project
   *  (the own-file one), so pass 1 should have bound it and scoping changes nothing for these rows. */
  moveUniqueSpelling: number
  /** OF `scopedWouldMove`: MORE than one declaration answers to the spelling, so pass 1's ordering
   *  (`is_declaration, file_id, language, s.id`) decides — and a scoped qname removes the duplicate
   *  that made the choice ambiguous. These are the rows a rename is worth its pins for. */
  moveDuplicateSpelling: number
  /** THE TWIN SPLIT of every row with no own-file declaration: a declaration exists SOMEWHERE in the
   *  project (order can move this binding) vs NOWHERE (not an order artifact at all). */
  twinExists: number
  /** no own-file declaration AND no candidate anywhere: external name or unanswerable target. */
  noCandidateAnywhere: number
  /** THE THREE BUCKETS of the twin class (pre-registered in docs/analyzers/history/hcl-lane-notes.md §8 Cause 19):
   *  REACHABLE / UNREACHABLE / UNDECIDABLE. Counted separately and never folded. */
  twinReachable: number
  twinUnreachable: number
  twinUndecidable: number
  /** of those, rows that currently BIND only after leaf reduction: the current "bound" is a leaf
   *  coincidence the scoped identity would fix (or break), so the price must not count them twice. */
  scopedWouldMoveLeafReduced: number
  /** the edge's own file answers ON the edge's line and the store bound it there: already right. */
  scopedAlreadyRight: number
}
const perType = new Map<string, TypeRow>()
const blank = (): TypeRow => ({ edges: 0, sourceUnbound: 0, targetUnbound: 0, bound: 0, boundSameFile: 0, boundOtherFile: 0, boundNameExact: 0, boundQnameExact: 0, boundNeedsLeafReduction: 0, withLine: 0, boundSameFileSameLine: 0, boundSameFileOffLine: 0, boundOtherFileSameLine: 0, boundOtherFileOffLine: 0, scopedWouldMove: 0, scopedWouldMoveLeafReduced: 0, scopedAlreadyRight: 0, twinExists: 0, noCandidateAnywhere: 0, moveUniqueSpelling: 0, moveDuplicateSpelling: 0, twinReachable: 0, twinUnreachable: 0, twinUndecidable: 0 })
const leaf = (s: string | null): string => {
  if (!s) return ""
  const noLine = s.replace(/:\d+$/, "")
  return (noLine.split(":").pop() ?? "").split(".").pop() ?? ""
}
for (const r of storeRows) {
  const key = String(r.type ?? "")
  let row = perType.get(key)
  if (!row) { row = blank(); perType.set(key, row) }
  row.edges++
  if (r.line_number !== null && r.line_number !== undefined) row.withLine++
  if (r.source_bound !== 1) row.sourceUnbound++
  if (r.target_bound !== 1) { row.targetUnbound++; continue }
  row.bound++
  if (r.same_file === 1) row.boundSameFile++
  else row.boundOtherFile++
  const lineMatch = r.line_number !== null && r.line_number !== undefined && r.tgt_line !== null && r.tgt_line !== undefined && Number(r.tgt_line) === Number(r.line_number)
  if (r.same_file === 1) { if (lineMatch) row.boundSameFileSameLine++; else row.boundSameFileOffLine++ }
  else { if (lineMatch) row.boundOtherFileSameLine++; else row.boundOtherFileOffLine++ }
  const spelled = String(r.target_external ?? "")
  if (r.tgt_name === spelled) row.boundNameExact++
  else if (leaf(spelled) === r.tgt_name) row.boundNeedsLeafReduction++
  if (r.tgt_qname === spelled) row.boundQnameExact++
  // THE PRICE, computed on the store's own row: own file answers, store bound elsewhere/nothing.
  const ownAnswers = Number(r.own_file_answers ?? 0) > 0
  const ownAnswersOnLine = Number(r.own_file_answers_on_line ?? 0) > 0
  if (ownAnswers && r.tgt_file_id !== null && r.tgt_file_id === r.src_file_id) row.scopedAlreadyRight++
  else if (ownAnswers) {
    row.scopedWouldMove++
    // THE DUPLICATE SPLIT: one declaration answering to this spelling means scoping changes nothing;
    // more than one means pass 1's ordering picked the foreign one, which scoping removes.
    if (Number(r.any_file_answers ?? 0) <= 1) row.moveUniqueSpelling++
    else row.moveDuplicateSpelling++
    if (leaf(spelled) === r.tgt_name) row.scopedWouldMoveLeafReduced++
  }
  if (ownAnswersOnLine && r.tgt_file_id === r.src_file_id && r.same_file === 1) row.scopedAlreadyRight += 0
  // THE TWIN SPLIT, on every row whose own file does not answer.
  if (!ownAnswers) {
    if (Number(r.any_file_answers ?? 0) > 0) {
      row.twinExists++
      // THE THREE BUCKETS, pre-registered before this run. A reaching BOUND import decides REACHABLE;
      // otherwise an UNBOUND import in the source file makes it UNDECIDABLE; otherwise UNREACHABLE.
      // FILE-ANCHORED RULE: REACHABLE needs an anchored bound import that reaches the target file;
      // UNDECIDABLE when the file's import evidence is itself incomplete — an anchored import whose
      // target is unbound, or NO anchored imports at all while the project holds unanchored ones;
      // otherwise UNREACHABLE on positive evidence.
      const anchored = Number(r.anchored_imports_in_source_file ?? 0)
      const unanchoredProject = Number(r.project_unanchored_imports ?? 0)
      if (Number(r.reaching_bound_import ?? 0) > 0) row.twinReachable++
      else if (Number(r.source_unbound_imports ?? 0) > 0) row.twinUndecidable++
      else if (anchored === 0 && unanchoredProject > 0) row.twinUndecidable++
      else row.twinUnreachable++
    } else row.noCandidateAnywhere++
  }
}

// ────────────────────────── the gate's MODEL over the same files, for the same population
/**
 * The comparison the Lead asked for: the gate classifies an edge `resolved` when exactly ONE
 * declaration in the project matches its target by `name` OR by `qualifiedName` (production's own
 * alias rule), `amb(decl)` when more than one matches, `unresolved` when none does. Re-implemented
 * HERE over this population, and printed beside the store's numbers, so the two are read together.
 * The whole-population gate number for the same lane is quoted separately by `--repo=…` runs.
 */
const declByName = new Map<string, number>()
const declByQName = new Map<string, number>()
for (const r of raw.prepare("SELECT name, qualified_name FROM brain_symbol WHERE project_id = ?").all(PID) as any[]) {
  const n = String(r.name ?? ""); const q = String(r.qualified_name ?? "")
  declByName.set(n, (declByName.get(n) ?? 0) + 1)
  if (q) declByQName.set(q, (declByQName.get(q) ?? 0) + 1)
}
const model = new Map<string, { edges: number; resolved: number; amb: number; unresolved: number; noSource: number }>()
{
  const { parseFile } = await import(`${REPO_ROOT}/src/ast/pool-worker.ts`)
  // THE ELIGIBLE SET, not the raw draw: the model must be asked about the same files the store was.
  for (const f of eligibleSample) {
    const abs = path.join(root, f.repo, f.rel)
    if (!existsSync(abs)) continue
    let res: any
    try { res = await parseFile(abs, root) } catch { continue }
    for (const rel of res?.relationships ?? []) {
      const t = String(rel?.type ?? rel?.relationshipType ?? "")
      if (!t) continue
      const row = model.get(t) ?? { edges: 0, resolved: 0, amb: 0, unresolved: 0, noSource: 0 }
      row.edges++
      const target = String(rel?.target ?? rel?.to ?? "")
      const byName = declByName.get(target) ?? 0
      const byQName = declByQName.get(target) ?? 0
      const matches = Math.max(byName, byQName)
      if (matches === 1) row.resolved++
      else if (matches > 1) row.amb++
      else row.unresolved++
      if (!rel?.source && !rel?.from) row.noSource++
      model.set(t, row)
    }
  }
}

const sum = (f: (t: TypeRow) => number) => [...perType.values()].reduce((a, t) => a + f(t), 0)
const report = {
  instrument: "validation/m14/fixtures/hcl/tools/store-binding-truth.clean.mts",
  draw: DRAW,
  repos: REPOS,
  admittedFiles: admitted,
  filesDrawn: sample.length,
  filesCopied: copied,
  indexerEligible: eligibleSample.length,
  indexerDiscoveredPaths: eligible.size,
  excludedFromTheIndexer: Object.fromEntries([...excludedSegments.entries()].sort((a, b) => b[1] - a[1])),
  indexMs,
  indexStats: { totalFiles: stats?.totalFiles, symbols: stats?.symbols ?? symCount, relationships: stats?.relationships },
  store: { brainFile: fileCount, brainSymbol: symCount, brainRelationship: storeRows.length },
  perType: Object.fromEntries([...perType.entries()].sort((a, b) => b[1].edges - a[1].edges)),
  gateModelOverTheSameFiles: Object.fromEntries([...model.entries()].sort((a, b) => b[1].edges - a[1].edges)),
  totals: {
    edges: sum((t) => t.edges), bound: sum((t) => t.bound), targetUnbound: sum((t) => t.targetUnbound),
    boundSameFile: sum((t) => t.boundSameFile), boundOtherFile: sum((t) => t.boundOtherFile),
    boundNameExact: sum((t) => t.boundNameExact), boundQnameExact: sum((t) => t.boundQnameExact),
    boundNeedsLeafReduction: sum((t) => t.boundNeedsLeafReduction), sourceUnbound: sum((t) => t.sourceUnbound),
    boundSameFileSameLine: sum((t) => t.boundSameFileSameLine),
    boundSameFileOffLine: sum((t) => t.boundSameFileOffLine),
    boundOtherFileSameLine: sum((t) => t.boundOtherFileSameLine),
    boundOtherFileOffLine: sum((t) => t.boundOtherFileOffLine),
    scopedWouldMove: sum((t) => t.scopedWouldMove),
    moveUniqueSpelling: sum((t) => t.moveUniqueSpelling),
    moveDuplicateSpelling: sum((t) => t.moveDuplicateSpelling),
    scopedWouldMoveLeafReduced: sum((t) => t.scopedWouldMoveLeafReduced),
    scopedAlreadyRight: sum((t) => t.scopedAlreadyRight),
    twinExists: sum((t) => t.twinExists),
    noCandidateAnywhere: sum((t) => t.noCandidateAnywhere),
    twinReachable: sum((t) => t.twinReachable),
    twinUnreachable: sum((t) => t.twinUnreachable),
    twinUndecidable: sum((t) => t.twinUndecidable),
  },
  /** THE CLASS SPLIT OF THE STORE-UNBOUND ROWS, by root segment — the population a claim may be
   *  written against (never the model's `noDeclaration`, which overstates it ~8x). Full, not a top-N:
   *  a claim set must be counted, not sampled. */
  unboundByRoot: (() => {
    const rows = raw.prepare(`
      SELECT r.relationship_type AS type, r.target_external AS target, COUNT(*) AS n
      FROM brain_relationship r
      WHERE r.project_id = ? AND r.target_symbol_id IS NULL
      GROUP BY r.relationship_type, r.target_external
    `).all(PID) as any[]
    const out: Record<string, Record<string, number>> = {}
    for (const r of rows) {
      const t = String(r.type ?? "")
      const tgt = String(r.target ?? "")
      const root = tgt === "" || tgt === "null" ? "(empty)" : tgt.split(".")[0]
      out[t] ??= {}
      out[t][root] = (out[t][root] ?? 0) + Number(r.n ?? 0)
    }
    return out
  })(),
  unboundTopTargets: (raw.prepare(`
    SELECT r.relationship_type AS type, r.target_external AS target, COUNT(*) AS n
    FROM brain_relationship r
    WHERE r.project_id = ? AND r.target_symbol_id IS NULL
    GROUP BY r.relationship_type, r.target_external ORDER BY n DESC LIMIT 20
  `).all(PID) as any[]) ?? [],
  boundOtherFileSamples: (raw.prepare(`
    SELECT r.relationship_type AS type, r.target_external AS target, ss.name AS src_name,
           sf.relative_path AS src_file, ts.name AS tgt_name, tf.relative_path AS tgt_file
    FROM brain_relationship r
    LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
    LEFT JOIN brain_file sf ON sf.id = ss.file_id
    LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
    LEFT JOIN brain_file tf ON tf.id = ts.file_id
    WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL AND ss.file_id <> ts.file_id
    LIMIT 15
  `).all(PID) as any[]) ?? [],
}
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2))

const pad = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
console.log(`  indexed in ${indexMs} ms: ${fileCount} files, ${symCount} symbols, ${storeRows.length} relationship rows`)
console.log("")
console.log("STORE (brain_relationship.target_symbol_id) vs the GATE'S MODEL, same files, same project")
console.log(pad("type", 14) + pad("edges", 8) + pad("bound", 8) + pad("sameFile", 10) + pad("otherFile", 11) + pad("unbound", 9)
  + pad("|modelRes", 11) + pad("modelAmb", 10) + pad("modelUnres", 11))
console.log(pad("", 14) + pad("INTENT of the BOUND rows", 8) + pad("sfSameLine", 12) + pad("sfOffLine", 11) + pad("ofSameLine", 12) + pad("ofOffLine", 11) + "← own-file+own-line vs off")
console.log("-".repeat(150))
for (const [t, r] of [...perType.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
  const m = model.get(t) ?? { edges: 0, resolved: 0, amb: 0, unresolved: 0, noSource: 0 }
  console.log(pad(t, 14) + pad(r.edges, 8) + pad(r.bound, 8) + pad(r.boundSameFile, 10) + pad(r.boundOtherFile, 11)
    + pad(r.targetUnbound, 9) + pad(m.resolved, 11) + pad(m.amb, 10) + pad(m.unresolved, 11)
    + "  " + pad(r.boundSameFileSameLine, 12) + pad(r.boundSameFileOffLine, 11) + pad(r.boundOtherFileSameLine, 12) + pad(r.boundOtherFileOffLine, 11))
}
console.log("-".repeat(132))
const T = report.totals
const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`
console.log(`STORE binds ${T.bound} of ${T.edges} (${pct(T.bound, T.edges)}) · same file ${T.boundSameFile} (${pct(T.boundSameFile, T.edges)}) · other file ${T.boundOtherFile} (${pct(T.boundOtherFile, T.edges)}) · unbound ${T.targetUnbound} (${pct(T.targetUnbound, T.edges)})`)
const mTot = [...model.values()].reduce((a, m) => ({ edges: a.edges + m.edges, resolved: a.resolved + m.resolved, amb: a.amb + m.amb, unresolved: a.unresolved + m.unresolved }), { edges: 0, resolved: 0, amb: 0, unresolved: 0 })
console.log(`MODEL calls ${mTot.resolved} resolved (${pct(mTot.resolved, mTot.edges)}) · ${mTot.amb} ambiguous (${pct(mTot.amb, mTot.edges)}) · ${mTot.unresolved} unresolved (${pct(mTot.unresolved, mTot.edges)})`)
console.log(`DUPLICATE SPLIT of the movable rows: pass 1 should have bound it (spelling project-unique) ${T.moveUniqueSpelling} · DUPLICATES exist so the ordering decided ${T.moveDuplicateSpelling}`)
console.log(`TWIN BUCKETS (pre-registered): REACHABLE ${T.twinReachable} · UNREACHABLE ${T.twinUnreachable} · UNDECIDABLE ${T.twinUndecidable}`)
console.log(`TWIN SPLIT (no own-file declaration): twin exists somewhere ${T.twinExists} · no candidate ANYWHERE ${T.noCandidateAnywhere}`)
console.log(`NAME-SPACE LEVER PRICE: ${T.scopedWouldMove} rows where the edge's own file ANSWERS to the target while the store bound elsewhere or nowhere (of those, ${T.scopedWouldMoveLeafReduced} currently bind only by leaf reduction); ${T.scopedAlreadyRight} already bind inside the own file.`)
console.log(`INTENT of the bound rows: own-file+own-line ${T.boundSameFileSameLine} (${pct(T.boundSameFileSameLine, T.bound)}) · own-file off-line ${T.boundSameFileOffLine} · OTHER-FILE same-line ${T.boundOtherFileSameLine} · OTHER-FILE off-line ${T.boundOtherFileOffLine}`)
console.log("")
console.log("top UNBOUND targets the store refused (type, target, rows):")
for (const r of report.unboundTopTargets.slice(0, 10)) console.log(`  ${r.type}  ${r.target}  ${r.n}`)
if (report.boundOtherFileSamples.length) {
  console.log("")
  console.log(`bound to ANOTHER file — ${T.boundOtherFile} rows; first ${report.boundOtherFileSamples.length}:`)
  for (const r of report.boundOtherFileSamples) console.log(`  ${r.type}  ${r.src_name} -[${r.target}]-> ${r.tgt_name}  ${r.src_file} -> ${r.tgt_file}`)
}

rmSync(root, { recursive: true, force: true })
try { rmSync(path.dirname(BrainDatabase.getDbPath(PID as any)), { recursive: true, force: true }) } catch { /* nothing to clean */ }
process.exit(0)
