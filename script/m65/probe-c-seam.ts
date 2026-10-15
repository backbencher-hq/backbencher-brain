// script/m65/probe-c-seam.ts — why does the C lane's cross-file call survive a full index
// bound and a refresh unbound? (D2 seam, lane-level diagnosis; the gate is the verdict.)
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const EMPTY = mkdtempSync(path.join(tmpdir(), "m65-c-seam-"))
process.env.BB_DATA_DIR = EMPTY
process.env.BB_NO_AUTO_REFRESH = "1"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

const FILES: Record<string, string> = {
  "a.h": `int ref_target_c(int x);\n`,
  "a.c": `#include "a.h"\n\nint ref_target_c(int x) {\n  return x + 1;\n}\n`,
  "b.c": `#include "a.h"\n\nint use_one_c() {\n  return ref_target_c(1);\n}\n`,
}
const EDITED = `#include "a.h"\n\nint use_one_c() {\n  return ref_target_c(1);\n}\n\nint use_two_c() {\n  return ref_target_c(2);\n}\n`

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel, reindexFilesParallel } = await import(
    path.join(ROOT, "src/ast/parallel-indexer.ts")
  )
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { resolveNameTargets } = await import(path.join(ROOT, "src/ast/import-resolution.ts"))
  const quiet = { log: () => {}, write: () => {} } as any

  const dir = path.join(EMPTY, "incremental")
  for (const [rel, content] of Object.entries(FILES)) {
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

  const dump = (label: string) => {
    const rows = raw
      .prepare(
        `SELECT r.id AS id, r.relationship_type AS t, r.target_external AS te,
                r.target_symbol_id AS tsid, r.is_cross_file AS xf, r.line_number AS ln,
                r.source_symbol_id AS ssid, ss.name AS srcName, sf.relative_path AS srcFile
           FROM brain_relationship r
           LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
           LEFT JOIN brain_file sf ON sf.id = ss.file_id
          WHERE r.project_id = ?
          ORDER BY r.id`,
      )
      .all(pid) as any[]
    console.log(`\n== ${label} (${rows.length} rows)`)
    for (const r of rows) console.log(JSON.stringify(r))
    const files = raw
      .prepare(`SELECT id, relative_path FROM brain_file WHERE project_id = ?`)
      .all(pid) as any[]
    console.log(`files: ${JSON.stringify(files)}`)
    const syms = raw
      .prepare(`SELECT id, name, qualified_name, file_id, line_start FROM brain_symbol WHERE project_id = ?`)
      .all(pid) as any[]
    console.log(`symbols: ${JSON.stringify(syms)}`)
  }

  dump("after full index")
  writeFileSync(path.join(dir, "b.c"), EDITED)
  const rt = await reindexFilesParallel(pid, dir, [{ path: path.join(dir, "b.c"), type: "modified" }], {
    logger: quiet,
  })
  console.log(`\nreindex: indexed=${rt.indexed} errors=${rt.errors} derived=${JSON.stringify((rt as any).derived)}`)
  dump("after refresh")

  const bFile = raw
    .prepare(`SELECT id FROM brain_file WHERE project_id = ? AND relative_path = 'b.c'`)
    .get(pid) as any
  console.log(`\nb.c file id: ${JSON.stringify(bFile)}`)
  if (bFile) {
    const res = resolveNameTargets(raw, pid, { sourceFileIds: [bFile.id] })
    console.log(`manual resolveNameTargets(b.c) -> ${JSON.stringify(res)}`)
  }
  dump("after manual decider run")

  // ── WHICH STEP BINDS IT IN THE FULL WORLD? ──────────────────────────────────
  // The same source is indexed into a second root WITHOUT the edit and dumped
  // before and after the full pass's own relationship phase, so the binding step
  // is named rather than inferred.
  const dirB = path.join(EMPTY, "full")
  mkdirSync(dirB, { recursive: true })
  for (const [rel, content] of Object.entries(FILES)) {
    const abs = path.join(dirB, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, rel === "b.c" ? EDITED : content)
  }
  const pidB = getProjectId(dirB) as string
  console.log = () => {}
  let fullRes: any = null
  try {
    fullRes = await indexProjectParallel(pidB, dirB, { logger: quiet })
  } finally {
    console.log = consoleLog
  }
  console.log(
    `\ndirB summary: derivedPass=${JSON.stringify((fullRes as any)?.summary?.derivedPass)} phases=${JSON.stringify(
      ((fullRes as any)?.phases?.postProcessingPhases ?? []).map((p: any) => p.name + ":" + p.outcome),
    )}`,
  )
  const rawB: any = await BrainDatabase.getRawInstance(pidB)
  const dumpB = (label: string) => {
    const rows = rawB
      .prepare(
        `SELECT relationship_type AS t, target_external AS te, target_symbol_id AS tsid, is_cross_file AS xf,
                line_number AS ln, ss.name AS src
           FROM brain_relationship r LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
          WHERE r.project_id = ? ORDER BY r.id`,
      )
      .all(pidB) as any[]
    console.log(`\n== FULL WORLD ${label}`)
    for (const r of rows) console.log(JSON.stringify(r))
  }
  dumpB("right after indexProjectParallel (before any post-processing)")
  const { runPostProcessing } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  await runPostProcessing(pidB, { logger: quiet })
  dumpB("after runPostProcessing")
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
