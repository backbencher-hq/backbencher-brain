/**
 * ruby-dump-classify — turn the fleet gate's OWN per-edge dump into the Ruby lane's D3 CAUSE table.
 *
 * WHY THIS EXISTS (ALL-OUT-OF-ALL phase 2 / task-13, D3). `incoming-gate.ts ruby rb <cap>` prints,
 * per relationship type, counts of edges that did not resolve and of edges that matched several
 * declarations. A count is not a cause: "calls unresolved 24,738" cannot be worked, while
 * "calls unresolved 24,738 = N method targets no declaration in the run answers + M Rails-DSL/gem
 * methods + K qualified leaves" names which rule would repay it and which ruling it needs. This file
 * does NOT walk the population again: it reads the dump the gate itself emitted, so there is no
 * second instrument and no second population — the rows ARE the gate's rows.
 *
 * HOW TO PRODUCE THE INPUT (the command a reader runs to reproduce every number):
 *
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   BB_DUMP_LIMIT=1000000 bun run script/m14/incoming-gate.ts ruby rb 0 --dump > dump.txt
 *
 * The gate emits one TSV line per NON-RESOLVED edge:
 *   DUMP\t<label>\t<outcome>\t<target>\t<srcFile>:<line>\t<claimKind-or-->
 * and the same stdout carries TABLE 1. This classifier PARSES TABLE 1 OUT OF THE SAME FILE and
 * REFUSES TO CLASSIFY unless the dump is the population the table describes. A whole-population dump
 * is streamed (readline) and the aggregates are bounded.
 *
 * OUTCOME BUCKETS (each is a declared class, never merged):
 *   unresolved (+ externalRefuted)      -> the lane's residual, classified by TARGET SPELLING below
 *   ambDeclOnly + ambBoth               -> ambiguity, classified by the same families
 *   causeDeclared + causeRefuted        -> a DECLARED cause (Ruby's overrides first-parent guesses
 *                                          carry `reasonCode: first-parent-guess`), its own column
 *   externalVerified/Unverified/Refuted -> verified-cited external claims (Ruby emits no external
 *                                          claim: 0 on every arm, stated rather than implied)
 *   binding*                            -> bindings (Ruby emits none)
 *
 * WHAT A FAMILY IS, and its stated limit: decided by the TARGET'S SPELLING alone, because that is
 * what the gate prints and therefore what can be counted without re-parsing the corpus. Its
 * interpretive limit is stated beside it: a bare snake_case method the run's key space does not
 * declare is either a project method in an unadmitted file, a gem method, a Rails-DSL-generated
 * method, or a dynamic dispatch target — and no spelling tells those apart by itself. Families order
 * work; they are not resolutions.
 *
 * USAGE
 *   bun run script/m14/ruby-dump-classify.ts <dump-file> [--json]
 *
 * EXIT: 0 classified · 2 environment/usage · 3 CONTROL DID NOT FIRE (dump is not the TABLE-1
 *       population: truncated dump `BB_DUMP_LIMIT`, or a schema change).
 */
import { createReadStream } from "node:fs"
import * as path from "node:path"
import { createInterface } from "node:readline"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const FILE = process.argv.slice(2).find((a) => !a.startsWith("--"))
const JSON_OUT = process.argv.includes("--json")
if (!FILE) {
  console.error("usage: bun run script/m14/ruby-dump-classify.ts <dump-file> [--json]")
  process.exit(2)
}

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
] as const
const KNOWN_TYPES = new Set<string>(ALL_TYPES)

type Table1 = {
  edges: number; resolved: number; collRes: number; ambDecl: number; ambKind: number
  unresolved: number; extOK: number; extUnknown: number; extFAIL: number
  bindOK: number; bindUnknown: number; bindFAIL: number; causeOK: number; causeFAIL: number
}

