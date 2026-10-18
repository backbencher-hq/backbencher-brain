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
 *   BB_DUMP_LIMIT=3000000 bun run script/m14/incoming-gate.ts java java 0 --dump > dump.txt
 *
 * (a cap-50 dump works identically for the triage table: `... java java 50 --dump`.)
 * The gate dumps one TSV line per NON-RESOLVED edge:
 *   DUMP <label> <outcome> <target> <srcFile>:<line> <claimKind-or-->
 * and the same stdout carries TABLE 1. This classifier PARSES TABLE 1 OUT OF THE SAME FILE and
 * REFUSES TO CLASSIFY unless the dump is the population the table describes: per type it requires
 *
 *     dumped rows of type == edges - resolved
 *     dumped unresolved  == TABLE 1 unresolved
 *     dumped ambiguous   == TABLE 1 amb(decl)
 *     dumped external rows == TABLE 1 extOK + ext? + extFAIL
 *
 * A `BB_DUMP_LIMIT` smaller than the population truncates the dump, every one of those checks fails,
 * and this instrument exits 3 instead of printing a family table over a cut population. That is the
 * control: it can fail, and it fails on the exact defect (a bound applied before a filter) that the
 * gate's own header names. A whole-population dump is ~1M rows / ~200 MB, so the file is STREAMED
 * (readline) and the aggregates are bounded — the dump rows precede TABLE 1 in the gate's output,
 * so the table is filled in the same single pass and the control runs after it.
 *
 * WHAT A FAMILY IS. Each family is decided by the TARGET'S SPELLING alone, because that is what the
 * gate prints and therefore what can be counted without re-parsing the corpus. Its interpretive
 * limit is stated beside it: `type-shaped` is "a bare Capitalised name the run's key space does not
 * declare", which is either an out-of-sample project type (at a SAMPLE) or a library type (at WHOLE
 * population) and no spelling can tell those apart by itself — the population size does. Families
 * are for ordering work; the whole-population gate is what turns them into resolutions.
 *
 * THE CLAIM COLUMN IS CLASSIFIED TOO, because the owner's D3 bar requires every ext? (a claim no
 * check can reach) to be a NAMED cause: for every external outcome the dump's claim-kind column is
 * tallied beside the target family, so "12,231 ext?" becomes "N owner claims on dotted module paths,
 * M namespace claims on bare names, …".
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
import { createReadStream, readFileSync } from "node:fs"
import * as path from "node:path"
import { createInterface } from "node:readline"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const ANALYZER = path.join(ROOT, "src/ast/real-java-analyzer.ts")

const FILE = process.argv.slice(2).find((a) => !a.startsWith("--"))
const JSON_OUT = process.argv.includes("--json")
if (!FILE) {
  console.error("usage: bun run script/m14/java-dump-classify.ts <dump-file> [--json]")
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
  edges: number; resolved: number; ambDecl: number; unresolved: number
  extOK: number; extUnknown: number; extFAIL: number
}

// ── the java.lang closed vocabulary, extracted from the analyzer's own source ────────────────────
const analyzerSrc = (() => {
  try { return readFileSync(ANALYZER, "utf8") } catch { return "" }
})()
const JAVA_LANG: Set<string> = (() => {
  const m = analyzerSrc.match(/const JAVA_LANG_TYPES: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/)
  if (!m) return new Set()
  return new Set([...m[1].matchAll(/"([A-Za-z0-9_$]+)"/g)].map((x) => x[1]))
})()
if (JAVA_LANG.size < 100) {
  console.error(`CONTROL DID NOT FIRE: extracted ${JAVA_LANG.size} java.lang names from ${ANALYZER}.`)
  console.error("Expected the lane's 137-name JAVA_LANG_TYPES set; the extraction is stale, refusing to classify.")
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
  if (s.includes(":")) return "module-qualified"
  if (JVM_ROOT.test(s)) return "platform-qualified"
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
  if (/^[A-Z][A-Za-z0-9_$]*$/.test(last)) return "dotted-type"
  if (/^[A-Z][A-Z0-9_$]*$/.test(last)) return "dotted-constant"
  if (/^[a-z_$][A-Za-z0-9_$]*$/.test(last)) return "dotted-member-path"
  return "other"
}

/** A bucket aggregate. Names are kept bounded per bucket so a whole-population dump (1M rows,
 *  hundreds of thousands of distinct targets) does not grow memory without bound: the top 8 by
 *  occurrence are enough to make a bucket walkable in the report, and the FULL distinct-name count
 *  is kept separately as a number. */
