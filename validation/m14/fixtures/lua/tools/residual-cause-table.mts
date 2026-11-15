/**
 * LUA RESIDUAL — NAMED CAUSES, read off a captured `incoming-gate.ts` log.
 *
 * ## Why this file exists
 *
 * The bar is "every ambiguous/unresolved edge attributed to a NAMED cause with a MEASURED count",
 * and the instrument that carries the counts is the gate's own report — TABLE 1, the marker-set
 * table, and the BINDING INTENT block. This tool does not count edges. It READS the gate's printed
 * numbers and does three things the gate does not:
 *
 *   1. CLOSURE, re-checked on what this file parsed. The gate prints the identity
 *      `resolved + amb + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + causeOK +
 *      causeFAIL = edges`, and a parser that silently drops a row would otherwise produce a cause
 *      table that does not add up. A non-zero gap is reported as a DEFECT IN THIS READER.
 *   2. THE NOT-RESOLVED CLASSES, RANKED, split by what the edges SHARE: the marker-set signature the
 *      gate grouped them under (metadata KEYS only — a value would shatter one marker into a
 *      signature per symbol it names).
 *   3. THE OWN-FILE LOWER BOUND, which is pure arithmetic on two of the gate's own tables and needs
 *      no further run:
 *
 *        sameFileUnproven ⊆ (resolved ∪ ambiguous)
 *
 *      because `classifyIntent` returns `sameFileUnproven` only when a declaration of the target
 *      exists in the EDGE'S OWN FILE, and an edge with no declaration anywhere is `unresolved` (or
 *      carries a claim, which is read only in that same `decls === 0` branch). So
 *
 *        |ambiguous ∩ ownFileAnswered| ≥ (sameFileUnproven + intended) − resolved
 *
 *      That is a LOWER bound, and its limit is stated in the output: "the own file answers" is not
 *      the same as "the own file answers UNIQUELY", which is what the resolver's own-file preference
 *      needs to be determinate. The unique-in-file split is the lane's lexical instrument's job
 *      (validation/m14/fixtures/lua/ambiguity-split.ts, B1/B2/B3), and this bound supports or
 *      contradicts its ruling; it does not replace it.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/lua/tools/residual-cause-table.mts <gate-log> [...more logs]
 *
 * Read-only; no corpus access, no parsing, no counting.
 */
import { readFileSync } from "node:fs"

const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
type Row = {
  type: string; edges: number; resolved: number; collRes: number; amb: number; ambKind: number
  unres: number; extOK: number; extQ: number; extFAIL: number
  bindOK: number; bindQ: number; bindFAIL: number; causeOK: number; causeFAIL: number
}
type Mark = { sig: string; resolved: number; amb: number; unres: number; extClaim: number; binding: number; cause: number }
type Intent = { intended: number; sameFile: number; twin: number; noDecl: number }

