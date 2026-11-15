// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_visualize read-path probe: it measures whether a
//   READ call leaves the index bytes alone, and attributes any change to the
//   open path rather than to the query, by isolating each layer in its own
//   process (fresh instance caches) and hashing the database and WAL around the
//   single operation under test.
// WHICH TOOL IT SERVES — bb_visualize (mutability read, requiresIndex true).
// WHY IT IS SHAPED THIS WAY — "the tool issues only SELECTs" is not the same
//   claim as "a call does not write the index": opening a pre-existing database
//   read-write runs additive migrations and idempotent healers before the first
//   SELECT. The only honest measurement is bytes: sha256 of brain.db and
//   brain.db-wal before and after each layer. A child process per scenario keeps
//   the module-level handle cache from hiding the open cost or reusing a handle
//   that the previous scenario already migrated.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_visualize/results/read-path.json.
// EDIT TOGETHER WHEN THIS CHANGES — src/brain/database.ts (the open contract),
//   src/intelligence/visualization/visualization-engine.ts, the handler.
// CONTRACTS IT MUST NOT BREAK — writes only under
//   validation/tools/bb_visualize/; never opens the shared .bb-data index.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const HERE = path.resolve(import.meta.dirname ?? ".", ".")
const RESULTS_DIR = path.join(HERE, "results")
const DATA_DIR = path.join(HERE, "bbdata")
const ROOT = path.resolve(HERE, "..", "..", "..")
process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

const SCENARIOS = ["control-import", "open-readonly", "open-readwrite", "engine-visualize", "handler-visualize", "server-call"] as const
type Scenario = (typeof SCENARIOS)[number]

interface Snapshot { db: FileState; wal: FileState; schemaVersion: number | null }
interface FileState { exists: boolean; size: number; sha256: string | null }

function fileState(file: string): FileState {
  if (!existsSync(file)) return { exists: false, size: 0, sha256: null }
  const hash = createHash("sha256")
  hash.update(readFileSync(file))
  return { exists: true, size: statSync(file).size, sha256: hash.digest("hex") }
}

async function snapshot(projectId: string, dbPath: string): Promise<Snapshot> {
  let schemaVersion: number | null = null
  try {
    const { BrainDatabase } = await import("../../../src/brain/database")
    const raw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })
    schemaVersion = Number((raw.prepare("PRAGMA schema_version").get() as any)?.schema_version ?? 0)
  } catch {
    schemaVersion = null
  }
  return { db: fileState(dbPath), wal: fileState(`${dbPath}-wal`), schemaVersion }
}

/** One scenario, run in a fresh process so no module cache is shared.
 *
 * The order is: snapshot -> the ONE operation under test -> snapshot. Running the
 * operation before the first snapshot would let its migration warm the file and
 * make the second run look read-only, which is the measurement error this shape
 * exists to avoid. */
async function scenario(name: Scenario, projectId: string, dbPath: string, root: string): Promise<{ name: Scenario; before: Snapshot; after: Snapshot; ms: number; notes: string[] }> {
  const notes: string[] = []
  const t0 = performance.now()
  let operation: () => Promise<void>
  if (name === "control-import") {
    operation = async () => { await import("../../../src/mcp/tool-handlers") }
    notes.push("imports the tool-handler assembler and opens nothing")
  } else if (name === "open-readonly") {
    operation = async () => {
      const { BrainDatabase } = await import("../../../src/brain/database")
      const raw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })
      notes.push(`readonly open; ${(raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as any).c} symbols read`)
    }
  } else if (name === "open-readwrite") {
    operation = async () => {
      const { BrainDatabase } = await import("../../../src/brain/database")
      const raw = await BrainDatabase.getRawInstance(projectId as any)
      notes.push(`read-write open; ${(raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as any).c} symbols read`)
    }
  } else if (name === "engine-visualize") {
    operation = async () => {
      const { visualizeProject } = await import("../../../src/intelligence/visualization/visualization-engine")
      const result = await visualizeProject(projectId, { scope: "project", format: "json", maxNodes: 50 })
      notes.push(`engine.visualizeProject: ${result.nodes.length} nodes, ${result.links.length} links`)
    }
  } else {
    operation = async () => {
      const { createToolHandlers } = await import("../../../src/mcp/tool-handlers")
      const handlers = createToolHandlers()
      const result = await handlers.bb_visualize({ format: "json", maxNodes: 50 }, { projectId: projectId as any, projectPath: root } as any)
      notes.push(`handler.bb_visualize: ${String(result.content?.[0]?.text ?? "").length} chars`)
    }
  }
  const before = await snapshot(projectId, dbPath)
  await operation()
  const after = await snapshot(projectId, dbPath)
  return { name, before, after, ms: Math.round(performance.now() - t0), notes }
}

