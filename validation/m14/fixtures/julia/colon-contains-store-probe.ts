/**
 * JULIA COLON-CONTAINS STORE PROBE — did the fleet's `140be2f01` reach this lane?
 *
 * ## The question
 *
 * `140be2f01` fixed the indexer's `contains` dedup guard, which built its key LEAF-REDUCED and
 * probed the CHILD RAW. Every child symbol whose NAME carries a colon therefore got a synthesized
 * owner→owned containment row written a SECOND time. The expectation for julia was "not affected —
 * its qualified names are dotted". The census counted otherwise: **52 colon-named AND owned symbols**
 * (`Base.:(==)`, `Base.:<`, `Base.:<=`, …), each of which received that duplicate row.
 *
 * That count is a MODEL count — symbols in analyzer output. This probe asks the STORE: with the fix
 * in, does julia still hold two containment rows for one (owner, child) pair? A model count cannot
 * answer it and neither can the gate, which never reads `brain_relationship`.
 *
 * ## Discipline
 *
 * - REAL indexer, REAL store: production `indexProjectParallel`, then SQL over `brain_relationship`
 *   joined to `brain_symbol`. No modelled SQL, no predicted bindings.
 * - ONE scratch project, so "emitted" (the analyzer over the same files) and "stored" are comparable.
 * - The corpus is COPIED, never written; the scratch project and its directory are removed on exit.
 * - A BROKEN STORE IS DISCLOSED, NOT READ THROUGH: zero symbols ⇒ exit 2 rather than printing
 *   binding numbers derived from nothing.
 * - `BB_DATA_DIR` must be set by the caller (store runs in this programme are one run each, and a
 *   scratch data dir keeps this one from touching the shared index).
 *
 * ## Usage
 *
 *   BB_DATA_DIR=$PWD/.tmp-julia/bb-data npx tsx validation/m14/fixtures/julia/colon-contains-store-probe.ts
 *   BB_JULIA_PROBE_FILES=800 …   # bound the draw (stride over the admitted population)
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const DRAW = Number(process.env.BB_JULIA_PROBE_FILES ?? 600)

if (!process.env.BB_DATA_DIR) {
  console.error("REFUSING: BB_DATA_DIR is not set. Store runs must write to a scratch data dir " +
    "(BB_DATA_DIR=$PWD/.tmp-julia/bb-data), never the shared one.")
  process.exit(2)
}

/** Every admitted `.jl` file, in the same shape the census admits them (under 400 KB). */
type F = { repo: string; rel: string; abs: string }
const all: F[] = []
for (const repo of readdirSync(CORPUS)) {
  const root = path.join(CORPUS, repo)
  const walk = (d: string, depth: number) => {
    if (depth > 20) return
    let ents; try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p, depth + 1) }
      else if (e.name.endsWith(".jl")) { try { if (statSync(p).size < 400_000) all.push({ repo, rel: path.relative(root, p), abs: p }) } catch { /* gone */ } }
    }
  }
  try { if (statSync(root).isDirectory()) walk(root, 0) } catch { /* not a dir */ }
}
all.sort((a, b) => (a.repo + a.rel).localeCompare(b.repo + b.rel))
const stride = Math.max(1, Math.floor(all.length / DRAW))
const sample = all.filter((_, i) => i % stride === 0).slice(0, DRAW)

console.log(`julia colon-contains store probe`)
console.log(`corpus ${CORPUS}`)
console.log(`admitted ${all.length} .jl files · draw ${sample.length} (every ${stride}th, sorted — a stride, never a prefix)`)
console.log(`data dir ${process.env.BB_DATA_DIR}`)

// Every drawn file carries BOTH halves of the colon-NAME audit: the analyzer's own contains edges
// (the row the indexer was supposed to dedup against) and the store's rows for the same file.
const { parseFile } = await import(`${REPO_ROOT}/src/ast/pool-worker.ts`)
let emittedContains = 0, emittedColonChild = 0, colonOwnedSymbols = 0, parsed = 0
const colonOwnedByFile = new Map<string, string[]>()
for (const f of sample) {
  let res: any
  try { res = await parseFile(f.abs, path.dirname(f.abs)) } catch { continue }
  if (res?.fallback) continue
  parsed++
  for (const s of (res.symbols ?? []) as any[]) {
    const nm = String(s?.name ?? ""); const own = String(s?.ownerName ?? "")
    if (nm.includes(":") && own) {
      colonOwnedSymbols++
      const list = colonOwnedByFile.get(f.abs) ?? []
      list.push(`${own} -> ${nm}`)
      colonOwnedByFile.set(f.abs, list)
    }
  }
  for (const r of (res.relationships ?? []) as any[]) {
    if (String(r?.type ?? r?.relationshipType ?? "").toLowerCase() !== "contains") continue
    emittedContains++
    if (String(r?.target ?? "").includes(":")) emittedColonChild++
  }
}
console.log(`analyzer over the same draw: parsed ${parsed}/${sample.length} · colon-named OWNED symbols ${colonOwnedSymbols} · ` +
  `contains edges ${emittedContains} (of which colon-child ${emittedColonChild})`)
if (parsed === 0) { console.error("REFUSING: the analyzer read nothing, so there is nothing to compare against."); process.exit(2) }

// ── the scratch project: copy the draw, index it with production, read the store
const scratch = mkdtempSync(path.join(process.env.BB_DATA_DIR!, "julia-colon-probe-"))
for (const f of sample) {
  const dst = path.join(scratch, f.repo, f.rel)
  mkdirSync(path.dirname(dst), { recursive: true })
  try { cpSync(f.abs, dst) } catch { /* one file, reported by the indexer's own count */ }
}
const { indexProjectParallel, discoverIndexableFiles } = await import(`${REPO_ROOT}/src/ast/parallel-indexer.ts`)
const { BrainDatabase } = await import(`${REPO_ROOT}/src/brain/database.ts`)
const { getProjectId } = await import(`${REPO_ROOT}/src/cli/index.ts`)

