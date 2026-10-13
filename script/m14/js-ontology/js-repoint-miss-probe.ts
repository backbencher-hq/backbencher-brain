// script/m14/js-ontology/js-repoint-miss-probe.ts — why does the name pass miss
// in-edges whose target symbol MOVED (id changed) inside a re-stored file?
//
// A2 measured it: a hub's in-edges dropped 15994 → 11999 after an incremental
// re-index that inserted a line above the hub's exports (so every symbol id
// changed) and the repair reported only 6 re-points. This probe rebuilds that
// shape at 4 files and prints, for every in-edge left unresolved:
//
//   - the row's own `target_external` spelling (what capture stored as the name)
//   - whether a symbol with that name exists in the re-stored file NOW
//   - the symbols that DO exist there (id + name + qualified_name)
//
// so the miss is attributed to a spelling mismatch or to a matching failure.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const EMPTY = mkdtempSync(path.join(tmpdir(), "js-repoint-miss-"))
process.env.BB_DATA_DIR = EMPTY

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const PROJ = path.join(EMPTY, "proj")
mkdirSync(path.join(PROJ, "src"), { recursive: true })

const HUB_V1 = `export function hubfn(x: number): number { return x + 1 }\nexport function hubother(x: number): number { return x * 2 }\n`
const HUB_V2 = `import { other } from "./other"\nexport function hubfn(x: number): number { return x + 100 }\nexport function hubother(x: number): number { return x * 200 }\n`

writeFileSync(path.join(PROJ, "src", "other.ts"), `export function other(): number { return 7 }\n`)
writeFileSync(path.join(PROJ, "src", "hub.ts"), HUB_V1)
for (let i = 1; i <= 3; i++) {
  writeFileSync(
    path.join(PROJ, "src", `leaf${i}.ts`),
    `import { hubfn, hubother } from "./hub"\n` +
      `export function leaf${i}fn(x: number): number { return hubfn(x + ${i}) }\n` +
      `export function leaf${i}other(x: number): number { return hubother(x * ${i}) }\n`,
  )
}

const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
const { indexProjectParallel, snapshotInEdges } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

const pid = getProjectId(PROJ) as any
const s0 = await indexProjectParallel(pid, PROJ, {})
console.log(`indexed: files=${s0.totalFiles} rels=${s0.relationshipsFound}`)
const raw = await BrainDatabase.getRawInstance(pid)
const hubFileId = `${pid}:src/hub.ts`

const intoHub = () =>
  (raw
    .prepare(
      `SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol t ON t.id = r.target_symbol_id WHERE r.project_id = ? AND t.file_id = ?`,
    )
    .get(pid, hubFileId) as any).c as number

const before = intoHub()
const beforeSyms = raw
  .prepare(`SELECT id, name, qualified_name FROM brain_symbol WHERE project_id = ? AND file_id = ? ORDER BY name`)
  .all(pid, hubFileId) as any[]
console.log(`\nbefore: ${before} edges into hub.ts; hub symbols:`)
for (const s of beforeSyms) console.log(`   ${s.name.padEnd(10)} ${s.id}`)

// What the FULL index (the reference world) leaves on those in-edges: type,
// whether the row has a symbol on its source side at all, and whether the
// enrichment pass gave it metadata. A2 asserts restored in-edges "keep their
// enrichment metadata" at ≥90% of the in-edge count — so it matters which
// in-edges can hold metadata in the first place.
const fullRows = raw
  .prepare(
    `SELECT r.relationship_type t, (r.source_symbol_id IS NULL) srcNull, (r.metadata IS NULL) metaNull, COUNT(*) c
       FROM brain_relationship r JOIN brain_symbol s ON s.id = r.target_symbol_id
      WHERE r.project_id = ? AND s.file_id = ?
      GROUP BY r.relationship_type, srcNull, metaNull ORDER BY r.relationship_type`,
  )
  .all(pid, hubFileId) as any[]
console.log(`\nin-edges of the FULL index by type / source-symbol-absent / metadata-absent:`)
for (const r of fullRows) console.log(`   ${String(r.t).padEnd(9)} srcNull=${r.srcNull} metaNull=${r.metaNull}  ×${r.c}`)

// every in-edge, as the capture would see it
const snapshot = await snapshotInEdges(pid, [hubFileId])
console.log(`\ncaptured (${snapshot.length} rows):`)
const byName = new Map<string, number>()
for (const r of snapshot) {
  const k = `${r.target_name ?? "«null»"} <-${r.relationship_type}-`
  byName.set(k, (byName.get(k) ?? 0) + 1)
}
for (const [k, n] of [...byName.entries()].sort()) console.log(`   ${String(n).padStart(4)}  ${k}`)
const resolvable = snapshot.filter((r: { target_symbol_id: string | null }) => r.target_symbol_id && beforeSyms.some((s: any) => s.id === r.target_symbol_id)).length
console.log(`   of these, ${resolvable} point at a symbol that exists right now (exact re-point would land)`)

// ---- the move: insert a line at the top of hub.ts, then incremental re-index
writeFileSync(path.join(PROJ, "src", "hub.ts"), HUB_V2)
const s1 = await indexProjectParallel(pid, PROJ, { isIncremental: true })
console.log(`\nincremental: newlyParsed=${s1.summary?.newlyParsed} derivedPass=${s1.summary?.derivedPass} bounded=${JSON.stringify(s1.m40Bounded)}`)

const after = intoHub()
const afterSyms = raw
  .prepare(`SELECT id, name, qualified_name FROM brain_symbol WHERE project_id = ? AND file_id = ? ORDER BY name`)
  .all(pid, hubFileId) as any[]
console.log(`\nafter: ${after} edges into hub.ts (was ${before}); hub symbols now:`)
for (const s of afterSyms) console.log(`   ${String(s.name).padEnd(10)} ${s.id}  qn=${s.qualified_name}`)

const stillNull = raw
  .prepare(
    `SELECT r.id, r.target_external, r.relationship_type, r.line_number
     FROM brain_relationship r
     WHERE r.project_id = ? AND r.target_symbol_id IS NULL AND r.target_external IS NOT NULL AND r.target_external != ''
     GROUP BY r.target_external, r.relationship_type`,
  )
  .all(pid) as any[]
console.log(`\nunresolved rows with a spelling (by spelling/type):`)
for (const r of stillNull) console.log(`   ${r.target_external}  [${r.relationship_type}]  e.g. ${r.id.slice(-40)}`)
const naming = new Set(afterSyms.map((s) => s.name))
const matchable = stillNull.filter((r) => naming.has(r.target_external))
console.log(`\n   ${matchable.length} of ${stillNull.length} unresolved spellings DO name a symbol in the re-stored file (name pass should have hit)`)
console.log(`   names present in hub.ts: ${[...naming].join(", ")}`)

// ---- can the SHARED resolver (the full pass's strategy 4) close the remainder?
const beforeResolve = intoHub()
const unresolvedBefore = (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND target_symbol_id IS NULL`).get(pid) as any).c
const { resolveImportTargets } = await import(path.join(ROOT, "src/ast/import-resolution.ts"))
const out = resolveImportTargets(raw as any, pid)
const unresolvedAfter = (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND target_symbol_id IS NULL`).get(pid) as any).c
console.log(`\nresolveImportTargets: scanned=${out.scanned} resolved=${out.resolved} byReason=${JSON.stringify(out.byReason)}`)
console.log(`   edges into hub.ts: ${beforeResolve} → ${intoHub()} (a full index held ${before})`)
console.log(`   unresolved rows: ${unresolvedBefore} → ${unresolvedAfter}`)