async function child(name: Scenario): Promise<void> {
  const { fixtureContext, FIXTURE_DIR } = await import("./lib/fixture")
  const { projectId } = await fixtureContext(FIXTURE_DIR, false)
  const dbPath = path.join(DATA_DIR, "projects", projectId, "brain.db")
  if (name === "server-call") {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
    const before = await snapshot(projectId, dbPath)
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", path.join(ROOT, "src", "cli", "index.ts"), "mcp", "--dir", FIXTURE_DIR],
      cwd: ROOT,
      env: { ...process.env, BB_DATA_DIR: DATA_DIR, BB_NO_AUTO_REFRESH: "1" },
      stderr: "pipe",
    })
    const client = new Client({ name: "read-path", version: "1.0.0" })
    await client.connect(transport)
    await client.callTool({ name: "bb_visualize", arguments: { format: "json", maxNodes: 50 } })
    await client.close()
    await new Promise((resolve) => setTimeout(resolve, 200))
    const after = await snapshot(projectId, dbPath)
    const unchanged = JSON.stringify(before) === JSON.stringify(after)
    writeFileSync(path.join(RESULTS_DIR, `read-path-${name}.json`), JSON.stringify({ scenario: name, before, after, unchanged }, null, 2) + "\n")
    console.log(JSON.stringify({ scenario: name, unchanged, before: before.db, after: after.db }))
    process.exit(0)
  }
  const result = await scenario(name, projectId, dbPath, FIXTURE_DIR)
  const unchanged = JSON.stringify(result.before) === JSON.stringify(result.after)
  const record = { ...result, unchanged }
  writeFileSync(path.join(RESULTS_DIR, `read-path-${name}.json`), JSON.stringify(record, null, 2) + "\n")
  console.log(JSON.stringify({ scenario: name, unchanged, schemaVersion: [result.before.schemaVersion, result.after.schemaVersion], db: [result.before.db, result.after.db], wal: [result.before.wal, result.after.wal], notes: result.notes }))
  process.exit(0)
}

async function main(): Promise<void> {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const { fixtureContext, FIXTURE_DIR } = await import("./lib/fixture")
  const { projectId } = await fixtureContext(FIXTURE_DIR, process.argv.includes("--reindex"))
  const dbPath = path.join(DATA_DIR, "projects", projectId, "brain.db")
  if (!existsSync(dbPath)) throw new Error(`fixture index missing: ${dbPath}`)
  const results: any[] = []
  for (const name of SCENARIOS) {
    const stdout = execFileSync(process.execPath, ["--import", "tsx", path.join(HERE, "read-path.ts"), "--child", name], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, BB_DATA_DIR: DATA_DIR, BB_NO_AUTO_REFRESH: "1" },
      timeout: 240_000,
    })
    // The child writes the FULL record (before/after snapshots) to its own file;
    // stdout carries only the one-line summary.
    const childFile = path.join(RESULTS_DIR, `read-path-${name}.json`)
    const record = JSON.parse(readFileSync(childFile, "utf8"))
    results.push(record)
    console.log(`${name}: unchanged=${record.unchanged}`)
  }
  const diagnosis = {
    schemaVersion: 1,
    tool: "bb_visualize",
    generatedAt: new Date().toISOString(),
    verifierCommand: "BB_DATA_DIR=validation/tools/bb_visualize/bbdata npx tsx validation/tools/bb_visualize/read-path.ts",
    fixture: { projectId, dbPath },
    scenarios: results,
    verdict: results.every((row) => row.unchanged) ? "byte-read-only across every layer" : "a read call writes the index on this tree",
  }
  writeFileSync(path.join(RESULTS_DIR, "read-path.json"), JSON.stringify(diagnosis, null, 2) + "\n")
  console.log(`read-path: ${diagnosis.verdict}`)
  const failing = results.filter((row) => !row.unchanged).map((row) => row.name ?? row.scenario)
  console.log(`  writing scenarios: ${failing.length ? failing.join(", ") : "none"}`)
  process.exit(0)
}

if (process.argv.includes("--child")) {
  const index = process.argv.indexOf("--child")
  const name = process.argv[index + 1] as Scenario
  if (!SCENARIOS.includes(name)) { console.error(`unknown scenario ${name}`); process.exit(2) }
  child(name).catch((error) => { console.error("FATAL", error); process.exit(2) })
} else {
  main().catch((error) => { console.error("FATAL", error); process.exit(2) })
}
