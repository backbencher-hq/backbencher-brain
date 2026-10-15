// script/m65/probe-refresh-resolution.ts — measurement probe for bb_graph review D2.
//
// Question: after a routine incremental refresh of a file that CALLS a function
// declared in another file, does the store still hold that call's target, or has
// the run left the row as an unresolved name (`target_symbol_id IS NULL`,
// `target_external = "refTarget"`)? A read tool that answers `callers` from the
// store cannot see an unresolved row, so this decides whether the tool can say
// "0 callers, truncated: false" about a symbol that has callers.
//
// Real paths only: the REAL indexer builds the world, then the REAL incremental
// entry point (`reindexFilesParallel` — what `bb index --changed`, LSP didSave
// and MCP bb_index mode=file run) refreshes the edited file.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const EMPTY = mkdtempSync(path.join(tmpdir(), "m65-refresh-probe-"))
process.env.BB_DATA_DIR = EMPTY

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const FIXTURE = path.join(EMPTY, "fixture")

async function main() {
  mkdirSync(path.join(FIXTURE, "src"), { recursive: true })
  writeFileSync(
    path.join(FIXTURE, "src/a.ts"),
    `export function refTarget(x: number): number {\n  return x + 1\n}\n`,
  )
  const bPath = path.join(FIXTURE, "src/b.ts")
  writeFileSync(
    bPath,
    `import { refTarget } from "./a"\nexport function useOne(): number {\n  return refTarget(1)\n}\n`,
  )

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel, reindexFilesParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const pid = getProjectId(FIXTURE) as any
  await indexProjectParallel(pid, FIXTURE, {})
  const raw = await BrainDatabase.getRawInstance(pid)

  const report = (label: string) => {
    const rows = raw
      .prepare(
        `SELECT r.id, r.relationship_type, r.target_symbol_id, r.target_external, r.source_external
           FROM brain_relationship r
          WHERE r.project_id = ? AND r.source_symbol_id IS NOT NULL
            AND r.source_symbol_id IN (SELECT id FROM brain_symbol WHERE project_id = ? AND file_id = ?)
          ORDER BY r.relationship_type, r.id`,
      )
      .all(pid, pid, `${pid}:src/b.ts`) as Array<any>
    const unresolved = rows.filter((r) => !r.target_symbol_id && r.target_external)
    // A row whose external spelling names a symbol the project holds is DECIDABLE:
    // the full pass resolves it, so leaving it NULL is the degradation.
    const decidable = unresolved.filter((r) => {
      const hit = raw
        .prepare(
          `SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND (name = ? OR qualified_name = ?)`,
        )
        .get(pid, r.target_external, r.target_external) as any
      return (hit?.c ?? 0) > 0
    })
    console.log(`\n[${label}] rows emitted by src/b.ts: ${rows.length}, unresolved: ${unresolved.length}, decidable-but-unresolved: ${decidable.length}`)
    for (const r of rows) {
      console.log(`   ${r.relationship_type.padEnd(10)} target=${r.target_symbol_id ? "BOUND" : "NULL "} ext=${JSON.stringify(r.target_external)}`)
    }
    return { rows, unresolved, decidable }
  }

  report("fresh full index")

  // The routine edit: one more call to the same cross-file function.
  writeFileSync(
    bPath,
    `import { refTarget } from "./a"\nexport function useOne(): number {\n  return refTarget(1)\n}\nexport function useTwo(): number {\n  return refTarget(2)\n}\n`,
  )

  const rt = await reindexFilesParallel(pid, FIXTURE, [{ path: bPath, type: "modified" }], {
    logger: { log: () => {}, write: () => {} } as any,
  })
  console.log(`\nincremental run: indexed=${rt.indexed} deleted=${rt.deleted} errors=${rt.errors} derived=${JSON.stringify(rt.derived ?? null)}`)
  const after = report("after incremental refresh")

  const boundToTarget = (raw
    .prepare(
      `SELECT COUNT(*) c FROM brain_relationship r
        JOIN brain_symbol s ON s.id = r.target_symbol_id
       WHERE r.project_id = ? AND r.relationship_type = 'calls' AND s.name = 'refTarget'`,
    )
    .get(pid) as any).c
  console.log(`\ncalls rows BOUND to refTarget: ${boundToTarget} (expected 2 — one per call site)`)
  console.log(`decidable-but-unresolved after refresh: ${after.decidable.length}`)
  console.log(EMPTY)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
