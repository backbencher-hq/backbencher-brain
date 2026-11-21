// script/m-fix/verify-old-index-compat.ts — P2-6 integration gate (verifier-owned, fix campaign)
//
// WHAT THIS PROVES — a read tool opening an index written by an OLDER bb build must
// never surface a raw SQLite error (`no such column: r.target_basis`) and must never
// answer a partial result from a stale schema. It must refuse with a DECLARED
// schema-incompatibility error naming the DB path, the detected schema, the missing
// table/column(s) and the remediation (`bb index --post <project>`), at BOTH doors:
//   (1) the tool handlers themselves (bb_graph/bb_impact/bb_visualize/bb_security),
//   (2) the CLI door (`runCli tool …`) — must NOT be masked into "No index found",
//   (3) the MCP stdio door — every tools/call answer must be isError with the declared text.
// Then it proves the REMEDY works: a write-path open (what `bb index --post` runs) migrates
// the old index in place, after which the read path opens and answers.
//
// RED on pre-fix bytes: bb_graph/bb_impact return `no such column: r.target_basis`,
// bb_visualize/bb_security answer partially, and both doors mask the cause.
//
// FIXTURE — the v(N-1) index: the real 2026-10-17 index at
// bb_tests/repositories/gql-gqlgen/graphql (env P26_OLD_DB overrides the DB path);
// if absent, a synthetic v(N-1) is built by stripping the additive relationship
// columns from a current-schema DB. Control: a current-schema DB built by the real
// indexer must open and answer.
//
// Run: npx tsx script/m-fix/verify-old-index-compat.ts
// Env: P26_OLD_DB (optional). The gate sets BB_DATA_DIR itself.

import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { openDatabase } from "#db"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const SCRATCH = path.join(ROOT, ".tools/verifier/p2/gate")
const OLD_PROJECT_ROOT = "/home/ishaq2321/bb_tests/repositories/gql-gqlgen/graphql"
const OLD_DB = process.env.P26_OLD_DB ?? "/home/ishaq2321/.bb/projects/3cc416747a0082a80b42b89928cb8c909e09e371/brain.db"
const TOOL_NAMES = ["bb_graph", "bb_impact", "bb_visualize", "bb_security"] as const
const TOOL_ARGS: Record<string, any> = {
  bb_graph: { symbol: "Query", maxDepth: 2 },
  bb_impact: { symbol: "Query" },
  bb_visualize: { scope: "project", format: "json", maxNodes: 20 },
  bb_security: { limit: 5 },
}

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log("  ok: " + label)
  else {
    failures++
    console.log("  FAIL: " + label + (detail ? " — " + detail : ""))
  }
}

function seedProjectDb(dataDir: string, projectId: string, sourceDb: string): string {
  const target = path.join(dataDir, "projects", projectId, "brain.db")
  if (existsSync(target)) rmSync(target)
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(sourceDb, target)
  return target
}

function isDeclared(text: string): boolean {
  return /schema incompatible/i.test(text) && /bb index --post/.test(text) && !/no such column|no such table/i.test(text)
}

const handlers = createToolHandlers() as Record<string, (args: any, ctx: any) => Promise<any>>

async function dbModule(): Promise<any> {
  return await import("../../src/brain/database")
}

/** (1) handler-level: isError answer, or the typed declared throw from the shared open. */
async function assertHandlerRefusals(oldData: string, projectId: string, projectPath: string): Promise<void> {
  process.env.BB_DATA_DIR = oldData
  const mod = await dbModule()
  const Incompatible = mod.SchemaIncompatibleError as (new (...a: any[]) => Error) | undefined
  for (const tool of TOOL_NAMES) {
    let text = ""
    let isError = false
    let typedThrow: any = null
    try {
      const result = await handlers[tool]!(TOOL_ARGS[tool]!, { projectId, projectPath })
      isError = result?.isError === true
      text = String(result?.content?.[0]?.text ?? "")
    } catch (error) {
      typedThrow = error
      text = error instanceof Error ? error.message : String(error)
    }
    const declared = typeof Incompatible === "function" ? isError || typedThrow instanceof Incompatible : isError
    // bb_security's handler catch converts ANY of its internal errors to a plain
    // text result (payload-honesty owns that surface; verifier must not edit it),
    // but both real doors (CLI/MCP) run the rethrowing index pre-check BEFORE the
    // handler and return isError — asserted in the door phases below. Here we
    // accept the declared, non-partial text and record the flag nuance.
    const declaredTextFromHandler = isDeclared(text) && !/"summary"\s*:/.test(text)
    check(
      `${tool}: refuses with isError OR the typed declared error`,
      declared || (tool === "bb_security" && declaredTextFromHandler),
      text.slice(0, 260),
    )
    check(`${tool}: refusal names DB path + detected schema + remediation`, /was written by an older bb build/.test(text) && /detected schema v/.test(text) && /bb index --post/.test(text), text.slice(0, 260))
    check(`${tool}: no raw sqlite error and no partial answer`, !/no such column|no such table/i.test(text) && !/"summary"\s*:/.test(text), text.slice(0, 260))
  }
}

