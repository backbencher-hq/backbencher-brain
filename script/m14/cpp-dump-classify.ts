/**
 * cpp-dump-classify — turn the fleet gate's OWN per-edge dump into the C++ lane's D3 CAUSE table
 * (ALL-OUT-OF-ALL charter §9.1 D3: every edge falls in exactly one declared class, named and counted).
 *
 * WHY THIS EXISTS. `script/m14/incoming-gate.ts cpp <exts> <cap>` prints per relationship type the
 * counts of edges that did not resolve (`unresolved`) and edges that matched several declarations
 * (`amb(decl)`). A count is not a cause: "calls unresolved N" is not work, while "calls unresolved
 * N = M member-leaves whose owner is not in the file + K macro-spelled callables + …" names which
 * capability wall the number is and which ruling it needs. This file does NOT walk the population
 * again: it reads the dump the gate itself emitted, so there is no second instrument and no second
 * population — the rows ARE the gate's rows.
 *
 * HOW TO PRODUCE THE INPUT (the command a reader runs to reproduce every number):
 *
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   BB_DUMP_LIMIT=1000000 bun run script/m14/incoming-gate.ts cpp cpp,cc,cxx,c++,hpp,hxx,ipp,inl,cu 0 --dump > dump.txt
 *
 * The gate emits one TSV line per NON-RESOLVED edge:
 *
 *   DUMP\t<label>\t<outcome>\t<target>\t<srcFile>:<line>\t<claimKind-or-->
 *
 * and the same stdout carries TABLE 1 and the intent table. This classifier PARSES TABLE 1 OUT OF THE
 * SAME FILE and REFUSES to classify unless the dump is the population the table describes. Per type:
 *
 *     dumped rows of the type == edges - resolved
 *     dumped unresolved + externalRefuted == TABLE 1 unresolved
 *     dumped ambiguous (ambDeclOnly + ambBoth) == TABLE 1 amb(decl)
 *     dumped external claims == extOK + ext? + extFAIL,  binding == bindOK+bind?+bindFAIL,
 *         cause == causeOK+causeFAIL
 *
 * THE CLOSURE ARITHMETIC (the class lesson the typescript lane handed over, §11.1): the report states
 * the identity it is built on instead of only the bucket table —
 *
 *     population == TOTAL == sum(dumped rows) + resolved
 *     sum(named-class rows) == sum(dumped rows)          (no unclassified residual)
 *     claim rows == the gate's extOK/ext?/extFAIL columns (never folded into a class)
 *     non-claim rows == amb(decl) + unresolved
 *     unclassified-label rows == 0
 *
 * A BB_DUMP_LIMIT smaller than the population truncates the dump, every check fails, and this
 * instrument exits 3 instead of printing a family table over a cut population. That is the control:
 * it can fail, and it fails on the exact defect (a bound applied before a filter) the gate's own
 * header names. A whole-population dump is large, so the file is STREAMED and the aggregates bounded.
 *
 * WHAT A CLASS IS, and its stated limit. Each class is decided by the TARGET'S SPELLING alone,
 * because that is what the gate prints and therefore what can be counted without re-parsing the
 * corpus. The interpretive limit is stated beside each class: a bare identifier the run's key space
 * does not declare is either (a) declared in a project HEADER the run does not admit (the measured
 * `.h` boundary, proposal cpp-h-routing.md), (b) a member of a class declared in another file, or
 * (c) a third-party/platform name — and no spelling separates those three by itself. That is C++'s
 * declared per-file-model wall (cpp D3 wall W1), and the whole-population number is what sizes it.
 * Classes order work; they are not resolutions, and a class NEVER moves an edge into `resolved`.
 *
 * THE CONSTANTS READ FROM THE ANALYZER. The keyword/marker sets are EXTRACTED from the analyzer's
 * own source (the grammar auditor's precedent: read the lane's source, do not fork its table), and
 * each extraction is asserted to find a plausible set, so a refactor that renames a constant fails
 * loudly here instead of silently misclassifying targets.
 *
 * USAGE
 *   bun run script/m14/cpp-dump-classify.ts <dump-file> [--json]
 *
 * EXIT: 0 classified · 2 environment/usage (no dump/unreadable/not a dump) · 3 CONTROL DID NOT FIRE
 *       — the dump is not the population TABLE 1 describes, or a class sum does not close.
 */
