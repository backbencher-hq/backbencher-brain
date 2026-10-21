/**
 * CSHARP - THE OWN-FILE TIE-BREAK's MOVEMENT, COUNTED PER ROW AND COUNTED DIRECTLY.
 *
 * WHAT THIS IS. The shared own-file tie-break (arbiter change e1e2f7a19, 2026-10-20) is ONE line
 * in the arbiter: inside the `decls > 1` branch, a row whose OWN FILE declares the target and
 * whose target is a plain identifier is RESOLVED (production binds the own file's declaration
 * first), where before the change it read as an ambiguity. The fleet's question - asked in
 * LANE-BRIEF §3 and settled in the Lead's L-03 - is whether a lane's cell carries that movement,
 * and whether it is counted PER ROW or PER COLUMN.
 *
 * WHY NOT A TABLE DIFFERENCE AND WHY NOT `collRes`.
 *   - `collRes` is the count of RESOLVED rows whose target had more than one declaration. It is
 *     the tie-break's COUNTER, not its MOVEMENT: a row that was resolved before the change (a
 *     single declaration, or a qualified-name join) is in `collRes` too, and a row the change
 *     moved is in `collRes` only by accident of the same shape.
 *   - TABLE 1 minus TABLE 2 is the difference between TWO DIFFERENT KEY SPACES (the project scope
 *     and the pooled corpus scope). It is not the difference between two ARBITER VERSIONS, and
 *     subtracting it would report the key spaces' difference as the change's movement.
 *
 * HOW IT IS COUNTED INSTEAD - THE ARBITER'S OWN FUNCTION, TWICE, PER ROW.
 *   For every relationship row in the whole admitted population this instrument calls the Lead's
 *   OWN `classifyEdge` TWICE:
 *     with    the tie-break's input (`ownFileDeclares` = the row's own file declares the target)
 *     without that input (`ownFileDeclares` = undefined)
 *   `ownFileDeclares` is consulted by EXACTLY ONE branch that can move an outcome (the tie-break);
 *   its other two uses (the claim's own disposition) are RECORDED, never to move the outcome. So
 *   the DIFFERENCE between the two verdicts IS the tie-break's movement, per row, computed by the
 *   arbiter itself rather than inferred from a table.
 *
 * THE INPUTS ARE THE GATE'S OWN, MIRRORED FROM THE ARBITER'S CONTRACT:
 *   - the project key space (name -> DECLARATION COUNT, and name -> kinds) per repo, built from
 *     the analyzer's own symbols with the gate's own `countKey` rule (the symbol's name, plus its
 *     qualified-name alias when that spelling DIFFERS from the name);
 *   - the declaration POSITIONS (name -> [{file, line}]), from which `ownFileDeclares` is the
 *     gate's own test (`some(d.file === srcFile)`);
 *   - the file's namespace symbol (the gate's `nsByFile`, the FIRST `module`-kind symbol in the
 *     file) for the qualified-name JOIN, which is counted exactly as the gate counts it;
 *   - the row's CLAIM, from the arbiter's own `externalClaimOf`, and the row's label (for the
 *     `contains` rule).
 *
 * THE CONTROL - THIS INSTRUMENT IS NOT ASKED TO BE RIGHT, IT IS CHECKED. It prints its own
 * per-label resolved / ambiguous / unresolved counts, and those counts are compared with the
 * GATE'S OWN TABLE 1 from the same arm. If they do not match, the movement count is NOT
 * published: a movement measured against a key space the gate does not use is a number about the
 * instrument, not about the lane.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { classifyEdge, isContainsEdge, type ExternalClaim } from "./incoming-rule"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const argOf = (name: string): string | undefined => {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(name)
  if (i >= 0 && argv[i + 1]) return argv[i + 1]
  const pfx = `${name}=`
  return argv.find((a) => a.startsWith(pfx))?.slice(pfx.length)
}
const KEYSPACE = argOf("--keyspace") ?? path.join(ROOT, ".tmp-csharp", "csharp-keyspace.jsonl")
const ROWS = argOf("--rows") ?? path.join(ROOT, ".tmp-csharp", "csharp-rows.jsonl")

// ── THE KEY SPACE (the gate's construction, mirrored) ───────────────────────────────────────────
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const declPos = new Map<string, { file: string; line: number }[]>()
const nsByFile = new Map<string, string>()

{
  let keyLines = 0
  for (const raw of readFileSync(KEYSPACE, "utf8").split("\n")) {
    if (!raw.trim()) continue
    let r: any
    try { r = JSON.parse(raw) } catch { continue }
    const repo = String(r.r ?? "")
    const file = String(r.f ?? "")
    const name = String(r.n ?? "")
    const kind = String(r.k ?? "")
    const line = Number(r.l ?? 0) || 0
    if (!name) continue
    keyLines++
    let pd = projectDecl.get(repo)
    if (!pd) { pd = new Map(); projectDecl.set(repo, pd) }
    pd.set(name, (pd.get(name) ?? 0) + 1)
    let pk = projectKinds.get(repo)
    if (!pk) { pk = new Map(); projectKinds.set(repo, pk) }
    let ks = pk.get(name)
    if (!ks) { ks = new Set(); pk.set(name, ks) }
    ks.add(kind)
    // The declaration POSITION (the gate's own test for `ownFileDeclares`): one position per
    // (file, line) - a qualified-name ALIAS of a declaration is the SAME declaration, so it does
    // not add a second position.
    const at = declPos.get(name)
    const pos = { file, line }
    if (!at) declPos.set(name, [pos])
    else if (!at.some((d) => d.file === file && d.line === line)) at.push(pos)
    // THE FILE's NAMESPACE: the FIRST `module`-kind symbol in the file (the gate's own rule).
    if (kind.toLowerCase() === "module" && !nsByFile.has(file)) nsByFile.set(file, name)
  }
  console.log(`key space: ${keyLines} declaration lines - ${projectDecl.size} repos - ${declPos.size} names - ${nsByFile.size} files with a namespace symbol`)
}

// ── THE ROWS (one per relationship) ──────────────────────────────────────────────────────────────
type Row = { label: string; target: string; source: string; file: string; repo: string; line: number; claim: ExternalClaim | null }
const perLabel = new Map<string, { rows: number; resolved: number; amb: number; ext: number; bind: number; cause: number; unresolved: number; movement: number; movementSamples: string[] }>()
const bump = (label: string, field: "rows" | "resolved" | "amb" | "ext" | "bind" | "cause" | "unresolved" | "movement") => {
  const e = perLabel.get(label) ?? { rows: 0, resolved: 0, amb: 0, ext: 0, bind: 0, cause: 0, unresolved: 0, movement: 0, movementSamples: [] }
  e[field]++
  perLabel.set(label, e)
}

let rowCount = 0
let callErrors = 0
for (const raw of readFileSync(ROWS, "utf8").split("\n")) {
  if (!raw.trim()) continue
  let r: any
  try { r = JSON.parse(raw) } catch { continue }
  const row: Row = {
    label: String(r.l ?? ""),
    target: String(r.t ?? ""),
    source: String(r.s ?? ""),
    file: String(r.f ?? ""),
    repo: String(r.r ?? ""),
    line: Number(r.n ?? 0) || 0,
    claim: (r.c ?? null) as ExternalClaim | null,
  }
  rowCount++
  bump(row.label, "rows")
  const decl = projectDecl.get(row.repo)
  const kinds = projectKinds.get(row.repo)
  if (!decl || !kinds) { callErrors++; continue }
  const ownFileDeclares = (declPos.get(row.target) ?? []).some((d) => d.file === row.file)
  // THE QUALIFIED-NAME JOIN, counted exactly as the gate counts it.
  let qj: { qualified: string; count: number; branch: "slash" | "namespace" } | undefined
  const branch: "slash" | "namespace" = row.target.includes("/") ? "slash" : "namespace"
  if (branch === "slash") {
    qj = { qualified: row.target, count: decl.get(row.target) ?? 0, branch }
  } else {
    const ns = nsByFile.get(row.file)
    if (ns !== undefined && ns !== "") {
      const qualified = `${ns}/${row.target}`
      qj = { qualified, count: decl.get(qualified) ?? 0, branch }
    }
  }
  const isContains = isContainsEdge(row.label)
  let withOwn: any
  let withoutOwn: any
  try {
    withOwn = classifyEdge(decl, kinds, row.target, row.claim, undefined, isContains, ownFileDeclares, undefined, row.file, qj, row.file)
    withoutOwn = classifyEdge(decl, kinds, row.target, row.claim, undefined, isContains, undefined, undefined, row.file, qj, row.file)
  } catch (e: any) {
    callErrors++
    continue
  }
  // THE GATE'S OWN BUCKETS (incoming-gate.ts, the marks switch): resolved · amb (ambDeclOnly,
  // ambBoth) · ext (externalVerified, externalUnverified) · bind (binding*) · cause (cause*) ·
  // unres (everything else, including unresolved and externalRefuted). The buckets are the gate's
  // so the cross-check against TABLE 1 is a comparison of LIKE columns.
  const o = String(withOwn?.outcome ?? "")
  if (o === "resolved") bump(row.label, "resolved")
  else if (o === "ambDeclOnly" || o === "ambBoth") bump(row.label, "amb")
  else if (o === "externalVerified" || o === "externalUnverified") bump(row.label, "ext")
  else if (o === "bindingVerified" || o === "bindingRefuted" || o === "bindingUnverified") bump(row.label, "bind")
  else if (o === "causeDeclared" || o === "causeRefuted") bump(row.label, "cause")
  else bump(row.label, "unresolved")
  // THE MOVEMENT, PER ROW: the two verdicts differ, and the difference is the tie-break.
  if (String(withOwn?.outcome ?? "") !== String(withoutOwn?.outcome ?? "")) {
    bump(row.label, "movement")
    const e = perLabel.get(row.label)!
    if (e.movementSamples.length < 3) {
      e.movementSamples.push(`${row.source} -> ${row.target} (${row.file}:${row.line}) : without=${withoutOwn?.outcome} with=${withOwn?.outcome} decls=${withOwn?.decls}`)
    }
  }
}

const summary = [...perLabel.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.rows - a.rows)
const total = summary.reduce((a, s) => ({
  rows: a.rows + s.rows, resolved: a.resolved + s.resolved, amb: a.amb + s.amb,
  ext: a.ext + s.ext, bind: a.bind + s.bind, cause: a.cause + s.cause,
  unresolved: a.unresolved + s.unresolved, movement: a.movement + s.movement,
}), { rows: 0, resolved: 0, amb: 0, ext: 0, bind: 0, cause: 0, unresolved: 0, movement: 0 })

console.log("")
console.log("PER LABEL - rows · resolved · amb · ext · bind · cause · unres · MOVED BY THE TIE-BREAK")
for (const s of summary) {
  console.log(`  ${s.label.padEnd(14)} ${String(s.rows).padStart(9)} · ${String(s.resolved).padStart(9)} · ${String(s.amb).padStart(9)} · ${String(s.ext).padStart(7)} · ${String(s.bind).padStart(5)} · ${String(s.cause).padStart(5)} · ${String(s.unresolved).padStart(9)} · ${String(s.movement).padStart(7)}`)
  for (const sample of s.movementSamples) console.log(`      ${sample}`)
}
console.log("")
console.log(`TOTAL ${total.rows} rows · resolved ${total.resolved} · amb ${total.amb} · ext ${total.ext} · bind ${total.bind} · cause ${total.cause} · unres ${total.unresolved} · MOVED ${total.movement}` +
  (callErrors ? ` · rows the arbiter refused ${callErrors}` : ""))
console.log("THE MOVEMENT IS COUNTED PER ROW: every row is classified TWICE by the arbiter's own")
console.log("`classifyEdge` - once with the tie-break's `ownFileDeclares` input and once without it -")
console.log("and a row is MOVED when the two verdicts differ. The counter is the arbiter, not a table.")
