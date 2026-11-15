/**
 * STORE BINDING TRUTH — what the REAL indexer binds json's `overrides` edges to.
 *
 * ## Why this file exists
 *
 * json's whole-population residual is 25, and 22 of it is ONE type: every `overrides` edge this
 * lane emits reads `amb(decl)`. The gate classifies an edge by a NAME-MATCH count computed in
 * TypeScript — N declarations in the project share the target's name or qualifiedName — and that
 * is a MODEL of resolution, not resolution. The graph a consumer walks is
 * `brain_relationship.target_symbol_id`, written by SQL in `parallel-indexer.ts`, and for every
 * type except `contains` that is `resolveTargetStmt`:
 *
 *     SELECT s.id, s.file_id, f.language FROM brain_symbol s
 *     LEFT JOIN brain_file f ON f.id = s.file_id
 *     WHERE s.project_id = ? AND s.name = ?
 *     ORDER BY COALESCE(s.is_declaration, 0) ASC, (s.file_id = ?) DESC, (f.language = ?) DESC, s.id
 *     LIMIT 1
 *
 * `LIMIT 1` means it ALWAYS binds when the name exists. So for the 22, "ambiguous" and "unbound"
 * are different questions, and only the store can answer which one is true.
 *
 * ## What is being asked, exactly
 *
 * An `overrides` edge is emitted when a key is re-declared in the SAME OBJECT: source = the owner
 * symbol, target = the repeated key's qualified path, `metadata.overridesLine` = the PRIOR
 * declaration's line. The two declarations therefore share a NAME and a QUALIFIED PATH — the
 * analyzer states this at the emission site — so no key the store carries can tell them apart, and
 * the resolver's tie-break (`s.id`, a TEXT comparison) decides. This tool reads which row the store
 * actually bound:
 *
 *   boundPrior    the bound symbol sits on the group's EARLIEST line — the declaration the edge's
 *                 `overridesLine` names as the one being overridden
 *   boundLater    the bound symbol sits on the group's LATEST line — the declaration that overrides
 *   unbound       `target_symbol_id IS NULL`
 *   otherFile / otherLine   a row outside the key's own two declarations
 *
 * ## Discipline (copied from hcl-lane's reference tool, 18413be8f)
 *
 * - REAL indexer, REAL store: production `indexProjectParallel`, then SQL over
 *   `brain_relationship` joined to `brain_symbol`/`brain_file`. No modelled SQL, no predicted
 *   bindings.
 * - ONE PROJECT, so the store's numbers and the gate's model can be compared over the same files.
 * - The corpus is copied, never written; the scratch project and its database are removed on exit.
 * - A BROKEN STORE IS DISCLOSED, NOT READ THROUGH: zero symbols exits 2 rather than printing
 *   binding numbers derived from nothing.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/json/tools/store-binding-truth.mts
 *   BB_JSON_TRUTH_REPOS=duckdb npx tsx …        # default
 *   BB_JSON_TRUTH_MAX=800 npx tsx …             # bound the draw (stride, never a prefix)
 *   BB_JSON_TRUTH_OUT=… npx tsx …               # write the full report as JSON
 */
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"

const REPO_ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = (process.env.BB_JSON_TRUTH_REPOS ?? "duckdb").split(",").map((s) => s.trim()).filter(Boolean)
const MAX = Number(process.env.BB_JSON_TRUTH_MAX ?? 0)
const SIZE_CAP = 1024 * 1024
const OUT = process.env.BB_JSON_TRUTH_OUT ?? ""
/** BOTH SPELLINGS — the router maps `.jsonc` to json, and the Lead added it to the lane's admitted
 *  set (d43a5fa4d). A tool that measured one spelling would repeat the yaml lane's defect. */
const EXTENSIONS = [".json", ".jsonc"]

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
/** A BOUNDED DRAW IS A STRIDE, NOT A PREFIX (firing-check's lesson). */
const sample = (() => {
  if (MAX <= 0 || rows.length <= MAX) return rows
  const stride = rows.length / MAX
  const out: FileRow[] = []
  for (let i = 0; i < MAX; i++) out.push(rows[Math.floor(i * stride)])
  return out
})()
const DRAW = (() => {
  const h = createHash("sha256")
  for (const f of sample) { let size = -1; try { size = statSync(f.abs).size } catch {} h.update(`${f.repo}/${f.rel} ${size}\n`) }
  return h.digest("hex").slice(0, 16)
})()

/** The scratch root is overridable because a sandboxed session gives each command a PRIVATE /tmp:
 *  a store kept for post-hoc SQL under the default tmpdir is invisible to the next command, and the
 *  retention flag then reads as "the DB was deleted" when it was never shared. */
const root = mkdtempSync(path.join(process.env.BB_JSON_TRUTH_SCRATCH ?? tmpdir(), "bb-json-truth-"))
process.env.BB_DATA_DIR = process.env.BB_DATA_DIR ?? path.join(root, ".bb-data")
let copied = 0
for (const f of sample) {
  const dest = path.join(root, f.repo, f.rel)
  mkdirSync(path.dirname(dest), { recursive: true })
  try { cpSync(f.abs, dest); copied++ } catch {}
}
console.log(`store binding truth — json, project(s) ${REPOS.join(",")}`)
console.log(`  draw ${DRAW}  files ${copied} of ${admitted} admitted  scratch ${root}`)

