// script/m22/ledger-shape.ts — the ONE description of validation/m22/ledger.json.
//
// WHY THIS EXISTS. Fourteen M22 gates each opened the ledger like this:
//
//   const led = JSON.parse(readFileSync(LEDGER_PATH, "utf8"))
//   const e = Object.values(led.issues).find((i: any) => i.code === "C1")
//   if (e) { e.status = finalStatus; e.passed = passed; ... }
//
// `JSON.parse` returns `any`, so `led.issues` is `any`, and `Object.values` on an
// `any` resolves through its `values(o: {}): any[]` overload — the element type
// comes out `{}`. Every write below then reported "Property 'status' does not exist
// on type '{}'". Five diagnostics a file, across fourteen files, all from the same
// untyped read.
//
// verify-g1-governance.ts already declared the shape privately. This lifts it to
// one place so all fourteen share it and cannot drift apart.
//
// The shape is checked against validation/m22/ledger.json, whose issues map is
// keyed by GitHub issue number and carries: code, title, evidenceFile, status,
// passed, failed, commit.

export interface M22Issue {
  code: string
  title: string
  evidenceFile: string | null
  status: string
  passed: number | null
  failed: number | null
  commit: string | null
  /** Tolerated by the ledger writers; not read by every consumer. */
  evidence?: unknown
}

export interface M22Ledger {
  milestone: string
  milestoneNumber: number
  policy?: Record<string, unknown>
  families?: Record<string, unknown>
  /** Keyed by GitHub issue number, not by code. */
  issues: Record<string, M22Issue>
  closureBenchmark?: Record<string, unknown>
  e2eSweep?: Record<string, unknown>
}

/** Parse ledger text into the declared shape. The single place it is asserted. */
export function parseM22Ledger(text: string): M22Ledger {
  return JSON.parse(text) as M22Ledger
}

/**
 * The gate's own row, found by `code`.
 *
 * Deliberately not `Object.values(...)`: that overload is what produced the `{}`
 * element type in the first place. This indexes the map by value instead, which
 * keeps the element typed as M22Issue all the way through.
 */
export function findIssueByCode(ledger: M22Ledger, code: string): M22Issue | undefined {
  for (const row of Object.values(ledger.issues)) {
    if (row?.code === code) return row
  }
  return undefined
}