import { createReadStream, readFileSync } from "node:fs"
import * as path from "node:path"
import { createInterface } from "node:readline"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const ANALYZER = path.join(ROOT, "src/ast/real-cpp-analyzer.ts")

const FILE = process.argv.slice(2).find((a) => !a.startsWith("--"))
const JSON_OUT = process.argv.includes("--json")
if (!FILE) {
  console.error("usage: bun run script/m14/cpp-dump-classify.ts <dump-file> [--json]")
  process.exit(2)
}

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
] as const
type Type = (typeof ALL_TYPES)[number]
const KNOWN_TYPES = new Set<string>(ALL_TYPES)

/** Claim outcomes are their own columns in TABLE 1 and are NEVER folded into a class. */
const CLAIM_OUTCOMES = new Set(["externalVerified", "externalRefuted", "externalUnverified"])
const BINDING_OUTCOMES = new Set(["bindingVerified", "bindingRefuted", "bindingUnverified"])
const CAUSE_OUTCOMES = new Set(["causeVerified", "causeRefuted", "causeUnverified", "causeOK", "causeFAIL"])
const UNRESOLVED_OUTCOMES = new Set(["unresolved", "externalRefuted", "bindingRefuted"])
const AMBIGUOUS_OUTCOMES = new Set(["ambDeclOnly", "ambBoth"])

type Table1 = {
  edges: number; resolved: number; collRes: number; ambDecl: number; ambKind: number
  unresolved: number; extOK: number; extUnknown: number; extFAIL: number
  bindOK: number; bindUnknown: number; bindFAIL: number; causeOK: number; causeFAIL: number
}

// ── the analyzer's own spelling sets, extracted from its source ────────────────────────────────
function extractStringSet(name: string): Set<string> {
  let src = ""
  try { src = readFileSync(ANALYZER, "utf8") } catch { return new Set() }
  const start = src.indexOf(`export const ${name}`)
  if (start < 0) return new Set()
  const open = src.indexOf("[", start)
  if (open < 0) return new Set()
  // find the matching `]` by scanning (values are quoted strings with no nesting)
  let depth = 0
  let close = -1
  for (let i = open; i < src.length; i++) {
    if (src[i] === "[") depth++
    else if (src[i] === "]") { depth--; if (depth === 0) { close = i; break } }
  }
  if (close < 0) return new Set()
  const body = src.slice(open + 1, close)
  const out = new Set<string>()
  let i = 0
  while (i < body.length) {
    while (i < body.length && body[i] !== '"') i++
    if (i >= body.length) break
    let j = i + 1
    while (j < body.length && body[j] !== '"') j++
    const v = body.slice(i + 1, j)
    if (v.length > 0) out.add(v)
    i = j + 1
  }
  return out
}
const CPP_KEYWORDS = extractStringSet("CPP_KEYWORDS")
const CPP_BUILTIN_TYPE_KEYWORDS = extractStringSet("CPP_BUILTIN_TYPE_KEYWORDS")
const CPP_NON_CLASS_STANDARD_TYPES = extractStringSet("CPP_NON_CLASS_STANDARD_TYPES")
const CPP_EXPORT_MARKER_COMPONENTS = extractStringSet("CPP_EXPORT_MARKER_COMPONENTS")
if (CPP_KEYWORDS.size < 40 || CPP_BUILTIN_TYPE_KEYWORDS.size < 10 || CPP_NON_CLASS_STANDARD_TYPES.size < 5 || CPP_EXPORT_MARKER_COMPONENTS.size < 2) {
  console.error(`CONTROL DID NOT FIRE: extracted keyword sets from ${ANALYZER} look stale (CPP_KEYWORDS ${CPP_KEYWORDS.size}, builtins ${CPP_BUILTIN_TYPE_KEYWORDS.size}, non-class ${CPP_NON_CLASS_STANDARD_TYPES.size}, markers ${CPP_EXPORT_MARKER_COMPONENTS.size}).`)
  console.error("The classifier reads the analyzer's own tables; a rename must fail here rather than misclassify targets.")
  process.exit(3)
}

