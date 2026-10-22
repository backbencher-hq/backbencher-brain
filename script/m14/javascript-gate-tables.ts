/**
 * THE GATE LOG'S TABLES — ONE PARSER, TWO CONSUMERS.
 *
 * WHY THIS FILE EXISTS. The lane needs TWO things from a gate log: the cell reader wants TABLE 1's
 * per-type rows, and the twin comparator (L-16) wants to know whether the twin's TABLE 1 is
 * BYTE-IDENTICAL to the shipping gate's. **⇒ IF THOSE TWO READ THE LOG WITH TWO PARSERS, A
 * DISAGREEMENT BETWEEN THEM COULD BE A PARSER DIFFERENCE RATHER THAN A TWIN DIFFERENCE — and a
 * comparator whose own disagreement is ambiguous cannot decide a disagreement ✓✓.**
 *
 * ⇒ SO THERE IS ONE PARSER, HERE, AND BOTH CONSUMERS IMPORT IT ✓✓.
 *
 * WHAT IT PARSES, AND NOTHING ELSE:
 *   · TABLE 1 — PER PROJECT, the verdict's scope: one row per relationship type plus a TOTAL row.
 *   · TABLE 2 — POOLED, the pre-tie-break view over a DIFFERENT key space (the corpus pool, not
 *     the project). It is printed for the reader and is NEVER the tie-break's counter.
 *   · THE BINDING INTENT TABLE — which branch each row was ASKED.
 *   · THE VERDICT LINE — the gate's OWN residual, for the closure assertion.
 *
 * IT PARSES AND IT DOES NOT JUDGE: a log it cannot understand is an EXPLICIT FAILURE with a
 * non-zero exit, never a partial answer.
 */
import { readFileSync } from "node:fs"

export const COLS = [
  "type", "edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved",
  "extOK", "extQ", "extFAIL", "bindOK", "bindQ", "bindFAIL", "causeOK", "causeFAIL",
] as const

export type TableRow = Record<(typeof COLS)[number], string | number>
export type IntentRow = {
  type: string; edges: number; intended: number; sameFileUnproven: number
  arbitraryTwin: number; nothingAnywhere: number; noTarget: number
}

export type GateTables = {
  logPath: string
  table1: TableRow[]
  total1: TableRow | null
  total2: Record<string, number> | null
  intent: IntentRow[]
  intentTotal: IntentRow | null
  verdictLine: string | null
  gateResidual: number
  gateAmbiguous: number
  gateUnresolved: number
  claimCarry: number
}

