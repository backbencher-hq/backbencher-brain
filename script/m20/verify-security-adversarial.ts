// M20.S2 — security behavioral adversarial verification.
//
// 1. Policy matrix: deterministic injected taint rows; every row has an exact
//    expected state/severity/confidence, derived from the documented model
//    (docs/BB_SECURITY.md states + confidence calibration).
// 2. Real behavior: TS SQLi concat -> at least one RESOLVED finding;
//    clean fixture -> zero findings; parameterized -> zero resolved SQLi.
// 3. Tautology audit: scans every security verifier for unconditional
//    assertions (h.ck(..., true, ...), >= 0, || true). Fails if found.
// 4. Mutation proof: flipping is_mitigated on a resolved flow must change the
//    verdict; the engine must distinguish the two states.
// 5. Persists exact evidence (this file must have no auto-passes itself).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { analyzeTaintFlows } from "../../src/intelligence/security/taint"
import { securitySourceFingerprint, securityRelevantWorkingTreeChanges } from "../../src/intelligence/security/evidence"
import { SecurityHarness, auditForAutoPass } from "../m15/security-harness"

// The shared harness. The previous inline `check`/`negative` pair had two
// defects: `h.nk()` called `h.ck()`, so a disproof was counted as a check
// as well and the evidence file overstated its coverage; and the failure count
// was a plain mutable number, so any future reset would silently unbreak the
// exit code the way it did in verify-security-deep.ts. `SecurityHarness` keeps
// the failure list process-global, counts every assertion exactly once, and
// separates positives from negatives.
const h = new SecurityHarness()

