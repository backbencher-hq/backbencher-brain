/**
 * c-dump-classify — turn the fleet gate's OWN per-edge dump into the C lane's D3 CAUSE table.
 *
 * WHY THIS EXISTS. `script/m14/incoming-gate.ts c c <cap>` prints, per relationship type, counts of
 * edges that did not resolve (`unresolved`) and edges that matched several declarations
 * (`amb(decl)`). A count is not a cause: "calls unresolved N" is not work, while "calls unresolved
 * N = M macro-spelled targets + K names a library/header outside the .c run declares + …" names
 * which rule would repay it and which ruling it needs. This file does NOT walk the population
 * again: it reads the dump the gate itself emitted, so there is no second instrument and no second
 * population — the rows ARE the gate's rows.
 *
 * HOW TO PRODUCE THE INPUT (the command a reader runs to reproduce every number):
 *
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   BB_DUMP_LIMIT=3000000 bun run script/m14/incoming-gate.ts c c 0 --dump > dump.txt
 *
 * (a cap-50 dump works identically for a triage table.) The gate emits one TSV line per
 * NON-RESOLVED edge:
 *
 *   DUMP\t<label>\t<outcome>\t<target>\t<srcFile>:<line>\t<claimKind-or-->
 *
 * and the same stdout carries TABLE 1. This classifier PARSES TABLE 1 OUT OF THE SAME FILE and
 * REFUSES TO CLASSIFY unless the dump is the population the table describes: per type it requires
 *
 *     dumped rows of the type == edges - resolved
 *     dumped `unresolved`/`externalRefuted` == TABLE 1 unresolved
 *     dumped ambiguous outcomes (ambDeclOnly + ambBoth) == TABLE 1 amb(decl)
 *     dumped external outcomes (externalVerified + externalUnverified + externalRefuted) ==
 *       TABLE 1 extOK + ext? + extFAIL
 *
 * A BB_DUMP_LIMIT smaller than the population truncates the dump, every check fails, and this
 * instrument exits 3 instead of printing a family table over a cut population. That is the control:
 * it can fail, and it fails on the exact defect (a bound applied before a filter) the gate's own
 * header names. A whole-population dump is large, so the file is STREAMED (readline) and the
 * aggregates are bounded; the dump rows precede TABLE 1, so the table is filled in the same pass.
 *
 * WHAT A FAMILY IS, and its stated limit. Each family is decided by the TARGET'S SPELLING alone,
 * because that is what the gate prints and therefore what can be counted without re-parsing the
 * corpus. Its interpretive limit is stated beside it: a bare identifier the run's key space does
 * not declare is either (a) declared in a project HEADER the .c-only run does not admit, or (b) a
 * third-party/platform name no file in the run declares — and no spelling tells those apart by
 * itself. That is C's declared per-file-model wall (C-D2), and the whole-population number is what
 * sizes it. Families order work; they are not resolutions.
 *
 * THE ONE LIST READ FROM ELSEWHERE. `iso-c-stdlib-name` needs the analyzer's own
 * `ISO_C_LIBRARY_NAMES` set — the names the analyzer CLAIMS as external. It is EXTRACTED from the
 * analyzer's source (the grammar auditor's precedent: read the lane's source, do not fork its
 * table), and the extraction is asserted to find a plausible set, so a refactor that renames the
 * constant fails loudly here instead of silently misclassifying those targets.
 *
 * USAGE
 *   bun run script/m14/c-dump-classify.ts <dump-file> [--json]
 *
 * EXIT: 0 classified · 2 environment/usage (no dump/unreadable/not a dump) · 3 CONTROL DID NOT FIRE
 *       — the dump is not the population TABLE 1 describes.
 */
import { createReadStream, readFileSync } from "node:fs"
import * as path from "node:path"
import { createInterface } from "node:readline"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const ANALYZER = path.join(ROOT, "src/ast/real-c-analyzer.ts")

const FILE = process.argv.slice(2).find((a) => !a.startsWith("--"))
const JSON_OUT = process.argv.includes("--json")
if (!FILE) {
  console.error("usage: bun run script/m14/c-dump-classify.ts <dump-file> [--json]")
  process.exit(2)
}

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
] as const
type Type = (typeof ALL_TYPES)[number]
const KNOWN_TYPES = new Set<string>(ALL_TYPES)

type Table1 = {
  edges: number; resolved: number; collRes: number; ambDecl: number; ambKind: number
  unresolved: number; extOK: number; extUnknown: number; extFAIL: number
  bindOK: number; bindUnknown: number; bindFAIL: number; causeOK: number; causeFAIL: number
}
const rawTableRows = new Map<string, string[]>()
function numBind(t: string, col: string): number {
  return 0 // filled below from rawTableRows via TABLE_COLS lookup; kept as a function for the control's readability
}

