// script/m13/verify-security-handler.ts — bb_security handler, adapter and bounds.
//
// Two layers:
//   1. ADAPTER SHAPE — analyzeSecurityAcrossLanguages returns the finding shape
//      the handler consumes (findings + suspiciousSources + summary, with
//      resolved file/line/symbol and a flow chain), and the token-based analyzer
//      is documented as a heuristic rather than an AST data-flow proof.
//   2. HANDLER BEHAVIOUR — the declared bounds are exercised through the tool's
//      own handler and its real CLI door:
//        * a >cap fixture must produce the explicit CAPPED sentence with the
//          number of findings that were not examined (the live read, not only
//          recordRun);
//        * recordRun must persist the census-sized set, and the history page
//          must cap its rendered findings while declaring the true total;
//        * a read must not run the write paths: a deliberately dropped healing
//          index must STILL be missing after a CLI read, and the database file
//          bytes must be unchanged. A read-write open would recreate the index.
//
// Run: npx tsx script/m13/verify-security-handler.ts   (bun run … also works)
// Exit: non-zero if any assertion failed.

import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import type { ToolContext } from "../../src/mcp/tools/shared"
import { Harness } from "./harness"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
// Self-contained data dir: the suite must not depend on the caller exporting one
// (the shared HOME is read-only in sandboxes, where every fixture gate used to
// die on mkdir $HOME/.bb/projects before asserting anything).
if (!process.env.BB_DATA_DIR) process.env.BB_DATA_DIR = path.join(rootDir, "validation", "tools", "bb_security", "bbdata")
process.env.BB_NO_AUTO_REFRESH = "1"

const harness = new Harness({
  issue: "M13.41",
  code: "Sec2",
  tool: "bb_security",
  title: "bb_security: adapter shape, declared bounds, and read-only reads",
  layers: ["unit", "integration"],
  decisions: {
    adapterTested: "the handler-shape adapter (cross-language-security.ts), not just the taint engine",
    boundsExercised: "CAPPED sentence on the live read, census-sized recordRun, declared history page cap",
    readOnlyRead: "a CLI read must not heal the database or move its bytes",
    regexDocumented: "the token-based taint detection is documented as heuristic, not AST",
  },
  limitations: [
    "The taint-analyzer's token matcher is a KNOWN heuristic, documented in docs/BB_SECURITY.md.",
    "Real-repository recall/precision is covered by the m15 deep suite (corpus leg).",
  ],
})

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
const tsxBin = path.join(rootDir, "node_modules", ".bin", "tsx")

function deleteProject(projectId: string): void {
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}

function sha256(file: string): string | null {
  try { return createHash("sha256").update(readFileSync(file)).digest("hex") } catch { return null }
}

/** Run the source CLI door in a fresh process (read path isolated from this one). */
function cliRead(dir: string): { status: number; stdout: string; stderr: string } {
  const args = ["tool", "bb_security", "--dir", dir, "--args", "{}"]
  const result = isBun
    ? spawnSync("bun", ["run", "src/cli/index.ts", ...args], { cwd: rootDir, encoding: "utf8", timeout: 180_000, env: { ...process.env, BB_NO_AUTO_REFRESH: "1" } })
    : spawnSync(tsxBin, ["src/cli/index.ts", ...args], { cwd: rootDir, encoding: "utf8", timeout: 180_000, env: { ...process.env, BB_NO_AUTO_REFRESH: "1" } })
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

// ── 1. Adapter shape on a tainted fixture ──────────────────────────────────
{
  const dir = mkdtempSync(path.join(tmpdir(), "bb-sec-handler-"))
  const projectId = getProjectId(dir)
  mkdirSync(path.join(dir, "src"), { recursive: true })
  writeFileSync(
    path.join(dir, "src", "app.ts"),
    [
      "import express from 'express'",
      "const app = express()",
      "app.get('/users', async (req, res) => {",
      "  const userInput = req.query.name",
      "  const sql = `SELECT * FROM users WHERE name = '${userInput}'`",
      "  const result = await db.query(sql)",
      "  res.send(result)",
      "})",
    ].join("\n"),
  )
  await indexProjectParallel(projectId, dir, {})
  const { CrossLanguageSecurityAnalysis } = await import("../../src/security/cross-language-security")
  const result = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId)

  harness.check("handler: findings is an array", Array.isArray(result.findings), `type=${typeof result.findings}`)
  harness.check("handler: suspiciousSources is an array", Array.isArray(result.suspiciousSources), `type=${typeof result.suspiciousSources}`)
  harness.check("handler: cross_language_vulnerabilities is an array", Array.isArray(result.cross_language_vulnerabilities), `type=${typeof result.cross_language_vulnerabilities}`)
  harness.check("handler: summary is an object", typeof result.summary === "object" && result.summary !== null, `type=${typeof result.summary}`)
  harness.check("handler: summary has severity breakdown", typeof result.summary.critical === "number" && typeof result.summary.high === "number", JSON.stringify(result.summary).slice(0, 200))

  const allFindings = [...result.findings, ...result.suspiciousSources]
  harness.check("handler: findings have non-empty file paths", allFindings.every((f) => f.file), `${allFindings.filter((f) => !f.file).length} missing files`)
  harness.check("handler: findings carry severity", allFindings.every((f) => !!f.severity), `${allFindings.filter((f) => !f.severity).length} missing severity`)
  harness.check("handler: findings carry flow chains (non-empty)", allFindings.length === 0 || allFindings.some((f) => f.flow.length > 0), `max flow chain length: ${Math.max(0, ...allFindings.map((f) => f.flow.length))}`)
  harness.negative("handler: no zero-length severity values", allFindings.every((f) => f.severity !== ""), "empty severity found")
  deleteProject(projectId)
}