type Fam = { occurrences: number; names: Map<string, number>; distinct: number }
const mkFam = (): Fam => ({ occurrences: 0, names: new Map(), distinct: 0 })
function addTo(m: Map<string, Fam>, key: string, name: string): void {
  let f = m.get(key)
  if (!f) { f = mkFam(); m.set(key, f) }
  f.occurrences++
  if (!f.names.has(name)) {
    f.distinct++
    if (f.names.size < 8) f.names.set(name, 0)
  }
  const c = f.names.get(name)
  if (c !== undefined) f.names.set(name, c + 1)
}

const isAmb = (o: string) => o === "ambDeclOnly" || o === "ambBoth" || o === "ambiguous"
const isExt = (o: string) => o === "externalVerified" || o === "externalUnverified" || o === "externalRefuted"

// Aggregates filled in ONE streaming pass (the dump rows come before TABLE 1 in the gate's output).
const fam = new Map<string, Fam>()                 // `${type}|${outcome}|${family}`
const claims = new Map<string, Fam>()              // `${type}|${outcome}|${claimKind}` for external rows
const rowCount = new Map<string, { total: number; unresolved: number; amb: number; ext: number; extFAIL: number }>()
for (const t of ALL_TYPES) rowCount.set(t, { total: 0, unresolved: 0, amb: 0, ext: 0, extFAIL: 0 })

const table1 = new Map<Type, Table1>()
{
  const rl = createInterface({ input: createReadStream(FILE, { encoding: "utf8" }), crlfDelay: Infinity })
  let inTable = false
  for await (const line of rl) {
    if (line.startsWith("TABLE 1")) { inTable = true; continue }
    if (inTable) {
      if (line.startsWith("-----")) continue
      const cols = line.trim().split(/\s+/)
      if (cols.length >= 8 && KNOWN_TYPES.has(cols[0])) {
        table1.set(cols[0] as Type, {
          edges: Number(cols[1]), resolved: Number(cols[2]), ambDecl: Number(cols[4]),
          unresolved: Number(cols[6]), extOK: Number(cols[7]), extUnknown: Number(cols[8]),
          extFAIL: Number(cols[9]),
        })
      } else if (line.startsWith("TOTAL")) {
        inTable = false
      }
      continue
    }
    if (!line.startsWith("DUMP\t")) continue
    const p = line.split("\t")
    if (p.length < 6) continue
    const type = p[1]
    if (!KNOWN_TYPES.has(type)) continue
    const outcome = p[2]
    const target = p[3]
    const claim = p[5]
    const rc = rowCount.get(type)!
    rc.total++
    // EXTERNAL ROWS ARE KEYED BY THEIR EXACT OUTCOME, not one `external` bucket: the owner's D3
    // bar requires every ext? (externalUnverified) to be a NAMED cause, and a verified claim and an
    // unverifiable one are different facts about different verification mechanisms.
    let outcomeClass: string = "other"
    if (isAmb(outcome)) { outcomeClass = "ambiguous"; rc.amb++ }
    else if (isExt(outcome)) { outcomeClass = outcome; rc.ext++; if (outcome === "externalRefuted") rc.extFAIL++ }
    else if (outcome === "unresolved") { outcomeClass = "unresolved"; rc.unresolved++ }
    if (outcomeClass === "other") continue
    let f = family(target)
    // A `calls`/`overrides` target IS a member leaf by construction (the analyzer publishes
    // `callExpression.split(".").pop()`), so a Capitalised one is a PascalCase METHOD name
    // (`GetDC()` in JNA code), not a type reference. Spelling alone cannot say that; the label can.
    if ((type === "calls" || type === "overrides") && (f === "type-shaped" || f === "java-lang-name")) f = "member-leaf-pascal"
    addTo(fam, `${type}\u0000${outcomeClass}\u0000${f}`, target)
    if (isExt(outcome)) addTo(claims, `${type}\u0000${outcome}\u0000${claim}`, target)
  }
}

