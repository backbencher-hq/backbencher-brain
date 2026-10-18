/**
 * cpp-index-arm-compare — the DECOMPOSED delta between the cpp project-index arms (task-22), computed
 * from the gate's own output files so no number is retyped.
 *
 * THE ARMS THIS COMPARES (whole population, 7,435 admitted files / 31 repos):
 *   A      no --index, no consumption flag            (the accepted D1–D6 baseline shape)
 *   B-off  --index, no consumption flag               (the NAME-MODEL arm: the index is built and
 *                                                      handed to the analyzer, which ignores it)
 *   B-on   --index + BB_CPP_INDEX_CONSUME=1           (metadata-only consumption: declaration
 *                                                      provenance, heritage KIND, truthful
 *                                                      metadata.owner for qualified calls)
 *
 * PRE-COMMITTED SIGNALS (a failure here is a STOP, not a note):
 *   · B-off's TABLE must equal A's (the index alone changes no column — ruling B's delta-0 name-model
 *     arm is CORRECT, not a defect);
 *   · TOTAL edges must be identical across all arms (consumption is metadata-only);
 *   · extFAIL / bindFAIL / causeFAIL must stay 0;
 *   · arbitraryTwin must NOT rise from A to B-on;
 *   · closure identity must hold inside each arm.
 *
 * Usage: bun run script/m14/cpp-index-arm-compare.ts --a=<out> --b-off=<out> --b-on=<out> [--json=<path>]
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const A_PATH = argOf("--a")
const BOFF_PATH = argOf("--b-off")
const BON_PATH = argOf("--b-on")
const JSON_OUT = argOf("--json")
if (!A_PATH || !BOFF_PATH || !BON_PATH) {
  console.error("usage: bun run script/m14/cpp-index-arm-compare.ts --a=<out> --b-off=<out> --b-on=<out> [--json=<path>]")
  process.exit(2)
}

type Table = Record<string, Record<string, number>>
const parse = (p: string) => {
  const lines = fs.readFileSync(p, "utf8").split("\n")
  // THE OWNER CHANNEL PRINTS ON STDERR on purpose (stdout is the report, parsers read it
  // positionally), so the channel's own line is read from the sibling .err file when the caller
  // passes the gate's captured streams. A missing .err is an empty channel line, not an error.
  const errPath = p.replace(/\.out$/, ".err")
  const errLines = fs.existsSync(errPath) ? fs.readFileSync(errPath, "utf8").split("\n") : []
  const find = (pred: (l: string) => boolean) => { for (let i = 0; i < lines.length; i++) if (pred(lines[i])) return i; return -1 }
  const i1 = find((l) => l.startsWith("TABLE 1 — PER PROJECT"))
  const i2 = find((l) => l.startsWith("collRes = of"))
  const i3 = find((l) => l.includes("sameFileUnproven") && l.trim().startsWith("type"))
  const pop = lines.filter((l) => l.startsWith("population:") || l.startsWith("project index:"))
  const hdr = lines[i1 + 1].trim().split(/\s+/)
  const table: Table = {}
  for (const line of lines.slice(i1 + 2, i2)) {
    const p2 = line.trim().split(/\s+/)
    if (p2.length !== hdr.length) continue
    if (!/^[a-z_]+$/.test(p2[0])) continue
    const row: Record<string, number> = {}
    for (let k = 1; k < hdr.length; k++) row[hdr[k]] = Number(p2[k])
    table[p2[0]] = row
  }
  const intent: Record<string, Record<string, number>> = {}
  const ihdr = lines[i3].trim().split(/\s+/)
  for (let i = i3 + 1; i < lines.length; i++) {
    const p2 = lines[i].trim().split(/\s+/)
    if (p2.length !== ihdr.length || !/^[a-z_]+$/.test(p2[0])) continue
    const row: Record<string, number> = {}
    for (let k = 1; k < ihdr.length; k++) row[ihdr[k]] = Number(p2[k])
    intent[p2[0]] = row
  }
  const ownerLine = errLines.find((l) => l.includes("owner channel (production rule, modelled)")) ?? ""
  const ownerVsName = errLines.find((l) => l.includes("owner channel vs name model")) ?? ""
  const owner = {
    rows: Number(ownerLine.match(/owner channel \(production rule, modelled\): (\d+) row/)?.[1] ?? 0),
    resolved: Number(ownerLine.match(/resolved (\d+)/)?.[1] ?? 0),
    declined: Number(ownerLine.match(/declined (\d+)/)?.[1] ?? 0),
    resolvedButNameSaidAmbiguous: Number(ownerVsName.match(/(\d+) row\(s\) the name count called ambiguous\/unresolved and the channel resolves/)?.[1] ?? 0),
    declinedButNameWouldResolve: Number(ownerVsName.match(/(\d+) row\(s\) the channel DECLINED/)?.[1] ?? 0),
    line: ownerLine.trim(),
  }
  const verdict = lines.find((l) => l.startsWith("VERDICT: FAIL")) ?? ""
  return { table, intent, owner, verdict, pop }
}

const A = parse(A_PATH)
const Boff = parse(BOFF_PATH)
const Bon = parse(BON_PATH)
const COLS = ["edges", "resolved", "amb(decl)", "unresolved", "bindOK", "bindFAIL", "extOK", "extFAIL", "causeOK", "causeFAIL"]
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

const sumCol = (t: Table, col: string) => Object.values(t).reduce((a, r) => a + (r[col] ?? 0), 0)
const totals = { A: Object.fromEntries(COLS.map((c) => [c, sumCol(A.table, c)])), Boff: Object.fromEntries(COLS.map((c) => [c, sumCol(Boff.table, c)])), Bon: Object.fromEntries(COLS.map((c) => [c, sumCol(Bon.table, c)])) }
const intentTotals = (int: Record<string, Record<string, number>>, col: string) => Object.entries(int).filter(([k]) => k !== "TOTAL").reduce((a, [, r]) => a + (r[col] ?? 0), 0)
const intentA = { arbitraryTwin: intentTotals(A.intent, "arbitraryTwin"), sameFileUnproven: intentTotals(A.intent, "sameFileUnproven"), nothingAnywhere: intentTotals(A.intent, "nothingAnywhere"), intended: intentTotals(A.intent, "intended") }
const intentBon = { arbitraryTwin: intentTotals(Bon.intent, "arbitraryTwin"), sameFileUnproven: intentTotals(Bon.intent, "sameFileUnproven"), nothingAnywhere: intentTotals(Bon.intent, "nothingAnywhere"), intended: intentTotals(Bon.intent, "intended") }

type Delta = Record<string, Record<string, number>>
const delta = (t1: Table, t2: Table): Delta => {
  const out: Delta = {}
  for (const ty of TYPES) {
    const row: Record<string, number> = {}
    for (const c of COLS) {
      const v = (t2[ty]?.[c] ?? 0) - (t1[ty]?.[c] ?? 0)
      if (v !== 0) row[c] = v
    }
    if (Object.keys(row).length) out[ty] = row
  }
  return out
}

const failures: string[] = []
const check = (id: string, ok: boolean, detail: string) => { if (!ok) failures.push(`${id}: ${detail}`) }
check("b-off-equals-a", JSON.stringify(totals.A) === JSON.stringify(totals.Boff), "the name-model arm must equal the baseline column for column")
check("total-edges-invariant", totals.A.edges === totals.Bon.edges && totals.Boff.edges === totals.Bon.edges, `edges A=${totals.A.edges} B-off=${totals.Boff.edges} B-on=${totals.Bon.edges}`)
check("extfail-bindfail-causefail-zero", ["extFAIL", "bindFAIL", "causeFAIL"].every((c) => totals.Bon[c] === 0), JSON.stringify({ extFAIL: totals.Bon.extFAIL, bindFAIL: totals.Bon.bindFAIL, causeFAIL: totals.Bon.causeFAIL }))
check("arbitraryTwin-not-risen", intentBon.arbitraryTwin <= intentA.arbitraryTwin, `A=${intentA.arbitraryTwin} B-on=${intentBon.arbitraryTwin}`)
// closure identity per arm: resolved + amb + unresolved + claims/bindings/causes == edges
const closure = (t: Record<string, number>) => t.resolved + t["amb(decl)"] + t.unresolved + t.extOK + t.bindOK + t.causeOK
for (const [name, tt] of [["A", totals.A], ["B-off", totals.Boff], ["B-on", totals.Bon]] as const) {
  check(`closure-${name}`, closure(tt as any) === tt.edges, `sum=${closure(tt as any)} edges=${tt.edges}`)
}
const formatDelta = (d: Delta) => Object.entries(d).map(([ty, cols]) => `  ${ty}: ${Object.entries(cols).map(([c, v]) => `${c} ${v > 0 ? "+" : ""}${v}`).join(" · ")}`).join("\n") || "  (no per-type movement)"
const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-index-arm-compare.ts",
  measuredAt: new Date().toISOString(),
  arms: { a: A_PATH, bOff: BOFF_PATH, bOn: BON_PATH },
  populations: { a: A.pop, bOn: Bon.pop },
  totals,
  intent: { A: intentA, BOn: intentBon },
  ownerChannel: { A: A.owner, Boff: Boff.owner, Bon: Bon.owner },
  deltas: { "A->B-off": delta(A.table, Boff.table), "A->B-on": delta(A.table, Bon.table) },
  verdicts: { a: A.verdict, bOn: Bon.verdict },
  checks: { ok: failures.length === 0, failures },
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) { const t = path.resolve(ROOT, JSON_OUT); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, json) }
process.stdout.write(
  `cpp-index-arm-compare — edges A=${totals.A.edges} B-off=${totals.Boff.edges} B-on=${totals.Bon.edges}\n` +
  `  resolved   A=${totals.A.resolved} B-off=${totals.Boff.resolved} B-on=${totals.Bon.resolved}\n` +
  `  amb(decl)  A=${totals.A["amb(decl)"]} B-off=${totals.Boff["amb(decl)"]} B-on=${totals.Bon["amb(decl)"]}\n` +
  `  unresolved A=${totals.A.unresolved} B-off=${totals.Boff.unresolved} B-on=${totals.Bon.unresolved}\n` +
  `  owner channel rows/resolved/declined: A=${A.owner.rows}/${A.owner.resolved}/${A.owner.declined} B-on=${Bon.owner.rows}/${Bon.owner.resolved}/${Bon.owner.declined}\n` +
  `  arbitraryTwin A=${intentA.arbitraryTwin} B-on=${intentBon.arbitraryTwin}\n` +
  `  DELTA A->B-on:\n${formatDelta(report.deltas["A->B-on"])}\n` +
  `  CHECKS: ${failures.length === 0 ? "PASS" : "FAIL — " + failures.join(" · ")}\n`,
)
if (failures.length > 0) process.exit(3)