// ── 2. Python fixture: classification is not TypeScript-only ───────────────
{
  const dir = mkdtempSync(path.join(tmpdir(), "bb-sec-py-"))
  const projectId = getProjectId(dir)
  mkdirSync(path.join(dir, "src"), { recursive: true })
  writeFileSync(
    path.join(dir, "src", "app.py"),
    [
      "from flask import Flask, request",
      "import sqlite3",
      "app = Flask(__name__)",
      "@app.route('/search')",
      "def search():",
      "    q = request.args.get('q')",
      "    conn = sqlite3.connect('db.sqlite')",
      "    cursor = conn.execute(f\"SELECT * FROM items WHERE name = '{q}'\")",
      "    return str(cursor.fetchall())",
    ].join("\n"),
  )
  await indexProjectParallel(projectId, dir, {})
  const { CrossLanguageSecurityAnalysis } = await import("../../src/security/cross-language-security")
  const result = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId)
  harness.check("handler (python): findings carry vulnerability type", [...result.findings, ...result.suspiciousSources].every((f) => !!f.type), `missing types: ${[...result.findings, ...result.suspiciousSources].filter((f) => !f.type).length}`)
  deleteProject(projectId)
}

// ── 3. Heuristic honesty ───────────────────────────────────────────────────
{
  const taintAnalyzerSrc = readFileSync(path.join(rootDir, "src", "ast", "taint-analyzer.ts"), "utf8")
  const hasPatterns = taintAnalyzerSrc.includes(".test(") || taintAnalyzerSrc.includes("new RegExp")
  harness.check("honesty: taint-analyzer.ts uses pattern matching (fact)", hasPatterns, hasPatterns ? "pattern matches detected" : "no pattern matching")
  const secDoc = readFileSync(path.join(rootDir, "docs", "BB_SECURITY.md"), "utf8")
  harness.check("honesty: docs/BB_SECURITY.md acknowledges indexer heuristics", secDoc.includes("indexer heuristics"), "missing heuristic acknowledgment")
  harness.check("honesty: docs/BB_SECURITY.md does not claim AST data-flow proof", !secDoc.includes("AST-based taint") && !secDoc.includes("pure AST"), "claims AST where it should not")
  harness.negative("honesty: no doc claims taint detection is a pure-AST proof", !secDoc.includes("pure AST taint"), "pure-AST claim found")
}