/** Parse a gate log. THROWS with a clear message when the log is not a gate report. */
export function parseGateLog(logPath: string): GateTables {
  const LOG = readFileSync(logPath, "utf8")
  const lines = LOG.split("\n")

  // ── TABLE 1 — PER PROJECT, the verdict's scope ────────────────────────────────────────────────
  const T1_HEADER = lines.findIndex((l) => l.startsWith("TABLE 1 —"))
  if (T1_HEADER < 0) throw new Error(`NO TABLE 1 in ${logPath} — this log is not a gate report.`)
  const table1: TableRow[] = []
  let total1: TableRow | null = null
  for (let i = T1_HEADER; i < lines.length; i++) {
    const l = lines[i]
    if (i === T1_HEADER) continue // the "TABLE 1 —" banner itself
    if (i === T1_HEADER + 1) continue // the column header
    if (/^-----/.test(l)) continue
    if (!l.trim()) continue
    const parts = l.trim().split(/\s+/)
    if (parts[0] === "TOTAL") {
      const nums = parts.slice(1).map(Number)
      const r: any = { type: "TOTAL" }
      COLS.slice(1).forEach((c, k) => (r[c] = nums[k]))
      total1 = r
      break
    }
    if (!/^[a-z_]+$/.test(parts[0])) break
    const nums = parts.slice(1).map(Number)
    const r: any = { type: parts[0] }
    COLS.slice(1).forEach((c, k) => (r[c] = nums[k]))
    table1.push(r)
  }
  if (!total1) throw new Error(`NO TOTAL row in TABLE 1 of ${logPath}`)

  // ── TABLE 2 — POOLED, the pre-tie-break view over a DIFFERENT key space ───────────────────────
  let total2: Record<string, number> | null = null
  const T2 = lines.findIndex((l) => l.startsWith("TABLE 2 —"))
  if (T2 >= 0) {
    for (let i = T2; i < lines.length; i++) {
      const parts = lines[i].trim().split(/\s+/)
      if (parts[0] === "TOTAL") {
        const nums = parts.slice(1).map(Number)
        total2 = { edges: nums[0], resolved: nums[1], ambDecl: nums[2], unresolved: nums[3], extFAIL: nums[4] }
        break
      }
    }
  }

  // ── THE INTENT TABLE — the join's own price ──────────────────────────────────────────────────
  const intent: IntentRow[] = []
  let intentTotal: IntentRow | null = null
  {
    const h = lines.findIndex((l) => l.startsWith("BINDING INTENT"))
    if (h >= 0) {
      for (let i = h; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/)
        const isRow = parts.length === 7 && parts.slice(1).every((x) => /^\d+$/.test(x))
        if (parts[0] === "TOTAL" && isRow) {
          intentTotal = { type: "TOTAL", edges: +parts[1], intended: +parts[2], sameFileUnproven: +parts[3], arbitraryTwin: +parts[4], nothingAnywhere: +parts[5], noTarget: +parts[6] }
          break
        }
        if (/^[a-z_]+$/.test(parts[0]) && isRow) {
          intent.push({ type: parts[0], edges: +parts[1], intended: +parts[2], sameFileUnproven: +parts[3], arbitraryTwin: +parts[4], nothingAnywhere: +parts[5], noTarget: +parts[6] })
        }
      }
    }
  }

  // ── THE VERDICT LINE — the gate's OWN residual ───────────────────────────────────────────────
  const verdictLine = lines.find((l) => l.startsWith("VERDICT:")) ?? null
  const gateResidual = verdictLine ? Number((verdictLine.match(/—\s*(\d+)\s+ambiguous\/unresolved/) ?? [])[1] ?? -1) : -1
  const gateAmbiguous = verdictLine ? Number((verdictLine.match(/(\d+)\s+ambiguous \+/) ?? [])[1] ?? -1) : -1
  const gateUnresolved = verdictLine ? Number((verdictLine.match(/\+\s*(\d+)\s+unresolved/) ?? [])[1] ?? -1) : -1

  // ── THE CLAIM-CARRYING SHARE ─────────────────────────────────────────────────────────────────
  const claimShare = lines.find((l) => l.includes("ambiguous edge(s) carry a claim")) ?? null
  const claimCarry = claimShare ? Number((claimShare.match(/(\d+)\s+of this lane's/) ?? [])[1] ?? -1) : -1

  return {
    logPath, table1, total1, total2, intent, intentTotal, verdictLine,
    gateResidual, gateAmbiguous, gateUnresolved, claimCarry,
  }
}

/**
 * THE COMPARISON L-16 ASKS FOR: are the two TABLE 1 blocks IDENTICAL?
 *
 * ⇒ THE COMPARISON IS ON THE ROWS, NOT ON THE RAW TEXT ✓✓ — the raw text carries a timestamp and
 * a verdict line that are allowed to differ, and a byte comparison of the WHOLE log would report a
 * disagreement that is not one ✓✓. **⇒ THE ROWS ARE WHAT THE TWIN IS CLAIMED TO REPRODUCE ✓✓.**
 *
 * ⇒ AND IT RETURNS THE DIFFERENCES, NAMED BY TYPE AND COLUMN ✓✓, so a disagreement is a
 * DIAGNOSIS and not a boolean ✓✓.
 */
export function diffTable1(a: GateTables, b: GateTables): { type: string; column: string; left: unknown; right: unknown }[] {
  const diffs: { type: string; column: string; left: unknown; right: unknown }[] = []
  const byType = (t: GateTables) => {
    const m = new Map<string, TableRow>()
    for (const r of t.table1) m.set(String(r.type), r)
    if (t.total1) m.set("TOTAL", t.total1)
    return m
  }
  const ma = byType(a)
  const mb = byType(b)
  const types = [...new Set([...ma.keys(), ...mb.keys()])].sort()
  for (const t of types) {
    const ra = ma.get(t)
    const rb = mb.get(t)
    if (!ra) { diffs.push({ type: t, column: "(row)", left: undefined, right: "PRESENT ONLY IN THE SECOND" }); continue }
    if (!rb) { diffs.push({ type: t, column: "(row)", left: "PRESENT ONLY IN THE FIRST", right: undefined }); continue }
    for (const c of COLS.slice(1)) {
      if (String(ra[c]) !== String(rb[c])) diffs.push({ type: t, column: c, left: ra[c], right: rb[c] })
    }
  }
  return diffs
}