/** (2) CLI door: `runCli tool …` must throw the DECLARED error, not "No index found". */
async function assertCliDoorRefusal(oldData: string, projectPath: string): Promise<void> {
  process.env.BB_DATA_DIR = oldData
  const mod = await dbModule()
  const Incompatible = mod.SchemaIncompatibleError as (new (...a: any[]) => Error) | undefined
  const cli: any = await import("../../src/cli/index")
  let thrown: any = null
  const originalLog = console.log
  console.log = () => {} // the CLI prints answers; silence while we assert the throw
  try {
    await cli.runCli(["tool", "bb_graph", "--dir", projectPath, "--args", '{"symbol":"Query"}'])
  } catch (error) {
    thrown = error
  } finally {
    console.log = originalLog
  }
  const declared = typeof Incompatible === "function" && thrown instanceof Incompatible
  const message = thrown instanceof Error ? thrown.message : String(thrown)
  check("CLI door: throws the typed declared schema error", declared, message.slice(0, 260))
  check("CLI door: error is the declared refusal, not the generic 'No index found'", isDeclared(message) && !/^No index found/.test(message), message.slice(0, 260))
}

/** (3) MCP stdio door: every tools/call isError answer carries the declared refusal. */
async function assertMcpDoorRefusals(oldData: string, projectPath: string): Promise<void> {
  const tsxBin = path.join(ROOT, "node_modules", ".bin", "tsx")
  if (!existsSync(tsxBin)) {
    check("MCP door: tsx executable available", false, tsxBin)
    return
  }
  const child: ChildProcessWithoutNullStreams = spawn(tsxBin, ["src/mcp/server.ts", "--dir", projectPath], {
    cwd: ROOT,
    env: { ...process.env, BB_DATA_DIR: oldData },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams
  const pending = new Map<number, (message: any) => void>()
  let buffer = ""
  let stderr = ""
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8")
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line.length > 0) {
        try {
          const message = JSON.parse(line)
          if (typeof message.id === "number") pending.get(message.id)?.(message)
        } catch {
          // non-JSON stdout is not part of the protocol; ignore
        }
      }
      newline = buffer.indexOf("\n")
    }
  })
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-4000)
  })
  const send = (payload: any): void => {
    child.stdin.write(JSON.stringify(payload) + "\n")
  }
  const rpc = (payload: any, id: number): Promise<any> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`MCP response timeout for id=${id}; stderr tail: ${stderr.slice(-400)}`))
      }, 25_000)
      pending.set(id, (message) => {
        clearTimeout(timer)
        pending.delete(id)
        resolve(message)
      })
      send(payload)
    })
  try {
    const initialized = await rpc(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "p2-6-gate", version: "1" } } },
      1,
    )
    check("MCP door: server answers initialize", !!initialized?.result, JSON.stringify(initialized).slice(0, 200))
    send({ jsonrpc: "2.0", method: "notifications/initialized" })
    let id = 2
    for (const tool of TOOL_NAMES) {
      const response = await rpc(
        { jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: TOOL_ARGS[tool]! } },
        id,
      )
      const text = String(response?.result?.content?.[0]?.text ?? "")
      check(`MCP door ${tool}: isError answer`, response?.result?.isError === true, text.slice(0, 260))
      check(`MCP door ${tool}: declared refusal with remediation`, isDeclared(text), text.slice(0, 260))
      check(`MCP door ${tool}: no raw sqlite error / no partial answer`, !/no such column|no such table/i.test(text) && !/"summary"\s*:/.test(text), text.slice(0, 260))
      id++
    }
  } finally {
    child.kill("SIGTERM")
    setTimeout(() => { try { child.kill("SIGKILL") } catch {} }, 1500)
  }
}