const { indexProjectParallel, discoverIndexableFiles } = await import(`${REPO_ROOT}/src/ast/parallel-indexer.ts`)
const { BrainDatabase } = await import(`${REPO_ROOT}/src/brain/database.ts`)
const { getProjectId } = await import(`${REPO_ROOT}/src/cli/index.ts`)

const eligible = new Set(await discoverIndexableFiles(root))
const eligibleSample = sample.filter((f) => eligible.has(path.join(root, f.repo, f.rel)))
const excluded = sample.length - eligibleSample.length
console.log(`  indexer-eligible ${eligibleSample.length} of ${copied} copied (${excluded} not discovered by the indexer)`)
if (eligibleSample.length === 0) {
  console.error("REFUSING to measure: the indexer's own discovery admits NONE of the drawn files, so the store would hold nothing.")
  rmSync(root, { recursive: true, force: true })
  process.exit(2)
}

const PID = getProjectId(root)
const t0 = Date.now()
try { await indexProjectParallel(PID as any, root, {}) } catch (e) {
  console.error(`index failed: ${(e as Error)?.message ?? e}`)
  rmSync(root, { recursive: true, force: true })
  process.exit(2)
}
const indexMs = Date.now() - t0
const raw = await BrainDatabase.getRawInstance(PID as any)
const symCount = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?").get(PID) as any)?.c ?? 0
if (symCount === 0) {
  console.error(`BROKEN STORE: 0 symbols for project ${PID} — refusing to print binding numbers derived from an empty store.`)
  rmSync(root, { recursive: true, force: true })
  process.exit(2)
}
console.log(`  indexed in ${(indexMs / 1000).toFixed(1)}s  symbols ${symCount}  project ${PID}`)

// ── the store's own verdict over every `overrides` edge, with the key's declaration group
type Row = {
  id: string; target_external: string | null; line_number: number | null; metadata: string | null
  target_bound: number; src_file_id: number | null; tgt_file_id: number | null
  tgt_name: string | null; tgt_qname: string | null; tgt_line: number | null
}
const storeRows = raw.prepare(`
  SELECT r.id, r.relationship_type AS type, r.target_external, r.line_number, r.metadata,
         CASE WHEN r.target_symbol_id IS NULL THEN 0 ELSE 1 END AS target_bound,
         ss.file_id AS src_file_id, ts.file_id AS tgt_file_id,
         ts.name AS tgt_name, ts.qualified_name AS tgt_qname, ts.line_start AS tgt_line
  FROM brain_relationship r
  LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
  LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
  WHERE r.project_id = ? AND r.relationship_type IN ('overrides', 'contains')
`).all(PID) as unknown as Row[]

/**
 * THE `contains` SPLIT — the tie-break question, and `contains` IS in the gate's
 * `LINE_IS_TARGET_LINE` because the analyzer writes the edge on the TARGET SYMBOL's own start line.
 * So for this type the gate's own definition of intent is readable here:
 *   intended        bound in the edge's OWN FILE and ON the edge's own line
 *   sameFileOffLine bound in the edge's own file, off the line
 *   arbitraryTwin   bound in ANOTHER file
 *   unbound         no row
 */
const containsSplit = { edges: 0, bound: 0, unbound: 0, intended: 0, sameFileOffLine: 0, arbitraryTwin: 0 }
const containsExamples: string[] = []

/** name -> declaration lines, and (name, qualified_name) -> lines, over the store's own symbols. */
const byName = new Map<string, { file: number | null; line: number | null }[]>()
const byNameQ = new Map<string, { file: number | null; line: number | null }[]>()
for (const s of raw.prepare("SELECT name, qualified_name, line_start, file_id FROM brain_symbol WHERE project_id = ?").all(PID) as any[]) {
  const rec = { file: s.file_id ?? null, line: s.line_start ?? null }
  const n = String(s.name ?? ""); const q = String(s.qualified_name ?? "")
  byName.set(n, [...(byName.get(n) ?? []), rec])
  byNameQ.set(`${n}\u0000${q}`, [...(byNameQ.get(`${n}\u0000${q}`) ?? []), rec])
}