// ── 4. Handler + CLI read path: a read does not write ─────────────────────
{
  const dir = mkdtempSync(path.join(tmpdir(), "bb-sec-readonly-"))
  const projectId = getProjectId(dir)
  mkdirSync(path.join(dir, "src"), { recursive: true })
  writeFileSync(
    path.join(dir, "src", "app.ts"),
    [
      "import { Client } from 'pg'",
      "const client = new Client()",
      "export function search(req: any): unknown { const q = req.query.q; return client.query('SELECT ' + q) }",
    ].join("\n"),
  )
  await indexProjectParallel(projectId, dir, {})
  const dbPath = BrainDatabase.getDbPath(projectId)
  // Remove a healing index: a read-write open recreates it (ensureHealthIndexes),
  // a read-only open cannot. The dropped object makes the read path falsifiable.
  const healIndex = "brain_symbol_project_idx"
  const rw = await BrainDatabase.getRawInstance(projectId)
  rw.exec(`DROP INDEX IF EXISTS ${healIndex}`)
  const indexBefore = rw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(healIndex)
  rw.close()
  // Closing this process's rw handle is not enough to prove a fresh process
  // cannot heal, so the check runs through the real CLI door in a child process.
  const before = sha256(dbPath)
  const cli = cliRead(dir)
  const after = sha256(dbPath)
  // The history answer is also a read, and it must not open a writeable handle
  // either. Run it through the same CLI door and re-check bytes + the dropped
  // healing index.
  const beforeHistory = sha256(dbPath)
  const cliHistory = (() => {
    const args = ["tool", "bb_security", "--dir", dir, "--args", JSON.stringify({ history: true })]
    const result = isBun
      ? spawnSync("bun", ["run", "src/cli/index.ts", ...args], { cwd: rootDir, encoding: "utf8", timeout: 180_000, env: { ...process.env, BB_NO_AUTO_REFRESH: "1" } })
      : spawnSync(tsxBin, ["src/cli/index.ts", ...args], { cwd: rootDir, encoding: "utf8", timeout: 180_000, env: { ...process.env, BB_NO_AUTO_REFRESH: "1" } })
    return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
  })()
  const afterHistory = sha256(dbPath)
  const verify = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  const indexAfter = verify.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(healIndex)
  harness.check("read-path: the CLI findings read succeeds", cli.status === 0 && cli.stdout.includes("security:"), `exit=${cli.status} stderr=${cli.stderr.slice(0, 200)}`)
  harness.check("read-path: the CLI history read succeeds", cliHistory.status === 0 && cliHistory.stdout.trim().startsWith("{"), `exit=${cliHistory.status} stderr=${cliHistory.stderr.slice(0, 200)}`)
  harness.negative("read-path: the database file is byte-identical after a history read", beforeHistory !== null && beforeHistory === afterHistory, `before=${beforeHistory?.slice(0, 12)} after=${afterHistory?.slice(0, 12)}`)
  harness.negative("read-path: the dropped healing index is STILL missing after a read", !indexBefore && !indexAfter, `before=${JSON.stringify(indexBefore)} after=${JSON.stringify(indexAfter)}`)
  harness.negative("read-path: the database file is byte-identical after a read", before !== null && before === after, `before=${before?.slice(0, 12)} after=${after?.slice(0, 12)}`)
  deleteProject(projectId)
}

