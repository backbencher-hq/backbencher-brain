// script/m65/probe-lane-deciders.ts — for one lane: index, refresh, then ask each shared
// decider, in the order the passes run them, what it does with the rows the refresh re-stored.
//
// Usage: bun run script/m65/probe-lane-deciders.ts <lane> [<lane> ...]
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const EMPTY = mkdtempSync(path.join(tmpdir(), "m65-deciders-"))
process.env.BB_DATA_DIR = EMPTY
process.env.BB_NO_AUTO_REFRESH = "1"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

async function main() {
  const { LANE_FIXTURES } = await import(path.join(ROOT, "script/m65/lane-fixtures.ts"))
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel, reindexFilesParallel } = await import(
    path.join(ROOT, "src/ast/parallel-indexer.ts")
  )
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const {
    resolveNameTargets,
    resolveImportTargets,
    resolveRankedBareNameTargets,
    resolveDottedTargets,
    settleImportTargets,
  } = await import(path.join(ROOT, "src/ast/import-resolution.ts"))
  const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))
  const quiet = { log: () => {}, write: () => {} } as any

  const lanes = process.argv.slice(2)
  for (const lane of lanes) {
    const fx = LANE_FIXTURES.find((f: any) => f.language === lane)
    if (!fx) {
      console.log(`no fixture for lane ${lane}`)
      continue
    }
    console.log(`\n═══ ${lane} ═══`)
    const dir = path.join(EMPTY, lane)
    for (const [rel, content] of Object.entries(fx.files)) {
      const abs = path.join(dir, rel)
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, content)
    }
    const pid = getProjectId(dir) as string
    const consoleLog = console.log
    console.log = () => {}
    try {
      await indexProjectParallel(pid, dir, { logger: quiet })
    } finally {
      console.log = consoleLog
    }
    const raw: any = await BrainDatabase.getRawInstance(pid)
    const rowState = () => {
      const rows = raw
        .prepare(
          `SELECT relationship_type AS t, target_external AS te, target_symbol_id AS tsid,
                  is_cross_file AS xf, line_number AS ln,
                  COALESCE(ss.name, '') AS src,
                  COALESCE(sf.relative_path, '') AS srcFile
             FROM brain_relationship r
             LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
             LEFT JOIN brain_file sf ON sf.id = ss.file_id
            WHERE r.project_id = ?
            ORDER BY r.id`,
        )
        .all(pid) as any[]
      return rows.map((r) => `${r.t}|${r.srcFile}:${r.src}|${r.tsid ? "BOUND" : String(r.te)}|xf=${r.xf}|l${r.ln}`)
    }
    console.log(`full index rows (${rowState().length}):`)
    for (const r of rowState()) console.log(`  ${r}`)
    if (fx.targetName) {
      const g = await graphTraversal(pid, fx.targetName, { direction: "callers", maxDepth: 2 })
      console.log(`full index bb_graph callers(${fx.targetName}) = ${g.callers.length}`)
    }

    // Which decider binds THIS lane's unresolved rows in the FULL world? Detach every
    // unresolved-looking row's target and ask each decider in order.
    if (process.argv.includes("--detach-probe")) {
      const rows = raw
        .prepare(`SELECT id, relationship_type AS t, target_external AS te, target_symbol_id AS tsid FROM brain_relationship WHERE project_id = ?`)
        .all(pid) as any[]
      console.log("\n-- detach probe: full-world rows and their targets --")
      for (const r of rows) console.log(`  ${r.t}|${r.te}|${r.tsid ? "BOUND" : "unbound"}`)
      const sample = rows.find((r) => r.tsid && String(r.te).includes(":"))
      if (sample) {
        console.log(`detaching ${sample.t}|${sample.te}`)
        raw.prepare(`UPDATE brain_relationship SET target_symbol_id = NULL WHERE id = ?`).run(sample.id)
        const fileIds = (raw.prepare(`SELECT id FROM brain_file WHERE project_id = ?`).all(pid) as any[]).map((r) => r.id)
        const steps2: Array<[string, () => any]> = [
          ["resolveNameTargets", () => resolveNameTargets(raw, pid, { sourceFileIds: fileIds })],
          ["resolveDottedTargets", () => resolveDottedTargets(raw, pid, { sourceFileIds: fileIds })],
          ["resolveImportTargets(scoped)", () => resolveImportTargets(raw, pid, { onlySourceFileIds: fileIds })],
          ["resolveRankedBareNameTargets", () => resolveRankedBareNameTargets(raw, pid, { sourceFileIds: fileIds })],
          ["resolveImportTargets(project)", () => resolveImportTargets(raw, pid, {})],
        ]
        for (const [name, fn] of steps2) {
          let out: any = null
          try {
            out = fn()
          } catch (e: any) {
            out = { error: e?.message }
          }
          const now = raw.prepare(`SELECT target_symbol_id AS t FROM brain_relationship WHERE id = ?`).get(sample.id) as any
          console.log(`  ${name} -> ${JSON.stringify(out)} · row now ${now?.t ? "BOUND" : "unbound"}`)
          if (now?.t) break
        }
      }
      return
    }

    const editedAbs = path.join(dir, fx.editedPath)
    writeFileSync(editedAbs, fx.editedContent)
    const rt = await reindexFilesParallel(pid, dir, [{ path: editedAbs, type: "modified" }], { logger: quiet })
    console.log(`after refresh: ${JSON.stringify((rt as any).derived)}`)
    console.log(`refreshed rows (${rowState().length}):`)
    for (const r of rowState()) console.log(`  ${r}`)

    const touchedFileIds = (raw
      .prepare(`SELECT id FROM brain_file WHERE project_id = ? AND relative_path = ?`)
      .all(pid, fx.editedPath) as any[]).map((r) => r.id)
    console.log(`touched file ids: ${JSON.stringify(touchedFileIds)}`)
    const steps: Array<[string, () => any]> = [
      ["resolveNameTargets", () => resolveNameTargets(raw, pid, { sourceFileIds: touchedFileIds })],
      ["resolveDottedTargets(scoped)", () => resolveDottedTargets(raw, pid, { sourceFileIds: touchedFileIds })],
      ["resolveImportTargets(scoped)", () => resolveImportTargets(raw, pid, { onlySourceFileIds: touchedFileIds })],
      ["resolveRankedBareNameTargets", () => resolveRankedBareNameTargets(raw, pid, { sourceFileIds: touchedFileIds })],
      ["resolveImportTargets(project)", () => resolveImportTargets(raw, pid, {})],
      ["settleImportTargets", () => settleImportTargets(raw, pid)],
    ]
    for (const [name, fn] of steps) {
      const before = rowState()
      let out: any = null
      try {
        out = fn()
      } catch (e: any) {
        out = { error: e?.message }
      }
      const after = rowState()
      const moved = after.filter((r, i) => before[i] !== r).length
      console.log(`  ${name} -> ${JSON.stringify(out)} · rows moved: ${moved}`)
      if (moved > 0) for (const r of after) console.log(`      ${r}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
