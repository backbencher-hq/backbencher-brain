/**
 * STORE BINDING TRUTH (zig) — what the REAL indexer binds, and what a FILE CLAIM would buy.
 *
 * ## Why this file exists
 *
 * The lane's restricted claim ceiling says **12,928 file-shaped targets name a file the project
 * carries** (96.5%) — a statement about WHAT THE PROJECT HAS. A claim's effect is a statement
 * about WHAT THE STORE BINDS, and those are different populations. This tool measures the second,
 * BEFORE any analyzer edit, because an `importProjectFile` claim is conditional: it verifies on a
 * hit and REFUTES on a miss.
 *
 * ## The three expectations this run must be able to fail (stated before it was run)
 *
 *   1. the claimable file-shaped targets VERIFY (their file is in the project's admitted list);
 *   2. the targets whose file the project does NOT carry REFUTE, and are therefore EXCLUDED from
 *      the claim rather than claimed — a claim on them would be a false statement;
 *   3. `extFAIL` for the lane stays 0. If it moves off 0, the exclusion is wrong and THAT is the
 *      finding.
 *
 * ## And the DELTA, which decides what the claim is worth
 *
 * A ceiling is an upper bound on what a change could reach; the delta is what it buys. So this
 * reports, of the file-shaped edges: how many are ALREADY BOUND in the store without any claim,
 * how many are UNBOUND AND CLAIMABLE (the delta), and how many are UNBOUND AND NOT CLAIMABLE.
 *
 * ## Discipline (same as the json and hcl tools)
 *
 * - REAL indexer (`indexProjectParallel`), REAL store (`brain_relationship`/`brain_symbol`); no
 *   modelled SQL, no predicted bindings. One project per run, and every store figure is ONE RUN.
 * - The store's binding is order- and run-dependent and runs in worker threads; a main-thread
 *   driver hook records ZERO inserts, so nothing here is read through a hook.
 * - A BROKEN STORE IS DISCLOSED: zero symbols exits 2 rather than printing binding numbers from
 *   an empty store.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/zig/tools/store-binding-truth.mts
 *   BB_ZIG_TRUTH_REPOS=ghostty …        # default; comma-separated
 *   BB_ZIG_TRUTH_MAX=400 …              # bound the draw (a STRIDE, never a prefix)
 *   BB_ZIG_TRUTH_OUT=…                  # write the report as JSON
 */
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"

const REPO_ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = (process.env.BB_ZIG_TRUTH_REPOS ?? "ghostty").split(",").map((s) => s.trim()).filter(Boolean)
const MAX = Number(process.env.BB_ZIG_TRUTH_MAX ?? 0)
const SIZE_CAP = 1024 * 1024
const OUT = process.env.BB_ZIG_TRUTH_OUT ?? ""
/** zig's admitted spelling is `.zig`; `.zon` is copied so the project looks like the real tree, but
 *  the ADMITTED list for the claim test is `.zig` only — the arbiter's file list IS the lane's
 *  admitted population (c3a2d71d6). */
const LANE_EXT = [".zig"]
const COPY_EXT = [".zig", ".zon"]

type FileRow = { repo: string; rel: string; abs: string }
const rows: FileRow[] = []
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  if (!existsSync(dir)) { console.error(`no such repo: ${dir}`); continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const lower = rel.toLowerCase()
    if (!COPY_EXT.some((x) => lower.endsWith(x))) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    rows.push({ repo, rel, abs })
  }
}
rows.sort((a, b) => (a.repo === b.repo ? (a.rel < b.rel ? -1 : 1) : a.repo < b.repo ? -1 : 1))
const admitted = rows.length
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

const root = mkdtempSync(path.join(process.env.BB_ZIG_TRUTH_SCRATCH ?? tmpdir(), "bb-zig-truth-"))
process.env.BB_DATA_DIR = process.env.BB_DATA_DIR ?? path.join(root, ".bb-data")
let copied = 0
for (const f of sample) {
  const dest = path.join(root, f.repo, f.rel)
  mkdirSync(path.dirname(dest), { recursive: true })
  try { cpSync(f.abs, dest); copied++ } catch {}
}
console.log(`store binding truth — zig, project(s) ${REPOS.join(",")}`)
console.log(`  LABEL: whole-project run; every store figure here is ONE RUN (the store's binding is order- and run-dependent)`)
console.log(`  draw ${DRAW}  files ${copied} of ${admitted} copied  scratch ${root}`)

const { indexProjectParallel, discoverIndexableFiles } = await import(`${REPO_ROOT}/src/ast/parallel-indexer.ts`)
const { BrainDatabase } = await import(`${REPO_ROOT}/src/brain/database.ts`)
const { getProjectId } = await import(`${REPO_ROOT}/src/cli/index.ts`)

