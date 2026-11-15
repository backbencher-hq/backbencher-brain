// The cap and payload-bound probe.
//
// Builds a fixture that produces more deduplicated findings than the live scan
// cap (500) but far fewer than the recording cap (50 000), so both branches are
// observable:
//   - the live answer must say it was CAPPED and how many were not examined;
//   - recordRun must persist the census-sized set, not the display window;
//   - the history answer has no cap of its own, so its payload is measured.
import { mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { DATA, ROOT, TSX, dataDirFor, ensureDirs, makeFixture, mcpCall, writeEvidence, gitHead } from "./lib"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"

process.env.BB_DATA_DIR = DATA
ensureDirs()

function indexOne(dir: string, dataDir: string) {
  mkdirSync(dataDir, { recursive: true })
  return spawnSync(TSX, [path.join(ROOT, "validation/tools/bb_security/work/probe-index-one.ts"), dir, dataDir], {
    cwd: ROOT, encoding: "utf8", timeout: 900_000,
    env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" },
  })
}

function parseCensus(text: string) {
  const index = text.match(/\[scan: (\d+) taint flow\(s\) indexed → (\d+) finding\(s\)/)
  const cap = text.match(/CAPPED at ([\d,]+); (\d+) findings exist and (\d+) were not examined/)
  const recorded = text.match(/(\d+) findings recorded/)
  return {
    scannedFlows: index ? Number(index[1]) : null,
    deduplicatedFlows: index ? Number(index[2]) : null,
    capAt: cap ? Number(cap[1].replace(/,/g, "")) : null,
    findingsExist: cap ? Number(cap[2]) : null,
    notExamined: cap ? Number(cap[3]) : null,
    recordedCount: recorded ? Number(recorded[1]) : null,
  }
}

async function main() {
  // 60 files x 10 functions = 600 distinct sink locations, each with a source
  // token in the same body, so dedup cannot collapse them into one.
  const files: Record<string, string> = {}
  for (let f = 0; f < 60; f++) {
    const lines = ["import { Client } from 'pg'", "const client = new Client()"]
    for (let i = 0; i < 10; i++) {
      lines.push(`export function f${f}_${i}(req: any): unknown {`)
      lines.push(`  const q = req.query.q`)
      lines.push(`  return client.query('SELECT * FROM t' + ${i} + ' WHERE name = ' + q)`)
      lines.push("}")
    }
    files[`src/mod${f}.ts`] = lines.join("\n")
  }
  const fixture = makeFixture("cap600", files)
  const dataDir = dataDirFor("cap600")
  rmSync(path.join(dataDir, "projects"), { recursive: true, force: true })
  const indexed = indexOne(fixture.dir, dataDir)
  if (indexed.status !== 0) throw new Error(`index failed: ${(indexed.stderr ?? "").slice(-800)}`)
  process.env.BB_DATA_DIR = dataDir
  const projectId = getProjectId(fixture.dir)
  const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  const taintRows = (raw.prepare("SELECT COUNT(*) c FROM brain_taint_flow WHERE project_id=?").get(projectId) as any).c
  const fileRows = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(projectId) as any).c

  const live = await mcpCall(fixture.dir, {}, { dataDir, timeoutMs: 300_000 })
  const recorded = await mcpCall(fixture.dir, { recordRun: true }, { dataDir, timeoutMs: 600_000 })
  const historyAll = await mcpCall(fixture.dir, { history: true }, { dataDir, timeoutMs: 300_000 })
  const historyOne = await mcpCall(fixture.dir, { history: true, limit: 1 }, { dataDir, timeoutMs: 300_000 })
  const historyJsonAll = (() => { try { return JSON.parse(historyAll.text) } catch { return null } })()
  const historyJsonOne = (() => { try { return JSON.parse(historyOne.text) } catch { return null } })()

  const payload = {
    schemaVersion: 1,
    tool: "bb_security",
    generatedAt: new Date().toISOString(),
    currentCommit: gitHead(),
    command: "BB_DATA_DIR=… BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_security/work/probe-cap.ts",
    project: { path: fixture.dir, projectId, dataDir, files: fileRows, taintRows },
    live: { isError: live.isError, durationMs: live.durationMs, payloadBytes: Buffer.byteLength(live.text), census: parseCensus(live.text), text: live.text.slice(0, 2000) },
    recordRun: { isError: recorded.isError, durationMs: recorded.durationMs, payloadBytes: Buffer.byteLength(recorded.text), census: parseCensus(recorded.text), text: recorded.text.slice(0, 2000) },
    historyAll: { isError: historyAll.isError, durationMs: historyAll.durationMs, payloadBytes: Buffer.byteLength(historyAll.text), runs: historyJsonAll?.runs?.length ?? null, findings: historyJsonAll?.findings?.length ?? null, runFindingCounts: (historyJsonAll?.runs ?? []).map((r: any) => r.findingCount) },
    historyLimit1: { isError: historyOne.isError, payloadBytes: Buffer.byteLength(historyOne.text), runs: historyJsonOne?.runs?.length ?? null, findings: historyJsonOne?.findings?.length ?? null },
  }
  const file = writeEvidence("cap.json", payload)
  console.log(file)
  console.log(JSON.stringify({
    files: fileRows, taintRows,
    live: { bytes: payload.live.payloadBytes, census: payload.live.census },
    recordRun: { bytes: payload.recordRun.payloadBytes, census: payload.recordRun.census },
    historyAll: { bytes: payload.historyAll.payloadBytes, runs: payload.historyAll.runs, findings: payload.historyAll.findings, runFindingCounts: payload.historyAll.runFindingCounts },
    historyLimit1: { bytes: payload.historyLimit1.payloadBytes, runs: payload.historyLimit1.runs, findings: payload.historyLimit1.findings },
  }, null, 2))
}
await main()