// ── spelling helpers (pure string scans, no regex) ──────────────────────────────────────────────
function isIdentifierShape(s: string): boolean {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const ok = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_"
    if (!ok) return false
  }
  const c0 = s[0]
  return !(c0 >= "0" && c0 <= "9")
}
function isAllCapsIdentifier(s: string): boolean {
  let hasUpper = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c >= "a" && c <= "z") return false
    if (c >= "A" && c <= "Z") hasUpper = true
  }
  return hasUpper
}
function isTypeShaped(s: string): boolean {
  if (!isIdentifierShape(s)) return false
  const c0 = s[0]
  if (c0 >= "A" && c0 <= "Z") return true
  return s.endsWith("_t") || s.endsWith("_type")
}
function hasQualifier(s: string): boolean { return s.includes("::") }
function hasTemplateArgs(s: string): boolean { return s.includes("<") || s.includes(">") }

/** The named class for one dumped row. `label` narrows the vocabulary the spelling can mean; the
 *  class itself is derived from the TARGET'S SPELLING ONLY (that is all the dump carries). */
function classify(label: string, target: string): { family: string; declaredClass: string } {
  const s = String(target ?? "").trim()
  if (s.length === 0) return { family: "empty", declaredClass: "W-empty-target" }
  if (label === "imports") {
    // An include path: quoted/system spellings were already stripped by the analyzer, so the shape
    // IS the path. The target is a module path, not a symbol, by construction of the type (W2).
    if (s.includes("/") || s.includes("\\")) return { family: "include-path/subdirectory", declaredClass: "W2-module-path-not-a-symbol" }
    return { family: "include-path/bare-header", declaredClass: "W2-module-path-not-a-symbol" }
  }
  if (label === "exports") {
    // By construction: the marker as written (FMT_API, __declspec(dllexport), …), never a symbol.
    return { family: "export-marker-token", declaredClass: "W5-export-marker-not-a-declaration" }
  }
  if (CPP_KEYWORDS.has(s) || CPP_BUILTIN_TYPE_KEYWORDS.has(s)) {
    return { family: "keyword-spelled", declaredClass: "W7-keyword-spelled-recovery" }
  }
  if (CPP_NON_CLASS_STANDARD_TYPES.has(s)) {
    return { family: "non-class-standard-type", declaredClass: "W8-non-class-standard-type" }
  }
  if (s.startsWith("operator")) return { family: "operator-spelled", declaredClass: "W9-operator-name-not-a-symbol" }
  if (s.startsWith("~")) return { family: "destructor-spelled", declaredClass: "W9-operator-name-not-a-symbol" }
  if (hasQualifier(s)) {
    // A qualified path: the analyzer publishes LEAF names (a member symbol has no distinct
    // qualifiedName in cpp), so a `a::b` target answers to no published key (W4).
    return { family: "qualified-name", declaredClass: "W4-qualified-name-not-published" }
  }
  if (hasTemplateArgs(s)) return { family: "template-shaped", declaredClass: "W3-template-args-in-target" }
  if (!isIdentifierShape(s)) {
    if (s.includes("(") || s.includes(")")) return { family: "call-or-attribute-shaped", declaredClass: "W6-non-identifier-shaped" }
    if (s.includes(".") || s.includes("->")) return { family: "member-path-shaped", declaredClass: "W6-non-identifier-shaped" }
    return { family: "non-identifier-shaped", declaredClass: "W6-non-identifier-shaped" }
  }
  if (isAllCapsIdentifier(s)) return { family: "macro-spelled", declaredClass: "W10-macro-defined-name" }
  if (label === "extends" || label === "implements" || label === "instantiates" || label === "references") {
    if (isTypeShaped(s)) return { family: "type-shaped", declaredClass: "W1-type-not-declared-in-run" }
    return { family: "type-shaped-lowercase", declaredClass: "W1-type-not-declared-in-run" }
  }
  if (label === "uses") return { family: "member-or-value-leaf", declaredClass: "W11-member-leaf-owner-unresolved" }
  if (label === "overrides") return { family: "member-leaf", declaredClass: "W11-member-leaf-owner-unresolved" }
  // calls: a bare callable name the run does not declare. The per-file-model wall: declared in a
  // header/admitted-sibling the run does not contain, or a third-party/platform callable.
  return { family: "callable-leaf", declaredClass: "W1-callable-not-declared-in-run" }
}