/** (4) remedy: a write-path open (what `bb index --post` runs) must heal the index. */
async function assertRemedyHeals(oldData: string, projectId: string, projectPath: string): Promise<void> {
  process.env.BB_DATA_DIR = oldData
  const mod = await dbModule()
  await mod.BrainDatabase.getRawInstance(projectId) // read-write open = the migration path
  mod.BrainDatabase.close(projectId)
  let readOpen: any = null
  try {
    readOpen = await mod.BrainDatabase.getRawInstance(projectId, { readonly: true })
  } catch (error) {
    readOpen = { error }
  }
  check("remedy: write-path open migrates the index; read-only open then succeeds", !!readOpen && !readOpen.error, String(readOpen?.error ?? ""))
  const after = await handlers.bb_graph!({ symbol: "Query", maxDepth: 2 }, { projectId, projectPath })
  check("remedy: bb_graph answers after the migration (no refusal)", after?.isError !== true, String(after?.content?.[0]?.text ?? "").slice(0, 200))
}

async function main(): Promise<void> {
  console.log("P2-6 old-index compatibility gate\n")
  rmSync(SCRATCH, { recursive: true, force: true })
  mkdirSync(SCRATCH, { recursive: true })

  // ── control: a CURRENT-schema DB, built by the real indexer, must open and answer ──
  const controlSource = path.join(SCRATCH, "control-src")
  const controlData = path.join(SCRATCH, "control-data")
  mkdirSync(path.join(controlSource, "src"), { recursive: true })
  writeFileSync(path.join(controlSource, "src", "hub.ts"), "export function hub(): number { return 1 }\nexport function caller(): number { return hub() }\n")
  const controlId = getProjectId(controlSource)
  process.env.BB_DATA_DIR = controlData
  await indexProjectParallel(controlId, controlSource, {})
  const controlRaw = await (await dbModule()).BrainDatabase.getRawInstance(controlId, { readonly: true })
  check("control: current-schema DB opens read-only without refusal", !!controlRaw)
  const controlGraph = await handlers.bb_graph!({ symbol: "hub" }, { projectId: controlId, projectPath: controlSource })
  check("control: current-schema DB answers bb_graph", controlGraph?.isError !== true, String(controlGraph?.content?.[0]?.text ?? "").slice(0, 200))

  // ── upgrade: a DB whose brain_project_meta was never created must still index ──
  //
  // REGRESSION THIS PINS (shipped in 0.1.7, reported by the owner):
  //   storeResults failed {"error":"no such table: brain_project_meta"}
  //   a batch failed to store, some files may be missing from DB
  // The Go module-identity read in parallel-indexer.ts reads brain_project_meta.
  // The fresh-database path created that table; the EXISTING-database open path
  // (src/brain/database.ts) never called ensureProjectMetaTable, so every index
  // built by an earlier bb lacked it and the storeResults batch threw. Nothing in
  // gate_order exercised "index created by the previous version, then indexed
  // again", which is why a green suite shipped it.
  //
  // The check is deliberately functional: build the DB, DROP the table to stand in
  // for a pre-0.1.7 index, re-open (the migration), add a file, re-index, and
  // require the new symbol to exist. A log-scrape would pass on a swallowed error.
  {
    const upgradeSource = path.join(SCRATCH, "upgrade-src")
    const upgradeData = path.join(SCRATCH, "upgrade-data")
    mkdirSync(upgradeSource, { recursive: true })
    writeFileSync(path.join(upgradeSource, "go.mod"), "module example.com/up\n\ngo 1.21\n")
    writeFileSync(path.join(upgradeSource, "main.go"), "package main\n\nfunc main() {}\n")
    const upgradeId = getProjectId(upgradeSource)
    process.env.BB_DATA_DIR = upgradeData
    await indexProjectParallel(upgradeId, upgradeSource, {})
    const upgradeMod = await dbModule()
    const beforeDrop = await upgradeMod.BrainDatabase.getRawInstance(upgradeId)
    beforeDrop.exec("DROP TABLE IF EXISTS brain_project_meta")
    upgradeMod.BrainDatabase.close(upgradeId)
    const afterDrop = await upgradeMod.BrainDatabase.getRawInstance(upgradeId, { readonly: true })
    const droppedCount = afterDrop.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_project_meta'").all().length
    check("upgrade: fixture really lost brain_project_meta (the pre-0.1.7 shape)", droppedCount === 0)
    upgradeMod.BrainDatabase.close(upgradeId)

    writeFileSync(path.join(upgradeSource, "extra.go"), "package main\n\nfunc helper() int { return 1 }\n")
    let indexThrew: unknown = null
    try {
      await indexProjectParallel(upgradeId, upgradeSource, {})
    } catch (error) {
      indexThrew = error
    }
    check("upgrade: indexing a pre-0.1.7 DB does not throw", indexThrew === null, String(indexThrew ?? ""))

    const healed = await upgradeMod.BrainDatabase.getRawInstance(upgradeId, { readonly: true })
    const healedTable = healed.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_project_meta'").all().length
    check("upgrade: the write-path open creates brain_project_meta", healedTable === 1)
    const stored = healed.prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE name = 'helper'").get() as { c: number }
    check(
      "upgrade: the newly indexed symbol reached the DB (no failed storeResults batch)",
      stored.c >= 1,
      `helper rows=${stored.c}`,
    )
    upgradeMod.BrainDatabase.close(upgradeId)
  }

  // ── v(N-1) fixture: the real 2026-10-17 index (or a synthetic strip) ───────────
  let oldId: string
  let oldProjectPath: string
  let oldData: string
  if (existsSync(OLD_DB)) {
    console.log(`\n[v(N-1) fixture] real old index: ${OLD_DB}`)
    oldId = getProjectId(OLD_PROJECT_ROOT)
    oldProjectPath = OLD_PROJECT_ROOT
    oldData = path.join(SCRATCH, "old-data")
    seedProjectDb(oldData, oldId, OLD_DB)
  } else {
    console.log(`\n[v(N-1) fixture] real old index missing at ${OLD_DB} — building synthetic v(N-1) by stripping additive columns`)
    oldProjectPath = controlSource
    oldId = controlId
    oldData = path.join(SCRATCH, "synthetic-old-data")
    const seeded = seedProjectDb(oldData, oldId, path.join(controlData, "projects", controlId, "brain.db"))
    const raw = openDatabase(seeded)
    try {
      // Rebuild brain_relationship without the additive generated columns a newer
      // build reads (the exact shape of the 2026-10-17 incident).
      raw.exec(`
        DROP INDEX IF EXISTS brain_rel_target_basis_idx;
        DROP INDEX IF EXISTS brain_rel_pattern_cover_idx;
        ALTER TABLE brain_relationship RENAME TO brain_relationship_old;
        CREATE TABLE brain_relationship (
          id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, source_symbol_id TEXT,
          target_symbol_id TEXT, source_external TEXT, target_external TEXT,
          relationship_type TEXT NOT NULL, confidence REAL NOT NULL, context TEXT,
          line_number INTEGER, is_cross_language INTEGER NOT NULL DEFAULT 0, bridge_mechanism TEXT,
          is_cross_file INTEGER NOT NULL DEFAULT 0, metadata TEXT,
          time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
        );
        INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, source_external, target_external,
          relationship_type, confidence, context, line_number, is_cross_language, bridge_mechanism, is_cross_file, metadata,
          time_created, time_updated)
        SELECT id, project_id, source_symbol_id, target_symbol_id, source_external, target_external,
          relationship_type, confidence, context, line_number, is_cross_language, bridge_mechanism, is_cross_file, metadata,
          time_created, time_updated FROM brain_relationship_old;
        DROP TABLE brain_relationship_old;
      `)
      const cols = (raw.prepare("PRAGMA table_xinfo(brain_relationship)").all() as Array<{ name: string }>).map((c) => c.name)
      check("synthetic v(N-1) really lacks target_basis/evidence_class", !cols.includes("target_basis") && !cols.includes("evidence_class"), cols.join(","))
    } finally {
      try { raw.close() } catch {}
    }
  }

  // shared-open typed refusal + handler-level refusals
  process.env.BB_DATA_DIR = oldData
  const mod = await dbModule()
  let typed: any = null
  try {
    await mod.BrainDatabase.getRawInstance(oldId, { readonly: true })
  } catch (error) {
    typed = error
  }
  check("shared read open throws SchemaIncompatibleError", typeof mod.SchemaIncompatibleError === "function" && typed instanceof mod.SchemaIncompatibleError, typed ? String(typed) : "no error thrown")
  if (typed instanceof mod.SchemaIncompatibleError) {
    check("declared error lists missing target_basis/evidence_class", ["target_basis", "evidence_class"].every((m) => typed.details.missing.some((x: string) => x.includes(m))), JSON.stringify(typed.details.missing))
    check("declared error names DB path + detected/expected schema + remediation", typed.message.includes(path.join(oldData, "projects", oldId, "brain.db")) && /detected schema v/.test(typed.message) && /this build requires v/.test(typed.message) && /bb index --post/.test(typed.message), typed.message)
  }
  await assertHandlerRefusals(oldData, oldId, oldProjectPath)
  await assertCliDoorRefusal(oldData, oldProjectPath)
  await assertMcpDoorRefusals(oldData, oldProjectPath)
  await assertRemedyHeals(oldData, oldId, oldProjectPath)

  console.log(failures === 0 ? "\nP2-6 OLD-INDEX COMPAT: PASS" : `\nP2-6 OLD-INDEX COMPAT: FAIL (${failures} failure(s))`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error("P2-6 gate crashed:", error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exitCode = 1
})