function parseLog(path: string): { rows: Row[]; marks: Mark[]; intent: Map<string, Intent>; total: Row | null; population: string[] } {
  const text = readFileSync(path, "utf8")
  const rows: Row[] = []
  const marks: Mark[] = []
  const intent = new Map<string, Intent>()
  const population: string[] = []
  let total: Row | null = null
  let section = ""
  for (const line of text.split("\n")) {
    const t = line.trim()
    if (t.startsWith("population:") || t.startsWith("excluded from that population") || t.startsWith("parse failures:")
      || t.startsWith("endpoint keys") || t.startsWith("empty results:") || t.startsWith("VERDICT")) population.push(t)
    if (t.startsWith("TABLE 1")) { section = "t1"; continue }
    if (t.startsWith("EDGES A MARKER SET EXPLAINS")) { section = "marks"; continue }
    if (t.startsWith("BINDING INTENT")) { section = "intent"; continue }
    if (t.startsWith("TABLE 2")) { section = "other"; continue }
    if (t.startsWith("AMBIGUOUS / UNRESOLVED TARGETS")) { section = "other"; continue }
    if (t.startsWith("extClaim =")) { section = "other"; continue }
    const parts = t.split(/\s+/)
    if (section === "t1" && parts.length === 15 && (TYPES.includes(parts[0]) || parts[0] === "TOTAL")) {
      const n = parts.slice(1).map((x) => Number(x.replace(/,/g, "")))
      if (n.some((x) => !Number.isFinite(x))) continue
      const r: Row = {
        type: parts[0], edges: n[0], resolved: n[1], collRes: n[2], amb: n[3], ambKind: n[4], unres: n[5],
        extOK: n[6], extQ: n[7], extFAIL: n[8], bindOK: n[9], bindQ: n[10], bindFAIL: n[11], causeOK: n[12], causeFAIL: n[13],
      }
      if (parts[0] === "TOTAL") total = r
      else rows.push(r)
      continue
    }
    // The marker table's rows: a signature (no spaces) then six numbers. The sig may contain `+`.
    if (section === "marks" && parts.length === 7) {
      const n = parts.slice(1).map((x) => Number(x.replace(/,/g, "")))
      if (n.some((x) => !Number.isFinite(x))) continue
      if (/^[a-zA-Z(]/.test(parts[0])) {
        marks.push({ sig: parts[0], resolved: n[0], amb: n[1], unres: n[2], extClaim: n[3], binding: n[4], cause: n[5] })
        continue
      }
    }
    // BINDING INTENT rows are `type edges intended sameFileUnproven arbitraryTwin noDeclaration` — SIX
    // tokens, and the first version of this reader required five, so it parsed no row at all and the
    // lower-bound section printed an empty table. A reader that silently matches nothing is the same
    // defect class as a probe that cannot fire.
    if (section === "intent" && parts.length === 6 && TYPES.includes(parts[0])) {
      const n = parts.slice(1).map((x) => Number(x.replace(/,/g, "")))
      if (n.some((x) => !Number.isFinite(x))) continue
      intent.set(parts[0], { intended: n[1], sameFile: n[2], twin: n[3], noDecl: n[4] })
    }
  }
  return { rows, marks, intent, total, population }
}

const w = (s: any, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
let bad = 0
for (const path of process.argv.slice(2)) {
  const { rows, marks, intent, total, population } = parseLog(path)
  console.log(`\n=== ${path}`)
  for (const p of population) console.log(`  ${p}`)
  if (rows.length === 0) { console.log("  FATAL: no TABLE 1 rows parsed"); bad++; continue }

  // CLOSURE — the reader's own self-test.
  console.log(`\nCLOSURE (re-checked on what THIS READER parsed — a dropped row must not produce a table that adds up):`)
  for (const r of [...rows, ...(total ? [total] : [])]) {
    const disp = r.resolved + r.amb + r.unres + r.extOK + r.extQ + r.extFAIL + r.bindOK + r.bindQ + r.bindFAIL + r.causeOK + r.causeFAIL
    if (disp !== r.edges) { console.log(`  ${w(r.type, 13)} ** GAP ${r.edges - disp} ** (${r.edges} vs ${disp})`); bad++ }
  }
  if (total) console.log(`  TOTAL ${total.edges} — every row closed${bad === 0 ? "" : " (see gaps above)"}`)

  // THE NAMED CAUSES, ranked by not-resolved, split by the marker keys they share.
  //
  // THE TYPE OF A MARKER ROW IS NOT PRINTED BY THE GATE, and this reader has to RECOVER it. The
  // table's header declares a `type` column; `printReport`'s `show()` emits `w(m.sig, …)` where the
  // header has `w("type", 14) + w("metadata KEYS on the edge", 52)`, so the signature occupies BOTH
  // columns and no row carries a type. The type is recoverable only from the emitter's own structure:
  // the rows are emitted in `ALL_TYPES` order, up to 5 per type (plus binding/cause-bearing sets), and
  // a type's rows SUM to that type's TABLE 1 `amb` and `unresolved`. So the attribution below is
  // arithmetic, not a guess, and every row it cannot attribute is REPORTED rather than filed under
  // the wrong type.
  //
  // Recorded as an instrument finding rather than worked around silently: a lane instructed to "split
  // the residual by the marker table" cannot read the type off the table, which is the same family as
  // TABLE 1's header/emitter mismatch (HANDOFF §5d) — and it is why the marker table's closure row
  // added in `63063d378` matters: without the type, the only way to know a row was omitted is that
  // the arithmetic stops matching.
  const attributed: { sig: string; type: string; amb: number; unres: number }[] = []
  {
    let cursor = 0
    for (const t of TYPES) {
      const row = rows.find((r) => r.type === t)
      if (!row) continue
      let a = 0
      let u = 0
      while ((a < row.amb || u < row.unres) && cursor < marks.length) {
        const m = marks[cursor]
        a += m.amb
        u += m.unres
        attributed.push({ sig: m.sig, type: t, amb: m.amb, unres: m.unres })
        cursor++
        if (a > row.amb || u > row.unres) break
      }
    }
    for (let i = cursor; i < marks.length; i++) {
      attributed.push({ sig: marks[i].sig, type: "UNATTRIBUTED", amb: marks[i].amb, unres: marks[i].unres })
    }
  }
  const unattributed = attributed.filter((m) => m.type === "UNATTRIBUTED")
  console.log(`\nNOT-RESOLVED BY TYPE, split by the marker signature the gate grouped it under`)
  console.log(`(type column RECOVERED by arithmetic — the gate's marker table prints no type; ${unattributed.length} row(s) unattributable):`)
  const sigW = Math.max(52, ...attributed.map((m) => m.sig.length + 2))
  console.log(`  ${w("type", 13)} ${w("marker signature", sigW)} ${w("amb", 9)} ${w("unres", 9)} ${w("notRes", 9)} ${w("share", 8)}`)
  const all = attributed.map((m) => ({ ...m, notRes: m.amb + m.unres })).sort((a, b) => b.notRes - a.notRes)
  const sum = all.reduce((n, m) => n + m.notRes, 0)
  for (const m of all) {
    if (m.notRes === 0) continue
    console.log(`  ${w(m.type, 13)} ${w(m.sig, sigW)} ${w(m.amb, 9)} ${w(m.unres, 9)} ${w(m.notRes, 9)} ${w(((m.notRes / sum) * 100).toFixed(1) + "%", 8)}`)
  }
  console.log(`  ${w("TOTAL", 13)} ${w("", sigW)} ${w(all.reduce((n, m) => n + m.amb, 0), 9)} ${w(all.reduce((n, m) => n + m.unres, 0), 9)} ${w(sum, 9)}`)
  console.log(`  NOTE: ${marks.length} marker row(s) parsed, ${attributed.length - unattributed.length} attributed. The gate prints up to 5 sets per type by amb+unres plus every binding/cause-bearing set, and discloses any omission in its own closure row.`)

  // THE OWN-FILE LOWER BOUND — arithmetic on the gate's own two tables.
  console.log(`\nOWN-FILE LOWER BOUND — |ambiguous ∩ ownFileAnswered| >= (sameFileUnproven + intended) - resolved, per type:`)
  console.log(`  ${w("type", 13)} ${w("amb", 9)} ${w("sameFile", 9)} ${w("intended", 9)} ${w("resolved", 9)} ${w(">= lower", 9)} ${w("of amb", 8)}`)
  for (const r of rows) {
    const it = intent.get(r.type)
    if (!it) continue
    const lower = Math.max(0, it.sameFile + it.intended - r.resolved)
    console.log(`  ${w(r.type, 13)} ${w(r.amb, 9)} ${w(it.sameFile, 9)} ${w(it.intended, 9)} ${w(r.resolved, 9)} ${w(lower, 9)} ${w(r.amb === 0 ? "-" : ((lower / r.amb) * 100).toFixed(1) + "%", 8)}`)
  }
  console.log(`  LIMIT: "the own file answers" is not "the own file answers UNIQUELY". A name declared twice in`)
  console.log(`  the edge's own file is still a collision the resolver's own-file preference cannot settle, so this`)
  console.log(`  is a lower bound on the determinate class, not an estimate of it. The unique-in-file split is the`)
  console.log(`  lexical instrument's question (ambiguity-split.ts B1/B2/B3).`)
}
process.exit(bad === 0 ? 0 : 1)