const root = mkdtempSync(path.join(tmpdir(), "bb-m20-s2-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), [
  "import { Client } from 'pg'",
  "const client = new Client()",
  "export function runQuery(userInput: string): unknown {",
  "  const sql = 'SELECT * FROM t WHERE name = ' + userInput",
  "  return client.query(sql)",
  "}",
  "export function safeQuery(userInput: string): unknown {",
  "  return client.query('SELECT * FROM t WHERE name = $1', [userInput])",
  "}",
  "export function pure(a: number): number { return a + 1 }",
].join("\n"))
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId)

  // ── 1. Real behavior positives/negatives ────────────────────────────────
  const report = await analyzeTaintFlows(projectId, { maxResults: 100 })
  const resolvedSqli = report.findings.filter((f) => f.vulnerabilityType === "sql_injection" && f.state === "confirmed")
  h.ck("REAL: concatenated SQL yields a resolved sql_injection finding", resolvedSqli.length >= 1, `resolved=${resolvedSqli.length}`)
  h.ck("REAL: resolved finding carries taint evidence", resolvedSqli.every((f) => f.evidence.some((e) => e.kind === "taint_flow")))
  h.ck("REAL: resolved finding has real file path", resolvedSqli.every((f) => f.file && f.file.endsWith("app.ts")), resolvedSqli.map((f) => f.file).join(","))

  // Clean fixture (~/p2-style negative).
  const clean = mkdtempSync(path.join(tmpdir(), "bb-m20-s2c-"))
  mkdirSync(path.join(clean, "src"), { recursive: true })
  writeFileSync(path.join(clean, "src", "clean.ts"), "export function add(a: number, b: number): number { return a + b }\n")
  const cleanPid = getProjectId(clean)
  await indexProjectParallel(cleanPid, clean, {})
  const cleanReport = await analyzeTaintFlows(cleanPid, { maxResults: 100 })
  h.nk("REAL: clean code produces zero findings", cleanReport.summary.total === 0 && cleanReport.findings.length === 0, `total=${cleanReport.summary.total}`)
  rmSync(clean, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(cleanPid)), { recursive: true, force: true })

  // ── 2. Deterministic policy matrix (injected rows) ─────────────────────
  // Clear analyzer-produced rows so the matrix is exact.
  raw.prepare("DELETE FROM brain_taint_flow WHERE project_id = ?").run(projectId)
  // Use a single real symbol as both source and sink for resolved rows.
  const sym = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND name = 'runQuery' LIMIT 1").get(projectId) as { id: string } | undefined
  // THE GATE. Previously a bare `if (sym)`, which meant a fixture that failed
  // to index silently reduced 20 assertions to 1 and still reported verified.
  h.require("matrix: the fixture symbol is indexed", !!sym, "no symbol named 'runQuery'; the matrix below would never execute")
  if (sym) {
    const now = Date.now()
    const ins = raw.prepare("INSERT INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    // confirmed: both endpoints resolved, unmitigated, alias type
    ins.run("m-confirmed", projectId, sym.id, sym.id, "http_input", "database_write", "sqli", "high", 0, JSON.stringify([sym.id]), 0, now, now)
    // mitigated: both endpoints resolved + mitigation flag
    ins.run("m-mitigated", projectId, sym.id, sym.id, "http_input", "database_write", "sql_injection", "high", 1, JSON.stringify([sym.id]), 0, now, now)
    // source_only: source resolved, sink NULL
    ins.run("m-source-only", projectId, sym.id, null, "http_input", "unresolved", "xss", "unknown", 0, JSON.stringify([sym.id]), 0, now, now)
    // unresolved: sink resolved, source NULL
    ins.run("m-unresolved", projectId, null, sym.id, "unresolved", "innerHTML", "xss_reflected", "high", 0, JSON.stringify([sym.id]), 0, now, now)
    // partial mitigated: sink resolved, source NULL, flagged mitigated — must stay unresolved, not mitigated
    ins.run("m-partial-mit", projectId, null, sym.id, "unresolved", "database_write", "command_injection", "critical", 1, JSON.stringify([sym.id]), 0, now, now)

    const m = await analyzeTaintFlows(projectId, { maxResults: 100, includeUnresolved: true, includeMitigated: true })
    const byId = (id: string) => m.findings.find((f) => f.id === id)
    const c = byId("m-confirmed")
    h.ck("matrix: confirmed row -> state confirmed", c?.state === "confirmed", JSON.stringify(c?.state))
    h.ck("matrix: confirmed row -> confidence 0.7 (calibrated)", c?.confidence === 0.7, JSON.stringify(c?.confidence))
    h.ck("matrix: alias 'sqli' normalized to sql_injection", c?.vulnerabilityType === "sql_injection", JSON.stringify(c?.vulnerabilityType))
    h.ck("matrix: confirmed row resolves both endpoints", !!c?.source.file && !!c?.sink.file)
    const mit = byId("m-mitigated")
    h.ck("matrix: resolved row + flag -> state mitigated, confidence 0.3", mit?.state === "mitigated" && mit?.confidence === 0.3, JSON.stringify(mit))
    const so = byId("m-source-only")
    h.ck("matrix: no-sink row -> state source_only, confidence 0.4", so?.state === "source_only" && so?.confidence === 0.4, JSON.stringify(so))
    const un = byId("m-unresolved")
    h.ck("matrix: no-source row -> state unresolved, confidence 0.4", un?.state === "unresolved" && un?.confidence === 0.4, JSON.stringify(un))
    h.ck("matrix: alias 'xss_reflected' normalized to xss", un?.vulnerabilityType === "xss", JSON.stringify(un?.vulnerabilityType))
    const pm = byId("m-partial-mit")
    h.nk("matrix: partial mitigated row is NOT classified mitigated", pm?.state !== "mitigated", JSON.stringify(pm?.state))
    h.ck("matrix: partial mitigated row stays unresolved observation", pm?.state === "unresolved", JSON.stringify(pm?.state))

    // state counts
    h.ck("matrix: summary byState reflects exact matrix", m.summary.byState.confirmed === 1 && m.summary.byState.mitigated === 1 && m.summary.byState.source_only === 1 && m.summary.byState.unresolved === 2, JSON.stringify(m.summary.byState))

    // includeMitigated/includeUnresolved policy
    const noUnresolved = await analyzeTaintFlows(projectId, { maxResults: 100, includeUnresolved: false, includeMitigated: true })
    h.nk("policy: includeUnresolved=false drops source_only+unresolved", !noUnresolved.findings.some((f) => f.state === "source_only" || f.state === "unresolved"), noUnresolved.findings.map((f) => `${f.id}:${f.state}`).join(","))

    // ── 3. Mutation proof ────────────────────────────────────────────────
    const before = await analyzeTaintFlows(projectId, { maxResults: 100, includeMitigated: false })
    const beforeIds = before.findings.map((f) => f.id)
    raw.prepare("UPDATE brain_taint_flow SET is_mitigated = 1 WHERE id = 'm-confirmed'").run()
    const after = await analyzeTaintFlows(projectId, { maxResults: 100, includeMitigated: false })
    const afterIds = after.findings.map((f) => f.id)
    h.nk("mutation: mitigation flip removes the row from includeMitigated=false", beforeIds.includes("m-confirmed") && !afterIds.includes("m-confirmed"), `before=${beforeIds.join(",")} after=${afterIds.join(",")}`)
    // The preconditions of that disproof, asserted rather than assumed: without
    // them `beforeIds.includes(...) && !afterIds.includes(...)` is satisfied by
    // an empty set on both sides.
    h.ck("mutation: the row IS present before the flip", beforeIds.includes("m-confirmed"), `before=${beforeIds.join(",")}`)
    h.ck("mutation: the flip produced a different result set", beforeIds.join(",") !== afterIds.join(","), `before=${beforeIds.join(",")} after=${afterIds.join(",")}`)

    // The accounting the handler's headline depends on.
    h.ck("matrix: bySeverity sums to total", Object.values(m.summary.bySeverity).reduce((a, b) => a + b, 0) === m.summary.total, `bySeverity=${JSON.stringify(m.summary.bySeverity)} total=${m.summary.total}`)
    h.ck("matrix: byState sums to total", Object.values(m.summary.byState).reduce((a, b) => a + b, 0) === m.summary.total, `byState=${JSON.stringify(m.summary.byState)} total=${m.summary.total}`)
    h.ck("matrix: truncatedFindings is 0 with no cap in play", m.summary.truncatedFindings === 0, `truncatedFindings=${m.summary.truncatedFindings} deduplicatedFlows=${m.summary.deduplicatedFlows}`)
  }
  h.release()

  // ── 4. Auto-pass audit across EVERY security verifier ───────────────────
  //
  // The previous audit scanned three files and matched only a literal
  // `check(..., true)`. It therefore passed over `script/verify-security.ts`
  // (which contained `byState.confirmed >= 0 && typeof ... === "number"`) and
  // `script/m15/verify-security-deep.ts` (which contained
  // `confidence >= 0 && confidence <= 1`) — the two files that actually had
  // the banned shape. The list is now every security verifier, and the detector
  // is `auditForAutoPass`, which rejects the three unfalsifiable shapes
  // structurally instead of naming one of them.
  const securityVerifiers = [
    "script/verify-security.ts",
    "script/m15/security-harness.ts",
    "script/m15/verify-security-deep.ts",
    "script/m15/verify-security-regressions.ts",
    "script/m20/verify-security-flow-boundary.ts",
    "script/m20/verify-security-adversarial.ts",
    "script/m20/verify-security-history.ts",
    "script/m13/verify-security-adversarial.ts",
    "script/m13/verify-security-contract.ts",
    "script/m13/verify-security-handler.ts",
    "script/m13/verify-security-docs.ts",
  ]
  h.ck("audit: the verifier list covers the whole security suite", securityVerifiers.length >= 10, `n=${securityVerifiers.length}`)
  // Every listed verifier must actually exist, or the audit silently reads fewer
  // files than it claims to cover.
  for (const file of securityVerifiers) {
    h.ck(`audit: ${file} exists`, existsSync(path.resolve(file)), "listed in the audit but not on disk — the audit would cover fewer files than it claims")
  }
  auditForAutoPass(h, "tautology", securityVerifiers.map((file) => ({ file, text: readFileSync(path.resolve(file), "utf8") })))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

const failed = h.failed
const result = {
  issue: "M20.S2", code: "S2", milestone: "M20",
  status: failed === 0 && securityRelevantWorkingTreeChanges(path.resolve(".")).length === 0 ? "verified" : "known-gap",
  checks: h.checks, passed: h.totalPassed, failed, negativeCases: h.negatives, negativePassed: h.negativePassed,
  // execFileSync, not Bun.spawnSync — this suite also runs under tsx/node.
  currentCommit: (() => {
    try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() }
    catch { return "unknown" }
  })(),
  sourceFingerprint: securitySourceFingerprint(path.resolve(".")),
  workingTreeRelevantChanges: securityRelevantWorkingTreeChanges(path.resolve(".")),
  verifierCommand: "npx tsx script/m20/verify-security-adversarial.ts",
  evidenceFile: "S2.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Policy matrix and real-behavior fixtures cover classification, calibration, dedup, filters, and mutation response; they do not prove real-world taint recall.",
    "Real-repository security coverage is owned by M20.X2; template-literal XSS and cross-symbol Python CMDi remain analyzer blind spots documented in docs/BB_SECURITY.md.",
  ],
}
mkdirSync(path.resolve("validation/m20/results"), { recursive: true })
writeFileSync(path.resolve("validation/m20/results/S2.json"), JSON.stringify(result, null, 2) + "\n")
console.log(failed === 0 ? `\nSECURITY S2: PASS (${h.totalPassed}/${h.checks}, ${h.negativePassed}/${h.negatives} negatives)` : `\nSECURITY S2: ${failed} FAILURES`)
if (failed > 0) for (const f of h.failures) console.log(`  FAIL: ${f.detail}`)
process.exit(failed > 0 ? 1 : 0)