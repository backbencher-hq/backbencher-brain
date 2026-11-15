// script/m72/store/run.ts — M72 STORE PROOF (task-6 / PLAN.md §6 verification)
//
// WHAT THIS PROVES, end-to-end on a temporary project (never a user repo):
//   (a) a tiny TypeScript project indexes and the spec engine's lead is PERSISTED
//       into brain_security_flow (row shape, stable id format, evidence JSON);
//   (b) editing the file to REMOVE the sink and reindexing the changed file
//       deletes the old row — the stale-row contract (`1 -> 0`);
//   (c) moving the function 12 lines down keeps the SAME id (ids are
//       line-number-free) while the stored line moves with the code;
//   (d) a second file's row SURVIVES the reindex of the first file;
//   (e) test files are skipped (`is_test_file`) and languages with no spec are
//       skipped, counted explicitly; the runtime also proves the legacy
//       `brain_taint_flow` writer is off by default (0 rows).
//
// WHY IT READS THE DB INSTEAD OF TRUSTING THE PIPELINE'S RETURN: a count returned
// by the writer is a claim about itself. The assertions below read the stored
// rows through the same reader the answer surface uses (`readSecurityFlows`), so
// "the row is gone" is about the database, not about a counter.
//
// RUN: npx tsx script/m72/store/run.ts        (exit 0 = all pass)
// ROLLBACK CONTROL: BB_SECURITY_LEGACY=1 flips the legacy writer on and this
// proof is expected to FAIL on the "legacy writer off" check — that is the
// point of the gate, not a defect.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// ── ISOLATION: never touch the user's ~/.bb index ───────────────────────────
//
// The project database lives under `$BB_DATA_DIR/projects/<id>/brain.db`. This
// proof must run on a THROWAWAY data dir (temp only), so the dir is set BEFORE
// any app module is imported — `bbDataDir()` is read when the database layer
// initializes, and a static app import would run first. All app imports below
// are therefore dynamic (`await import`), not hoisted.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-m72-store-data-"))
process.env.BB_DATA_DIR = DATA_DIR

const { getProjectId } = await import("../../../src/util/project-id")
const { BrainDatabase } = await import("../../../src/brain/database")
const { indexProjectParallel, flushBackgroundEmbeddings } = await import("../../../src/ast/parallel-indexer")
const { analyzeSymbol } = await import("../../../src/intelligence/security/rebuild/engine")
const {
  persistSecurityLeads,
  prepareSecurityFlowStatements,
  readSecurityFlows,
  securityFlowId,
  securityLeadToRow,
  securityLegacyEnabled,
  SECURITY_FLOW_SETUP_HINT,
} = await import("../../../src/intelligence/security/rebuild/store")
type SecurityLead = import("../../../src/intelligence/security/rebuild/spec-types").SecurityLead

