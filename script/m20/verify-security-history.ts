// script/m20/verify-security-history.ts — security history state persistence (M72 lead contract).
//
// THE PATH THIS FILE PINS. The Phase-1 (M72) default path is: the spec engine
// persists leads into `brain_security_flow`; the answer reads that store with
// limit/offset; `recordRun` is the one write and persists the store's census into
// the shared analysis history. The retired token engine (`brain_taint_flow`,
// `taint@intelligence`, states confirmed/mitigated) is NOT asserted here — it is
// rollback-only under BB_SECURITY_LEGACY=1 and is pinned by the m15 regression
// suite. This file therefore seeds the M72 store directly, so the history
// behaviour it asserts is independent of the spec engine's detection coverage.
//
// What each section pins:
//
//  1. THE COVERAGE COULD VANISH SILENTLY. All 12 substantive assertions sat
//     inside `if (sym) { ... }`. A fixture that failed to index produced
//     `checks: 1, failed: 0` — reported as `status: "verified"` with 12/12 of the
//     real coverage never executed. The harness's `require()`/`release()` makes an
//     absent precondition a FAILURE.
//
//  2. THE ANSWER LOSES THE UNAVAILABLE-TIER ROW, HONESTLY. A store row whose
//     tier is not `leads` is not a lead and must not be presented as one; it is
//     also never persisted by `recordRun`. The matrix seeds one such row so the
//     count difference (4 stored / 3 presented) is a real assertion, not `>= 0`.
//
//  3. IDENTITY ACROSS A RE-GRADE. The persisted history fingerprint is
//     `m72:<stable store id>` — the store id is line-number-free, so a severity
//     re-grade (or a line move) is a repeat, not a new finding. The old
//     `file:line:label` identity manufactured phantom churn; this section pins the
//     replacement.
//
//  4. A CRASH MUST NOT LEAVE STALE EVIDENCE. An unguarded CLI call throws, the
//     `finally` cleans up, and S3.json is never written — leaving a committed
//     record in place, still claiming `verified`. The CLI legs are gated and a
//     skip is recorded with its reason, never a silent stale file.
//
//  5. `negative()` incremented `checks` via `check()`, double-counting every
//     disproof and overstating coverage. The harness counts each once.
//
// Coverage that is easy to lose: the evidence and limitations the recorder
// persists, the fingerprint's stability across a re-grade, the recordRun census,
// and the tier exclusion.
//
// Run: npx tsx script/m20/verify-security-history.ts
// Exit: non-zero if any assertion failed.

import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { getAnalysisHistory } from "../../src/intelligence/analysis/run-history"
import { securitySourceFingerprint, securityRelevantWorkingTreeChanges } from "../../src/intelligence/security/evidence"
import { writeSealed } from "../lib/evidence.ts"
import { SecurityHarness } from "../m15/security-harness"
import { fileURLToPath } from "node:url"

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
// Self-contained data dir: never inherit the caller's HOME.
if (!process.env.BB_DATA_DIR) process.env.BB_DATA_DIR = path.join(ROOT_DIR, "validation", "tools", "bb_security", "bbdata")
process.env.BB_NO_AUTO_REFRESH = "1"
// Default-path verifier: the retired token engine must not run.
delete process.env.BB_SECURITY_LEGACY

const h = new SecurityHarness()
const skipped: Array<{ leg: string; reason: string }> = []

