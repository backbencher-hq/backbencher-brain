// History-policy probe: two documented invariants are tested against the
// persistence layer instead of against the analyzer's current output.
//
//   1. docs/BB_SECURITY.md — "history must never contain rule=\"unresolved\" or
//      severity=\"unknown\" rows". The handler persists any confirmed/mitigated
//      finding and forwards `finding.severity` verbatim, so a resolved,
//      mitigated flow whose stored grade is outside the union becomes a
//      persisted `unknown`. This probe injects exactly that row at a sink with
//      no other finding.
//
//   2. docs/BB_SECURITY.md — "recordRun persists the full analysed set, never a
//      display slice". The persisted identity is
//      `taint:<type>:<sinkType>:<file>:<line>` and does not include the flow
//      STATE, so a confirmed flow and a mitigated flow at the same sink share a
//      fingerprint. completeAnalysisRun dedupes by fingerprint, so one of the
//      two is silently dropped while the response counts both.
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
    cwd: ROOT, encoding: "utf8", timeout: 600_000,
    env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" },
  })
}

async function main() {
  const fixture = makeFixture("history-policy", {
    "src/api.ts": [
      "import { Client } from 'pg'",
      "const client = new Client()",
      "export function search(userInput: string): unknown {",
      "  const sql = 'SELECT * FROM items WHERE name = ' + userInput",
      "  return client.query(sql)",
      "}",
      "export function touched(req: any): unknown {",
      "  const q = req.query.q",
      "  return client.query(q)",
      "}",
      "export function pure(a: number): number { return a + 1 }",
    ].join("\n"),
  })
  const dataDir = dataDirFor("history-policy")
  rmSync(path.join(dataDir, "projects"), { recursive: true, force: true })
  const indexed = indexOne(fixture.dir, dataDir)
  if (indexed.status !== 0) throw new Error(`index failed: ${(indexed.stderr ?? "").slice(-600)}`)
  process.env.BB_DATA_DIR = dataDir
  const projectId = getProjectId(fixture.dir)
  const rw = await BrainDatabase.getRawInstance(projectId)
  const sym = (name: string) => (rw.prepare("SELECT id, line_start FROM brain_symbol WHERE project_id = ? AND name = ? LIMIT 1").get(projectId, name) as { id: string; line_start: number } | undefined)
  const search = sym("search")
  const pure = sym("pure")
  if (!search || !pure) throw new Error(`fixture symbols missing: search=${!!search} pure=${!!pure}`)
  const now = Date.now()
  const insert = rw.prepare("INSERT OR REPLACE INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
  // Collision pair: a mitigated flow at the SAME sink as the analyzer's
  // confirmed `search` flow (same type/sinkType/file/line, different state).
  insert.run("fp-collide-mitigated", projectId, search.id, search.id, "http_input", "database_write", "sql_injection", "high", 1, JSON.stringify([search.id]), 0, now, now)
  // Unknown-grade resolved flow at a sink with no other finding.
  insert.run("unknown-grade-mitigated", projectId, pure.id, pure.id, "http_input", "database_write", "sql_injection", "info", 1, JSON.stringify([pure.id]), 0, now, now)

  const recorded = await mcpCall(fixture.dir, { recordRun: true }, { dataDir, timeoutMs: 300_000 })
  const history = await mcpCall(fixture.dir, { history: true }, { dataDir, timeoutMs: 300_000 })
  const hist = (() => { try { return JSON.parse(history.text) } catch { return null } })()
  const liveHead = recorded.text.split("\n")[0]
  const recordedLine = recorded.text.match(/(\d+) findings recorded/)?.[1] ?? null
  const persisted = (hist?.findings ?? []) as any[]
  const run = (hist?.runs ?? [])[0] ?? null

  const payload = {
    schemaVersion: 1,
    tool: "bb_security",
    generatedAt: new Date().toISOString(),
    currentCommit: gitHead(),
    command: "BB_DATA_DIR=… BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_security/work/probe-history-policy.ts",
    project: { path: fixture.dir, projectId, dataDir },
    injected: {
      collisionPair: { id: "fp-collide-mitigated", state: "mitigated", fingerprintClaim: "taint:sql_injection:database_write:src/api.ts:" + search.line_start, collidesWith: "the analyzer's confirmed flow on the same sink" },
      unknownGrade: { id: "unknown-grade-mitigated", storedSeverity: "info", normalizedSeverity: "unknown", state: "mitigated", file: "src/api.ts", line: pure.line_start },
    },
    recordRun: {
      isError: recorded.isError,
      liveHead,
      recordedCountInResponse: recordedLine ? Number(recordedLine) : null,
      recordedRunFindingCount: run?.findingCount ?? null,
      textHead: recorded.text.slice(0, 800),
    },
    history: {
      runs: (hist?.runs ?? []).length,
      persistedFindings: persisted.length,
      persistedSeverities: [...new Set(persisted.map((f: any) => f.severity))],
      persistedRules: [...new Set(persisted.map((f: any) => f.rule))],
      persistedLocations: persisted.map((f: any) => `${f.location ?? "?"} state=${f.state}`),
      persistedUnknownSeverityRow: persisted.find((f: any) => f.severity === "unknown") ?? null,
      findingCountEqualsPersisted: run?.findingCount === persisted.length,
    },
    verdict: {
      responseOverstatesPersistedSet: recordedLine !== null && run?.findingCount !== null ? Number(recordedLine) !== run.findingCount : null,
      historyContainsUnknownSeverity: persisted.some((f: any) => f.severity === "unknown"),
      collisionDroppedOneFlow: persisted.length < (Number(recordedLine) || 0),
    },
  }
  const file = writeEvidence("history-policy.json", payload)
  console.log(file)
  console.log(JSON.stringify(payload.verdict, null, 2))
  console.log("response recorded:", recordedLine, "| run.findingCount:", run?.findingCount, "| persisted:", persisted.length)
  console.log("persisted severities:", payload.history.persistedSeverities, "locations:", payload.history.persistedLocations)
}
await main()
