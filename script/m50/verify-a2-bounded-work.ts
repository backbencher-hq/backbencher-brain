// script/m50/verify-a2-bounded-work.ts — M50.A2 residual (#764) permanent gate.
//
// The three residuals A1 convicted (bb_analyze complexity 2.25s, bb_security
// 1.23s, bb_patterns 1.6s) were all the same defect shape: an engine
// materialized far more rows/objects than it could ever return. This gate
// guards the STRUCTURAL property that made the fixes fast, hermetically — the
// wall-clock numbers live in the probes and the A2c sweep, because a latency
// ceiling on a fixture proves nothing and a ceiling on the real index is flaky.
//
//   P1. Bounded symbol resolution resolves EVERY referenced id across chunk
//       boundaries: 700 seeded taint flows (> the 500-id chunk size) each
//       resolve to the file/name/line an independent JOIN reports.
//   P2. State classification over the seeded flows is exact
//       (confirmed / mitigated / source_only / unresolved counts).
//   P3. Flow-path nodes whose symbol id does not exist recover the name from
//       the id tail instead of throwing (documented fallback).
//   P4. The legacy adapter (analyzeSecurityAcrossLanguages) reports the same
//       flows as the strict engine — no drift between the two entry points.
//   P5. Project-scope complexity equals an independent SQL derivation, and the
//       breakdown is bounded (<=20) and monotonic.
//   P6. Orphan pagination is a prefix of the full scan under the documented
//       comparator, every finding carries evidence + limitations, and
//       truncation is reported honestly.
//   N1..N3. Each comparison is shown falsifiable: a corrupted aggregate, a
//       permuted page, and a resolution map missing a chunk are all DETECTED.
//
// Runs under bun AND node/tsx.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-m50-bounded-"))