// ── 5. Declared bounds: live cap sentence, census recordRun, page cap ─────
{
  const dir = mkdtempSync(path.join(tmpdir(), "bb-sec-bounds-"))
  const projectId = getProjectId(dir)
  mkdirSync(path.join(dir, "src"), { recursive: true })
  writeFileSync(path.join(dir, "src", "base.ts"), "export function base(): number { return 1 }\n")
  await indexProjectParallel(projectId, dir, {})
  const raw = await BrainDatabase.getRawInstance(projectId)
  const fileRow = raw.prepare("SELECT id FROM brain_file WHERE project_id = ? LIMIT 1").get(projectId) as { id: string }
  const now = Date.now()
  const insertSymbol = raw.prepare("INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end) VALUES (?,?,?,?,?,?,?)")
  const insertFlow = raw.prepare("INSERT INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
  const CAP_PROBE = 510
  for (let i = 0; i < CAP_PROBE; i++) {
    const symbolId = `bounds-symbol-${i}`
    insertSymbol.run(symbolId, projectId, fileRow.id, `bounds_${i}`, "function", 1000 + i, 1000 + i)
    insertFlow.run(`bounds-flow-${i}`, projectId, symbolId, symbolId, "http_input", "database_write", "sql_injection", "high", 0, JSON.stringify([symbolId]), 0, now, now)
  }
  const handlers = createToolHandlers()
  const ctx = { projectPath: dir, projectId } as ToolContext
  const textOf = (result: any) => (result.content ?? []).map((c: any) => c?.text ?? "").join("\n")

  const live = textOf(await handlers.bb_security!({}, ctx))
  harness.check("bounds: the live read renders at most the findings window", (live.match(/^ {2}\[/gm) ?? []).length <= 20, `lines=${(live.match(/^ {2}\[/gm) ?? []).length}`)
  harness.check("bounds: the live census states the pre-cap total", /\[scan: \d+ taint flow\(s\) indexed → 510 finding\(s\)/.test(live), live.split("\n").find((l) => l.startsWith("[scan:")) ?? "missing census")
  harness.check("bounds: the live read publishes the explicit CAPPED sentence", /CAPPED at 500; 510 finding\(s\) exist and 10 were not examined/.test(live), live.split("\n").find((l) => l.includes("CAPPED")) ?? "missing CAPPED sentence")

  const recorded = textOf(await handlers.bb_security!({ recordRun: true }, ctx))
  harness.check("bounds: recordRun persists the census-sized set (not the 500 display cap)", /510 findings recorded/.test(recorded), recorded.split("\n").find((l) => l.includes("recorded")) ?? "missing recorded line")
  const history = JSON.parse(textOf(await handlers.bb_security!({ history: true }, ctx)))
  harness.check("bounds: history declares its rendered page", typeof history.findingsShown === "number" && typeof history.findingsTotal === "number", JSON.stringify({ findingsShown: history.findingsShown, findingsTotal: history.findingsTotal }))
  harness.check("bounds: history page is capped at the declared 200 findings", history.findingsShown === 200 && history.findingsTotal === 510 && history.findingsTruncated === 310, JSON.stringify({ shown: history.findingsShown, total: history.findingsTotal, truncated: history.findingsTruncated }))
  harness.check("bounds: history census object names the page", history.census?.findingsTotal === 510 && history.census?.findingsShown === 200 && history.census?.findingsBeyondCap === 310, JSON.stringify(history.census))
  // Drift guard: the handler reads history through its own read-only query (the
  // shared reader opens the database for writing, which a read may not do), so
  // the page must still agree with the recorder's own reader on the same rows.
  {
    const { getAnalysisHistory } = await import("../../src/intelligence/analysis/run-history")
    const oracle = await getAnalysisHistory(projectId, "security", 20)
    const handlerRunIds = (history.runs ?? []).map((r: any) => r.id).sort()
    const oracleRunIds = oracle.runs.map((r) => r.id).sort()
    harness.check("history: the read-only page lists the same runs as the shared reader", JSON.stringify(handlerRunIds) === JSON.stringify(oracleRunIds), `handler=${handlerRunIds.length} oracle=${oracleRunIds.length}`)
    const identity = (rows: any[]) => JSON.stringify(rows.map((f) => `${f.fingerprint}|${f.state}|${f.severity}|${f.confidence}`).sort())
    // The handler page is capped by design; the contract is that the rendered
    // page is the shared reader's own ordered prefix, mapping field for field.
    harness.check("history: the read-only page is the shared reader's ordered prefix", identity(history.findings ?? []) === identity(oracle.findings.slice(0, 200)), `handler=${(history.findings ?? []).length} oraclePrefix=${Math.min(oracle.findings.length, 200)}`)
  }
  harness.negative("bounds: no unvalidated observation is persisted to history", (history.findings ?? []).every((f: any) => f.state !== "source_only" && f.state !== "unresolved" && f.rule !== "unresolved"), JSON.stringify([...new Set((history.findings ?? []).map((f: any) => `${f.state}/${f.rule}`))]))
  deleteProject(projectId)
}

// ── 6. Library door: an unindexed project is refused, not answered ────────
{
  const dir = mkdtempSync(path.join(tmpdir(), "bb-sec-library-"))
  const projectId = getProjectId(dir)
  mkdirSync(path.join(dir, "src"), { recursive: true })
  writeFileSync(path.join(dir, "src", "only.ts"), "export const only = 1\n")
  const dbPath = BrainDatabase.getDbPath(projectId)
  const handlers = createToolHandlers()
  let thrown = ""
  try {
    await handlers.bb_security!({}, { projectPath: dir, projectId } as ToolContext)
  } catch (error: any) {
    thrown = String(error?.message ?? error)
  }
  harness.check("library-door: an unindexed project is refused by name", /no index found/i.test(thrown), thrown.slice(0, 240))
  harness.negative("library-door: the refused call did not create an index", !existsSync(dbPath), `created ${dbPath}`)
  rmSync(dir, { recursive: true, force: true })
  rmSync(path.dirname(dbPath), { recursive: true, force: true })
}

harness.emit()
