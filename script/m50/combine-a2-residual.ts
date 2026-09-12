// script/m50/combine-a2-residual.ts — M50.A2 residual evidence combiner.
//
// Derives validation/m50/results/A2-residual.json from the artifacts that
// MEASURED the work — never from prose. Every number below is read out of a
// probe receipt or a harness case file, and the status is computed:
//
//   * complexity  A1-case-8  → A2c-case-8   (production-shape p50)
//   * security    A1-case-14 → A2c-case-14
//   * patterns    A1-case-13 → A2c-case-13
//   * parity      the three phase probes' own parity/digest flags must hold
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
  { name: "bb_analyze complexity", idx: 8, probe: "A2-complexity-parity.json", parity: (p: any) => checkAll(p?.parity) },
  { name: "bb_security", idx: 14, probe: "A2-security-phases.json", parity: (p: any) => p?.parity?.equal === true && p?.prevEngineDigestMatch === true },
  { name: "bb_patterns scope=all", idx: 13, probe: "A2-pattern-phases.json", parity: (p: any) => p?.prevDigestMatch === true },
] as const

function checkAll(flags: Record<string, boolean> | undefined): boolean {
  if (!flags) return false
  const values = Object.values(flags)
  return values.length > 0 && values.every((v) => v === true)
}

const rows: Array<Record<string, unknown>> = []

for (const t of TOOLS) {
  const before = caseP50("A1", t.idx)
  const after = caseP50("A2c", t.idx)
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
          : "Orphan candidates are lightweight sort keys and finding objects are built only for the returned page, with the path predicates memoized per file; parity = the scan's finding digest is byte-identical to the pre-fix run.",
  })
}

// Honest residue: what is still above the one-second line, straight from the
// comparison artifact rather than restated.
const compare = readJson("A2c-latency-compare.json")
const stillNotOk = Array.isArray(compare?.table)
  ? (compare.table as Array<{ tool: string; after?: { verdict?: string } }>)
      .filter((r) => r.after?.verdict && r.after.verdict !== "OK")
      .map((r) => `${r.tool}: ${r.after!.verdict}`)
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
  },
  verifierCommand: "bun run script/m50/combine-a2-residual.ts",
  status: checks.length - pass === 0 ? "verified" : "known-gap",
}

writeFileSync(path.join(R, "A2-residual.json"), JSON.stringify(out, null, 2) + "\n")
console.log(JSON.stringify({ status: out.status, passed: out.passed, failed: out.failed, rows, stillNotOk }, null, 2))