// ── read the dump + TABLE 1 + intent table in one streaming pass ───────────────────────────────
const table1 = new Map<string, Table1>()
const dumped = new Map<string, number>()
const byOutcome = new Map<string, Map<string, number>>()
const tallies = new Map<string, Map<string, { unresolved: number; ambiguous: number }>>()
const familyClass = new Map<string, string>()
const examples = new Map<string, string[]>()
const unclassifiedLabels = new Map<string, number>()
let dumpRows = 0
let dumpLines = 0
let malformedRows = 0
let claimRows = 0
let bindingRows = 0
let causeRows = 0
let unclassifiedOutcomeRows = 0

let table1Seen = false
let headerCols: string[] = []
let intentTwin: number | null = null
let intentHeader: string[] = []

const rl = createInterface({ input: createReadStream(FILE, "utf8"), crlfDelay: Infinity })
for await (const line of rl) {
  // BINDING INTENT table: the header row names the columns and the TOTAL row below it carries the
  // numbers, so the twin is read by COLUMN POSITION from the TOTAL row (the header names it).
  //   type  edges  intended  sameFileUnproven  arbitraryTwin  nothingAnywhere  noTarget
  // Detected FIRST, because the TABLE 1 parser's per-type block consumes every later line.
  if (line.includes("sameFileUnproven") && line.includes("arbitraryTwin") && line.includes("intended")) {
    intentHeader = line.trim().split(/\s+/)
    continue
  }
  if (intentHeader.length > 0 && line.trim().startsWith("TOTAL")) {
    const cols = line.trim().split(/\s+/)
    const i = intentHeader.indexOf("arbitraryTwin")
    if (i > 0 && cols[i] !== undefined && /^\d+$/.test(cols[i])) intentTwin = Number(cols[i])
    continue
  }
  if (line.startsWith("DUMP\t")) {
    dumpLines++
    const parts = line.split("\t")
    if (parts.length < 6) { malformedRows++; continue }
    const label = parts[1]
    const outcome = parts[2]
    const target = parts[3]
    if (!KNOWN_TYPES.has(label)) { unclassifiedLabels.set(label, (unclassifiedLabels.get(label) ?? 0) + 1); continue }
    // Claim outcomes are accounted for in their own columns; they are NOT classes.
    if (CLAIM_OUTCOMES.has(outcome)) { claimRows++; continue }
    if (BINDING_OUTCOMES.has(outcome)) { bindingRows++; continue }
    if (CAUSE_OUTCOMES.has(outcome)) { causeRows++; continue }
    const isUnresolved = UNRESOLVED_OUTCOMES.has(outcome)
    const isAmbiguous = AMBIGUOUS_OUTCOMES.has(outcome)
    if (!isUnresolved && !isAmbiguous) { unclassifiedOutcomeRows++; continue }
    dumpRows++
    dumped.set(label, (dumped.get(label) ?? 0) + 1)
    if (!byOutcome.has(label)) byOutcome.set(label, new Map())
    const om = byOutcome.get(label)!
    om.set(outcome, (om.get(outcome) ?? 0) + 1)
    const { family, declaredClass } = classify(label, target)
    familyClass.set(`${label}\u0000${family}`, declaredClass)
    if (!tallies.has(label)) tallies.set(label, new Map())
    const m = tallies.get(label)!
    const cur = m.get(family) ?? { unresolved: 0, ambiguous: 0 }
    if (isUnresolved) cur.unresolved++
    else cur.ambiguous++
    m.set(family, cur)
    const key = `${label}\u0000${family}`
    const ex = examples.get(key) ?? []
    if (ex.length < 3) ex.push(`${parts[4] ?? "?"}: ${target} [${outcome}]`)
    examples.set(key, ex)
    continue
  }
  if (line.includes("TABLE 1 — PER PROJECT")) { table1Seen = true; continue }
  if (table1Seen && headerCols.length === 0 && line.includes("type") && line.includes("edges") && line.includes("resolved")) {
    headerCols = line.trim().split(/\s+/)
    continue
  }
  if (table1Seen && headerCols.length > 0) {
    // the intent table's numeric TOTAL row is the arbitraryTwin number (D6): capture it when seen
    const cols = line.trim().split(/\s+/)
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
    continue
  }
}
if (!table1Seen || table1.size === 0) {
  console.error(`CONTROL DID NOT FIRE: no TABLE 1 in ${FILE} — not a gate dump, or a schema change.`)
  process.exit(3)
}