const verdict = { edges: 0, bound: 0, unbound: 0, boundExact: 0, boundPrior: 0, boundLater: 0, otherLine: 0, otherFile: 0, noGroup: 0 }
const examples: string[] = []
for (const r of storeRows) {
  if (r.type !== "overrides") continue
  verdict.edges++
  if (r.target_bound !== 1) { verdict.unbound++; continue }
  verdict.bound++
  const group = byNameQ.get(`${r.tgt_name ?? ""}\u0000${r.tgt_qname ?? ""}`) ?? []
  const lines = group.map((g) => g.line).filter((l): l is number => l !== null)
  if (lines.length === 0) { verdict.noGroup++; continue }
  const min = Math.min(...lines); const max = Math.max(...lines)
  const boundLine = r.tgt_line ?? null
  // A ONE-ROW GROUP IS NOT AN OFF-LINE BINDING. The first version fell through to `otherLine` when
  // every declaration of the key sat on one line, which reads as "bound but not to its own
  // declaration" and is the opposite of what it is: the store holds ONE symbol for that identity
  // (measured: 4 analyzer symbols for `11152[3].fileSize`, 1 row in the store) and the edge is
  // bound to it. `boundExact` names that case; `boundPrior`/`boundLater` need a real split.
  if (r.src_file_id !== null && r.tgt_file_id !== null && r.src_file_id !== r.tgt_file_id) verdict.otherFile++
  else if (min === max) verdict.boundExact++
  else if (boundLine !== null && boundLine === min) verdict.boundPrior++
  else if (boundLine !== null && boundLine === max) verdict.boundLater++
  else verdict.otherLine++
  if (examples.length < 8) {
    examples.push(`${r.target_external}  bound line ${boundLine}  group lines [${[...new Set(lines)].sort((a, b) => a - b).join(",")}]  edge line ${r.line_number}`)
  }
}

// ── the gate's MODEL over the same store's symbols, for comparison
let modelAmb = 0, modelResolved = 0, modelUnres = 0
for (const r of storeRows) {
  if (r.type !== "overrides") continue
  const spelled = String(r.target_external ?? "")
  const n = byName.get(spelled)?.length ?? 0
  const q = byNameQ.get(`${r.tgt_name ?? ""}\u0000${spelled}`)?.length ?? 0
  const hits = Math.max(n, q)
  if (hits === 0) modelUnres++
  else if (hits === 1) modelResolved++
  else modelAmb++
}

for (const r of storeRows) {
  if (r.type !== "contains") continue
  containsSplit.edges++
  if (r.target_bound !== 1) { containsSplit.unbound++; continue }
  containsSplit.bound++
  const srcFile = r.src_file_id, tgtFile = r.tgt_file_id
  const sameFile = r.src_file_id !== null && r.tgt_file_id !== null && r.src_file_id === r.tgt_file_id
  const sameLine = r.line_number !== null && r.tgt_line !== null && Number(r.tgt_line) === Number(r.line_number)
  if (sameFile && sameLine) containsSplit.intended++
  else if (sameFile) containsSplit.sameFileOffLine++
  else {
    containsSplit.arbitraryTwin++
    if (containsExamples.length < 12) {
      const src = raw.prepare("SELECT f.path AS p FROM brain_file f WHERE f.id = ?").get(srcFile) as any
      const tgt = raw.prepare("SELECT f.path AS p FROM brain_file f WHERE f.id = ?").get(tgtFile) as any
      containsExamples.push(`${String(r.target_external)}  bound to ${tgt?.p ?? tgtFile}  from ${src?.p ?? srcFile}  line ${r.line_number}`)
    }
  }
}
console.log(`\njson \`contains\` — the tie-break split: edges ${containsSplit.edges}  bound ${containsSplit.bound}  unbound ${containsSplit.unbound}`)
console.log(`  intended (own file + own line) ${containsSplit.intended}  sameFileOffLine ${containsSplit.sameFileOffLine}  arbitraryTwin (another file) ${containsSplit.arbitraryTwin}`)
for (const e of containsExamples) console.log(`    TWIN ${e}`)

const report = {
  tool: "json store binding truth", repo: REPOS.join(","), draw: DRAW,
  admitted, copied, eligible: eligibleSample.length, project: PID, indexMs, symbols: symCount,
  overrides: verdict, containsSplit, modelOverTheSameSymbols: { amb: modelAmb, resolved: modelResolved, unresolved: modelUnres },
  examples,
}
console.log(`\njson \`overrides\` — the STORE's verdict over ${verdict.edges} edge(s):`)
console.log(`  bound ${verdict.bound}  unbound ${verdict.unbound}`)
console.log(`    boundExact ${verdict.boundExact}  boundPrior ${verdict.boundPrior}  boundLater ${verdict.boundLater}  otherLine ${verdict.otherLine}  otherFile ${verdict.otherFile}  noGroup ${verdict.noGroup}`)
console.log(`  the GATE's model over the same symbols: resolved ${modelResolved}  amb ${modelAmb}  unresolved ${modelUnres}`)
if (examples.length) { console.log("  examples:"); for (const e of examples) console.log(`    ${e}`) }
if (OUT) { writeFileSync(OUT, JSON.stringify(report, null, 1)); console.log(`wrote ${OUT}`) }
const KEEP = process.env.BB_JSON_TRUTH_KEEP === "1"
if (KEEP) console.log(`KEEPING scratch (BB_JSON_TRUTH_KEEP=1): project ${PID}  db ${process.env.BB_DATA_DIR}/projects/${PID}/brain.db`)
else rmSync(root, { recursive: true, force: true })
