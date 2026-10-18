/**
 * java-dump-classify — turn the fleet gate's OWN per-edge dump into the Java lane's CAUSE table.
 *
 * WHY THIS EXISTS. `script/m14/incoming-gate.ts java java <cap>` prints, per relationship type, a
 * count of edges that did not resolve (`unresolved`) and of edges that matched several declarations
 * (`amb(decl)`). A count is not a cause: "calls unresolved 855" cannot be worked, while "calls
 * unresolved 855 = 828 member leaves on a receiver the edge does not name + 17 constructor
 * delegation keyword targets + 10 type-shaped" says which rule would repay it and which ruling it
 * needs. `script/m14/java-incoming-census.ts` was the earlier shape of this question, but it
 * re-implemented the gate's discovery and classification and its copied walk has since drifted from
 * the gate's (its equality control refuses to print). This file does NOT walk the population at
 * all: it reads the dump the gate itself emitted, so there is no second instrument and no second
 * population — the rows ARE the gate's rows.
 *
 * HOW TO PRODUCE THE INPUT (and the command a reader must run to reproduce every number here):
 *
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   BB_DUMP_LIMIT=100000 bun run script/m14/incoming-gate.ts java java 50 --dump > dump.txt
 *
 * The gate dumps one TSV line per NON-RESOLVED edge:
 *   DUMP <label> <outcome> <target> <srcFile>:<line> <claimKind-or-->
 * and the same stdout carries TABLE 1. This classifier PARSES TABLE 1 OUT OF THE SAME FILE and
 * REFUSES TO CLASSIFY unless the dump is the population the table describes: per type it requires
 *
 *     dumped rows of type == edges - resolved
 *     dumped unresolved  == TABLE 1 unresolved
 *     dumped ambiguous   == TABLE 1 amb(decl)
 *     dumped external    == TABLE 1 extOK + ext?
 *
 * A `BB_DUMP_LIMIT` smaller than the population truncates the dump, every one of those checks fails,
 * and this instrument exits 3 instead of printing a family table over a cut population. That is the
 * control: it can fail, and it fails on the exact defect (a bound applied before a filter) that the
 * gate's own header names.
 *
 * WHAT A FAMILY IS. Each family is decided by the TARGET'S SPELLING alone, because that is what the
 * gate prints and therefore what can be counted without re-parsing the corpus. Its interpretive
 * limit is stated beside it: `type-shaped` is "a bare Capitalised name the sampled key space does
 * not declare", which at a SAMPLE is either an out-of-sample project type or a library type, and no
 * spelling can tell those apart. Families are for ordering work, and the whole-population gate run
 * is what turns them into resolutions.
 *
 * THE ONE LIST THIS FILE READS FROM ELSEWHERE. `java-lang-name` needs the JDK `java.lang` closed
 * vocabulary, which lives as `JAVA_LANG_TYPES` in the analyzer itself. It is EXTRACTED from that
 * source at run time (the grammar auditor's own precedent: read the lane's source, don't fork its
 * table) and the extraction is asserted to find a plausible list, so a refactor that renames the
 * constant fails loudly here instead of silently classifying every java.lang name as type-shaped.
 *
 * USAGE
 *   bun run script/m14/java-dump-classify.ts <dump-file> [--json]
 *
 * EXIT: 0 classified · 2 environment/usage (no dump, unreadable) · 3 CONTROL DID NOT FIRE — the dump
 *       is not the population TABLE 1 describes (truncated dump, or a schema change in the gate).
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const ANALYZER = path.join(ROOT, "src/ast/real-java-analyzer.ts")

const FILE = process.argv.slice(2).find((a) => !a.startsWith("--"))
const JSON_OUT = process.argv.includes("--json")
if (!FILE) {
  console.error("usage: bun run script/m14/java-dump-classify.ts <dump-file> [--json]")
  process.exit(2)
}

// ── TABLE 1, parsed out of the gate's own report ────────────────────────────────────────────────
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

type Table1 = {
  edges: number; resolved: number; ambDecl: number; unresolved: number
  extOK: number; extUnknown: number; extFAIL: number
}
let raw: string
try {
  raw = readFileSync(FILE, "utf8")
} catch (e) {
  console.error(`cannot read dump file ${FILE}: ${(e as Error).message}`)
  process.exit(2)
}

const table1 = new Map<Type, Table1>()
let inTable = false
for (const line of raw.split("\n")) {
  if (line.startsWith("TABLE 1")) { inTable = true; continue }
  if (!inTable) continue
  if (line.startsWith("-----")) continue
  const cols = line.trim().split(/\s+/)
  if (cols.length < 8) continue
  const t = cols[0]
  if (!(ALL_TYPES as readonly string[]).includes(t)) continue
  // type edges resolved collRes amb(decl) amb(kind) unresolved extOK ext? extFAIL ...
  table1.set(t as Type, {
    edges: Number(cols[1]), resolved: Number(cols[2]), ambDecl: Number(cols[4]),
    unresolved: Number(cols[6]), extOK: Number(cols[7]), extUnknown: Number(cols[8]),
    extFAIL: Number(cols[9]),
  })
}
if (table1.size !== ALL_TYPES.length) {
  console.error(`CONTROL DID NOT FIRE: parsed ${table1.size} of ${ALL_TYPES.length} rows of TABLE 1 from ${FILE}.`)
  console.error("The dump file must be the gate's full stdout (table + DUMP rows).")
  process.exit(3)
}

// ── the java.lang closed vocabulary, extracted from the analyzer's own source ────────────────────
const analyzerSrc = (() => {
  try { return readFileSync(ANALYZER, "utf8") } catch { return "" }
})()
const JAVA_LANG: Set<string> = (() => {
  const m = analyzerSrc.match(/const JAVA_LANG_TYPES: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/)
  if (!m) return new Set()
  const names = [...m[1].matchAll(/"([A-Za-z0-9_$]+)"/g)].map((x) => x[1])
  return new Set(names)
})()
if (JAVA_LANG.size < 100) {
  console.error(`CONTROL DID NOT FIRE: extracted ${JAVA_LANG.size} java.lang names from ${ANALYZER}.`)
  console.error("Expected the lane's 137-name JAVA_LANG_TYPES set; the extraction is stale, refusing to classify.")
  process.exit(3)
}

// ── the dump rows ───────────────────────────────────────────────────────────────────────────────
type Row = { label: Type; outcome: string; target: string; site: string; claim: string }
const rows: Row[] = []
for (const line of raw.split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t")
  if (p.length < 6) continue
  rows.push({ label: p[1] as Type, outcome: p[2], target: p[3], site: p[4], claim: p[5] })
}

// ── THE CONTROL: the dump must be the population TABLE 1 describes ─────────────────────────────
const isAmb = (o: string) => o === "ambDeclOnly" || o === "ambiguousByDecl" || o === "ambBoth" || o === "ambiguous"
const isExt = (o: string) => o === "externalVerified" || o === "externalUnverified" || o === "externalRefuted"
const failures: string[] = []
for (const t of ALL_TYPES) {
  const tc = table1.get(t)!
  const mine = rows.filter((r) => r.label === t)
  const nonResolved = tc.edges - tc.resolved
  const unres = mine.filter((r) => !isAmb(r.outcome) && !isExt(r.outcome)).length
  const amb = mine.filter((r) => isAmb(r.outcome)).length
  const ext = mine.filter((r) => isExt(r.outcome)).length
  if (mine.length !== nonResolved) failures.push(`${t}: dumped ${mine.length} rows, TABLE 1 non-resolved = edges ${tc.edges} - resolved ${tc.resolved} = ${nonResolved}`)
  if (unres !== tc.unresolved) failures.push(`${t}: dumped unresolved ${unres} != TABLE 1 ${tc.unresolved}`)
  if (amb !== tc.ambDecl) failures.push(`${t}: dumped ambiguous ${amb} != TABLE 1 amb(decl) ${tc.ambDecl}`)
  if (ext !== tc.extOK + tc.extUnknown) failures.push(`${t}: dumped external ${ext} != TABLE 1 extOK+ext? = ${tc.extOK + tc.extUnknown}`)
}
if (failures.length > 0) {
  console.error("CONTROL DID NOT FIRE: the dump is not the population TABLE 1 describes.")
  for (const f of failures.slice(0, 20)) console.error("  " + f)
  console.error(`${failures.length} mismatch(es) — a truncated dump (BB_DUMP_LIMIT too small) prints a family table over a cut population and this instrument refuses to.`)
  process.exit(3)
}

// ── families, by spelling only ──────────────────────────────────────────────────────────────────
const JVM_ROOT = /^(java|javax|jakarta|jdk|sun|com\.sun|kotlin|kotlinx)\./
const RESERVED = new Set([
  "super", "this", "class", "new", "null", "true", "false", "void", "int", "long", "double",
  "float", "boolean", "byte", "short", "char", "var", "_", "record", "sealed", "permits", "yield",
])
function family(t: string): string {
  const s = t.trim()
  if (s.length === 0) return "empty"
  if (RESERVED.has(s)) return "keyword-spelled"
  if (/[/\\]/.test(s) || /^[A-Za-z]:/.test(s)) return "path-shaped"
  if (JVM_ROOT.test(s)) return "platform-qualified"
  if (s.includes(":")) return "module-qualified"
  if (!s.includes(".")) {
    // ALL_CAPS is tested BEFORE the Capitalised test: `FILL_HORIZONTAL` matches both character
    // classes, and a constant read counted as a type name would put a receiver-less field read in
    // the wrong work item.
    if (/^[A-Z][A-Z0-9_$]*$/.test(s)) return "constant-shaped"
    if (/^[A-Z][A-Za-z0-9_$]*$/.test(s)) {
      if (JAVA_LANG.has(s)) return "java-lang-name"
      return "type-shaped"
    }
    if (/^[a-z_$][A-Za-z0-9_$]*$/.test(s)) return "member-leaf"
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s)) return "other-bare"
    return "other"
  }
  const segs = s.split(".")
  const last = segs[segs.length - 1]
  const first = segs[0]
  if (/^[A-Z][A-Za-z0-9_$]*$/.test(last)) return "dotted-type"
  if (/^[A-Z][A-Z0-9_$]*$/.test(last)) return "dotted-constant"
  if (/^[a-z_$][A-Za-z0-9_$]*$/.test(last)) {
    if (JVM_ROOT.test(s) || /^(org|com|net|io|edu|gov)\./.test(first)) return "dotted-member-path"
    return "dotted-member-path"
  }
  return "other"
}

const key = (t: Type, outcome: "unresolved" | "ambiguous") => `${t}\u0000${outcome}`
const fam = new Map<string, { occurrences: number; names: Map<string, number> }>()
for (const r of rows) {
  const outcome = isAmb(r.outcome) ? "ambiguous" : isExt(r.outcome) ? null : "unresolved"
  if (outcome === null) continue
  let f = family(r.target)
  // A `calls`/`overrides` target IS a member leaf by construction (the analyzer publishes
  // `callExpression.split(".").pop()`), so a Capitalised one is a PascalCase METHOD name
  // (`GetDC()` in JNA code), not a type reference. Spelling alone cannot say that; the label can.
  if ((r.label === "calls" || r.label === "overrides") && (f === "type-shaped" || f === "java-lang-name")) f = "member-leaf-pascal"
  const k = key(r.label, outcome) + "\u0000" + f
  const cur = fam.get(k) ?? { occurrences: 0, names: new Map() }
  cur.occurrences++
  cur.names.set(r.target, (cur.names.get(r.target) ?? 0) + 1)
  fam.set(k, cur)
}

// claim-bearing non-resolved rows (the "own column" of declared claims), by type and claim kind
const claims = new Map<string, number>()
for (const r of rows) {
  if (r.claim === "-") continue
  const k = `${r.label}\u0000${r.outcome}\u0000${r.claim}`
  claims.set(k, (claims.get(k) ?? 0) + 1)
}

const famRows: { type: string; outcome: string; family: string; occurrences: number; distinct: number; examples: string[] }[] = []
for (const [k, v] of fam) {
  const [t, outcome, f] = k.split("\u0000")
  const names = [...v.names.entries()].sort((a, b) => b[1] - a[1])
  famRows.push({ type: t, outcome, family: f, occurrences: v.occurrences, distinct: v.names.size, examples: names.slice(0, 6).map(([n, c]) => `${n}(${c})`) })
}
famRows.sort((a, b) => (a.type === b.type ? (a.outcome === b.outcome ? b.occurrences - a.occurrences : a.outcome < b.outcome ? -1 : 1) : ALL_TYPES.indexOf(a.type as Type) - ALL_TYPES.indexOf(b.type as Type)))

if (JSON_OUT) {
  console.log(JSON.stringify({
    input: path.relative(ROOT, path.resolve(FILE)),
    control: { ok: true, dumpIsPopulationOfTable1: true },
    table1: Object.fromEntries([...table1.entries()]),
    families: famRows,
    claimBearing: Object.fromEntries([...claims.entries()].sort()),
  }, null, 2))
} else {
  const tot = (o: string) => famRows.filter((r) => r.outcome === o).reduce((n, r) => n + r.occurrences, 0)
  console.log(`java dump classifier — input ${path.relative(ROOT, path.resolve(FILE))}`)
  console.log(`control: PASS — every per-type dumped count equals TABLE 1 (edges-resolved, unresolved, amb(decl), extOK+ext?)`)
  console.log(`rows classified: ${rows.length} non-resolved edges (unresolved ${tot("unresolved")} · ambiguous ${tot("ambiguous")})`)
  console.log()
  for (const t of ALL_TYPES) {
    const mine = famRows.filter((r) => r.type === t)
    if (mine.length === 0) continue
    const tc = table1.get(t)!
    console.log(`${t} — ${tc.edges} edges · resolved ${tc.resolved} · amb(decl) ${tc.ambDecl} · unresolved ${tc.unresolved} · extOK ${tc.extOK} · ext? ${tc.extUnknown} · extFAIL ${tc.extFAIL}`)
    for (const outcome of ["unresolved", "ambiguous"]) {
      const rs = mine.filter((r) => r.outcome === outcome)
      if (rs.length === 0) continue
      console.log(`  ${outcome}`)
      for (const r of rs) console.log(`    ${String(r.occurrences).padStart(6)}  ${r.family.padEnd(20)} ${String(r.distinct).padStart(5)} names  e.g. ${r.examples.join(", ")}`)
    }
  }
  console.log()
  console.log("CLAIM-BEARING NON-RESOLVED ROWS (the declared-claim column, never merged into resolved)")
  console.log("-".repeat(78))
  const claimKeys = [...claims.entries()].sort((a, b) => b[1] - a[1])
  if (claimKeys.length === 0) console.log("  (none — every non-resolved edge carries no claim)")
  for (const [k, n] of claimKeys) {
    const [t, outcome, kind] = k.split("\u0000")
    console.log(`  ${String(n).padStart(6)}  ${t.padEnd(13)} ${outcome.padEnd(20)} claim.kind=${kind}`)
  }
}