// ── tiny assertion harness ──────────────────────────────────────────────────
let checks = 0
let failures = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (!ok) failures++
  const line = `  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`
  lines.push(line)
  console.log(line)
}
function section(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`)
}

// ── the fixture ─────────────────────────────────────────────────────────────
const VULNERABLE_A = `declare const client: any
export function runA(req: any) {
  const q = req.query
  return client.query("select * from t where x = " + q)
}
`
const VULNERABLE_B = `declare const client: any
export function runB(req: any) {
  const v = req.body
  return client.query("delete from t where id = " + v)
}
`
// Same body text as VULNERABLE_A, but at a test path: the pipeline must index
// the file and still persist NO lead from it.
const FIXTURE = {
  "src/a.ts": VULNERABLE_A,
  "src/b.ts": VULNERABLE_B,
  "tests/a.test.ts": VULNERABLE_A,
} as const

const root = mkdtempSync(path.join(tmpdir(), "bb-m72-store-"))
const rel = (p: string) => path.relative(root, p).split(path.sep).join("/")
const abs = (p: string) => path.join(root, p)
let projectId = ""
let closeDb = false

function writeFixtures(files: Record<string, string>): void {
  for (const [file, body] of Object.entries(files)) {
    const target = abs(file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, body)
  }
}

async function reindex(files: string[]): Promise<void> {
  await indexProjectParallel(projectId as any, root, {
    files: files.map(abs),
    skipPostProcessing: true,
  })
}

try {
  if (securityLegacyEnabled()) {
    console.log(
      "NOTE: BB_SECURITY_LEGACY=1 is set — the legacy writer is on, so the default-path assertions below are expected to fail.",
    )
  }
  writeFixtures(FIXTURE as unknown as Record<string, string>)
  projectId = getProjectId(root)
  console.log(`temp project: ${root}`)
  console.log(`project id:   ${projectId}`)

  const { default: Database } = await import("better-sqlite3")
  let raw: any
  try {
    raw = await BrainDatabase.getRawInstance(projectId as any)
    closeDb = true
  } catch (error) {
    throw new Error(`could not open the project database: ${(error as Error).message}`)
  }

  // ════════════════════════════════════════════════════════════════════════
  section("(a) first index — one lead per production file is persisted")
  await reindex(["src/a.ts", "src/b.ts", "tests/a.test.ts"])

  const r0 = readSecurityFlows(raw, projectId, { limit: 500 })
  check("store reader reports initialized table", r0.initialized, r0.message ?? "")
  check("no setup hint on an initialized store", r0.message !== SECURITY_FLOW_SETUP_HINT, String(r0.message ?? ""))

  const fileRows = (r: typeof r0, file: string) => r.rows.filter((row) => row.file === file)
  const idsOf = (rows: Array<{ id: string }>) => rows.map((row) => row.id).sort()
  const sinkLineOf = (rows: Array<{ sinkLine: number | null }>) => rows.map((row) => row.sinkLine)

  const a0 = fileRows(r0, "src/a.ts")
  const b0 = fileRows(r0, "src/b.ts")
  const t0 = fileRows(r0, "tests/a.test.ts")
  check("src/a.ts produced at least one stored lead", a0.length >= 1, `rows=${a0.length}`)
  check("src/b.ts produced at least one stored lead", b0.length >= 1, `rows=${b0.length}`)
  check("tests/a.test.ts produced NO stored lead (test-file skip)", t0.length === 0, `rows=${t0.length}`)

  const aFile = raw
    .prepare("SELECT id, relative_path, is_test_file FROM brain_file WHERE project_id = ? AND relative_path = 'src/a.ts'")
    .get(projectId) as { id: string; relative_path: string; is_test_file: number } | undefined
  const bFile = raw
    .prepare("SELECT id, relative_path FROM brain_file WHERE project_id = ? AND relative_path = 'src/b.ts'")
    .get(projectId) as { id: string; relative_path: string } | undefined
  const tFile = raw
    .prepare("SELECT id, is_test_file FROM brain_file WHERE project_id = ? AND relative_path = 'tests/a.test.ts'")
    .get(projectId) as { id: string; is_test_file: number } | undefined
  check("src/a.ts is an indexed file row", Boolean(aFile), String(aFile?.id))
  check("tests/a.test.ts is indexed AND flagged is_test_file=1", tFile?.is_test_file === 1, JSON.stringify(tFile))

  // Lead shape: the stored columns must be the engine's vocabulary, not a
  // post-processed guess. Optional-chained so the ROLLBACK run
  // (BB_SECURITY_LEGACY=1) reports FAILED checks instead of throwing on the
  // first missing row — a control run must be readable.
  const leadA = a0[0]
  check("stored row carries a tier", leadA?.tier === "leads" || leadA?.tier === "scan", String(leadA?.tier))
  check("stored row is a lead (not a finding claim)", leadA?.state === "lead", String(leadA?.state))
  check("stored row names a spec rule id", typeof leadA?.ruleId === "string" && leadA.ruleId.includes("."), String(leadA?.ruleId))
  check("stored row carries the sql_injection family", /sql_injection|command_injection|code_injection/.test(String(leadA?.vulnerabilityType)), String(leadA?.vulnerabilityType))
  const evidenceA = (leadA?.evidence ?? null) as any
  check(
    "evidence JSON parses and carries source/sink tokens",
    Boolean(evidenceA?.sink && evidenceA?.source && typeof evidenceA.sink.byteStart === "number"),
    JSON.stringify(evidenceA?.store ?? null),
  )

  // Stable id: `sec:<projectId>:<fileId>:<ruleId>:<byteStart>:<byteEnd>` — the
  // last two segments are byte OFFSETS, never lines (a line segment would drift
  // the moment the function moved; the id must not).
  const idA0 = leadA?.id ?? ""
  const idShape = /^sec:(.+):([^:]+):([^:]+):(\d+):(\d+)$/.exec(idA0)
  check("row id has the stable `sec:` shape", Boolean(idShape), idA0)
  check(
    "row id's trailing offsets are the sink token's byte offsets (no line numbers)",
    Boolean(idShape) && Number(idShape![4]) === evidenceA.sink.byteStart && Number(idShape![5]) === evidenceA.sink.byteEnd,
    `id ends ${idShape?.[4]}:${idShape?.[5]} vs sink ${evidenceA?.sink?.byteStart}:${evidenceA?.sink?.byteEnd}`,
  )
  check(
    "row id is reproducible from the documented format",
    Boolean(idShape) &&
      securityFlowId(projectId, aFile!.id, String(leadA!.ruleId), evidenceA.sink.byteStart, evidenceA.sink.byteEnd) === idA0,
    idA0,
  )

  // The legacy table must stay EMPTY on the default path (new path never writes
  // it; the old token detector is gated off).
  const legacyRows = Number(
    (raw.prepare("SELECT COUNT(*) AS c FROM brain_taint_flow WHERE project_id = ?").get(projectId) as any)?.c ?? 0,
  )
  check("legacy brain_taint_flow has 0 rows from the default pipeline", legacyRows === 0, `rows=${legacyRows}`)
  if (legacyRows !== 0) {
    check(
      "BB_SECURITY_LEGACY=1 is the cause (rollback control)",
      securityLegacyEnabled(),
      securityLegacyEnabled()
        ? "rollback run: the legacy token writer explains these rows"
        : "legacy rows appeared WITHOUT BB_SECURITY_LEGACY=1 — the new path is leaking old-table writes",
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  section("(b) remove the sink, reindex the changed file — the old row is GONE")
  const removerBody = `declare const client: any
export function runA(req: any) {
  // sink removed by the edit: the value no longer reaches a dangerous call
  return req.query
}
`
  writeFileSync(abs("src/a.ts"), removerBody)
  await reindex(["src/a.ts"])

  const r1 = readSecurityFlows(raw, projectId, { limit: 500 })
  const a1 = fileRows(r1, "src/a.ts")
  const b1 = fileRows(r1, "src/b.ts")
  check("edited src/a.ts now stores 0 leads", a1.length === 0, `rows=${a1.length}`)
  check("the OLD src/a.ts row id is absent (not merely replaced)", a1.every((row) => row.id !== idA0), idsOf(a1).join(",") || "no rows")
  check("src/a.ts file row still exists (the file was reindexed, not deleted)", Boolean(raw.prepare("SELECT 1 FROM brain_file WHERE id = ?").get(aFile!.id)))

  // ════════════════════════════════════════════════════════════════════════
  section("(c) move the function 12 lines down — the id is UNCHANGED, the line moves")
  const paddedBody = `${Array.from({ length: 12 }, (_, i) => `// padding line ${i + 1} — moves runA down without touching its body`).join("\n")}\n${VULNERABLE_A}`
  writeFileSync(abs("src/a.ts"), paddedBody)
  await reindex(["src/a.ts"])

  const r2 = readSecurityFlows(raw, projectId, { limit: 500 })
  const a2 = fileRows(r2, "src/a.ts")
  check("restored+moved src/a.ts stores a lead again", a2.length >= 1, `rows=${a2.length}`)
  check("moved src/a.ts lead keeps the SAME id", a2.length >= 1 && a2[0]!.id === idA0, a2[0]?.id ?? "none")
  const movedSinkLine = sinkLineOf(a2)[0] ?? null
  const originalSinkLine = sinkLineOf(a0)[0] ?? null
  check(
    "the stored sink line moved WITH the function (+12), proving the id is not line-derived",
    typeof movedSinkLine === "number" && typeof originalSinkLine === "number" && movedSinkLine - originalSinkLine === 12,
    `before=${originalSinkLine} after=${movedSinkLine}`,
  )

  // ════════════════════════════════════════════════════════════════════════
  section("(d) a second file's row SURVIVES every reindex of the first file")
  const b2 = fileRows(r2, "src/b.ts")
  check("src/b.ts rows survived (id set identical)", idsOf(b2).join(",") === idsOf(b0).join(","), `${idsOf(b2).join(",")} vs ${idsOf(b0).join(",")}`)
  check("src/b.ts still has its original count", b2.length === b0.length, `${b2.length} vs ${b0.length}`)
  check("src/b.ts rows are not attributed to the edited file", b2.every((row) => row.file === "src/b.ts"))

  // ════════════════════════════════════════════════════════════════════════
  section("(e) contract skips are COUNTED, not silently ignored")
  // A REAL engine lead from the same fixture body, then the store's own mapper:
  // this isolates the two pipeline exclusions (test file, no spec) from the
  // parse/index path that already proved them end-to-end above.
  const engineLeads = analyzeSymbol({ language: "typescript", source: VULNERABLE_A, file: "src/a.ts" })
  check("engine produces a lead for the fixture body (spec present)", engineLeads.length === 1, `leads=${engineLeads.length}`)
  const sample: SecurityLead = engineLeads[0]!

  const baseCtx = {
    projectId,
    fileId: aFile!.id,
    relativePath: "src/a.ts",
    symbolId: `${aFile!.id}:runA:1`,
    symbolStartLine: 2,
    language: "typescript",
    isTestFile: false,
  }
  const stored = securityLeadToRow(sample, baseCtx, Date.now())
  check("lead -> row mapping succeeds for a production symbol", stored.row !== null && stored.skipped === undefined, stored.skipped ?? stored.row?.id)

  const testFileMapping = securityLeadToRow(sample, { ...baseCtx, relativePath: "tests/a.test.ts", isTestFile: true }, Date.now())
  check("test-file context is skipped as `test_file`", testFileMapping.row === null && testFileMapping.skipped === "test_file", JSON.stringify(testFileMapping.skipped))

  const noSpecMapping = securityLeadToRow(sample, { ...baseCtx, language: "json" }, Date.now())
  check("data language (json) is skipped as `no_spec`", noSpecMapping.row === null && noSpecMapping.skipped === "no_spec", JSON.stringify(noSpecMapping.skipped))

  const unregisteredMapping = securityLeadToRow(sample, { ...baseCtx, language: "brainfuck" }, Date.now())
  check(
    "unregistered language is skipped as `no_spec` (no invented spec)",
    unregisteredMapping.row === null && unregisteredMapping.skipped === "no_spec",
    JSON.stringify(unregisteredMapping.skipped),
  )

  const malformedMapping = securityLeadToRow({ ...sample, evidence: { ...sample.evidence, sink: undefined as any } }, baseCtx, Date.now())
  check("a lead without a sink token is skipped as `malformed` (no invented offsets)", malformedMapping.row === null && malformedMapping.skipped === "malformed", JSON.stringify(malformedMapping.skipped))

  // Direct-write control on a THROWAWAY file id: proves persistSecurityLeads
  // counts skips instead of writing them, using the same prepared statements the
  // pipeline uses. The rows are inserted under a synthetic file so the real
  // fixture state above is untouched, then removed.
  const stmts = prepareSecurityFlowStatements(raw)
  const syntheticCtx = { ...baseCtx, fileId: `${projectId}:__store_proof_synthetic__.ts`, relativePath: "__store_proof_synthetic__.ts", symbolId: `${projectId}:__store_proof_synthetic__.ts:f:1` }
  const persistTestFile = persistSecurityLeads(stmts, { ...syntheticCtx, isTestFile: true }, [sample], Date.now())
  check("persistSecurityLeads writes nothing for a test-file symbol", persistTestFile.inserted === 0 && persistTestFile.skipped.test_file === 1, JSON.stringify(persistTestFile))
  const persistNoSpec = persistSecurityLeads(stmts, { ...syntheticCtx, language: "json" }, [sample], Date.now())
  check("persistSecurityLeads writes nothing for a no-spec language", persistNoSpec.inserted === 0 && persistNoSpec.skipped.no_spec === 1, JSON.stringify(persistNoSpec))
  const persistOk = persistSecurityLeads(stmts, syntheticCtx, [sample], Date.now())
  const syntheticRows = Number(
    (raw.prepare("SELECT COUNT(*) AS c FROM brain_security_flow WHERE file_id = ?").get(syntheticCtx.fileId) as any)?.c ?? 0,
  )
  check("persistSecurityLeads DOES write one row for a valid lead (control)", persistOk.inserted === 1 && syntheticRows === 1, JSON.stringify({ ...persistOk, rows: syntheticRows }))
  stmts.deleteForFile.run(projectId, syntheticCtx.fileId, syntheticCtx.fileId, syntheticCtx.fileId)
  check(
    "the per-file delete removes the synthetic rows",
    Number((raw.prepare("SELECT COUNT(*) AS c FROM brain_security_flow WHERE file_id = ?").get(syntheticCtx.fileId) as any)?.c ?? 0) === 0,
  )

  // Missing-table behaviour is a declared state, not a crash: drop the table on
  // a COPY of the DB path is destructive to the fixture, so prove it on an
  // in-memory handle that never ran the DDL.
  const memDb = new Database(":memory:")
  const uninitialized = readSecurityFlows(memDb, projectId, { limit: 5 })
  check("missing table reads as `initialized: false` (no throw)", uninitialized.initialized === false)
  check("missing table reports the actionable setup hint", uninitialized.message === SECURITY_FLOW_SETUP_HINT, String(uninitialized.message))
  memDb.close()

  // ════════════════════════════════════════════════════════════════════════
  section("final census")
  const final = readSecurityFlows(raw, projectId, { limit: 500 })
  console.log(`  stored rows: ${final.total} (a=${fileRows(final, "src/a.ts").length}, b=${fileRows(final, "src/b.ts").length}, tests=${fileRows(final, "tests/a.test.ts").length})`)
} catch (error) {
  failures++
  console.log(`\nFAIL: the proof threw — ${(error as Error)?.stack ?? String(error)}`)
} finally {
  try {
    await flushBackgroundEmbeddings({ timeoutMs: 10_000 }).catch(() => undefined)
  } catch {}
  if (closeDb && projectId) {
    try {
      BrainDatabase.close(projectId as any)
    } catch {}
  }
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {}
  // The throwaway bb data dir (project DBs live under it) is temp-only, so the
  // proof leaves no index behind for the next run to mistake for its own.
  try {
    rmSync(DATA_DIR, { recursive: true, force: true })
  } catch {}
}

console.log(`\n${"=".repeat(72)}`)
console.log(`M72 store proof: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURE(S)`} (${checks - failures}/${checks})`)
console.log(`${"=".repeat(72)}`)
process.exit(failures === 0 ? 0 : 1)
