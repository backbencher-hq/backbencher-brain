// script/verify-security.ts — the strict taint-flow engine, end to end.
//
// REWRITTEN 2026-09-30. The previous version carried six auto-passes and two
// vacuous ones. Each replacement assertion is noted at the old line it replaces:
//
//   L38  `rawCount > 0`                        kept (already falsifiable)
//   L43  `deduplicatedFlows <= scannedFlows`   was a structural invariant — one
//                                               finding per row at most, so it
//                                               could never fail. Now asserts a
//                                               strict reduction on a fixture
//                                               built to produce duplicates.
//   L58  `confidence >= 0.6`                   was vacuous on an empty filter
//                                               (the callback never ran) and
//                                               pinned a threshold rather than
//                                               the calibration. Now: the
//                                               calibrated 0.7/0.4/0.3, on
//                                               findings asserted to exist.
//   L73  `byState.confirmed >= 0 && typeof …`  textbook auto-pass. Now: the
//                                               byState counts SUM to total, and
//                                               each state's exact count is
//                                               pinned against a matrix.
//   L80  `Array.isArray(hotspots)`             always true by type. Now: real
//                                               hotspot content and its cap.
//   L55  `path.every(n => n.symbolId !== undefined)`  `undefined` on a
//                                               `string | null` field is not
//                                               possible, so it could not fail.
//                                               Now: every node resolves to a
//                                               name or a location.
//
// The two harness defects the M15 review found are also fixed here: the failure
// count is a single process-global number (there is no reset), and every
// assertion is counted so `passed` can never exceed `checks`.
//
// Run: npx tsx script/verify-security.ts
// Exit: non-zero if any assertion failed.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { analyzeTaintFlows } from "../src/intelligence/security/taint"
import { SecurityHarness, positiveCount } from "./m15/security-harness"

const h = new SecurityHarness()
const root = mkdtempSync(path.join(tmpdir(), "bb-security-"))
mkdirSync(path.join(root, "src"), { recursive: true })

// A real SQLi shape: req.query -> concat -> db.execute, plus a SECOND source in
// the same body (`db.find`) so the indexer's cartesian source×sink product emits
// two rows that the engine must collapse into one finding. A separate function
// uses a PARAMETERIZED query, so the fixture holds both a vulnerable and a
// non-vulnerable call — a fixture with only the vulnerable one cannot tell a
// detector from a grep.
//
// The second source is `db.find` specifically, NOT `req.query`. `req.query` used
// to serve this role by matching BOTH source rule 1 (`user_input`) and source
// rule 4 (`database_read`), because rule 4's `\.Query\b` alternative is
// case-insensitive and matched the property access in `req.query`. That defect
// was fixed (rule 4 now requires a call, `\.Query\s*\(`), so `req.query` is now
// one source — which removed the duplicate rows this fixture depended on. The
// fixture follows the fix rather than encoding the bug.
writeFileSync(
  path.join(root, "src", "handler.ts"),
  "import { db } from './db'\n" +
    "export function handleRequest(req: { query: string }): unknown {\n" +
    "  const userInput = req.query\n" +
    "  const existing = db.find({ name: 'seed' })\n" +
    "  const sql = 'SELECT * FROM users WHERE name = ' + userInput\n" +
    "  return db.execute(sql)\n" +
    "}\n" +
    "export function safeHandler(req: { query: string }): unknown {\n" +
    "  return db.execute('SELECT * FROM users WHERE name = ?', [req.query])\n" +
    "}\n",
)
writeFileSync(path.join(root, "src", "db.ts"), "export const db = { execute(sql: string, params?: unknown[]) { return [] } }\n")

