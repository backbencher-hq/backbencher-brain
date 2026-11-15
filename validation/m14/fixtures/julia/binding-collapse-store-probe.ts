/**
 * LANDING SITE 2, MEASURED IN THE STORE — does `retargetJuliaMethodTableBindings` bind what the gate
 * model says it binds, and does it leave every other language alone?
 *
 * ## The falsifier, and its control
 *
 * The gate's model moved 1,489 edges `amb -> resolved` with `unresolved` unchanged. The store is a
 * different instrument, so the claim here is the store's own:
 *   1. julia rows of the bindable types that were UNBOUND become BOUND — and the count is reported;
 *   2. NO row that already had a `target_symbol_id` changes it (snapshot compare, id by id);
 *   3. NON-JULIA rows are untouched — which is why files of another language are copied into the SAME
 *      scratch project: without them the language guard would be unobservable and "no-op elsewhere"
 *      would be a claim about a population that is not there;
 *   4. every newly bound target is a GENUINE qualification (`qualified_name` differs from `name`),
 *      which is the clause that separates a method table from a name coincidence.
 *
 * ## Discipline
 *
 * Real indexer, real store, scratch `BB_DATA_DIR` (refused if unset), the draw is a bounded stride over
 * the admitted julia population plus a fixed non-julia control set, and a broken store exits 2 rather
 * than printing binding numbers derived from nothing.
 *
 * Usage:  BB_DATA_DIR=$PWD/.tmp-julia/bb-data npx tsx validation/m14/fixtures/julia/binding-collapse-store-probe.ts
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const JULIA_REPOS = (process.env.BB_PROBE_JULIA_REPOS ?? "DataFrames.jl,Aqua.jl,StaticArrays.jl").split(",")
const JULIA_MAX = Number(process.env.BB_PROBE_JULIA_FILES ?? 160)
const OTHER_MAX = Number(process.env.BB_PROBE_OTHER_FILES ?? 40)
const OTHER_EXTS = [".ts", ".py", ".go", ".rb"]

if (!process.env.BB_DATA_DIR) {
  console.error("REFUSING: BB_DATA_DIR is not set — store runs use a scratch data dir.")
  process.exit(2)
}

const julia: string[] = []
for (const repo of JULIA_REPOS) {
  const root = path.join(CORPUS, repo)
  const walk = (d: string, depth: number) => {
    if (depth > 20) return
    let ents; try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p, depth + 1) }
      else if (e.name.endsWith(".jl")) { try { if (statSync(p).size < 400_000) julia.push(path.relative(root, p)) } catch { /* gone */ } }
    }
  }
  try { if (statSync(root).isDirectory()) walk(root, 0) } catch { /* not a dir */ }
}
julia.sort()
const stride = Math.max(1, Math.floor(julia.length / JULIA_MAX))
const juliaDraw = julia.filter((_, i) => i % stride === 0).slice(0, JULIA_MAX)

// THE CONTROL SET: files of other languages, copied into the SAME project so the language guard has
// something to be a no-op ON. Taken from other repos because they are what the corpus has.
const others: { repo: string; rel: string; abs: string }[] = []
for (const repo of readdirSync(CORPUS)) {
  if (others.length >= OTHER_MAX) break
  const root = path.join(CORPUS, repo)
  const walk = (d: string, depth: number) => {
    if (depth > 12 || others.length >= OTHER_MAX) return
    let ents; try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (others.length >= OTHER_MAX) return
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|\.git|dist|build/.test(e.name)) walk(p, depth + 1) }
      else if (OTHER_EXTS.some((x) => e.name.endsWith(x))) {
        try { if (statSync(p).size < 120_000) others.push({ repo, rel: path.relative(root, p), abs: p }) } catch { /* gone */ }
      }
    }
  }
  try { if (statSync(root).isDirectory()) walk(root, 0) } catch { /* not a dir */ }
}

const scratch = mkdtempSync(path.join(process.env.BB_DATA_DIR!, "julia-bind-probe-"))
const copy = (src: string, dst: string) => {
  mkdirSync(path.dirname(dst), { recursive: true })
  try { copyFileSync(src, dst) } catch { /* the indexer's own count reports it */ }
}
for (const rel of juliaDraw) copy(path.join(CORPUS, JULIA_REPOS.find((r) => existsSync(path.join(CORPUS, r, rel))) ?? JULIA_REPOS[0]!, rel), path.join(scratch, "julia", rel))
for (const f of others) copy(f.abs, path.join(scratch, "other", f.repo, f.rel))
console.log(`binding-collapse store probe`)
console.log(`corpus ${CORPUS}`)
console.log(`julia draw ${juliaDraw.length} of ${julia.length} across ${JULIA_REPOS.length} repo(s) · non-julia control ${others.length} file(s)`)
console.log(`data dir ${process.env.BB_DATA_DIR}`)

const { indexProjectParallel } = await import(`${REPO_ROOT}/src/ast/parallel-indexer.ts`)
const { BrainDatabase } = await import(`${REPO_ROOT}/src/brain/database.ts`)
const { getProjectId } = await import(`${REPO_ROOT}/src/cli/index.ts`)
const { retargetJuliaMethodTableBindings } = await import(`${REPO_ROOT}/src/ast/julia-binding-collapse.ts`)

let stats: any
try { stats = await indexProjectParallel(getProjectId(scratch) as any, scratch, {}) }
catch (e) { console.error(`index failed: ${(e as Error)?.message ?? e}`); rmSync(scratch, { recursive: true, force: true }); process.exit(2) }
const PID = getProjectId(scratch)
const raw: any = await BrainDatabase.getRawInstance(PID as any)