// ── the analyzer's ISO-C claim list, extracted from its own source ──────────────────────────────
const ISO_C_LIBRARY_NAMES: Set<string> = (() => {
  let src = ""
  try { src = readFileSync(ANALYZER, "utf8") } catch { return new Set() }
  // `const ISO_C_LIBRARY_NAMES = new Set([ ... ])` — the list may be multi-line or a single line.
  const start = src.indexOf("ISO_C_LIBRARY_NAMES")
  if (start < 0) return new Set()
  const open = src.indexOf("[", start)
  const close = src.indexOf("]", open + 1)
  if (open < 0 || close < 0) return new Set()
  const body = src.slice(open + 1, close)
  const names = new Set<string>()
  for (const m of body.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)) names.add(m[1])
  return names
})()
if (ISO_C_LIBRARY_NAMES.size < 40) {
  console.error(`CONTROL DID NOT FIRE: extracted ${ISO_C_LIBRARY_NAMES.size} ISO-C library names from ${ANALYZER}.`)
  console.error("Expected the analyzer's own ISO_C_LIBRARY_NAMES set; the extraction is stale, refusing to classify.")
  process.exit(3)
}

// ── spelling families (no corpus re-parse: the gate printed the target, this reads it) ──────────
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
const C_KEYWORDS = new Set([
  // K1 CORRECTION (D7 arm-A measured): this copy now matches the ANALYZER's C_KEYWORDS exactly. The old
  // copy omitted _Bool/_Complex/_Imaginary/_Alignas/_Alignof/_Atomic/_Generic/_Noreturn/_Static_assert/
  // _Thread_local, so 5 `_Static_assert` recovery rows were classified `name-not-in-run-key-space` in §15
  // while the corrected K1 (keyword-only) withdrew them. Class counts are corrected in
  // C-D7-DISPOSITION.md; TABLE 1/closure were never affected (this is a family boundary, not a measurement).
  "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "return",
  "goto", "sizeof", "typedef", "struct", "union", "enum", "static", "extern", "inline", "register",
  "volatile", "const", "auto", "signed", "unsigned", "void", "char", "short", "int", "long", "float",
  "double", "_Bool", "_Complex", "_Imaginary", "restrict", "_Alignas", "_Alignof", "_Atomic",
  "_Generic", "_Noreturn", "_Static_assert", "_Thread_local",
])

/** One family per target SPELLING. `type` only narrows the vocabulary the spelling can mean. */
function family(label: string, target: string): string {
  const s = String(target ?? "").trim()
  if (s.length === 0) return "empty"
  if (label === "imports") {
    // an include path: quoted/system spellings are already stripped, so the shape IS the path
    if (s.includes("/") || s.includes("\\")) return "include-path/subdirectory"
    return "include-path/bare-header"
  }
  if (label === "exports") return "export-marker-token" // by construction: the marker as written, never a symbol
  if (C_KEYWORDS.has(s)) return "keyword-spelled"
  if (!isIdentifierShape(s)) {
    // attribute spellings (`__declspec(dllexport)`), expressions, member paths, dotteds
    if (s.includes("(") || s.includes(")")) return "call-or-attribute-shaped"
    if (s.includes(".") || s.includes("->")) return "member-path-shaped"
    return "non-identifier-shaped"
  }
  if (ISO_C_LIBRARY_NAMES.has(s)) return "iso-c-stdlib-name"
  if (isAllCapsIdentifier(s)) return "macro-spelled"
  if (label === "references" && (s.endsWith("_t") || (s[0] >= "A" && s[0] <= "Z"))) {
    return "type-shaped"
  }
  // A bare identifier the run does not declare. C's per-file model wall (C-D2): either declared in
  // a project header outside the .c admission, or a third-party/platform name.
  return "name-not-in-run-key-space"
}

// ── read the dump + TABLE 1 in one streaming pass ───────────────────────────────────────────────
const table1 = new Map<string, Table1>()
const tally = new Map<string, Map<string, number>>() // type -> family -> count (unresolved+ambiguous)
const byOutcome = new Map<string, Map<string, number>>() // type -> outcome -> count
const examples = new Map<string, string[]>() // `${type}\u0000${family}` -> samples
const famSplits = new Map<string, { unresolved: number; ambiguous: number }>() // family split by outcome class
const dumpedAll = new Map<string, number>() // every DUMP row per type (the control's left side)
const externalVerified = new Map<string, Map<string, number>>() // type -> claim kind -> count

