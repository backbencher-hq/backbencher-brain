// script/m65/probe-a2-shape.ts — small-scale reproduction of script/m40/verify-a2-bounded-post.ts's
// fixture shape (N leaves calling a hub), to locate why A2 reads E1=0 after an incremental run.
//
// A2's own fixture is 2000 leaves (a ~10-minute run); this is the same shape at 30, with the
// repair's telemetry printed so the failure has a cause rather than a count.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const EMPTY = mkdtempSync(path.join(tmpdir(), "m65-a2-shape-"))
process.env.BB_DATA_DIR = EMPTY
const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const PROJ = path.join(EMPTY, "proj")
const LEAVES = Number(process.env.BB_A2_LEAVES ?? 30)

async function main() {
  mkdirSync(path.join(PROJ, "src"), { recursive: true })
  writeFileSync(
    path.join(PROJ, "src", "hub0.ts"),
    `export function hub0fn(x: number): number { return x + 1 }\nexport function hub0other(x: number): number { return x * 2 }\n`,
  )
  writeFileSync(path.join(PROJ, "src", "hub1.ts"), `export function hub1fn(x: number): number { return x - 1 }\n`)
  for (let i = 1; i < LEAVES; i++) {
    writeFileSync(
      path.join(PROJ, "src", `leaf${i}.ts`),
      [
        `import { hub0fn, hub0other } from "./hub0"`,
        `import { hub1fn } from "./hub1"`,
        `export function leaf${i}fn(x: number): number { return hub0fn(x + ${i}) }`,
        `export function leaf${i}other(x: number): number { return hub0other(x * ${i}) }`,
        `export function leaf${i}deep(x: number): number { return hub0fn(hub0other(hub1fn(leaf${i}fn(x)))) }`,
      ].join("\n") + "\n",
    )
  }

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(PROJ) as any
  const quiet = { log: () => {}, write: () => {} } as any

  await indexProjectParallel(pid, PROJ, { logger: quiet })
  const raw = await BrainDatabase.getRawInstance(pid)
  const hubFileId = `${pid}:src/hub0.ts`
  const edgesIntoHub = () =>
    (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol t ON t.id = r.target_symbol_id WHERE r.project_id = ? AND t.file_id = ?`).get(pid, hubFileId) as any).c as number
  const rowsIntoHubFile = () =>
    (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship r WHERE r.project_id = ? AND r.id IN (SELECT id FROM brain_relationship WHERE project_id = ?)`).get(pid, pid) as any).c as number
  const unresolvedNamingHub = () =>
    (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND target_symbol_id IS NULL AND target_external IN ('hub0fn','hub0other')`).get(pid) as any).c as number

  const E0 = edgesIntoHub()
  console.log(`after full index: edges into hub0 = ${E0} (unresolved rows naming hub0 fn/other: ${unresolvedNamingHub()})  allrows=${rowsIntoHubFile()}`)

  // The edit keeps both names and adds one, exactly as A2's does.
  writeFileSync(
    path.join(PROJ, "src", "hub0.ts"),
    `import { hub1fn } from "./hub1"\nexport function hub0fn(x: number): number { return x + 100 }\nexport function hub0other(x: number): number { return x * 200 }\nexport function hub0new(x: number): number { return hub1fn(x) - 1 }\n`,
  )
  const s1 = await indexProjectParallel(pid, PROJ, { isIncremental: true, logger: quiet })
  console.log(`incremental: derived=${s1.summary?.derivedPass} m40Bounded=${JSON.stringify(s1.m40Bounded ?? null)}`)
  console.log(`phases: ${JSON.stringify(s1.phases?.postProcessingPhases ?? [])}`)
  const E1 = edgesIntoHub()
  console.log(`after incremental: edges into hub0 = ${E1} (was ${E0})`)
  console.log(`unresolved rows naming hub0 fn/other: ${unresolvedNamingHub()}`)
  const rowsByTarget = raw
    .prepare(
      `SELECT r.relationship_type t, r.target_symbol_id IS NULL AS unresolved, COUNT(*) c
         FROM brain_relationship r WHERE r.project_id = ? AND r.target_external IN ('hub0fn','hub0other','hub0new')
        GROUP BY t, unresolved`,
    )
    .all(pid) as any[]
  for (const r of rowsByTarget) console.log(`   ${r.t} unresolved=${r.unresolved} count=${r.c}`)
  const fkNull = (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND target_symbol_id IS NULL`).get(pid) as any).c
  console.log(`rows with NULL target anywhere: ${fkNull}`)
  console.log(EMPTY)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
