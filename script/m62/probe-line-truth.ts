// script/m62/probe-line-truth.ts — the per-language truth MEASUREMENT, run
// standalone while it was being built. Same code path verify-consumers.ts R7
// drives; kept as a probe because a 22-file index run is expensive and a lane
// iterating on the table needs the numbers without re-running the whole A2
// chain. NOT a gate: it writes no sealed evidence and asserts no law, so it can
// never be cited as a pass. The gate is script/m62/verify-consumers.ts.
//
// Run: npx tsx script/m62/probe-line-truth.ts

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { invocationLineByFile, languageFixtureFiles, languageFixtureLineCounts } from "./a2-language-fixture.ts"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

async function main(): Promise<void> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "m62a2-lang-"))
  const ws = mkdtempSync(path.join(tmpdir(), "m62a2-langws-"))
  process.env.BB_DATA_DIR = dataDir
  const files = languageFixtureFiles()
  for (const [rel, body] of Object.entries(files)) writeFileSync(path.join(ws, rel), body)
  const invocations = invocationLineByFile(files)
  const lineCounts = languageFixtureLineCounts(files)

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(ws) as string
  const started = Date.now()
  const stats = await indexProjectParallel(pid, ws, {})
  console.log(`indexed in ${Date.now() - started} ms: files=${stats.totalFiles} symbols=${stats.symbolsExtracted} rels=${stats.relationshipsFound}`)
  const raw = await BrainDatabase.getRawInstance(pid as never)

  const rows = raw
    .prepare(
      `SELECT f.language AS lang, r.line_number AS ln, r.relationship_type AS rt,
              COALESCE(f.relative_path, f.path, '') AS file
       FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       JOIN brain_file f ON f.id = s.file_id
       WHERE r.project_id = ?`,
    )
    .all(pid) as Array<{ lang: string; ln: number | null; rt: string; file: string }>

  const byLang = new Map<string, { rows: number; real: number; nul: number; zero: number; outOfFile: number; callRows: number; callReal: number; callExact: number }>()
  for (const r of rows) {
    const e = byLang.get(r.lang) ?? { rows: 0, real: 0, nul: 0, zero: 0, outOfFile: 0, callRows: 0, callReal: 0, callExact: 0 }
    e.rows++
    if (r.ln === null) e.nul++
    else if (r.ln === 0) e.zero++
    else {
      e.real++
      const limit = lineCounts[r.file]
      if (limit !== undefined && (r.ln < 1 || r.ln > limit)) e.outOfFile++
    }
    if (r.rt === "calls" || r.rt === "references" || r.rt === "uses") {
      e.callRows++
      if (r.ln !== null && r.ln > 0) {
        e.callReal++
        if (invocations[r.file] === r.ln) e.callExact++
      }
    }
    byLang.set(r.lang, e)
  }
  const header = ["language", "rows", "realLine", "null", "zero", "outOfFile", "usageRows", "usageRealLine", "usageOnMarkedLine"]
  console.log(header.join("\t"))
  for (const lang of [...byLang.keys()].sort()) {
    const e = byLang.get(lang)!
    console.log([lang, e.rows, e.real, e.nul, e.zero, e.outOfFile, e.callRows, e.callReal, e.callExact].join("\t"))
  }
  console.log(`\nfiles with no language row: ${Object.keys(files).filter((f) => !raw.prepare("SELECT 1 AS x FROM brain_file WHERE project_id = ? AND (relative_path = ? OR path LIKE ?)").get(pid, f, `%${f}`)).map((f) => f).join(", ") || "(none)"}`)
  console.log(`total rows: ${rows.length}`)
  try { rmSync(ws, { recursive: true, force: true }) } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  void readFileSync
}
void main()