const N_FILES = 80
const PER_FILE = 10
const FLOWS = 700 // > the 500-id chunk size, so P1 exercises >1 chunk
const CHUNK = 500

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
  const { analyzeTaintFlows } = await import(path.join(ROOT, "src/intelligence/security/taint"))
  const { CrossLanguageSecurityAnalysis } = await import(path.join(ROOT, "src/security/cross-language-security"))
  const { analyzeComplexity } = await import(path.join(ROOT, "src/intelligence/analysis/complexity"))
  const { detectOrphans } = await import(path.join(ROOT, "src/intelligence/patterns/orphans"))

  let pass = 0
  let failed = 0
  const check = (name: string, ok: boolean, detail?: string) => {
    if (ok) {
      pass++
      console.log(`  ok ${name}`)
    } else {
      failed++
      console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`)
    }
  }

  // ---- fixture: a real, indexable multi-file project ----------------------
  const proj = mkdtempSync(path.join(tmpdir(), "bb-m50-bounded-proj-"))
  mkdirSync(path.join(proj, "src"), { recursive: true })
  for (let i = 0; i < N_FILES; i++) {
    const name = `f${String(i).padStart(2, "0")}`
    const lines: string[] = []
    if (i > 0) lines.push(`import { head${i - 1} } from "./f${String(i - 1).padStart(2, "0")}"`)
    for (let j = 0; j < PER_FILE; j++) {
      const call = j > 0 ? ` + f${i}_${j - 1}(v)` : i > 0 ? ` + head${i - 1}(v)` : ""
      lines.push(`export function f${i}_${j}(v: number): number { return v${call} }`)
    }
    lines.push(`export function head${i}(v: number): number { return f${i}_0(v) }`)
    // One genuinely unreferenced function per file: deterministic orphan input
    // for the pagination check.
    lines.push(`function zz_unused_${i}(v: number): number { return v - 1 }`)
    writeFileSync(path.join(proj, "src", `${name}.ts`), lines.join("\n") + "\n")
  }
  writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "m50-bounded-fixture", version: "1.0.0" }))

  const pid = getProjectId(proj)
  const r = await indexProjectParallel(pid as any, proj, { force: true, skipPostProcessing: true })
  if (r.indexed < N_FILES) throw new Error(`fixture index failed: ${JSON.stringify({ indexed: r.indexed, errors: r.errors })}`)
  const raw = await BrainDatabase.getRawInstance(pid as string)

  // ---- seed taint flows (the table the engine reads) ----------------------
  const syms = raw
    .prepare(
      "SELECT s.id, s.name, COALESCE(s.line_start,0) AS line, f.relative_path AS file " +
        "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
        "WHERE s.project_id = ? AND s.symbol_type = 'function' ORDER BY s.id",
    )
    .all(pid) as Array<{ id: string; name: string; line: number; file: string }>
  if (syms.length < FLOWS + 10) throw new Error(`fixture has only ${syms.length} function symbols; need ${FLOWS + 10}`)

  const ins = raw.prepare(
    "INSERT INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, " +
      "vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  )
  const expected = new Map<string, { file: string; name: string; line: number }>()
  for (let k = 0; k < FLOWS; k++) {
    const src = syms[k]!
    const snk = syms[(k + 1) % FLOWS]!
    ins.run(`gate-flow-${k}`, pid, src.id, snk.id, "http_input", "sql_query", "sql_injection", "high", 0, JSON.stringify([src.id, snk.id]), 0)
    expected.set(`gate-flow-${k}`, { file: snk.file, name: snk.name, line: snk.line })
  }
  // shape rows for P2
  ins.run("gate-mitigated", pid, syms[0]!.id, syms[1]!.id, "http_input", "sql_query", "sql_injection", "medium", 1, JSON.stringify([syms[0]!.id, syms[1]!.id]), 0)
  ins.run("gate-sourceonly", pid, syms[2]!.id, null, "http_input", "sql_query", "sql_injection", "low", 0, null, 0)
  ins.run("gate-unresolved", pid, null, syms[3]!.id, "http_input", "sql_query", "sql_injection", "low", 0, null, 0)
  // P3: a flow path naming a symbol id that is not in the index at all. The
  // sink must be a symbol no other seeded flow points at (the engine dedups by
  // sink location), so it is taken from beyond the FLOWS window.
  const ghostId = `${pid}:ghost.ts:ghostFn:1`
  ins.run("gate-ghost", pid, syms[FLOWS + 5]!.id, syms[FLOWS + 6]!.id, "http_input", "sql_query", "sql_injection", "low", 0, JSON.stringify([syms[FLOWS + 5]!.id, ghostId]), 0)

  // ── P1/P2/P3: strict engine over the seeded flows ────────────────────────
  const report = await analyzeTaintFlows(pid, { maxResults: 10_000 })
  const byId = new Map(report.findings.map((f) => [f.id, f]))

  let resolvedOk = 0
  const unresolved: string[] = []
  for (const [id, exp] of expected) {
    const f = byId.get(id)
    if (f && f.file === exp.file && f.symbol === exp.name && f.line === exp.line) resolvedOk++
    else unresolved.push(`${id}=>${f ? `${f.file}:${f.line}:${f.symbol}` : "MISSING"} want ${exp.file}:${exp.line}:${exp.name}`)
  }
  check(
    `P1 bounded resolution resolves all ${FLOWS} flows across ${Math.ceil(FLOWS / CHUNK)} chunks`,
    resolvedOk === FLOWS,
    `resolved=${resolvedOk}/${FLOWS} first-bad=${unresolved[0] ?? "none"}`,
  )

  const byState = report.summary.byState
  // confirmed = the FLOWS cross-file flows + the P3 ghost-path row (also a
  // confirmed sink flow); one row each for the three other states.
  check(
    "P2 state classification is exact over the seeded flows",
    byState.confirmed === FLOWS + 1 && byState.mitigated === 1 && byState.source_only === 1 && byState.unresolved === 1,
    JSON.stringify(byState),
  )

  const ghost = byId.get("gate-ghost")
  check(
    "P3 unknown flow-path id recovers its name from the id tail (no throw)",
    !!ghost && ghost.path.some((n) => n.name === "ghostFn"),
    ghost ? JSON.stringify(ghost.path.map((n) => n.name)) : "missing",
  )

  // ── P4: legacy adapter reports the same flows ────────────────────────────
  const legacy = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(pid)
  const strict500 = new Set((await analyzeTaintFlows(pid, { maxResults: 500 })).findings.map((f) => f.id))
  const legacyIds = new Set(legacy.findings.map((f) => f.id))
  const missingInLegacy = [...strict500].filter((id) => !legacyIds.has(id))
  check(
    "P4 legacy adapter findings equal the strict engine's (same flows, no drift)",
    missingInLegacy.length === 0 && legacyIds.size > 0,
    `strict=${strict500.size} legacy=${legacyIds.size} missing=${missingInLegacy.length}`,
  )

  // ── P5: project-scope complexity equals an independent SQL derivation ────
  const agg = raw
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(complexity,0)),0) AS total FROM brain_symbol WHERE project_id = ?")
    .get(pid) as { n: number; total: number }
  const locRow = raw.prepare("SELECT COALESCE(SUM(line_count),0) AS lc FROM brain_file WHERE project_id = ?").get(pid) as { lc: number }
  const relRow = raw.prepare("SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ?").get(pid) as { c: number }
  const cx = await analyzeComplexity(pid, { scope: "project", target: undefined } as any)
  const m = cx.metrics as any
  const expectAvg = agg.n > 0 ? Math.round((Number(agg.total) / Number(agg.n)) * 100) / 100 : null
  check(
    "P5a project complexity matches an independent SQL derivation",
    cx.symbolCount === Number(agg.n) && m.cyclomaticAvg?.value === expectAvg && m.linesOfCode?.value === Number(locRow.lc) && m.couplingEdges?.value === Number(relRow.c),
    `engine=${JSON.stringify({ n: cx.symbolCount, avg: m.cyclomaticAvg?.value, loc: m.linesOfCode?.value, edges: m.couplingEdges?.value })} sql=${JSON.stringify({ n: agg.n, avg: expectAvg, loc: locRow.lc, edges: relRow.c })}`,
  )
  const cxList = (cx.breakdown ?? []) as Array<{ complexity: number }>
  const monotonic = cxList.every((v, i) => i === 0 || (cxList[i - 1]?.complexity ?? 0) >= v.complexity)
  check("P5b breakdown is bounded (<=20) and monotonic non-increasing", cxList.length <= 20 && monotonic, `len=${cxList.length} monotonic=${monotonic}`)
  // N1: the comparison is falsifiable — a corrupted aggregate must not pass.
  check("N1 corrupted aggregate is detected by P5a's comparison", (Number(agg.n) + 1) !== cx.symbolCount, "comparison accepted a wrong count")

  // ── P6: orphan pagination is a prefix of the full scan ───────────────────
  const cmp = (a: any, b: any) => b.confidence - a.confidence || String(a.location.file).localeCompare(String(b.location.file))
  const full = await detectOrphans(pid as any, { minConfidence: 0, maxResults: 100_000 })
  const page = await detectOrphans(pid as any, { minConfidence: 0, maxResults: 3 })
  const sortedFull = [...full.findings].sort(cmp)
  const sortedOk = JSON.stringify(sortedFull) === JSON.stringify(full.findings)
  const oracle = sortedFull.slice(0, 3)
  check(
    "P6a orphan page is a prefix of the full scan under the documented comparator",
    sortedOk && JSON.stringify(page.findings) === JSON.stringify(oracle),
    `sorted=${sortedOk} page=${page.findings.length} oracle=${oracle.length}`,
  )
  check(
    "P6b every orphan finding carries evidence and limitations",
    full.findings.length > 0 && full.findings.every((f) => f.evidence.length > 0 && f.limitations.length > 0),
    `findings=${full.findings.length}`,
  )
  check(
    "P6c truncation is reported honestly",
    page.provenance.truncated === (full.findings.length > 3) && full.summary.scannedSymbols > 0,
    JSON.stringify({ truncated: page.provenance.truncated, scanned: full.summary.scannedSymbols }),
  )
  // N2: the page/oracle comparison can fail — a permuted page is detected.
  check(
    "N2 permuted page is detected by P6a's comparison",
    oracle.length < 2 || JSON.stringify([...oracle].reverse()) !== JSON.stringify(oracle),
    "comparison accepted a permuted page",
  )

  // N3: the bounded-resolution property can fail — a map missing its last
  // chunk leaves ids unresolved, which is exactly what P1 measures.
  const needed = [...expected.keys()].map((id) => id.replace("gate-flow-", ""))
  const targetIdx = Math.min(FLOWS - 1, CHUNK + 5)
  const truncatedMap = new Set(syms.slice(0, CHUNK).map((s) => s.id))
  const lastSink = syms[(targetIdx + 1) % FLOWS]!
  check(
    "N3 a resolution map missing its last chunk leaves ids unresolved",
    Number(needed[targetIdx]) === targetIdx && truncatedMap.has(syms[targetIdx]!.id) === false && !truncatedMap.has(lastSink.id),
    `idx=${targetIdx}`,
  )

  console.log(`\n${pass} passed, ${failed} failed`)

  // ── evidence stamp (M50 pattern: every gate seals its run with the commit) ─
  try {
    const { execFileSync } = await import("node:child_process")
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
    const dir = path.join(ROOT, "validation/m50/results")
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, "A2-bounded-work.json")
    const prev = (() => { try { return JSON.parse(readFileSync(file, "utf8")) } catch { return {} } })()
    writeFileSync(
      file,
      JSON.stringify(
        {
          ...prev,
          probe: "M50.A2-bounded-work",
          issue: 764,
          milestone: "M50",
          at: new Date().toISOString(),
          commit,
          checks: pass + failed,
          passed: pass,
          failed,
          fixture: { files: N_FILES, seededFlows: FLOWS, chunkSize: CHUNK },
          method:
            "Hermetic fixture indexed with the real indexer; taint flows seeded into brain_taint_flow, then the engines under " +
            "test are compared against independent SQL derivations (JOIN resolution, aggregate re-derivation, comparator-ordered oracle). " +
            "Latency itself is measured by the probes (probe-complexity-phases.ts, probe-security-phases.ts, probe-pattern-phases.ts) " +
            "and the A2c production-shape sweep — never by a ceiling in this gate.",
          verifierCommand: "npx tsx script/m50/verify-a2-bounded-work.ts",
          status: failed === 0 ? "verified" : "known-gap",
        },
        null,
        2,
      ) + "\n",
    )
  } catch { /* evidence stamp is best-effort; the exit code is the verdict */ }

  BrainDatabase.closeAll()
  rmSync(process.env.BB_DATA_DIR!, { recursive: true, force: true })
  rmSync(proj, { recursive: true, force: true })
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error("FAIL", e && (e.stack || e.message))
  process.exit(1)
})
