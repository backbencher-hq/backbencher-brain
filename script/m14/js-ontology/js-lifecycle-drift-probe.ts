// script/m14/js-ontology/js-lifecycle-drift-probe.ts — attribute the M40
// lifecycle-corpus drift (S4: relationships 3003 → 4502, +1 per module file).
//
// The corpus gate compares against a committed baseline, so ANY drift fails and
// the baseline must not be re-recorded until the drift is explained. This probe
// rebuilds the S4 fixture shape (N modules, each importing one function from a
// single hub and calling it), runs the SAME two steps the scenario runs — a full
// index, then `index --resume` — and then reports:
//
//   - relationship rows by type (committed baseline says ~2 per module file)
//   - DUPLICATE logical edges: rows sharing (source_symbol_id, target_external,
//     relationship_type) under different ids — the shape a lost-then-reinserted
//     row would take if the second write used a different id
//   - the id stability between the two runs' row sets
//
// Run it in a checkout of HEAD and in the working tree and diff the numbers: a
// difference in `byType` is the mechanism.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import path from "node:path"

const EMPTY = mkdtempSync(path.join(tmpdir(), "js-life-drift-"))
process.env.BB_DATA_DIR = EMPTY
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const PROJ = path.join(EMPTY, "proj")
mkdirSync(path.join(PROJ, "src"), { recursive: true })

const N = 200
writeFileSync(path.join(PROJ, "src", "hub.ts"), `export function libBase(x: number): number { return x }\n`)
for (let i = 1; i <= N; i++) {
  writeFileSync(path.join(PROJ, "src", `mod${i}.ts`), `import { libBase } from "./hub"\nexport function mod${i}fn(x: number): number { return libBase(x + ${i}) }\n`)
}

const runner = path.join(ROOT, "src", "cli", "index.ts")
const cli = (args: string[]) => spawnSync("bun", [runner, ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env } })

const r0 = cli(["index", PROJ])
console.log(`step 1 (full index): exit=${r0.status}`)
const r1 = cli(["index", PROJ, "--resume"])
console.log(`step 2 (--resume):   exit=${r1.status}`)
const r2 = cli(["index", PROJ, "--changed"])
console.log(`step 3 (--changed, nothing modified): exit=${r2.status}`)

// step 4 — THE exercise: re-store the HUB alone, with the modules untouched.
// Every module holds a FILE-LEVEL `imports` row into the hub (`source_symbol_id`
// NULL), so this is the population the old capture predicate excluded and the
// old store deleted. Rewriting identical content bumps mtime, so the hub is
// re-parsed and re-stored. Read the totals AFTER this step.
const { readFileSync, writeFileSync: wf } = await import("node:fs")
const hubPath = path.join(PROJ, "src", "hub.ts")
wf(hubPath, readFileSync(hubPath))
const r3 = cli(["index", PROJ, "--changed"])
console.log(`step 4 (--changed, hub re-stored): exit=${r3.status}`)

const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const pid = getProjectId(PROJ) as any
const raw = await BrainDatabase.getRawInstance(pid)

const one = (sql: string, ...p: any[]) => (raw.prepare(sql).get(...p) as any).c as number
console.log(`\nsymbols=${one(`SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?`, pid)} relationships=${one(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?`, pid)} files=${one(`SELECT COUNT(*) c FROM brain_file WHERE project_id = ?`, pid)}`)

console.log(`\nby type:`)
for (const r of raw.prepare(`SELECT relationship_type t, COUNT(*) c, SUM(CASE WHEN target_symbol_id IS NULL THEN 1 ELSE 0 END) unresolved FROM brain_relationship WHERE project_id = ? GROUP BY relationship_type ORDER BY c DESC`).all(pid) as any[]) {
  console.log(`  ${String(r.t).padEnd(12)} ${String(r.c).padStart(6)}  unresolved=${r.unresolved}`)
}

const dups = raw.prepare(`
  SELECT COUNT(*) c FROM (
    SELECT source_symbol_id, target_external, relationship_type, COUNT(*) n
      FROM brain_relationship WHERE project_id = ? GROUP BY 1,2,3 HAVING n > 1
  )`).get(pid) as any
const dupRows = raw.prepare(`
  SELECT SUM(n) c FROM (
    SELECT COUNT(*) n FROM brain_relationship WHERE project_id = ? GROUP BY source_symbol_id, target_external, relationship_type HAVING n > 1
  )`).get(pid) as any
console.log(`\nduplicate logical edges: ${dups.c} keys covering ${dupRows.c ?? 0} rows`)
for (const r of raw.prepare(`SELECT id, relationship_type t, target_external te, target_symbol_id tid FROM brain_relationship WHERE project_id = ? AND source_symbol_id IN (SELECT source_symbol_id FROM brain_relationship WHERE project_id = ? GROUP BY source_symbol_id, target_external, relationship_type HAVING COUNT(*) > 1) ORDER BY source_symbol_id LIMIT 6`).all(pid, pid) as any[]) {
  console.log(`  ${String(r.t).padEnd(9)} target=${String(r.te).padEnd(20)} resolved=${r.tid ? "yes" : "NO"}  id=${r.id.slice(-52)}`)
}

const intoHub = one(`SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol t ON t.id = r.target_symbol_id WHERE r.project_id = ? AND t.name = 'libBase'`, pid)
console.log(`\nedges into libBase: ${intoHub} (modules: ${N})`)
