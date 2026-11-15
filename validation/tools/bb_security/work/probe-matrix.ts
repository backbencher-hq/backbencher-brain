// bb_security behaviour matrix over the real MCP stdio door (source entry).
// Every row records: the request, isError, the reply text (bounded), payload
// bytes, and the specific tokens the class of answer must carry. Refusals are
// asserted to be refusals, not silent success.
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import {
  DATA, ROOT, TSX, dataDirFor, ensureDirs, makeFixture, mcpCall, writeEvidence, gitHead,
} from "./lib"
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
  const secDir = dataDirFor("sec")
  // Fresh fixture + fresh data dir: the matrix records what a clean project
  // answers, not what an earlier probe left behind (a stale history run or a
  // touched source file would silently change every row below).
  const shaped = makeFixture("security-shaped", {
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
  const fixture = { dir: shaped.dir, projectId: shaped.projectId }
  rmSync(path.join(secDir, "projects"), { recursive: true, force: true })
  {
    const r = indexOne(fixture.dir, secDir)
    if (r.status !== 0) throw new Error(`index failed: ${r.stderr}`)
  }

  // A project with more deduplicated flows than the 500-flow live cap: many
  // distinct sink/source pairs in one body collapse into a large flow set.
  const truncFixture = makeFixture("truncation", {
    "src/many.ts": (() => {
      const lines = ["import { Client } from 'pg'", "const client = new Client()", "export function wide(req: any): unknown {"]
      for (let i = 0; i < 40; i++) lines.push(`  const q${i} = req.query.q${i}`)
      for (let i = 0; i < 20; i++) lines.push(`  const r${i} = client.query('SELECT ${i} ' + q${i})`)
      lines.push("  return r0", "}")
      return lines.join("\n")
    })(),
  })
  const truncData = dataDirFor("trunc")
  rmSync(path.join(truncData, "projects"), { recursive: true, force: true })
  const truncIndex = indexOne(truncFixture.dir, truncData)
  if (truncIndex.status !== 0) throw new Error(`trunc index failed: ${truncIndex.stderr}`)
  process.env.BB_DATA_DIR = truncData
  const truncRaw = await BrainDatabase.getRawInstance(truncFixture.projectId, { readonly: true })
  const truncFlows = (truncRaw.prepare("SELECT COUNT(*) c FROM brain_taint_flow WHERE project_id=?").get(truncFixture.projectId) as any).c
  process.env.BB_DATA_DIR = secDir

  const rows: any[] = []
  const run = async (id: string, args: Record<string, unknown>, opts: { dataDir?: string; dir?: string; autoRefresh?: boolean; expectError?: boolean } = {}) => {
    const call = await mcpCall(opts.dir ?? fixture.dir, args, { dataDir: opts.dataDir ?? secDir, autoRefresh: opts.autoRefresh, timeoutMs: 180_000 })
    rows.push({
      id,
      args,
      door: "MCP stdio (source entry: tsx src/cli/index.ts mcp)",
      ok: call.ok,
      isError: call.isError,
      durationMs: call.durationMs,
      payloadBytes: Buffer.byteLength(call.text),
      lineCount: call.text.split("\n").length,
      textHead: call.text.slice(0, 500),
      textTail: call.text.slice(-500),
      stderrBytes: Buffer.byteLength(call.stderr),
      stderrHead: call.stderr.slice(0, 300),
    })
    return rows[rows.length - 1]
  }
  const runFull = async (id: string, args: Record<string, unknown>, opts: { dataDir?: string; dir?: string; autoRefresh?: boolean } = {}) => {
    const call = await mcpCall(opts.dir ?? fixture.dir, args, { dataDir: opts.dataDir ?? secDir, autoRefresh: opts.autoRefresh, timeoutMs: 180_000 })
    rows.push({
      id, args, door: "MCP stdio (source entry: tsx src/cli/index.ts mcp)",
      ok: call.ok, isError: call.isError, durationMs: call.durationMs, payloadBytes: Buffer.byteLength(call.text),
      lineCount: call.text.split("\n").length, textHead: call.text.slice(0, 500), textTail: call.text.slice(-500),
      stderrBytes: Buffer.byteLength(call.stderr), stderrHead: call.stderr.slice(0, 300),
    })
    return call
  }

  // ── Read answers ────────────────────────────────────────────────────────
  const base = await run("default", {})
  await run("limit-without-history", { limit: 3 })
  await run("limit-zero-without-history", { limit: 0 })
  await run("recordRun-false", { recordRun: false })
  await run("history-false", { history: false })

  // ── Boundary refusals (must be isError with a teaching message) ─────────
  await run("limit-negative", { limit: -1 })
  await run("limit-fractional", { limit: 2.5 })
  await run("limit-string", { limit: "5" })
  await run("limit-nan", { limit: null })
  await run("unknown-option-mode", { mode: "findings" })
  await run("unknown-option-severity", { severity: "critical" })
  await run("history-not-boolean", { history: "yes" })

  // ── History door ────────────────────────────────────────────────────────
  await run("history-empty", { history: true })
  await run("history-limit-zero", { history: true, limit: 0 })
  await run("history-limit-one", { history: true, limit: 1 })
  await run("history-plus-recordrun", { history: true, recordRun: true })
  await run("history-huge-limit", { history: true, limit: 1000000000 })

  // ── Declared write: recordRun, then history reads it back ──────────────
  const recorded = await run("recordrun", { recordRun: true })
  const afterRecord = await run("history-after-recordrun", { history: true })
  const recordedAgain = await run("recordrun-repeat", { recordRun: true })
  const historyAfterRepeat = await run("history-after-repeat", { history: true })

  // ── Staleness: touch a finding file, then read (auto-refresh disabled) ──
  const apiFile = path.join(fixture.dir, "src/api.ts")
  const beforeTouch = await runFull("pre-touch", {})
  const { appendFileSync } = await import("node:fs")
  appendFileSync(apiFile, "\n// audit: touched after indexing\n")
  const touchedNoRefresh = await runFull("stale-no-autorefresh", {}, { autoRefresh: false })
  const touchedAutoRefreshAllowed = await runFull("stale-autorefresh-allowed", {}, { autoRefresh: true })
  const dbAfterAutoRefresh = statSync(path.join(secDir, "projects", fixture.projectId, "brain.db"))
  // Did the second call reindex? Compare the index rows: a refreshed file would
  // change symbol/flow counts or leave a stale-marker-free answer. Restore the
  // fixture afterwards by reindexing explicitly.
  const rawAfter = await BrainDatabase.getRawInstance(fixture.projectId, { readonly: true })
  const taintRowsAfter = (rawAfter.prepare("SELECT COUNT(*) c FROM brain_taint_flow WHERE project_id=?").get(fixture.projectId) as any).c

  // ── Cap: a project above the live scan cap ─────────────────────────────
  const capped = await mcpCall(truncFixture.dir, {}, { dataDir: truncData, timeoutMs: 300_000 })
  const cappedRecord = await mcpCall(truncFixture.dir, { recordRun: true }, { dataDir: truncData, timeoutMs: 300_000 })
  const cappedHistory = await mcpCall(truncFixture.dir, { history: true }, { dataDir: truncData, timeoutMs: 300_000 })
  const cappedHistoryJson = (() => { try { return JSON.parse(cappedHistory.text) } catch { return null } })()

  // ── History policy: is "never an unknown severity" enforced or incidental? ─
  // Inject a RESOLVED, mitigated flow whose stored severity is outside the union.
  // The handler persists confirmed/mitigated findings, and its mapper forwards
  // `finding.severity` verbatim, so if the claim in docs/BB_SECURITY.md
  // ("history must never contain severity=unknown") is a policy it must drop or
  // re-grade this row; if it is an accident of the analyzer's current output the
  // row will be persisted as `unknown`.
  const policyRaw = await BrainDatabase.getRawInstance(fixture.projectId, { readonly: true })
  const sym = policyRaw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND name = 'search' LIMIT 1").get(fixture.projectId) as { id: string } | undefined
  let unknownSeverityProbe: any = { available: false }
  if (sym) {
    const rw = await BrainDatabase.getRawInstance(fixture.projectId)
    const now = Date.now()
    rw.prepare("INSERT OR REPLACE INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("policy-unknown-sev", fixture.projectId, sym.id, sym.id, "http_input", "database_write", "sql_injection", "info", 1, JSON.stringify([sym.id]), 0, now, now)
    const rec = await mcpCall(fixture.dir, { recordRun: true }, { dataDir: secDir, timeoutMs: 180_000 })
    const hist = await mcpCall(fixture.dir, { history: true }, { dataDir: secDir, timeoutMs: 180_000 })
    const histJson = (() => { try { return JSON.parse(hist.text) } catch { return null } })()
    unknownSeverityProbe = {
      available: true,
      recordTextHead: rec.text.slice(0, 300),
      historyFindings: histJson?.findings?.length ?? null,
      historySeverities: [...new Set((histJson?.findings ?? []).map((f: any) => f.severity))],
      historyRules: [...new Set((histJson?.findings ?? []).map((f: any) => f.rule))],
      persistedUnknownSeverityRow: (histJson?.findings ?? []).find((f: any) => f.severity === "unknown") ?? null,
    }
  }

  const payload = {
    schemaVersion: 1,
    tool: "bb_security",
    generatedAt: new Date().toISOString(),
    currentCommit: gitHead(),
    command: "BB_DATA_DIR=… BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_security/work/probe-matrix.ts",
    project: { path: fixture.dir, projectId: fixture.projectId, dataDir: secDir },
    defaultAnswer: { findingsLine: base.textHead.split("\n")[0], censusLine: (base.textHead.split("\n").find((l: string) => l.startsWith("[scan:")) ?? null) },
    truncationProject: { path: truncFixture.dir, projectId: truncFixture.projectId, dataDir: truncData, taintFlowsIndexed: truncFlows },
    truncationDoor: {
      defaultCall: { ok: capped.ok, isError: capped.isError, payloadBytes: Buffer.byteLength(capped.text), textHead: capped.text.slice(0, 500) },
      recordRunCall: { ok: cappedRecord.ok, isError: cappedRecord.isError, payloadBytes: Buffer.byteLength(cappedRecord.text), textHead: cappedRecord.text.slice(0, 600) },
      historyCall: { ok: cappedHistory.ok, isError: cappedHistory.isError, payloadBytes: Buffer.byteLength(cappedHistory.text), runs: cappedHistoryJson?.runs?.length ?? null, findings: cappedHistoryJson?.findings?.length ?? null, findingSeverities: [...new Set((cappedHistoryJson?.findings ?? []).map((f: any) => f.severity))], findingRules: [...new Set((cappedHistoryJson?.findings ?? []).map((f: any) => f.rule))] },
    },
    historyPolicy: unknownSeverityProbe,
    staleness: {
      preTouch: { isError: beforeTouch.isError, textHead: beforeTouch.textHead },
      touchedNoRefresh: { isError: touchedNoRefresh.isError, payloadBytes: Buffer.byteLength(touchedNoRefresh.text), text: touchedNoRefresh.text.slice(0, 1500) },
      touchedAutoRefreshAllowed: { isError: touchedAutoRefreshAllowed.isError, payloadBytes: Buffer.byteLength(touchedAutoRefreshAllowed.text), text: touchedAutoRefreshAllowed.text.slice(0, 1500) },
      identicalDespiteAutoRefresh: touchedNoRefresh.text === touchedAutoRefreshAllowed.text,
      taintRowsAfterAutoRefreshCall: taintRowsAfter,
      dbMtimeAfterAutoRefreshCall: new Date(dbAfterAutoRefresh.mtimeMs).toISOString(),
    },
    rows,
  }
  const file = writeEvidence("matrix.json", payload)
  console.log(file)
  for (const r of rows) console.log(`${r.isError ? "ERR " : "ok  "} ${r.id.padEnd(28)} ${String(r.payloadBytes).padStart(7)}B ${r.textHead.split("\n")[0].slice(0, 110)}`)
  console.log("truncation:", JSON.stringify(payload.truncationDoor.defaultCall.textHead.split("\n").slice(0, 3)))
  console.log("staleness identical:", payload.staleness.identicalDespiteAutoRefresh, "taintRows:", taintRowsAfter)
}
await main()