const eligible = new Set(await discoverIndexableFiles(root))
const eligibleSample = sample.filter((f) => eligible.has(path.join(root, f.repo, f.rel)))
console.log(`  indexer-eligible ${eligibleSample.length} of ${copied} copied`)
if (eligibleSample.length === 0) { console.error("REFUSING: the indexer admits none of the drawn files."); rmSync(root, { recursive: true, force: true }); process.exit(2) }

const PID = getProjectId(root)
const t0 = Date.now()
try { await indexProjectParallel(PID as any, root, {}) } catch (e) {
  console.error(`index failed: ${(e as Error)?.message ?? e}`); rmSync(root, { recursive: true, force: true }); process.exit(2)
}
const indexMs = Date.now() - t0
const raw = await BrainDatabase.getRawInstance(PID as any)
const symCount = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?").get(PID) as any)?.c ?? 0
if (symCount === 0) { console.error(`BROKEN STORE: 0 symbols — refusing to print binding numbers.`); rmSync(root, { recursive: true, force: true }); process.exit(2) }
console.log(`  indexed in ${(indexMs / 1000).toFixed(1)}s  symbols ${symCount}  project ${PID}`)

/** THE ARBITER'S FILE LIST: the lane's ADMITTED population (`.zig`, size-capped). */
const admittedFiles = new Set(sample.filter((f) => LANE_EXT.some((x) => f.rel.toLowerCase().endsWith(x))).map((f) => f.rel))

const DOC_EXT = [".zig", ".zon", ".c", ".h", ".cpp", ".md", ".json", ".yml", ".yaml", ".txt", ".toml"]
const isFileShaped = (t: string): boolean => DOC_EXT.some((e) => t.split("#")[0].toLowerCase().endsWith(e))
const candidatesOf = (srcRel: string, target: string): string[] => {
  const dir = path.posix.dirname(srcRel)
  const out = new Set<string>()
  out.add(path.posix.normalize(path.posix.join(dir, target)))
  out.add(path.posix.normalize(target))
  return [...out].filter((c) => !c.startsWith(".."))
}
type Row = { type: string; target: string; srcRel: string; bound: number; line: number | null }
const storeRows = raw.prepare(`
  SELECT r.relationship_type AS type, r.target_external AS target, f.relative_path AS srcRel,
         CASE WHEN r.target_symbol_id IS NULL THEN 0 ELSE 1 END AS bound, r.line_number AS line
  FROM brain_relationship r
  LEFT JOIN brain_file f ON f.id = (SELECT file_id FROM brain_symbol s WHERE s.id = r.source_symbol_id)
  WHERE r.project_id = ?
`).all(PID) as unknown as Row[]

const report = { edges: 0, fileShaped: 0, bound: 0, unbound: 0, unboundAndClaimable: 0, unboundNotClaimable: 0, boundButFileShaped: 0 }
const examples: string[] = []
for (const r of storeRows) {
  report.edges++
  if (!isFileShaped(String(r.target ?? ""))) continue
  report.fileShaped++
  const src = String(r.srcRel ?? "")
  const claimable = src && candidatesOf(src, String(r.target)).some((c) => admittedFiles.has(c))
  if (r.bound === 1) { report.bound++; report.boundButFileShaped++; continue }
  report.unbound++
  if (claimable) { report.unboundAndClaimable++; if (examples.length < 10) examples.push(`CLAIMABLE  ${src} -> ${r.target}`) }
  else { report.unboundNotClaimable++; if (examples.length < 16) examples.push(`NOT-CLAIMABLE ${src} -> ${r.target}`) }
}
console.log(`\nFILE-SHAPED EDGES IN THE STORE (this is the claim's question):`)
console.log(`  edges ${report.edges}  file-shaped ${report.fileShaped}`)
console.log(`  ALREADY BOUND without any claim      ${report.bound}`)
console.log(`  UNBOUND                              ${report.unbound}`)
console.log(`    of those, CLAIMABLE (the DELTA)    ${report.unboundAndClaimable}`)
console.log(`    of those, NOT claimable (refuse)   ${report.unboundNotClaimable}`)
console.log(`  ADMITTED file list size              ${admittedFiles.size}`)
if (examples.length) { console.log(`  examples:`); for (const e of examples) console.log(`    ${e}`) }
if (OUT) { writeFileSync(OUT, JSON.stringify({ repo: REPOS.join(","), draw: DRAW, admitted: admittedFiles.size, symbols: symCount, indexMs, report, examples }, null, 1)); console.log(`wrote ${OUT}`) }
if (process.env.BB_ZIG_TRUTH_KEEP === "1") console.log(`KEEPING scratch: ${root}`)
else rmSync(root, { recursive: true, force: true })