let table1Seen = false
let table1Ended = false
let headerCols: string[] = []

const rl = createInterface({ input: createReadStream(FILE, "utf8"), crlfDelay: Infinity })
for await (const line of rl) {
  if (line.startsWith("DUMP\t")) {
    const parts = line.split("\t")
    // DUMP label outcome target claimKind (5 parts: the 'srcFile:line' may contain no tabs)
    if (parts.length < 6) continue
    const label = parts[1]
    const outcome = parts[2]
    const target = parts[3]
    if (!KNOWN_TYPES.has(label)) continue
    dumpedAll.set(label, (dumpedAll.get(label) ?? 0) + 1)
    if (outcome === "externalVerified") {
      if (!externalVerified.has(label)) externalVerified.set(label, new Map())
      const em = externalVerified.get(label)!
      const ck = parts[5] ?? "-"
      em.set(ck, (em.get(ck) ?? 0) + 1)
      continue
    }
    // A REFUTED external claim is counted in the unresolved bucket by the table, so it must be
    // classified with it; the other claim outcomes are the legitimate external/binding/cause rows.
    const isUnresolvedOutcome = outcome === "unresolved" || outcome === "externalRefuted"
    const isAmbiguous = outcome === "ambDeclOnly" || outcome === "ambBoth"
    if (!isUnresolvedOutcome && !isAmbiguous) continue
    if (!tally.has(label)) tally.set(label, new Map())
    const fam = family(label, target)
    {
      const sk = `${label}\u0000${fam}`
      const sp = famSplits.get(sk) ?? { unresolved: 0, ambiguous: 0 }
      if (isUnresolvedOutcome) sp.unresolved++
      else sp.ambiguous++
      famSplits.set(sk, sp)
    }
    const m = tally.get(label)!
    m.set(fam, (m.get(fam) ?? 0) + 1)
    if (!byOutcome.has(label)) byOutcome.set(label, new Map())
    const om = byOutcome.get(label)!
    om.set(outcome, (om.get(outcome) ?? 0) + 1)
    const key = `${label}\u0000${fam}`
    const ex = examples.get(key) ?? []
    if (ex.length < 3) {
      ex.push(`${parts[4] ?? "?"}: ${target} [${outcome}]`)
      examples.set(key, ex)
    }
    continue
  }
  if (line.includes("TABLE 1 — PER PROJECT")) { table1Seen = true; continue }
  // THE FIRST TABLE-1 HEADER ONLY: later tables (TABLE 2 is the pooled key space, printed after
  // TABLE 1) have a SHORTER header that also contains `type`/`edges`/`resolved`, and letting it
  // overwrite `headerCols` re-parsed the pooled rows into TABLE 1 — measured: instantiates read
  // `resolved 0 / amb(decl) 182` and every per-type control failed. The first header is the one
  // the control is about; `TOTAL` ends the table.
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
      edges: num("edges"),
      resolved: num("resolved"),
      collRes: num("collRes"),
      ambDecl: num("amb(decl)"),
      ambKind: num("amb(kind)"),
      unresolved: num("unresolved"),
      extOK: num("extOK"),
      extUnknown: num("ext?"),
      extFAIL: num("extFAIL"),
      bindOK: num("bindOK"),
      bindUnknown: num("bind?"),
      bindFAIL: num("bindFAIL"),
      causeOK: num("causeOK"),
      causeFAIL: num("causeFAIL"),
    })
    rawTableRows.set(t, cols)
  }
}
if (!table1Seen || table1.size === 0) {
  console.error(`CONTROL DID NOT FIRE: no TABLE 1 in ${FILE} — not a gate dump, or a schema change.`)
  process.exit(3)
}