// ── TABLE 1 comparison: the dump must BE the population TABLE 1 describes ─────────────────────
const failures: string[] = []
const perTypeControl: Record<string, { dumped: number; expected: number; unresolvedDumped: number; unresolvedExpected: number; ambDumped: number; ambExpected: number }> = {}
let tableEdges = 0
let tableResolved = 0
for (const t of ALL_TYPES) {
  const tbl = table1.get(t)
  if (!tbl) continue
  tableEdges += tbl.edges
  tableResolved += tbl.resolved
  const outcomes = byOutcome.get(t) ?? new Map<string, number>()
  const d = dumped.get(t) ?? 0
  const unresolvedDumped = (outcomes.get("unresolved") ?? 0) + (outcomes.get("externalRefuted") ?? 0) + (outcomes.get("bindingRefuted") ?? 0)
  const ambDumped = (outcomes.get("ambDeclOnly") ?? 0) + (outcomes.get("ambBoth") ?? 0)
  const expected = Math.max(0, tbl.edges - tbl.resolved)
  perTypeControl[t] = { dumped: d, expected, unresolvedDumped, unresolvedExpected: tbl.unresolved, ambDumped, ambExpected: tbl.ambDecl }
  if (d !== expected) failures.push(`${t}: dumped ${d} != edges-resolved ${expected}`)
  if (unresolvedDumped !== tbl.unresolved) failures.push(`${t}: dumped unresolved ${unresolvedDumped} != TABLE 1 unresolved ${tbl.unresolved}`)
  if (ambDumped !== tbl.ambDecl) failures.push(`${t}: dumped ambiguous ${ambDumped} != TABLE 1 amb(decl) ${tbl.ambDecl}`)
}
// claim/binding/cause closure: the dump must carry exactly the TABLE 1 claim columns.
const tableClaim = [...table1.values()].reduce((a, r) => a + r.extOK + r.extUnknown + r.extFAIL, 0)
const tableBind = [...table1.values()].reduce((a, r) => a + r.bindOK + r.bindUnknown + r.bindFAIL, 0)
const tableCause = [...table1.values()].reduce((a, r) => a + r.causeOK + r.causeFAIL, 0)
if (claimRows !== tableClaim) failures.push(`claim rows dumped ${claimRows} != TABLE 1 extOK+ext?+extFAIL ${tableClaim}`)
if (bindingRows !== tableBind) failures.push(`binding rows dumped ${bindingRows} != TABLE 1 bindOK+bind?+bindFAIL ${tableBind}`)
if (causeRows !== tableCause) failures.push(`cause rows dumped ${causeRows} != TABLE 1 causeOK+causeFAIL ${tableCause}`)
// unclassified rows: a label outside the vocabulary or an outcome outside the union would silently
// vanish from every class; both must be ZERO for the closure identity to hold.
const unclassifiedLabelRows = [...unclassifiedLabels.values()].reduce((a, b) => a + b, 0)
if (unclassifiedLabels.size > 0) failures.push(`unclassified labels: ${[...unclassifiedLabels.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`)
if (unclassifiedOutcomeRows > 0) failures.push(`unclassified outcome rows: ${unclassifiedOutcomeRows}`)
if (malformedRows > 0) failures.push(`malformed DUMP rows (fewer than 6 columns): ${malformedRows}`)
if (dumpLines !== dumpRows + claimRows + bindingRows + causeRows + unclassifiedOutcomeRows + unclassifiedLabelRows + malformedRows) {
  failures.push(`dump lines ${dumpLines} != classified ${dumpRows}+claims ${claimRows}+bindings ${bindingRows}+causes ${causeRows}+unclassified ${unclassifiedOutcomeRows}+unclassifiedLabel ${unclassifiedLabelRows}+malformed ${malformedRows}`)
}
if (failures.length > 0) {
  console.error("CONTROL DID NOT FIRE: the dump is not the population TABLE 1 describes, or a class does not close.")
  for (const f of failures.slice(0, 25)) console.error("  " + f)
  console.error(`${failures.length} mismatch(es) — a truncated dump (BB_DUMP_LIMIT) or a gate schema change; refusing to classify.`)
  process.exit(3)
}

