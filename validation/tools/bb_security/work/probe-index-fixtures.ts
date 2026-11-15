// Index the three measurement fixtures for bb_security, once, under this
// lane's own BB_DATA_DIR. T0 = test/fixtures/polyglot (charter §6), T1 =
// .perf-fixtures/bb-scale/n100 (fallback n50), plus a security-shaped fixture
// that actually contains a confirmed flow and a source-only observation.
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { DATA, LANE, ROOT, ensureDirs, makeFixture, writeEvidence, dataDirFor, gitHead } from "./lib"
import { BrainDatabase } from "../../../../src/brain/database"

process.env.BB_DATA_DIR = DATA
ensureDirs()

const securityFixture = makeFixture("security-shaped", {
  "src/api.ts": [
    "import { Client } from 'pg'",
    "const client = new Client()",
    "export function search(userInput: string): unknown {",
    "  const sql = 'SELECT * FROM items WHERE name = ' + userInput",
    "  return client.query(sql)",
    "}",
    "export function safe(userInput: string): unknown {",
    "  return client.query('SELECT * FROM items WHERE name = $1', [userInput])",
    "}",
    "export function pure(a: number): number { return a + 1 }",
  ].join("\n"),
  "src/pattern.py": [
    "from flask import request",
    "def isolated():",
    "    q = request.args.get('q')",
    "    return q",
  ].join("\n"),
})

async function main() {
  const cases: Array<{ tier: string; label: string; dir: string; projectId: string }> = [
    { tier: "T0", label: "polyglot", dir: path.join(ROOT, "test", "fixtures", "polyglot"), projectId: "" },
    { tier: "T1", label: "n100", dir: path.join(ROOT, ".perf-fixtures", "bb-scale", "n100"), projectId: "" },
    { tier: "T0-security", label: "security-shaped", dir: securityFixture.dir, projectId: securityFixture.projectId },
  ]
  const rows: any[] = []
  for (const c of cases) {
    if (!existsSync(c.dir)) { rows.push({ ...c, status: "blocked", reason: `missing ${c.dir}` }); continue }
    process.env.BB_DATA_DIR = dataDirFor(c.tier === "T0" ? "t0" : c.tier === "T1" ? "t1" : "sec")
    const { getProjectId } = await import("../../../../src/util/project-id")
    const projectId = c.projectId || getProjectId(c.dir)
    const started = Date.now()
    await indexProjectParallel(projectId, c.dir, {})
    const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
    const counts = {
      files: (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(projectId) as any).c,
      symbols: (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as any).c,
      relationships: (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?").get(projectId) as any).c,
      taintFlows: (raw.prepare("SELECT COUNT(*) c FROM brain_taint_flow WHERE project_id=?").get(projectId) as any).c,
    }
    const dbFile = BrainDatabase.getDbPath(projectId)
    const { statSync } = await import("node:fs")
    rows.push({ tier: c.tier, label: c.label, dir: c.dir, projectId, dataDir: process.env.BB_DATA_DIR, counts, dbPath: dbFile, dbBytes: existsSync(dbFile) ? statSync(dbFile).size : 0, indexedInMs: Date.now() - started })
  }
  const payload = { schemaVersion: 1, tool: "bb_security", generatedAt: new Date().toISOString(), currentCommit: gitHead(), command: "BB_DATA_DIR=… npx tsx validation/tools/bb_security/work/probe-index-fixtures.ts", fixtures: rows }
  const file = writeEvidence("fixtures.json", payload)
  // A durable note the latency probe reads instead of re-indexing.
  writeFileSync(path.join(LANE, "work", "fixtures.json"), JSON.stringify(payload, null, 2) + "\n")
  console.log(JSON.stringify(rows, null, 2))
  console.log(file)
}
await main()