const TYPES = ["calls", "references", "uses", "instantiates", "exports", "extends", "imports"]
const q = TYPES.map(() => "?").join(",")
const snapshot = () => raw.prepare(
  `SELECT r.id, r.relationship_type, COALESCE(r.target_symbol_id,'') AS tid, COALESCE(f.language,'') AS lang
     FROM brain_relationship r
     LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
     LEFT JOIN brain_file   f ON f.id = s.file_id
    WHERE r.project_id = ? AND r.relationship_type IN (${q})`,
).all(PID, ...TYPES) as any[]

const before = snapshot()
const nSymbols = (raw.prepare(`SELECT COUNT(*) AS n FROM brain_symbol WHERE project_id = ?`).get(PID) as any)?.n ?? 0
if (nSymbols === 0) { console.error("REFUSING: the store holds no symbols — nothing to measure."); rmSync(scratch, { recursive: true, force: true }); process.exit(2) }
const jl = before.filter((r) => r.lang === "julia")
const other = before.filter((r) => r.lang !== "julia")
const unboundJl = jl.filter((r) => !r.tid)
console.log(`store: ${nSymbols} symbol(s) · ${before.length} row(s) of the bindable types (julia ${jl.length}, non-julia ${other.length})`)
console.log(`BEFORE: julia unbound ${unboundJl.length} of ${jl.length} · non-julia unbound ${other.filter((r: any) => !r.tid).length} of ${other.length}`)

if (Number(process.env.BB_PROBE_SHOW ?? 0) > 0) {
  const TOP = Number(process.env.BB_PROBE_SHOW)
  const counts = new Map<string, number>()
  for (const r of unboundJl as any[]) {
    const t = String(raw.prepare(`SELECT target_external AS t FROM brain_relationship WHERE id = ?`).get(r.id)?.t ?? "")
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)
  console.log(`unbound julia targets (top ${top.length} of ${counts.size} distinct):`)
  for (const [t, n] of top) console.log(`  ${n.toString().padStart(5)}  ${JSON.stringify(t)}`)
}
const res = retargetJuliaMethodTableBindings(raw, PID)
console.log(`pass: ${JSON.stringify(res)}`)

// WHAT THE RULE REACHED, IN THE STORE'S OWN ROWS: for the keys the pass calls one binding, are the
// rows that target them bound, unbound, or absent? This is the question the gate's model cannot
// answer, because the model has no store.
if (res.keyNames.length) {
  const placeholders = res.keyNames.map(() => "?").join(",")
  const onKeys = raw.prepare(
    `SELECT COALESCE(target_symbol_id,'') AS tid, COUNT(*) AS n
       FROM brain_relationship
      WHERE project_id = ? AND relationship_type IN (${TYPES.map(() => "?").join(",")})
        AND target_external IN (${placeholders})
      GROUP BY (target_symbol_id IS NULL)`,
  ).all(PID, ...TYPES, ...res.keyNames) as any[]
  const boundOnKeys = onKeys.find((r) => r.tid !== "")?.n ?? 0
  const unboundOnKeys = onKeys.find((r) => r.tid === "")?.n ?? 0
  console.log(`rows whose target IS one of the ${res.keyNames.length} one-binding key(s): bound ${boundOnKeys} · unbound ${unboundOnKeys}`)
  const shown = res.keyNames.slice(0, 8).map((k) => JSON.stringify(k)).join(", ")
  console.log(`  keys: ${shown}${res.keyNames.length > 8 ? ", …" : ""}`)
}

const after = snapshot()
const byId = new Map(after.map((r: any) => [r.id, r]))
let changedExisting = 0, newlyBound = 0, otherChanged = 0, nonGenuine = 0
for (const r of before as any[]) {
  const a = byId.get(r.id) as any
  if (!a) continue
  if (r.lang === "julia") {
    if (r.tid && a.tid && a.tid !== r.tid) changedExisting++
    if (!r.tid && a.tid) {
      newlyBound++
      const sym = raw.prepare(`SELECT name, qualified_name FROM brain_symbol WHERE id = ?`).get(a.tid) as any
      const nm = String(sym?.name ?? ""), qn = String(sym?.qualified_name ?? "")
      if (!qn || qn === nm) nonGenuine++
    }
  } else if (a.tid !== r.tid) otherChanged++
}
const afterUnboundJl = (after as any[]).filter((r) => r.lang === "julia" && !r.tid).length
console.log(`\nFALSIFIER`)
console.log(`  julia rows newly bound                 ${newlyBound}`)
console.log(`  julia unbound: ${unboundJl.length} -> ${afterUnboundJl}`)
console.log(`  rows that ALREADY had a binding and changed it  ${changedExisting}   (must be 0)`)
console.log(`  NON-JULIA rows changed (the language guard)     ${otherChanged}   (must be 0)`)
console.log(`  new bindings whose target is NOT a genuine qualification  ${nonGenuine}   (must be 0)`)
rmSync(scratch, { recursive: true, force: true })
if (changedExisting > 0 || otherChanged > 0 || nonGenuine > 0) {
  console.error("FAIL — a guard did not hold; the numbers above are the finding.")
  process.exit(1)
}
console.log(`PASS — ${newlyBound} julia row(s) bound, no existing binding re-pointed, no other language touched.`)