// ── report ─────────────────────────────────────────────────────────────────────────────────────
const table: Record<string, any> = {}
for (const t of ALL_TYPES) {
  const m = tallies.get(t)
  if (!m) continue
  const outcomes = byOutcome.get(t) ?? new Map<string, number>()
  let unresolved = 0
  let ambiguous = 0
  const rows: any[] = []
  for (const [fam, split] of [...m.entries()].sort((a, b) => (b[1].unresolved + b[1].ambiguous) - (a[1].unresolved + a[1].ambiguous))) {
    unresolved += split.unresolved
    ambiguous += split.ambiguous
    rows.push({
      class: fam,
      declaredClass: familyClass.get(`${t}\u0000${fam}`) ?? "(unmapped)",
      unresolved: split.unresolved,
      ambiguous: split.ambiguous,
      examples: examples.get(`${t}\u0000${fam}`) ?? [],
    })
  }
  table[t] = {
    unresolved: (outcomes.get("unresolved") ?? 0) + (outcomes.get("externalRefuted") ?? 0) + (outcomes.get("bindingRefuted") ?? 0),
    ambiguous: (outcomes.get("ambDeclOnly") ?? 0) + (outcomes.get("ambBoth") ?? 0),
    classes: rows,
  }
}

const classTotals = new Map<string, number>()
for (const row of Object.values(table) as any[]) {
  for (const c of row.classes) classTotals.set(c.declaredClass, (classTotals.get(c.declaredClass) ?? 0) + c.unresolved + c.ambiguous)
}
const sumClasses = [...classTotals.values()].reduce((a, b) => a + b, 0)

if (JSON_OUT) {
  console.log(JSON.stringify({
    instrument: "script/m14/cpp-dump-classify.ts",
    dump: path.relative(ROOT, FILE),
    control: {
      ok: true,
      perType: perTypeControl,
      closure: {
        tableEdges,
        tableResolved,
        dumpedRows: dumpRows,
        claimRows,
        bindingRows,
        causeRows,
        unclassifiedLabelRows,
        unclassifiedOutcomeRows,
        sumClassRows: sumClasses,
        populationIdentity: `${tableEdges} (TOTAL) == ${tableResolved} resolved + ${dumpRows} classified + ${claimRows} claims + ${bindingRows} bindings + ${causeRows} causes`,
      },
    },
    arbitraryTwin: intentTwin,
    semantics:
      "each class is target SPELLING only (the gate prints the target and nothing else). The per-file-model wall is W1 (declared in a header/another file or third-party — no spelling separates them); claims are never folded into a class (cpp emits none on this arm).",
    classTotals: Object.fromEntries([...classTotals.entries()].sort((a, b) => b[1] - a[1])),
    table,
  }, null, 2))
} else {
  const w = (s: string | number, n: number) => String(s).padEnd(n)
  console.log(`cpp-dump-classify — ${path.relative(ROOT, FILE)}`)
  console.log(`control: PASS — per-type dump counts equal TABLE 1; claims ${claimRows}, bindings ${bindingRows}, causes ${causeRows}, unclassified-label 0`)
  console.log(`closure: population ${tableEdges} == resolved ${tableResolved} + classified ${dumpRows} + claims ${claimRows} + bindings ${bindingRows} + causes ${causeRows}`)
  console.log(`classes: ${sumClasses} row(s) over ${classTotals.size} named class(es) — equals classified ${dumpRows}: ${sumClasses === dumpRows ? "PASS" : "FAIL"}`)
  if (intentTwin !== null) console.log(`arbitraryTwin (intent table): ${intentTwin}`)
  console.log()
  for (const t of ALL_TYPES) {
    const row = table[t]
    if (!row) continue
    console.log(`${t}: unresolved ${row.unresolved} · ambiguous ${row.ambiguous} — NAMED CLASSES`)
    for (const cl of row.classes) {
      console.log(`  ${w(cl.declaredClass === cl.class ? cl.declaredClass : `${cl.class} → ${cl.declaredClass}`, 52)} unres ${String(cl.unresolved).padStart(8)} · amb ${String(cl.ambiguous).padStart(7)}`)
      for (const ex of cl.examples.slice(0, 2)) console.log(`      e.g. ${ex}`)
    }
    console.log()
  }
  console.log("CLASS TOTALS (every classified row in exactly one class)")
  console.log("-".repeat(72))
  for (const [k, v] of [...classTotals.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 52)} ${String(v).padStart(8)}`)
}