// ── spelling families ───────────────────────────────────────────────────────────────────────────
const RUBY_KEYWORDS = new Set([
  "def", "end", "class", "module", "if", "unless", "else", "elsif", "while", "until", "for", "do",
  "begin", "rescue", "ensure", "return", "yield", "super", "self", "nil", "true", "false", "and",
  "or", "not", "then", "case", "when", "in", "break", "next", "redo", "retry", "alias", "undef",
  "defined?", "__FILE__", "__LINE__", "__method__", "lambda", "proc",
])
function isIdentifierShape(s: string): boolean {
  if (s.length === 0) return false
  const start = s[0]
  const okStart =
    (start >= "a" && start <= "z") || (start >= "A" && start <= "Z") || start === "_"
  if (!okStart) return false
  for (let i = 1; i < s.length; i++) {
    const c = s[i]
    const ok =
      (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_"
    // Ruby method names may end with ? ! = (setter/predicate)
    if (!ok && (c === "?" || c === "!" || c === "=") && i === s.length - 1) continue
    if (!ok) return false
  }
  return true
}
function family(label: string, target: string): string {
  const s = String(target ?? "").trim()
  if (s.length === 0) return "empty-target"
  if (label === "imports" || label === "references") return s.includes("/") || s.endsWith(".rb") ? "require-path" : "bare-load-path"
  if (s.includes("/") || s.endsWith(".rb")) return "require-path"
  if (s.startsWith("@")) return "ivar-member"
  if (RUBY_KEYWORDS.has(s)) return "keyword-spelled"
  if (s.includes(".")) return "qualified-name"
  if (!isIdentifierShape(s)) {
    if ((s.startsWith(":") && s.length > 1) || (s.startsWith("__") && s.endsWith("__"))) return "symbol-or-dynamic"
    return "operator-spelled"
  }
  const c0 = s[0]
  if (c0 >= "A" && c0 <= "Z") return "constant-shaped"
  if (s === "send" || s === "__send__" || s === "public_send" || s === "method_missing" || s === "respond_to?") return "dynamic-dispatch-idiom"
  return "method-shaped"
}

// ── read the dump + TABLE 1 in one streaming pass ───────────────────────────────────────────────
const table1 = new Map<string, Table1>()
const tally = new Map<string, number>() // `type\0family` -> count
const famSplits = new Map<string, { unresolved: number; ambiguous: number }>()
const examples = new Map<string, string[]>()
const outcomeTotals = new Map<string, Map<string, number>>() // type -> outcome -> count
const causeKinds = new Map<string, Map<string, number>>() // type -> claimKind -> count
const externalKinds = new Map<string, Map<string, number>>()
let table1Seen = false
let table1Ended = false
let headerCols: string[] = []
const unclassifiedLabelRows: string[] = []

const isUnresolvedOutcome = (o: string): boolean => o === "unresolved" || o === "externalRefuted"
const isAmbiguousOutcome = (o: string): boolean => o === "ambDeclOnly" || o === "ambBoth"
const isCauseOutcome = (o: string): boolean => o === "causeDeclared" || o === "causeRefuted"
const isExternalOutcome = (o: string): boolean => o === "externalVerified" || o === "externalUnverified" || o === "externalRefuted"
const isBindingOutcome = (o: string): boolean => o === "bindingVerified" || o === "bindingRefuted" || o === "bindingUnverified"

const rl = createInterface({ input: createReadStream(FILE, "utf8"), crlfDelay: Infinity })
for await (const line of rl) {
  if (line.startsWith("DUMP\t")) {
    const parts = line.split("\t")
    if (parts.length < 6) continue
    const label = parts[1]
    const outcome = parts[2]
    const target = parts[3]
    const claimKind = parts[5] ?? "-"
    if (!KNOWN_TYPES.has(label)) { unclassifiedLabelRows.push(line.slice(0, 160)); continue }
    if (!outcomeTotals.has(label)) outcomeTotals.set(label, new Map())
    const om = outcomeTotals.get(label)!
    om.set(outcome, (om.get(outcome) ?? 0) + 1)
    if (isCauseOutcome(outcome)) {
      if (!causeKinds.has(label)) causeKinds.set(label, new Map())
      const cm = causeKinds.get(label)!
      cm.set(claimKind, (cm.get(claimKind) ?? 0) + 1)
      continue
    }
    if (isExternalOutcome(outcome)) {
      if (!externalKinds.has(label)) externalKinds.set(label, new Map())
      const em = externalKinds.get(label)!
      em.set(claimKind, (em.get(claimKind) ?? 0) + 1)
      continue
    }
    if (isBindingOutcome(outcome)) continue
    if (!isUnresolvedOutcome(outcome) && !isAmbiguousOutcome(outcome)) continue
    const fam = family(label, target)
    const key = `${label}\u0000${fam}`
    tally.set(key, (tally.get(key) ?? 0) + 1)
    const sp = famSplits.get(key) ?? { unresolved: 0, ambiguous: 0 }
    if (isUnresolvedOutcome(outcome)) sp.unresolved++
    else sp.ambiguous++
    famSplits.set(key, sp)
    const ex = examples.get(key) ?? []
    if (ex.length < 2) {
      ex.push(`${parts[4] ?? "?"}: ${target} [${outcome}]`)
      examples.set(key, ex)
    }
    continue
  }
  if (line.includes("TABLE 1 — PER PROJECT")) { table1Seen = true; continue }
  if (table1Seen && !table1Ended && headerCols.length === 0 && line.trim().length > 0 &&
      line.startsWith("type") && line.includes("edges") && line.includes("unresolved") && line.includes("extOK")) {
    headerCols = line.trim().split(/\s+/)
    continue
  }
  if (table1Seen && !table1Ended && headerCols.length > 0) {
    const cols = line.trim().split(/\s+/)
    if (cols[0] === "TOTAL") { table1Ended = true; continue }
    if (cols.length < headerCols.length) continue
    const t = cols[0]
    if (!KNOWN_TYPES.has(t)) continue
    const num = (name: string): number => {
      const i = headerCols.indexOf(name)
      return i >= 0 && cols[i] !== undefined ? Number(cols[i]) : 0
    }
    table1.set(t, {
      edges: num("edges"), resolved: num("resolved"), collRes: num("collRes"),
      ambDecl: num("amb(decl)"), ambKind: num("amb(kind)"), unresolved: num("unresolved"),
      extOK: num("extOK"), extUnknown: num("ext?"), extFAIL: num("extFAIL"),
      bindOK: num("bindOK"), bindUnknown: num("bind?"), bindFAIL: num("bindFAIL"),
      causeOK: num("causeOK"), causeFAIL: num("causeFAIL"),
    })
  }
}
if (!table1Seen || table1.size === 0) {
  console.error(`CONTROL DID NOT FIRE: no TABLE 1 in ${FILE} — not a gate dump, or a schema change.`)
  process.exit(3)
}

// ── THE CONTROL: the dump must BE the population TABLE 1 describes ─────────────────────────────
const failures: string[] = []
const perTypeControl: Record<string, any> = {}
for (const t of ALL_TYPES) {
  const tbl = table1.get(t)
  if (!tbl) continue
  const outcomes = outcomeTotals.get(t) ?? new Map<string, number>()
  const dumped = [...outcomes.values()].reduce((a, b) => a + b, 0)
  const unresolvedDumped = (outcomes.get("unresolved") ?? 0) + (outcomes.get("externalRefuted") ?? 0)
  const ambDumped = (outcomes.get("ambDeclOnly") ?? 0) + (outcomes.get("ambBoth") ?? 0)
  const causeDumped = (outcomes.get("causeDeclared") ?? 0) + (outcomes.get("causeRefuted") ?? 0)
  const extDumped = (outcomes.get("externalVerified") ?? 0) + (outcomes.get("externalUnverified") ?? 0)
  const bindDumped = (outcomes.get("bindingVerified") ?? 0) + (outcomes.get("bindingRefuted") ?? 0) + (outcomes.get("bindingUnverified") ?? 0)
  // Every non-resolved row is dumped; the partition is resolved + (amb + unresolved + ext + bibding + cause).
  const expectedDumped = tbl.edges - tbl.resolved
  perTypeControl[t] = { dumped, expectedDumped, unresolvedDumped, unresolvedExpected: tbl.unresolved, ambDumped, ambExpected: tbl.ambDecl, causeDumped, causeExpected: tbl.causeOK + tbl.causeFAIL, extDumped, extExpected: tbl.extOK + tbl.extUnknown + tbl.extFAIL, bindDumped }
  if (dumped !== expectedDumped) failures.push(`${t}: dumped ${dumped} != edges-resolved ${expectedDumped}`)
  if (unresolvedDumped !== tbl.unresolved) failures.push(`${t}: dumped unresolved ${unresolvedDumped} != TABLE 1 unresolved ${tbl.unresolved}`)
  if (ambDumped !== tbl.ambDecl) failures.push(`${t}: dumped ambiguous ${ambDumped} != TABLE 1 amb(decl) ${tbl.ambDecl}`)
  if (causeDumped !== tbl.causeOK + tbl.causeFAIL) failures.push(`${t}: dumped cause ${causeDumped} != TABLE 1 causeOK+causeFAIL ${tbl.causeOK + tbl.causeFAIL}`)
  if (extDumped !== tbl.extOK + tbl.extUnknown + tbl.extFAIL) failures.push(`${t}: dumped external ${extDumped} != TABLE 1 ext columns ${tbl.extOK + tbl.extUnknown + tbl.extFAIL}`)
  if (bindDumped !== tbl.bindOK + tbl.bindUnknown + tbl.bindFAIL) failures.push(`${t}: dumped binding ${bindDumped} != TABLE 1 bind columns`)
}
if (failures.length > 0) {
  console.error("CONTROL DID NOT FIRE: the dump is not the population TABLE 1 describes.")
  for (const f of failures.slice(0, 20)) console.error("  " + f)
  console.error(`${failures.length} mismatch(es) — a truncated dump (BB_DUMP_LIMIT) or a gate schema change; refusing to classify.`)
  process.exit(3)
}

// ── report ──────────────────────────────────────────────────────────────────────────────────────
const table: Record<string, any> = {}
let totalEdges = 0
let totalResolved = 0
let totalClassified = 0
let totalCauses = 0
let totalExternal = 0
let totalBindings = 0
let unclassifiedOutcomeRows = 0
for (const t of ALL_TYPES) {
  const tbl = table1.get(t)
  if (!tbl) continue
  totalEdges += tbl.edges
  totalResolved += tbl.resolved
  totalCauses += tbl.causeOK + tbl.causeFAIL
  totalExternal += tbl.extOK + tbl.extUnknown + tbl.extFAIL
  totalBindings += tbl.bindOK + tbl.bindUnknown + tbl.bindFAIL
  // CLASSIFIED = the unresolved+ambiguous buckets ONLY. Cause/external/binding rows are their own
  // columns in the closure (a cause is never a resolution, and counting it here too made the identity
  // fail by exactly the cause count: 24,328 + 60,906 + 2,943 = 88,177 != 85,234 — the failure is why
  // this line is spelled out rather than summed over the outcome map).
  totalClassified += tbl.unresolved + tbl.ambDecl
  const fams: any[] = []
  for (const key of [...tally.keys()].filter((k) => k.startsWith(`${t}\u0000`))) {
    const fam = key.slice(t.length + 1)
    const sp = famSplits.get(key) ?? { unresolved: 0, ambiguous: 0 }
    fams.push({ family: fam, unresolved: sp.unresolved, ambiguous: sp.ambiguous, examples: examples.get(key) ?? [] })
  }
  fams.sort((a, b) => b.unresolved + b.ambiguous - (a.unresolved + a.ambiguous))
  const classificationTotal = fams.reduce((a, f) => a + f.unresolved + f.ambiguous, 0)
  const expectedClassification = tbl.unresolved + tbl.ambDecl
  if (classificationTotal !== expectedClassification) unclassifiedOutcomeRows += Math.abs(expectedClassification - classificationTotal)
  table[t] = {
    edges: tbl.edges, resolved: tbl.resolved, collRes: tbl.collRes,
    unresolved: tbl.unresolved, ambiguous: tbl.ambDecl,
    declaredCause: tbl.causeOK + tbl.causeFAIL,
    causeKinds: Object.fromEntries([...(causeKinds.get(t) ?? new Map()).entries()]),
    verifiedExternal: tbl.extOK + tbl.extUnknown + tbl.extFAIL,
    externalKinds: Object.fromEntries([...(externalKinds.get(t) ?? new Map()).entries()]),
    bindings: tbl.bindOK + tbl.bindUnknown + tbl.bindFAIL,
    families: fams,
  }
}
const populationIdentity = {
  TOTAL: totalEdges,
  resolved: totalResolved,
  classified: totalClassified,
  declaredCauses: totalCauses,
  verifiedExternalClaims: totalExternal,
  bindings: totalBindings,
  closure: `${totalResolved} + ${totalClassified} + ${totalCauses} + ${totalExternal} + ${totalBindings} == ${totalEdges}`,
  holds: totalResolved + totalClassified + totalCauses + totalExternal + totalBindings === totalEdges,
  unclassifiedLabelRows: unclassifiedLabelRows.length,
  unclassifiedOutcomeRows,
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    instrument: "script/m14/ruby-dump-classify.ts",
    dump: path.relative(ROOT, FILE),
    control: { ok: true, perType: perTypeControl },
    populationIdentity,
    semantics: "family = TARGET SPELLING only (the gate prints the target and nothing else); Ruby's per-file-model wall is method-shaped/constant-shaped names no declaration in the run answers (gems, Rails DSL, dynamic dispatch) — no spelling can separate those",
    table,
  }, null, 2))
} else {
  console.log(`ruby-dump-classify — ${path.relative(ROOT, FILE)}`)
  console.log(`control: PASS — every per-type dumped count equals the TABLE 1 it was dumped against`)
  console.log(`population identity: ${populationIdentity.closure} -> ${populationIdentity.holds ? "HOLDS" : "FAILS"}; unclassified label rows ${populationIdentity.unclassifiedLabelRows}, outcome rows ${populationIdentity.unclassifiedOutcomeRows}`)
  console.log()
  const w = (s: string | number, n: number) => String(s).padEnd(n)
  for (const t of ALL_TYPES) {
    const row = table[t]
    if (!row || (row.unresolved === 0 && row.ambiguous === 0 && row.declaredCause === 0 && row.edges === 0)) continue
    console.log(`${t}: unresolved ${row.unresolved} · ambiguous ${row.ambiguous} · declared-cause ${row.declaredCause} · verified-external ${row.verifiedExternal} — NAMED CLASSES`)
    for (const [k, v] of Object.entries(row.causeKinds ?? {})) console.log(`  declared-cause/${w(k, 24)} ${String(v).padStart(8)} (own column; never a resolution)`)
    for (const f of row.families) {
      console.log(`  ${w(f.family, 28)} unres ${String(f.unresolved).padStart(7)} · amb ${String(f.ambiguous).padStart(7)}`)
      for (const ex of f.examples.slice(0, 2)) console.log(`      e.g. ${ex}`)
    }
    console.log()
  }
}
process.exit(0)