/** Seed one M72 store row. The id is the stable, line-number-free store id. */
function seedRow(
  raw: any,
  projectId: string,
  fileId: string,
  symbolId: string,
  row: { id: string; vulnerability: string; severity: string; tier: string; state: string; rule: string; sourceLine: number; sinkLine: number },
): void {
  const now = Date.now()
  raw.prepare(
    `INSERT OR REPLACE INTO brain_security_flow
      (id, project_id, file_id, source_symbol_id, sink_symbol_id, vulnerability_type, severity,
       state, tier, rule_id, source_line, sink_line, evidence, time_created, time_updated)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    row.id,
    projectId,
    fileId,
    symbolId,
    symbolId,
    row.vulnerability,
    row.severity,
    row.state,
    row.tier,
    row.rule,
    row.sourceLine,
    row.sinkLine,
    JSON.stringify({
      ruleId: row.rule,
      vulnerability: row.vulnerability,
      severity: row.severity,
      source: { line: row.sourceLine, byteStart: 0, byteEnd: 1 },
      sink: { line: row.sinkLine, byteStart: 10, byteEnd: 20 },
      reachPath: ["probe.source", "probe.assign"],
      store: { sourceLine: row.sourceLine, sinkLine: row.sinkLine },
    }),
    now,
    now,
  )
}

const root = mkdtempSync(path.join(tmpdir(), "bb-m20-s3-"))
mkdirSync(path.join(root, "src"), { recursive: true })
// A clean fixture: the default pipeline produces no lead here, so the matrix is
// exactly the rows this file seeds.
writeFileSync(path.join(root, "src", "app.ts"), "export function handle(input: string): unknown {\n  return input\n}\n")
const projectId = getProjectId(root)

try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId)
  const fileRow = raw.prepare("SELECT id, relative_path FROM brain_file WHERE project_id = ? LIMIT 1").get(projectId) as { id: string; relative_path: string }
  const sym = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND name = 'handle' LIMIT 1").get(projectId) as { id: string } | undefined

  // THE GATE. Absent, this fails — the assertions below are the coverage.
  h.require("the fixture symbol is indexed", !!sym, "no symbol named 'handle'; the history matrix below would never execute")
  if (sym) {
    // The matrix: 3 `leads` rows (the only rows the answer/persister may present)
    // + 1 `unsupported` row that must be excluded by both. Severity `critical`
    // exists in the store so the answer's grade label (`exec`) is asserted.
    const rows = [
      { id: "sec:probe:conf", vulnerability: "sql_injection", severity: "high", tier: "leads", state: "lead", rule: "typescript.sql.query", sourceLine: 2, sinkLine: 3 },
      { id: "sec:probe-xss", vulnerability: "xss", severity: "medium", tier: "leads", state: "lead", rule: "typescript.xss.dom_sink", sourceLine: 4, sinkLine: 5 },
      { id: "sec:probe-mit", vulnerability: "command_injection", severity: "critical", tier: "leads", state: "candidate", rule: "typescript.cmd.child_process", sourceLine: 6, sinkLine: 7 },
      { id: "sec:probe-unsupported", vulnerability: "sql_injection", severity: "high", tier: "unsupported", state: "lead", rule: "unsupported.probe", sourceLine: 8, sinkLine: 9 },
    ] as const
    for (const row of rows) seedRow(raw, projectId, fileRow.id, sym.id, { ...row })

    const handler = createToolHandlers().bb_security
    const ctx = { projectPath: root, projectId } as any
    const live = (await handler({ recordRun: true }, ctx)).content[0]!.text

    h.ck("live: response reports a recorded run", live.includes("recorded run"), live.slice(0, 200))
    h.ck("live: the answer starts with the honesty banner", live.split("\n")[0] === "⚠️  LEXICAL TOKEN CO-OCCURRENCE — NOT DATA FLOW; NOT A VULNERABILITY FINDING", live.split("\n")[0]?.slice(0, 120))
    h.ck("live: the persisted count is stated as leads, not findings", /^3 leads recorded$/m.test(live), live.match(/^.*leads recorded.*$/m)?.[0] ?? live.slice(0, 300))
    h.ck("live: the recordRun census names the persisted count and preview", /^\[recordRun: 3 lead\(s\) persisted; preview shows 3\]$/m.test(live), live.match(/^\[recordRun:.*$/m)?.[0] ?? "missing census")
    h.ck("live: the answered leads carry the lead vocabulary with the demoted critical grade", /^ {2}\[exec\] lead: command injection @ /m.test(live) && /^ {2}\[high\] lead: sql injection @ /m.test(live) && /^ {2}\[medium\] lead: xss @ /m.test(live), live.split("\n").filter((l) => /\] lead:/.test(l)).join(" | "))
    h.nk("live: the answer never prints [critical]", !/\[critical\]/.test(live), live.split("\n").find((l) => /critical/.test(l)) ?? "clean")
    h.nk("live: the unavailable-tier row is NOT presented as a lead", !/unsupported\.probe/.test(live) && (live.match(/\] lead: /g) ?? []).length === 3, `leadLines=${(live.match(/\] lead: /g) ?? []).length}`)

    const history = await getAnalysisHistory(projectId, "security", 10)
    h.ck("history: one completed run", history.runs.length === 1 && history.runs[0]!.status === "completed", JSON.stringify(history.runs.map((r) => r.status)))
    h.ck("history: findingCount equals the leads-tier rows only (3), not the 4-row store", history.runs[0]!.findingCount === 3, `count=${history.runs[0]!.findingCount}`)

    h.ck("history: the three leads-tier rows persisted from a 4-row store", history.findings.length === 3, `n=${history.findings.length}`)
    h.ck("history: the unavailable-tier row was NOT persisted", !history.findings.some((f) => (f.rule ?? "").includes("unsupported")), `rules=${history.findings.map((f) => f.rule).join(",")}`)
    h.ck("history: the three rows have distinct identities", new Set(history.findings.map((f) => f.id)).size === 3 && new Set(history.findings.map((f) => f.fingerprint)).size === 3, JSON.stringify(history.findings.map((f) => ({ id: f.id, fingerprint: f.fingerprint }))))
    h.ck("history: the fingerprint is the stable store id, not file:line", history.findings.every((f) => /^m72:sec:/.test(f.fingerprint) && !/:line:/.test(f.fingerprint)), JSON.stringify(history.findings.map((f) => f.fingerprint)))

    const persisted = history.findings.find((f) => f.rule === "typescript.sql.query")!
    h.ck("history: the persisted finding names its spec rule", persisted?.rule === "typescript.sql.query", `rule=${persisted?.rule}`)
    h.ck("history: the persisted title is a LEAD title, not a vulnerability claim", persisted?.title === "lead: sql injection", `title=${persisted?.title}`)
    h.ck("history: the persisted state is open", persisted?.state === "open", `state=${persisted?.state}`)
    h.ck("history: the persisted row names the M72 engine", persisted?.engine === "m72-security-spec", `engine=${persisted?.engine}`)
    h.ck("history: the persisted row declares the static_finding evidence class", persisted?.evidenceClass === "static_finding", `evidenceClass=${persisted?.evidenceClass}`)
    h.ck("history: the persisted row has a location", typeof persisted?.location === "string" && persisted.location!.includes(":"), `location=${persisted?.location}`)
    h.ck("history: the persisted evidence names a security lead (not a taint_flow)", (persisted?.evidence ?? []).some((e: any) => e?.kind === "security_lead") && !(persisted?.evidence ?? []).some((e: any) => e?.kind === "taint_flow"), JSON.stringify(persisted?.evidence))
    h.ck("history: the persisted row carries the lexical-lead limitation", (persisted?.limitations ?? []).some((l: string) => /lexical lead: not a dataflow proof/i.test(l)), JSON.stringify(persisted?.limitations))
    h.nk("history: the persisted confidence is NULL (a lead makes no confidence claim)", persisted?.confidence === null, `confidence=${JSON.stringify(persisted?.confidence)}`)
    h.nk("history: no persisted row carries an unknown severity", history.findings.every((f) => f.severity !== "unknown"), `severities=${[...new Set(history.findings.map((f) => f.severity))].join(",")}`)
    h.nk("history: no persisted row is a one-sided observation", history.findings.every((f) => f.state === "open" || f.state === "mitigated"), `states=${[...new Set(history.findings.map((f) => f.state))].join(",")}`)

    // Repeat-run parity.
    await handler({ recordRun: true }, ctx)
    const history2 = await getAnalysisHistory(projectId, "security", 10)
    h.ck("parity: second run keeps the same finding count", history2.runs.length === 2 && history2.runs.every((r) => r.findingCount === 3), JSON.stringify(history2.runs.map((r) => r.findingCount)))
    h.ck("parity: finding set unchanged after repeat (no phantom resolution)", history2.findings.length === 3 && history2.findings.every((f) => f.state === "open"), JSON.stringify(history2.findings.map((f) => f.state)))
    h.ck("parity: occurrenceCount advances on a repeat", history2.findings.every((f) => (f.occurrenceCount ?? 0) >= 2), `occurrences=${JSON.stringify(history2.findings.map((f) => f.occurrenceCount))}`)

    // Fingerprint stability across a RE-GRADE. Severity is not in the identity: a
    // re-grade is a property of the same lead, not the arrival of a new one.
    raw.prepare("UPDATE brain_security_flow SET severity = 'critical' WHERE project_id = ? AND id = ?").run(projectId, "sec:probe:conf")
    const rec3 = (await handler({ recordRun: true }, ctx)).content[0]!.text
    h.ck("parity: re-grading a stored lead is a repeat, not a new finding", /new=0\b/.test(rec3), rec3.match(/new=\d+ repeated=\d+/)?.[0] ?? rec3.slice(0, 200))
    const history3 = await getAnalysisHistory(projectId, "security", 10)
    h.ck("parity: re-grading updates severity in place without minting a row", history3.findings.length === 3 && history3.findings.find((f) => f.rule === "typescript.sql.query")?.severity === "critical", `n=${history3.findings.length} sev=${history3.findings.find((f) => f.rule === "typescript.sql.query")?.severity}`)
    h.ck("parity: re-grading does not resolve the finding", history3.findings.every((f) => f.state === "open"), JSON.stringify(history3.findings.map((f) => f.state)))
    h.ck("parity: the re-graded row keeps the same fingerprint", new Set(history3.findings.map((f) => f.fingerprint)).size === 3, JSON.stringify(history3.findings.map((f) => f.fingerprint)))
  }
  h.release()

  // ── CLI parity, over the SOURCE entry ────────────────────────────────────
  // The compiled entry (`bin/bb` -> dist/) is an artifact built separately, so a
  // gate that shells it reports on whatever the last build contained — that is
  // how a stale build can make the working tree look wrong (and vice versa).
  // The parity assertion runs the same source the handler assertions run.
  {
    const runSourceCli = (args: Record<string, unknown>): string => {
      const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
      const tsxBin = path.join(ROOT_DIR, "node_modules", ".bin", "tsx")
      const cliArgs = ["tool", "bb_security", "--dir", root, "--args", JSON.stringify(args)]
      const env: Record<string, string | undefined> = { ...process.env, BB_NO_AUTO_REFRESH: "1" }
      delete env.BB_SECURITY_LEGACY
      const res = isBunRuntime
        ? spawnSync("bun", ["run", "src/cli/index.ts", ...cliArgs], { cwd: ROOT_DIR, encoding: "utf8", timeout: 180_000, env })
        : spawnSync(tsxBin, ["src/cli/index.ts", ...cliArgs], { cwd: ROOT_DIR, encoding: "utf8", timeout: 180_000, env })
      if ((res.status ?? 1) !== 0) throw new Error(`source CLI failed (exit ${res.status}): ${(res.stderr ?? "").slice(0, 300)}`)
      return res.stdout ?? ""
    }
    const cli = runSourceCli({ recordRun: true })
    h.ck("CLI: recordRun works", cli.includes("recorded run"), cli.slice(0, 200))
    h.ck("CLI: the CLI response carries the lead count and census", /^3 leads recorded$/m.test(cli) && /^\[recordRun: 3 lead\(s\) persisted; preview shows 3\]$/m.test(cli), cli.match(/^.*leads recorded.*$/m)?.[0] ?? "no census")
    const cliHist = runSourceCli({ history: true, limit: 10 })
    const parsed = JSON.parse(cliHist.trim())
    h.ck("CLI: history JSON has runs each with findingCount 3", Array.isArray(parsed.runs) && parsed.runs.length === 4 && parsed.runs.every((r: any) => r.findingCount === 3), `runs=${parsed.runs?.length} counts=${JSON.stringify(parsed.runs?.map((r: any) => r.findingCount))}`)
    h.ck("CLI: the CLI door persists the same 3-row set as the handler door", parsed.findings.length === 3, `n=${parsed.findings?.length}`)
    h.ck("CLI: history JSON findings name the M72 engine", parsed.findings.every((f: any) => f.engine === "m72-security-spec"), JSON.stringify([...new Set(parsed.findings.map((f: any) => f.engine))]))
    h.ck("CLI: history JSON carries security-lead evidence", parsed.findings.every((f: any) => Array.isArray(f.evidence) && f.evidence.length > 0 && f.evidence.every((e: any) => e.kind === "security_lead")), JSON.stringify(parsed.findings?.map((f: any) => f.evidence?.length)))
    h.nk("CLI: history JSON has no unknown-severity findings", parsed.findings.every((f: any) => f.severity !== "unknown"), JSON.stringify(parsed.findings?.map((f: any) => f.severity)))
    h.nk("CLI: history JSON has no retired-engine row", !(parsed.runs ?? []).some((r: any) => /taint@intelligence/.test(String(r.engineVersion))) && parsed.findings.every((f: any) => f.engine !== "taint@intelligence"), JSON.stringify((parsed.runs ?? []).map((r: any) => r.engineVersion)))
  }
} catch (error) {
  h.ck("the section completed without throwing", false, error instanceof Error ? (error.stack ?? error.message).slice(0, 300) : String(error))
} finally {
  try { rmSync(root, { recursive: true, force: true }) } catch {}
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}

const failed = h.failed
const result = {
  issue: "M20.S3", code: "S3", milestone: "M20",
  status: failed === 0 && securityRelevantWorkingTreeChanges(path.resolve(".")).length === 0 ? "verified" : "known-gap",
  checks: h.checks, passed: h.totalPassed, failed, negativeCases: h.negatives, negativePassed: h.negativePassed,
  currentCommit: (() => {
    try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() }
    catch { return "unknown" }
  })(),
  sourceFingerprint: securitySourceFingerprint(path.resolve(".")),
  workingTreeRelevantChanges: securityRelevantWorkingTreeChanges(path.resolve(".")),
  verifierCommand: "npx tsx script/m20/verify-security-history.ts",
  evidenceFile: "S3.json",
  generatedAt: new Date().toISOString(),
  skipped,
  limitations: [
    "Deterministic fixture-level history matrix over the M72 store; real-repository history parity is covered by the m17 corpus verifiers.",
    "The M72 store currently emits only lead/candidate states; the old confirmed/mitigated history states are retired with the token engine and are not asserted here.",
  ],
}
mkdirSync(path.resolve("validation/m20/results"), { recursive: true })
writeSealed(path.resolve("validation/m20/results/S3.json"), result)
console.log(failed === 0 ? `\nSECURITY S3: PASS (${h.totalPassed}/${h.checks}, ${h.negativePassed}/${h.negatives} negatives${skipped.length ? `, ${skipped.length} leg(s) skipped` : ""})` : `\nSECURITY S3: ${failed} FAILURES`)
for (const s of skipped) console.log(`  SKIP ${s.leg}: ${s.reason}`)
if (failed > 0) for (const f of h.failures) console.log(`  FAIL: ${f.detail}`)
process.exit(failed > 0 ? 1 : 0)