// ── THE CONTROL: the dump must be the population TABLE 1 describes ─────────────────────────────
if (table1.size < 10) {
  console.error(`CONTROL DID NOT FIRE: parsed ${table1.size} rows of TABLE 1 from ${FILE}.`)
  console.error("The dump file must be the gate's full stdout (table + DUMP rows).")
  process.exit(3)
}
const failures: string[] = []
for (const t of ALL_TYPES) {
  const tc = table1.get(t)
  if (!tc) continue // a type the gate's table does not carry at all (not printed) is not comparable
  const mine = rowCount.get(t)!
  const nonResolved = tc.edges - tc.resolved
  if (mine.total !== nonResolved) failures.push(`${t}: dumped ${mine.total} rows, TABLE 1 non-resolved = edges ${tc.edges} - resolved ${tc.resolved} = ${nonResolved}`)
  if (mine.unresolved !== tc.unresolved) failures.push(`${t}: dumped unresolved ${mine.unresolved} != TABLE 1 ${tc.unresolved}`)
  if (mine.amb !== tc.ambDecl) failures.push(`${t}: dumped ambiguous ${mine.amb} != TABLE 1 amb(decl) ${tc.ambDecl}`)
  if (mine.ext !== tc.extOK + tc.extUnknown + tc.extFAIL) failures.push(`${t}: dumped external ${mine.ext} != TABLE 1 extOK+ext?+extFAIL = ${tc.extOK + tc.extUnknown + tc.extFAIL}`)
}
if (failures.length > 0) {
  console.error("CONTROL DID NOT FIRE: the dump is not the population TABLE 1 describes.")
  for (const f of failures.slice(0, 20)) console.error("  " + f)
  console.error(`${failures.length} mismatch(es) — a truncated dump (BB_DUMP_LIMIT too small) prints a family table over a cut population and this instrument refuses to.`)
  process.exit(3)
}

const sortedFams = (m: Map<string, Fam>) => [...m.entries()].sort((a, b) => b[1].occurrences - a[1].occurrences)

if (JSON_OUT) {
  const out: any = {
    input: path.relative(ROOT, path.resolve(FILE)),
    control: { ok: true, dumpIsPopulationOfTable1: true },
    table1: Object.fromEntries([...table1.entries()]),
    families: sortedFams(fam).map(([k, v]) => {
      const [type, outcome, f] = k.split("\u0000")
      return { type, outcome, family: f, occurrences: v.occurrences, distinct: v.distinct, top: [...v.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8) }
    }),
    externalClaims: sortedFams(claims).map(([k, v]) => {
      const [type, outcome, claimKind] = k.split("\u0000")
      return { type, outcome, claimKind, occurrences: v.occurrences, distinct: v.distinct }
    }),
  }
  console.log(JSON.stringify(out, null, 2))
} else {
  const tot = (o: string) => sortedFams(fam).filter(([k]) => k.split("\u0000")[1] === o).reduce((n, [, v]) => n + v.occurrences, 0)
  console.log(`java dump classifier — input ${path.relative(ROOT, path.resolve(FILE))}`)
  console.log(`control: PASS — every per-type dumped count equals TABLE 1 (edges-resolved, unresolved, amb(decl), external incl. refuted)`)
  console.log(`rows classified: unresolved ${tot("unresolved")} · ambiguous ${tot("ambiguous")} · external ${tot("external")}`)
  console.log()
  for (const t of ALL_TYPES) {
    const mine = sortedFams(fam).filter(([k]) => k.split("\u0000")[0] === t)
    if (mine.length === 0) continue
    const tc = table1.get(t)
    console.log(`${t} — ${tc?.edges ?? "?"} edges · resolved ${tc?.resolved ?? "?"} · amb(decl) ${tc?.ambDecl ?? "?"} · unresolved ${tc?.unresolved ?? "?"} · extOK ${tc?.extOK ?? "?"} · ext? ${tc?.extUnknown ?? "?"} · extFAIL ${tc?.extFAIL ?? "?"}`)
    for (const outcome of ["unresolved", "ambiguous", "externalVerified", "externalUnverified", "externalRefuted"]) {
      const rs = mine.filter(([k]) => k.split("\u0000")[1] === outcome)
      if (rs.length === 0) continue
      console.log(`  ${outcome}`)
      for (const [k, v] of rs) {
        const f = k.split("\u0000")[2]
        const top = [...v.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => `${n}(${c})`).join(", ")
        console.log(`    ${String(v.occurrences).padStart(7)}  ${f.padEnd(20)} ${String(v.distinct).padStart(6)} names  e.g. ${top}`)
      }
    }
  }
  console.log()
  console.log("EXTERNAL-CLAIM CAUSES (type | outcome | claim kind — the named class an ext? belongs to)")
  console.log("-".repeat(86))
  const cs = sortedFams(claims)
  if (cs.length === 0) console.log("  (none — no non-resolved edge carries a claim)")
  for (const [k, v] of cs) {
    const [type, outcome, kind] = k.split("\u0000")
    console.log(`  ${String(v.occurrences).padStart(7)}  ${type.padEnd(13)} ${outcome.padEnd(22)} claim.kind=${kind.padEnd(18)} ${v.distinct} distinct target(s)`)
  }
}