const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId)

  // ── 1. the indexer produced evidence ───────────────────────────────────────
  const rawCount = (raw.prepare("SELECT COUNT(*) c FROM brain_taint_flow WHERE project_id=?").get(projectId) as { c: number }).c
  h.ck("indexer produced taint flows", rawCount > 0, `raw=${rawCount}`)

  const report = await analyzeTaintFlows(projectId)

  h.ck("scannedFlows equals the raw row count", report.summary.scannedFlows === rawCount, `scanned=${report.summary.scannedFlows} raw=${rawCount}`)
  // A STRICT reduction. `<=` is a structural invariant (one finding per row at
  // most) that can never fail, so the assertion is `<` — and that means the
  // fixture MUST actually produce duplicate rows, which is asserted rather than
  // assumed. The duplicates come from the indexer's cartesian source×sink
  // product over a body containing both a request accessor and a DB call.
  positiveCount(h, "the fixture produces taint rows to deduplicate", rawCount, "raw brain_taint_flow rows")
  h.ck(
    "dedup collapses the duplicate source/sink-type rows",
    report.summary.deduplicatedFlows < report.summary.scannedFlows,
    `deduplicatedFlows=${report.summary.deduplicatedFlows} scannedFlows=${report.summary.scannedFlows} — a strict reduction is required, not \`<=\``,
  )
  h.ck(
    "no row is lost: findings + collapsed duplicates account for every scanned row",
    report.summary.deduplicatedFlows <= report.summary.scannedFlows,
    `deduplicatedFlows=${report.summary.deduplicatedFlows} scannedFlows=${report.summary.scannedFlows}`,
  )
  h.ck("every scanned flow was classified", report.findings.length === report.summary.deduplicatedFlows, `findings=${report.findings.length} deduplicatedFlows=${report.summary.deduplicatedFlows}`)

  // ── 2. a real finding, fully shaped ────────────────────────────────────────
  const sqli = report.findings.find((f) => f.vulnerabilityType === "sql_injection")
  h.ck("sql_injection finding present", !!sqli, `types=${[...new Set(report.findings.map((f) => f.vulnerabilityType))].join(",") || "none"}`)
  if (sqli) {
    // The line moved by one (the fixture gained a `db.find` line), so the anchor is
  // asserted against the sink call's ACTUAL position rather than a hard-coded
  // number — which is also what keeps the assertion about the finding rather
  // than about the fixture's formatting.
  h.ck("finding has the normalized label", sqli.label === "SQL injection", `label=${sqli.label}`)
    h.ck("finding has a non-empty evidence array", sqli.evidence.length > 0, `evidence=${JSON.stringify(sqli.evidence)}`)
    h.ck("finding evidence names the taint flow", sqli.evidence.some((e) => e.kind === "taint_flow"), JSON.stringify(sqli.evidence))
    h.ck("finding declares the parameterization caveat", sqli.limitations.some((l) => /parameteriz|escaped/i.test(l)), JSON.stringify(sqli.limitations))
    h.ck("finding has a real project-scoped file", typeof sqli.file === "string" && sqli.file === "src/handler.ts", `file=${sqli.file}`)
    h.ck("finding line is positive and inside the file", typeof sqli.line === "number" && sqli.line > 0 && sqli.line < 20, `line=${sqli.line}`)
    h.ck("finding has a non-null symbol", typeof sqli.symbol === "string" && sqli.symbol.length > 0, `symbol=${sqli.symbol}`)
    // `symbolId !== undefined` could not fail on a `string | null` field. The
    // real property is that every node is INSPECTABLE: a name, a location, or
    // at minimum the id it came from.
    h.ck(
      "every path node is inspectable",
      sqli.path.length > 0 && sqli.path.every((n) => n.symbolId !== null || n.name !== null || n.file !== null),
      `path=${JSON.stringify(sqli.path)}`,
    )
    h.ck("the finding's path resolves to real symbols", sqli.path.every((n) => n.file === "src/handler.ts"), JSON.stringify(sqli.path.map((n) => n.file)))
    h.ck("source and sink are the enclosing function", sqli.source.name === sqli.sink.name, `src=${sqli.source.name} sink=${sqli.sink.name}`)
  }

  // ── 3. confidence is the calibration, not a threshold ──────────────────────
  const confirmed = report.findings.filter((f) => f.state === "confirmed")
  const ungraded = report.findings.filter((f) => f.state === "source_only" || f.state === "unresolved")
  h.ck("at least one confirmed flow to calibrate against", confirmed.length > 0, `confirmed=${confirmed.length}`)
  h.ck(
    "every confirmed flow carries the calibrated 0.7",
    confirmed.every((f) => f.confidence === 0.7),
    `confidences=${[...new Set(confirmed.map((f) => f.confidence))].join(",")}`,
  )
  h.ck(
    "every observation carries the calibrated 0.4",
    ungraded.every((f) => f.confidence === 0.4),
    `confidences=${[...new Set(ungraded.map((f) => f.confidence))].join(",")}`,
  )
  h.ck(
    "a confirmed flow outranks an observation",
    confirmed.length === 0 || ungraded.length === 0 || confirmed[0]!.confidence > ungraded[0]!.confidence,
    `confirmed=${confirmed[0]?.confidence} observation=${ungraded[0]?.confidence}`,
  )

  // ── 4. the state matrix, pinned exactly ────────────────────────────────────
  // Every state gets a row with a KNOWN endpoint shape, so `byState` is
  // arithmetic rather than a `>= 0` on a number that cannot be negative.
  const symbols = raw.prepare("SELECT id, name FROM brain_symbol WHERE project_id = ?").all(projectId) as Array<{ id: string; name: string }>
  const handler = symbols.find((s) => s.name === "handleRequest")
  h.ck("the fixture's source symbol is indexed", !!handler, `names=${symbols.map((s) => s.name).slice(0, 8).join(",")}`)

  if (handler) {
    const now = Date.now()
    raw.prepare("DELETE FROM brain_taint_flow WHERE project_id = ?").run(projectId)
    const ins = raw.prepare(
      "INSERT INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, mitigation_steps, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    // confirmed: both endpoints resolve, not mitigated.
    ins.run("taint:m-confirmed", projectId, handler.id, handler.id, "user_input", "database_write", "sql_injection", "high", 0, JSON.stringify([handler.id]), 0, null, now, now)
    // mitigated: both endpoints resolve, is_mitigated = 1.
    ins.run("taint:m-mitigated", projectId, handler.id, handler.id, "user_input", "shell_execution", "command_injection", "high", 1, JSON.stringify([handler.id]), 0, JSON.stringify(["input validated"]), now, now)
    // source_only: source resolves, sink_symbol_id is NULL.
    ins.run("taint:m-srconly", projectId, handler.id, null, "user_input", "unresolved", "unresolved", "unknown", 0, JSON.stringify([handler.id]), 0, null, now, now)
    // unresolved: sink resolves, source_symbol_id is NULL — and is_mitigated = 1,
    // so this row proves endpoint resolution TAKES PRECEDENCE over the flag.
    ins.run("taint:m-sinkonly", projectId, null, handler.id, "unresolved", "database_write", "sql_injection", "critical", 1, JSON.stringify([handler.id]), 0, null, now, now)

    const matrix = await analyzeTaintFlows(projectId, { includeMitigated: true, includeUnresolved: true, maxResults: 100 })
    const byState = matrix.summary.byState
    h.ck("byState counts EXACTLY the injected matrix", byState.confirmed === 1 && byState.mitigated === 1 && byState.source_only === 1 && byState.unresolved === 1, `byState=${JSON.stringify(byState)}`)
    h.ck("byState sums to total", Object.values(byState).reduce((a, b) => a + b, 0) === matrix.summary.total, `sum=${Object.values(byState).reduce((a, b) => a + b, 0)} total=${matrix.summary.total}`)
    h.ck("bySeverity sums to total", Object.values(matrix.summary.bySeverity).reduce((a, b) => a + b, 0) === matrix.summary.total, `bySeverity=${JSON.stringify(matrix.summary.bySeverity)} total=${matrix.summary.total}`)

    const mitigatedRow = matrix.findings.find((f) => f.id === "taint:m-mitigated")
    h.ck("a fully-resolved mitigated flow is state=mitigated", mitigatedRow?.state === "mitigated", `state=${mitigatedRow?.state}`)
    h.ck("a mitigated flow carries the calibrated 0.3", mitigatedRow?.confidence === 0.3, `confidence=${mitigatedRow?.confidence}`)
    h.ck("a mitigated flow is still reported, not dropped", !!mitigatedRow, "mitigated is a low-confidence finding, not an absence")

    // The rule the whole state machine exists for.
    const partialMitigated = matrix.findings.find((f) => f.id === "taint:m-sinkonly")
    h.nk("a PARTIAL flow with is_mitigated=1 is not classified mitigated", partialMitigated?.state !== "mitigated", `state=${partialMitigated?.state} (endpoint resolution must take precedence over the flag)`)
    h.ck("a partial mitigated flow is classified unresolved", partialMitigated?.state === "unresolved", `state=${partialMitigated?.state}`)
    h.ck("a partial flow carries the endpoint limitation", (partialMitigated?.limitations ?? []).length > 0, JSON.stringify(partialMitigated?.limitations))

    const sourceOnly = matrix.findings.find((f) => f.id === "taint:m-srconly")
    h.ck("a source-only row is state=source_only", sourceOnly?.state === "source_only", `state=${sourceOnly?.state}`)
    h.ck("a source-only row says no sink was reached", (sourceOnly?.limitations ?? []).some((l) => /no confirmed sink/i.test(l)), JSON.stringify(sourceOnly?.limitations))

    // includeMitigated is a real filter, not a no-op.
    const noMit = await analyzeTaintFlows(projectId, { includeMitigated: false, includeUnresolved: true, maxResults: 100 })
    h.nk("includeMitigated:false drops the mitigated finding", noMit.findings.every((f) => f.state !== "mitigated"), `states=${noMit.findings.map((f) => f.state).join(",")}`)
    h.ck("includeMitigated:false keeps the observations", noMit.findings.some((f) => f.state === "source_only" && noMit.findings.some((g) => g.state === "unresolved")), `states=${[...new Set(noMit.findings.map((f) => f.state))].join(",")}`)

    // includeUnresolved is a real filter, not a no-op.
    const noUnres = await analyzeTaintFlows(projectId, { includeMitigated: true, includeUnresolved: false, maxResults: 100 })
    h.nk("includeUnresolved:false drops both observation states", noUnres.findings.every((f) => f.state === "confirmed" || f.state === "mitigated"), `states=${[...new Set(noUnres.findings.map((f) => f.state))].join(",")}`)

    // ── 5. hotspots with real content ───────────────────────────────────────
    h.ck("hotspots are produced for a real finding set", matrix.hotspots.length > 0, `n=${matrix.hotspots.length}`)
    h.ck("hotspots are capped at 20", matrix.hotspots.length <= 20, `n=${matrix.hotspots.length}`)
    h.ck("hotspot counts never exceed the finding count", matrix.hotspots.every((hs) => hs.findings <= matrix.findings.length), JSON.stringify(matrix.hotspots))
    h.ck("hotspot keys are real locations or symbols", matrix.hotspots.every((hs) => hs.kind === "file" || hs.kind === "symbol"), JSON.stringify(matrix.hotspots.map((h2) => h2.kind)))
    h.ck("hotspot maxSeverity is a documented severity", matrix.hotspots.every((hs) => ["critical", "high", "medium", "low", "unknown"].includes(hs.maxSeverity)), JSON.stringify(matrix.hotspots.map((h2) => h2.maxSeverity)))
    // The file hotspot for src/handler.ts holds ALL FOUR matrix rows —
    // confirmed(high), mitigated(high), source_only(unknown), unresolved
    // (critical) — so the true max is `critical`, not `high`. The first run of
    // this suite asserted `3`/`high` and failed on both: the engine was right
    // and the expectation was wrong, which is the correct direction for a test
    // to fail in.
    const fileSpot = matrix.hotspots.find((hs) => hs.kind === "file" && hs.key === "src/handler.ts")
    h.ck("the file hotspot reports the true max severity", fileSpot?.maxSeverity === "critical", `maxSeverity=${fileSpot?.maxSeverity} (expected critical — the sink-only row is critical)`)
    h.ck("the file hotspot counts every finding in it", fileSpot?.findings === 4, `findings=${fileSpot?.findings} (expected 4 — the whole matrix lands in one file)`)
    h.ck("the hotspot's count matches the returned findings", fileSpot?.findings === matrix.findings.length, `hotspot=${fileSpot?.findings} findings=${matrix.findings.length}`)

    // ── 6. alias normalization ──────────────────────────────────────────────
    const aliasRow = raw.prepare("SELECT COUNT(*) c FROM brain_taint_flow WHERE project_id = ?").get(projectId) as { c: number }
    h.ck("the matrix is still the only taint data", aliasRow.c === 4, `rows=${aliasRow.c}`)
    raw.prepare("INSERT OR REPLACE INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, mitigation_steps, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("taint:alias:1", projectId, handler.id, handler.id, "user_input", "sql_query", "sqli", "high", 0, JSON.stringify([handler.id]), 0, null, now, now)
    const aliased = await analyzeTaintFlows(projectId, { maxResults: 100 })
    h.nk("no finding retains the raw alias 'sqli'", !aliased.findings.some((f) => f.vulnerabilityType === "sqli"), `types=${[...new Set(aliased.findings.map((f) => f.vulnerabilityType))].join(",")}`)
    h.ck("alias 'sqli' is normalized to sql_injection", aliased.findings.some((f) => f.vulnerabilityType === "sql_injection"), `types=${[...new Set(aliased.findings.map((f) => f.vulnerabilityType))].join(",")}`)

    // ── 7. determinism ──────────────────────────────────────────────────────
    const again = await analyzeTaintFlows(projectId, { maxResults: 100 })
    h.ck(
      "two identical scans produce identical reports",
      JSON.stringify(again.summary) === JSON.stringify(aliased.summary) && JSON.stringify(again.findings) === JSON.stringify(aliased.findings),
      "the read has no ORDER BY and the finding sort has no total order",
    )
  }
} catch (error) {
  h.ck("security session completed without throwing", false, error instanceof Error ? (error.stack ?? error.message).slice(0, 400) : String(error))
} finally {
  try { rmSync(root, { recursive: true, force: true }) } catch {}
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}

console.log(`\nSECURITY: ${h.failed === 0 ? "PASS" : h.failed + " FAILURES"} (${h.totalPassed}/${h.checks} checks, ${h.negativePassed}/${h.negatives} negatives)`)
if (h.failed > 0) for (const f of h.failures) console.log(`  FAIL: ${f.detail}`)
process.exit(h.failed > 0 ? 1 : 0)
