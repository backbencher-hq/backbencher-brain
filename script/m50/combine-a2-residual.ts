// script/m50/combine-a2-residual.ts — M50.A2 residual evidence combiner.
//
// Derives validation/m50/results/A2-residual.json from the artifacts that
// MEASURED the work — never from prose. Every number below is read out of a
// probe receipt or a harness case file, and the status is computed:
//
//   * complexity  A1-case-8  → A2c-case-8   (production-shape p50)
//   * security    A1-case-14 → A2c-case-14
//   * patterns    A1-case-13 → A2c-case-13
//   * test_gaps   A1-case-5  → A2d-case-5   (the second residual pass)
//   * parity      the four phase probes' own parity/digest flags must hold
//
// A missing receipt or a failed parity check downgrades the status to
// `known-gap` — the file cannot claim `verified` without its own evidence.
//
// Usage: bun run script/m50/combine-a2-residual.ts

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve("script/m50", "../..")
const R = path.join(ROOT, "validation/m50/results")

const readJson = (f: string): any | null => {
  const p = path.join(R, f)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, "utf8")) } catch { return null }
}

/** p50 of the single measured key in a harness case receipt. */
function caseP50(prefix: string, idx: number): { key: string; p50: number } | null {
  const j = readJson(`${prefix}-case-${idx}.json`)
  if (!j?.report) return null
  const measured = Object.entries(j.report as Record<string, { p50: number; n: number }>).filter(([, v]) => v && v.n > 0 && v.p50 >= 0)
  if (measured.length !== 1) return null
  const [key, v] = measured[0]!
  return { key, p50: v.p50 }
}

const TOOLS = [
  { name: "bb_analyze complexity", idx: 8, afterPrefix: "A2c", probe: "A2-complexity-parity.json", parity: (p: any) => checkAll(p?.parity) },
  { name: "bb_security", idx: 14, afterPrefix: "A2c", probe: "A2-security-phases.json", parity: (p: any) => p?.parity?.equal === true && p?.prevEngineDigestMatch === true },
  { name: "bb_patterns scope=all", idx: 13, afterPrefix: "A2c", probe: "A2-pattern-phases.json", parity: (p: any) => p?.prevDigestMatch === true },
  // Second residual pass (post-A2c): test_gaps reported every production symbol
  // as untested from a corpus of JSON fixtures, and built a finding object for
  // each of them before slicing to 200.
  { name: "bb_analyze test_gaps", idx: 5, afterPrefix: "A2d", probe: "A2-test-gaps-phases.json", parity: (p: any) => p?.prevReportDigestMatch === true },
] as const

function checkAll(flags: Record<string, boolean> | undefined): boolean {
  if (!flags) return false
  const values = Object.values(flags)
  return values.length > 0 && values.every((v) => v === true)
}

const rows: Array<Record<string, unknown>> = []

for (const t of TOOLS) {
  const before = caseP50("A1", t.idx)
  const after = caseP50(t.afterPrefix, t.idx)
  const probe = readJson(t.probe)
  const parityOk = t.parity(probe)
  const improved = !!before && !!after && after.p50 < before.p50
  rows.push({
    tool: t.name,
    harnessCase: t.idx,
    p50BeforeMs: before?.p50 ?? null,
    p50AfterMs: after?.p50 ?? null,
    speedup: before && after && after.p50 > 0 ? Math.round((before.p50 / after.p50) * 100) / 100 : null,
    parityProven: parityOk,
    improved,
    probeFile: `validation/m50/results/${t.probe}`,
    method:
      t.idx === 8
        ? "Project scope now aggregates in SQL and fetches only the top-20 breakdown rows; parity = identical metrics + same top-20 set."
        : t.idx === 14
          ? "Symbol resolution now fetches only the ids the taint rows reference (500-id chunks); parity = bounded map equals the full map for every referenced id AND the report digest is byte-identical to the pre-fix run."
          : t.idx === 5
            ? "Candidate gap keys are lightweight and finding objects are built only for the returned page; the test corpus is code-only and the exclusion is disclosed; parity = the full testGaps output (gaps + summary + truncated) is byte-identical to the pre-fix run."
            : "Orphan candidates are lightweight sort keys and finding objects are built only for the returned page, with the path predicates memoized per file; parity = the scan's finding digest is byte-identical to the pre-fix run.",
  })
}

// Honest residue: what is still above the one-second line, straight from the
// comparison artifact rather than restated.
const compare = readJson("A2c-latency-compare.json")
// A tool convicted in the A2c sweep may have been fixed by the second pass, but
// only a NEWER RECEIPT THAT MEASURES OK may withdraw the conviction — improving
// while staying above the one-second line is not an acquittal.
const OK_LINE_MS = 1000
const superseded = new Set(
  rows
    .filter((r) => r.improved === true && typeof r.p50AfterMs === "number" && (r.p50AfterMs as number) <= OK_LINE_MS)
    .map((r) => String(r.tool).replace(/ scope=all$/, " all")),
)
const stillNotOk = Array.isArray(compare?.table)
  ? (compare.table as Array<{ tool: string; after?: { verdict?: string } }>)
      .filter((r) => r.after?.verdict && r.after.verdict !== "OK")
      .filter((r) => !superseded.has(r.tool))
      .map((r) => `${r.tool}: ${r.after!.verdict}`)
  : null
const supersededConvictions = Array.isArray(compare?.table)
  ? (compare.table as Array<{ tool: string; after?: { verdict?: string } }>)
      .filter((r) => r.after?.verdict && r.after.verdict !== "OK" && superseded.has(r.tool))
      .map((r) => `${r.tool}: ${r.after!.verdict} (A2c) withdrawn — a newer receipt measures <= ${OK_LINE_MS}ms`)
  : null

let pass = 0
const checks: Array<{ name: string; ok: boolean; detail?: string }> = []
for (const r of rows) {
  checks.push({ name: `${r.tool}: measured faster AND parity-proven`, ok: r.parityProven === true && r.improved === true, detail: `${r.p50BeforeMs}ms -> ${r.p50AfterMs}ms` })
}
checks.push({ name: "every probed tool still has a receipt after the sweep", ok: rows.every((r) => r.p50AfterMs !== null) })
for (const c of checks) if (c.ok) pass++

const commit = (() => {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "" }
})()

const out = {
  probe: "M50.A2-residual",
  issue: 764,
  milestone: "M50",
  at: new Date().toISOString(),
  commit,
  checks: checks.length,
  passed: pass,
  failed: checks.length - pass,
  rows,
  residue: {
    note: "Tools still above the 1s 'OK' line after this work — declared, not excused.",
    stillNotOk,
    supersededConvictions,
  },
  verifierCommand: "bun run script/m50/combine-a2-residual.ts",
  status: checks.length - pass === 0 ? "verified" : "known-gap",
}

writeFileSync(path.join(R, "A2-residual.json"), JSON.stringify(out, null, 2) + "\n")
console.log(JSON.stringify({ status: out.status, passed: out.passed, failed: out.failed, rows, stillNotOk }, null, 2))