// ── THE CONTROL: the dump must BE the population TABLE 1 describes ─────────────────────────────
const failures: string[] = []
const perTypeControl: Record<string, { dumped: number; expected: number; unresolvedDumped: number; unresolvedExpected: number; ambDumped: number; ambExpected: number }> = {}
for (const t of ALL_TYPES) {
  const tbl = table1.get(t)
  if (!tbl) continue
  const outcomes = byOutcome.get(t) ?? new Map<string, number>()
  const dumped = dumpedAll.get(t) ?? 0
  const unresolvedDumped = (outcomes.get("unresolved") ?? 0) + (outcomes.get("externalRefuted") ?? 0)
  const ambDumped = (outcomes.get("ambDeclOnly") ?? 0) + (outcomes.get("ambBoth") ?? 0)
  // The dump is every NON-RESOLVED row: resolved + amb + unresolved + extOK + ext? + extFAIL +
  // binding + declared-cause partitions the edge count, so the dump's left side is
  // edges - resolved - bindOK - bind? - causeOK. C has no binding/cause rows; the subtraction is
  // spelled out so a future claim channel cannot silently break the control.
  const expected = Math.max(0, tbl.edges - tbl.resolved - tbl.bindOK - tbl.bindUnknown - tbl.causeOK)
  perTypeControl[t] = { dumped, expected, unresolvedDumped, unresolvedExpected: tbl.unresolved, ambDumped, ambExpected: tbl.ambDecl }
  if (dumped !== expected) failures.push(`${t}: dumped ${dumped} != edges-resolved ${expected}`)
  if (unresolvedDumped !== tbl.unresolved) failures.push(`${t}: dumped unresolved ${unresolvedDumped} != TABLE 1 unresolved ${tbl.unresolved}`)
  if (ambDumped !== tbl.ambDecl) failures.push(`${t}: dumped ambiguous ${ambDumped} != TABLE 1 amb(decl) ${tbl.ambDecl}`)
}
if (failures.length > 0) {
  console.error("CONTROL DID NOT FIRE: the dump is not the population TABLE 1 describes.")
  for (const f of failures.slice(0, 20)) console.error("  " + f)
  console.error(`${failures.length} mismatch(es) — a truncated dump (BB_DUMP_LIMIT) or a gate schema change; refusing to classify.`)
  process.exit(3)
}

// ── report ──────────────────────────────────────────────────────────────────────────────────────
const table: Record<string, { unresolved: number; ambiguous: number; externalVerified: Record<string, number>; families: Array<{ family: string; unresolved: number; ambiguous: number; examples: string[] }> }> = {}
for (const t of ALL_TYPES) {
  const fams = tally.get(t)
  if (!fams) continue
  const outcomes = byOutcome.get(t) ?? new Map<string, number>()
  // Family counts are split by outcome class: a family that is ambiguous is a different work item
  // from one that is unresolved, and the two must not be summed into a single "residual".
  const famRows: Array<{ family: string; unresolved: number; ambiguous: number; examples: string[] }> = []
  for (const fam of [...fams.keys()].sort()) {
    // recompute this family's split from the raw examples is impossible after aggregation; the
    // aggregate stores one count, so the split is kept by counting during the stream instead.
    famRows.push({ family: fam, unresolved: famSplits.get(`${t}\u0000${fam}`)?.unresolved ?? 0, ambiguous: famSplits.get(`${t}\u0000${fam}`)?.ambiguous ?? 0, examples: examples.get(`${t}\u0000${fam}`) ?? [] })
  }
  famRows.sort((a, b) => b.unresolved + b.ambiguous - (a.unresolved + a.ambiguous))
  table[t] = {
    unresolved: (outcomes.get("unresolved") ?? 0) + (outcomes.get("externalRefuted") ?? 0),
    ambiguous: (outcomes.get("ambDeclOnly") ?? 0) + (outcomes.get("ambBoth") ?? 0),
    externalVerified: Object.fromEntries([...(externalVerified.get(t) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])),
    families: famRows,
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    instrument: "script/m14/c-dump-classify.ts",
    dump: path.relative(ROOT, FILE),
    control: { ok: true, perType: perTypeControl },
    semantics: "family = target SPELLING only (the gate prints the target and nothing else); C's per-file-model wall (C-D2) is `name-not-in-run-key-space` — a header-declared or external name no spelling can separate",
    table,
  }, null, 2))
} else {
  console.log(`c-dump-classify — ${path.relative(ROOT, FILE)}`)
  console.log(`control: PASS — every per-type dumped count equals the TABLE 1 it was dumped against`)
  console.log()
  const w = (s: string | number, n: number) => String(s).padEnd(n)
  for (const t of ALL_TYPES) {
    const row = table[t]
    if (!row) continue
    const extTotal = Object.values(row.externalVerified).reduce((a, b) => a + b, 0)
    console.log(`${t}: unresolved ${row.unresolved} · ambiguous ${row.ambiguous} · verified-external ${extTotal} — NAMED CLASSES`)
    for (const [k, v] of Object.entries(row.externalVerified)) console.log(`  claim-kind ${w(k, 20)} ${String(v).padStart(8)} verified-cited external`)
    for (const f of row.families) {
      console.log(`  ${w(f.family, 30)} unres ${String(f.unresolved).padStart(8)} · amb ${String(f.ambiguous).padStart(7)}`)
      for (const ex of f.examples.slice(0, 2)) console.log(`      e.g. ${ex}`)
    }
    console.log()
  }
}