const eligible = new Set(await discoverIndexableFiles(scratch))
console.log(`indexer-eligible ${eligible.size} of ${sample.length} copied`)
let stats: any
const t0 = Date.now()
try { stats = await indexProjectParallel(getProjectId(scratch) as any, scratch, {}) }
catch (e) { console.error(`index failed: ${(e as Error)?.message ?? e}`); rmSync(scratch, { recursive: true, force: true }); process.exit(2) }
const ms = Date.now() - t0
const PID = getProjectId(scratch)
const raw = await BrainDatabase.getRawInstance(PID as any)
const symCount = (raw.prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE project_id = ?").get(PID) as any)?.c ?? 0
const fileCount = (raw.prepare("SELECT COUNT(*) AS c FROM brain_file WHERE project_id = ?").get(PID) as any)?.c ?? 0
if (symCount === 0) {
  console.error(`BROKEN STORE: 0 symbols for ${PID} over ${sample.length} copied files (indexer reported ${stats?.symbols ?? "?"}) — refusing to print numbers from an empty index.`)
  rmSync(scratch, { recursive: true, force: true }); process.exit(2)
}

const storedContains = (raw.prepare(
  "SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ? AND relationship_type = 'contains'").get(PID) as any)?.c ?? 0
const storedColon = (raw.prepare(
  "SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ? AND relationship_type = 'contains' AND target_external LIKE '%:%'").get(PID) as any)?.c ?? 0
/**
 * TWO GROUPINGS, BECAUSE THEY MEAN DIFFERENT THINGS — and the first version of this probe used only
 * the second, which would have convicted the store of a defect it does not have.
 *
 *   sameOwnerChildName   two rows for one owner and one child NAME. LEGITIMATE when a module holds
 *                        two symbols that share a name (two same-named structs, a struct and its
 *                        constructor): the analyzer's own edge dedup collapses those into one row,
 *                        while the indexer synthesizes one row per SYMBOL, so the store is right and
 *                        the edge model is the coarser one. Not a defect; reported as a shape.
 *   trueDuplicateRows    two rows identical in (source, target_external, target_symbol_id). THAT is
 *                        the `140be2f01` signature: one edge written twice.
 */
const sameOwnerChildName = (raw.prepare(`
  SELECT COUNT(*) AS c FROM (
    SELECT source_symbol_id, target_external, COUNT(*) AS n
    FROM brain_relationship WHERE project_id = ? AND relationship_type = 'contains'
    GROUP BY source_symbol_id, target_external HAVING n > 1)`).get(PID) as any)?.c ?? 0
const dupPairs = (raw.prepare(`
  SELECT COUNT(*) AS c FROM (
    SELECT source_symbol_id, target_external, target_symbol_id, COUNT(*) AS n
    FROM brain_relationship WHERE project_id = ? AND relationship_type = 'contains'
    GROUP BY source_symbol_id, target_external, target_symbol_id HAVING n > 1)`).get(PID) as any)?.c ?? 0
const dupColon = (raw.prepare(`
  SELECT COUNT(*) AS c FROM (
    SELECT source_symbol_id, target_external, target_symbol_id, COUNT(*) AS n
    FROM brain_relationship WHERE project_id = ? AND relationship_type = 'contains' AND target_external LIKE '%:%'
    GROUP BY source_symbol_id, target_external, target_symbol_id HAVING n > 1)`).get(PID) as any)?.c ?? 0
const nameSamples = raw.prepare(`
  SELECT s.name AS src, r.target_external AS tgt, COUNT(*) AS n, COUNT(DISTINCT r.target_symbol_id) AS distinctTargets
  FROM brain_relationship r LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
  WHERE r.project_id = ? AND r.relationship_type = 'contains'
  GROUP BY r.source_symbol_id, r.target_external HAVING n > 1 LIMIT 8`).all(PID) as any[]

console.log(`\nindexed in ${ms} ms: ${fileCount} files, ${symCount} symbols, ${storedContains} stored contains rows`)
console.log(`RATIO stored/emitted (the fleet's own test for this defect): ${emittedContains ? (storedContains / emittedContains).toFixed(3) : "n/a"}x`)
console.log(`same-owner-same-child-NAME pairs (legitimate when two symbols share a name): ${sameOwnerChildName}`)
for (const d of nameSamples) console.log(`    ${d.src} -> ${d.tgt}  x${d.n}  distinct bindings ${d.distinctTargets}`)
console.log(`TRUE DUPLICATE ROWS (source, child, binding) — the 140be2f01 signature: ${dupPairs}   of which colon-child: ${dupColon}`)
console.log(`stored contains rows whose target carries a colon: ${storedColon}`)
console.log(`\nVERDICT: ${dupPairs === 0
  ? "no duplicate containment rows — julia's colon-named class is clean under 140be2f01 on this draw"
  : "DUPLICATES PRESENT — the defect is still reaching this lane"}`)
console.log(`NOTE ON WHAT THIS CANNOT SAY: the fix is already in the tree, so this measures the CURRENT`)
console.log(`store, not a before/after. The before state is the census's model count (52 colon-named owned`)
console.log(`symbols), which is what the defect duplicated; a store-side "before" is no longer reachable.`)
rmSync(scratch, { recursive: true, force: true })
process.exit(dupPairs === 0 ? 0 : 1)
