/**
 * PY-DEPTH-MOVEMENT — the D7 measurement instrument: what the depth campaign MOVED, decomposed.
 *
 * Two jobs, both join-based and both auditable from the gate's own rows:
 *
 * (1) TABLE 1 DELTA between two whole-population arms (before/after), per label and for the
 *     claim/binding columns — so "resolved moved by N" is read, never inferred.
 *
 * (2) PER-EVIDENCE-CLASS MOVEMENT: each edge emitted with `metadata.owner`/`ownerEvidence` (the
 *     owner channel's static proof classes) is looked up in the BEFORE dump and the AFTER dump.
 *     A row that was NON-RESOLVED before and is NOT-SO in the after arm is a row the class MOVED;
 *     a row still non-resolved after is the class's residual wall. This is attribution by the
 *     analyzer's own evidence field, not by assumption.
 *
 * Dump-only mode is instant; `--analyze` adds the per-evidence pass (one in-process analyzer walk
 * of the population, ~10 min, no pool, no gate).
 *
 * Usage:
 *   bun run script/m14/py-depth-movement.ts --before <dump> --after <dump> [--analyze --out json]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealPythonAnalyzer } from "../../src/ast/real-python-analyzer"

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const BEFORE = argOf("--before")
const AFTER = argOf("--after")
const OUT = argOf("--out")
const ANALYZE = argv.includes("--analyze")
if (!BEFORE || !AFTER) { console.error("usage: --before <dump> --after <dump> [--analyze --out json]"); process.exit(2) }

const LABELS = ["calls","uses","contains","imports","references","exports","extends","implements","overrides","instantiates","decorates","renders","mixes_in","part_of"]

// ── TABLE 1 of one gate log ───────────────────────────────────────────────────────────────
type Row = { edges:number; resolved:number; collRes:number; ambDecl:number; ambKind:number; unresolved:number; extOK:number; extUnv:number; extFail:number; bindOK:number; bindUnv:number; bindFail:number; causeOK:number; causeFail:number }
function tableOf(logPath: string): { per: Map<string,Row>; total: Row | null } {
  const text = readFileSync(logPath, "utf8").replace(/\u0000/g, "")
  const per = new Map<string, Row>()
  let total: Row | null = null
  // Column-count tolerant: the TABLE gains columns over time (the binding columns were added in
  // task-19), so the parser reads whitespace fields and takes the first 14 numeric columns, which
  // are edges..causeFAIL in every schema this programme has printed.
  const readRow = (line: string): Row | null => {
    const p = line.trim().split(/\s+/)
    if (p.length < 15) return null
    const nums = p.slice(1, 15).map(Number)
    if (nums.some((n) => !Number.isFinite(n))) return null
    return { edges:nums[0]!, resolved:nums[1]!, collRes:nums[2]!, ambDecl:nums[3]!, ambKind:nums[4]!, unresolved:nums[5]!, extOK:nums[6]!, extUnv:nums[7]!, extFail:nums[8]!, bindOK:nums[9]!, bindUnv:nums[10]!, bindFail:nums[11]!, causeOK:nums[12]!, causeFail:nums[13]! }
  }
  for (const line of text.split("\n")) {
    const label = line.split(/\s+/)[0]
    if (!label || !LABELS.includes(label)) continue
    const r = readRow(line)
    if (r) per.set(label, r)
  }
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("TOTAL")) { total = readRow(line); break }
  }
  return { per, total }
}
const before = tableOf(BEFORE)
const after = tableOf(AFTER)
const w = (s: unknown, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
const delta = (a: number, b: number) => (b - a >= 0 ? `+${b - a}` : `${b - a}`)

console.log(`D7 D1+D2 — TABLE 1 DELTA (before: ${BEFORE}; after: ${AFTER})`)
if (!before.total || !after.total) { console.error("one of the logs has no TABLE 1 TOTAL row"); process.exit(2) }
const cols: Array<[keyof Row, string]> = [
  ["edges","edges"],["resolved","resolved"],["ambDecl","amb(decl)"],["unresolved","unresolved"],
  ["extOK","extOK"],["extUnv","ext?"],["bindOK","bindOK"],["bindUnv","bind?"],["extFail","extFAIL"],["bindFail","bindFAIL"],["causeFail","causeFAIL"],
]
console.log(`${w("type",12)}${cols.map(([,h]) => w(h, 12)).join("")}`)
for (const label of LABELS) {
  const b = before.per.get(label), a = after.per.get(label)
  if (!a) continue
  const bb = b ?? a
  console.log(`${w(label,12)}${cols.map(([k]) => w(delta(bb[k] as number, a[k] as number), 12)).join("")}`)
}
console.log(`${w("TOTAL",12)}${cols.map(([k]) => w(delta(before.total![k] as number, after.total![k] as number), 12)).join("")}`)
console.log(`\nBEFORE TOTAL: ${JSON.stringify(before.total)}`)
console.log(`AFTER  TOTAL: ${JSON.stringify(after.total)}`)

// ── dump parsing ─────────────────────────────────────────────────────────────────────────
type DumpRow = { label:string; outcome:string; target:string; file:string; line:number; claim:string }
function dumpRows(logPath: string): Map<string, DumpRow[]> {
  // NO NUL STRIPPING HERE: the binding claim's published target CONTAINS the separator, and a
  // global strip (which tableOf can afford, it only reads numbers) erases the very rows the
  // binding decomposition exists to count — the first run of this instrument measured 0 bindings
  // for exactly that reason.
  const text = readFileSync(logPath, "utf8")
  const out = new Map<string, DumpRow[]>()
  for (const line of text.split("\n")) {
    if (!line.startsWith("DUMP\t")) continue
    const p = line.split("\t")
    if (p.length < 6) continue
    const spec = p[4] ?? ""
    const c = spec.lastIndexOf(":")
    const file = c > 0 ? spec.slice(0, c) : spec
    const lineNo = c > 0 ? Number(spec.slice(c + 1)) : 0
    const r: DumpRow = { label: p[1]!, outcome: p[2]!, target: p[3]!, file, line: lineNo, claim: p[5] ?? "-" }
    const k = `${r.file}\u0000${r.label}\u0000${r.line}\u0000${r.target}`
    const arr = out.get(k) ?? []
    arr.push(r)
    out.set(k, arr)
  }
  return out
}
const bDump = dumpRows(BEFORE)
const aDump = dumpRows(AFTER)
const isResolvedOutcome = (o: string): boolean => o === "resolved"
const nonResolved = (m: Map<string, DumpRow[]>, k: string): boolean => {
  const arr = m.get(k)
  return !!arr && arr.length > 0 && !arr.every((r) => isResolvedOutcome(r.outcome))
}

// ── ext? per claim kind (dump-only) ─────────────────────────────────────────────────────
const extq = new Map<string, { count: number; samples: string[] }>()
for (const rows of aDump.values()) {
  for (const r of rows) {
    if (r.outcome !== "externalUnverified") continue
    const k = `${r.label}|${r.claim}`
    const t = extq.get(k) ?? { count: 0, samples: [] }
    t.count++
    if (t.samples.length < 3) t.samples.push(`${r.file}:${r.line} ${r.target}`)
    extq.set(k, t)
  }
}
console.log(`\nD7 EXT? CLASSIFICATION (after arm, by the gate's own claim kind) — total ${[...extq.values()].reduce((a,t)=>a+t.count,0)}`)
for (const [k, t] of [...extq.entries()].sort((a,b)=>b[1].count-a[1].count)) {
  console.log(`${w(k, 34)}${w(t.count, 10)}  e.g. ${t.samples[0] ?? ""}`)
}

// ── binding-claim decomposition (dump-only) ─────────────────────────────────────────────
// A binding claim RE-SPELLS a row: the published target is `<caller>\u0000<binding>`, and the
// BARE leaf is its identity. The decomposition asks what the row was BEFORE the claim: a
// previously-unresolved/ambiguous row that the claim reclaims, or a previously-RESOLVED row the
// claim withdraws (a DECOY — stated, never hidden, charter §18.5.3).
{
  const SEP = "\u0000"
  const counts = { total: 0, fromAmb: 0, fromUnres: 0, fromExtq: 0, decoysFromResolved: 0, unjoined: 0 }
  const outcomeCounts = new Map<string, number>()
  for (const rows of aDump.values()) {
    for (const r of rows) {
      const at = r.target.lastIndexOf(SEP)
      if (at < 0) continue
      const bare = r.target.slice(at + 1)
      if (bare === "") continue
      counts.total++
      const beforeKey = `${r.file}\u0000${r.label}\u0000${r.line}\u0000${bare}`
      const beforeRows = bDump.get(beforeKey)
      if (!beforeRows || beforeRows.length === 0) { counts.decoysFromResolved++; continue }
      const outs = beforeRows.map((x) => x.outcome)
      for (const o of outs) outcomeCounts.set(o, (outcomeCounts.get(o) ?? 0) + 1)
      if (outs.some((o) => o.startsWith("amb"))) counts.fromAmb++
      else if (outs.includes("unresolved")) counts.fromUnres++
      else if (outs.includes("externalUnverified")) counts.fromExtq++
      else counts.unjoined++
    }
  }
  console.log(`\nBINDING CLAIM DECOMPOSITION (published target = <caller>\u0000<binding>; identity = the BARE leaf)`)
  console.log(`  binding-spelled rows with a non-resolved outcome after the change   ${counts.total}`)
  console.log(`    were AMBIGUOUS before  (reclaimed by the claim)                   ${counts.fromAmb}`)
  console.log(`    were UNRESOLVED before (reclaimed by the claim)                  ${counts.fromUnres}`)
  console.log(`    were ext? before       (reclaimed by the claim)                  ${counts.fromExtq}`)
  console.log(`    were RESOLVED before   (DECOY: withdrawn from resolved)          ${counts.decoysFromResolved}`)
  console.log(`    other/unjoined                                                   ${counts.unjoined}`)
  if (outcomeCounts.size > 0) {
    const dist = [...outcomeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")
    console.log(`  before-outcome distribution of joined binding rows: ${dist}`)
  }
}

// ── per-evidence movement (requires --analyze) ──────────────────────────────────────────
type ClassStat = { ownerRows:number; movedToResolved:number; stillWall:number; amb:number; unres:number; extq:number }
const stats = new Map<string, ClassStat>()
type ExtStat = { count: number; samples: string[] }
const extBySpecifier = new Map<string, ExtStat>()
if (ANALYZE) {
  const CORPUS = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
  const files: string[] = []
  const walk = (dir: string, depth = 0): void => {
    if (depth > 12) return
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      if (e === ".git" || e === "node_modules" || e === ".corpus") continue
      const p = path.join(dir, e)
      let st: any
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) walk(p, depth + 1)
      else if (st.isFile() && (e.endsWith(".py") || e.endsWith(".pyi") || e.endsWith(".pyw"))) files.push(p)
    }
  }
  walk(CORPUS)
  const parser: any = await ASTEngine.getParser("python")
  const analyzer = new RealPythonAnalyzer()
  let parsed = 0
  for (const f of files) {
    let r: any
    try {
      const content = readFileSync(f, "utf8")
      const tree = parser.parse(content)
      if (!tree) continue
      r = analyzer.analyze(tree.rootNode, content, f)
      parsed++
    } catch { continue }
    for (const rel of r.relationships) {
      const label = String(rel.type)
      const md = rel.metadata ?? {}
      // EXT? ATTRIBUTION: for every row the AFTER arm leaves in externalUnverified, read the
      // ANALYZER's own external evidence (reason kind, specifier root) — the gate's claim-kind
      // column says only "owner", which prices nothing a D7 disposition can be based on.
      if (md.isExternalTarget === true || md.externalReason !== undefined) {
        const line = Number(rel.line_number ?? 0)
        const key = `${f}\u0000${label}\u0000${line}\u0000${String(rel.target)}`
        const rows = aDump.get(key)
        if (rows?.some((x) => x.outcome === "externalUnverified")) {
          const spec = String(md.externalSpecifier ?? md.module ?? "")
          const root = spec.includes(":") ? spec.slice(0, spec.indexOf(":")) : spec.split(".")[0] ?? ""
          const reason = String(md.externalReason ?? "none")
          const k = `${label}|${reason}|${root === "" ? "(none)" : root}`
          const t = extBySpecifier.get(k) ?? { count: 0, samples: [] }
          t.count++
          if (t.samples.length < 2) t.samples.push(`${String(f).split("/").slice(-1)[0]}:${line} ${String(rel.target)}`)
          extBySpecifier.set(k, t)
        }
      }
      if (label !== "calls" && label !== "uses") continue
      const ev = String(md.ownerEvidence ?? "none")
      if (ev === "none") continue
      const k = `${f}\u0000${label}\u0000${Number(rel.line_number ?? 0)}\u0000${String(rel.target)}`
      const st = stats.get(ev) ?? { ownerRows: 0, movedToResolved: 0, stillWall: 0, amb: 0, unres: 0, extq: 0 }
      st.ownerRows++
      const wasWall = nonResolved(bDump, k)
      const isWall = nonResolved(aDump, k)
      const claimNow = aDump.get(k)?.some((r) => r.outcome === "externalUnverified") ?? false
      if (wasWall && !isWall && !claimNow) st.movedToResolved++
      else if (isWall) {
        st.stillWall++
        const outs = aDump.get(k)!.map((r) => r.outcome)
        if (outs.some((o) => o.startsWith("amb"))) st.amb++
        else if (outs.includes("unresolved")) st.unres++
        if (outs.includes("externalUnverified")) st.extq++
      }
      stats.set(ev, st)
    }
  }
  console.log(`\nD7 RECEIVER-TYPING PER-EVIDENCE MOVEMENT (analyzer pass: ${parsed} files; join on file+label+line+target)`)
  console.log(`${w("evidence",20)}${w("ownerRows",12)}${w("moved->resolved",18)}${w("stillWall",12)}${w("amb",8)}${w("unres",9)}${w("ext?",8)}`)
  for (const [ev, st] of [...stats.entries()].sort((a,b)=>b[1].ownerRows-a[1].ownerRows)) {
    console.log(`${w(ev,20)}${w(st.ownerRows,12)}${w(st.movedToResolved,18)}${w(st.stillWall,12)}${w(st.amb,8)}${w(st.unres,9)}${w(st.extq,8)}`)
  }
  const extTotal = [...extBySpecifier.values()].reduce((a, t) => a + t.count, 0)
  console.log(`\nEXT? ATTRIBUTION BY THE ANALYZER'S OWN EVIDENCE — ${extTotal} of the arm's ext? rows join to an analyzer row`)
  for (const [k, t] of [...extBySpecifier.entries()].sort((a,b)=>b[1].count-a[1].count).slice(0, 30)) {
    console.log(`${w(k, 58)}${w(t.count, 8)}  ${t.samples[0] ?? ""}`)
  }
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    beforeTotal: before.total, afterTotal: after.total,
    delta: before.total && after.total ? Object.fromEntries(cols.map(([k]) => [k, (after.total![k] as number) - (before.total![k] as number)])) : null,
    extq: Object.fromEntries([...extq.entries()].map(([k, t]) => [k, { count: t.count, samples: t.samples }])),
    receiverTyping: ANALYZE ? Object.fromEntries(stats.entries()) : null,
    extBySpecifier: ANALYZE ? Object.fromEntries([...extBySpecifier.entries()].map(([k, t]) => [k, { count: t.count, samples: t.samples }])) : null,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
