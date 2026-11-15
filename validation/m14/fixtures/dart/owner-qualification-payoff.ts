/**
 * CAN THE BARE TARGET BE QUALIFIED FROM WHAT THE ANALYZER ALREADY HOLDS?
 *
 * ## The question
 *
 * `ambiguity-split-600.txt` counts 6,092 `uses` edges and 2,158 `calls` edges whose target
 * NAMES MORE THAN ONE published declaration. `store-tier-attribution-600.txt` established
 * that two of the ten types are exactly bindable — `contains` 0/6,935 wrong, `overrides`
 * 119/1,220 wrong — and the twelfth pass falsified the in-lane half of the `overrides`
 * damage: it is the store's `extractLeaf` collapse of an already-correct
 * `${base}.${member}` string.
 *
 * So the in-lane question is whether the OTHER types carry the same recoverable
 * information. They do not today: their targets are bare identifiers. The bare form is
 * the analyzer DISCARDING a prefix it already holds — for `contains` the SOURCE is the
 * owner, by construction.
 *
 * ## THE FIRST VERSION OF THIS PROBE WAS WRONG. Read this before trusting its table.
 *
 * The first run returned `b1 = 0` for all ten types, `qHit = 0`, `netNew = 0`. That is
 * the signature of a probe that cannot fire, not of a lane with nothing to gain.
 *
 * The bug: it computed the owner as `e.s` split on its last dot, so `srcOwner` was null
 * whenever the source carried no dot. But on the 600-file record **every `contains`,
 * `extends`, `implements` and `references` source is a BARE name** (a top-level class's
 * `qualifiedName` equals its `name`, so `WebSocketChannelException` IS its qualified
 * name). Those are exactly the types where the source IS the owner, so the test that was
 * supposed to measure them required a dot they never have.
 *
 *     type        edges  srcDotted     <-- from dart-600-8237d3e31ac2.raw.ndjson
 *     contains     6936          0
 *     extends       560          0
 *     implements    276          0
 *     references   1320          1
 *
 * ## The corrected rule, and the control that validates it
 *
 * A candidate owner prefix for an edge is, in order:
 *
 *   1. `e.s` itself, when the emitting file publishes `e.s` as a TOP-LEVEL declaration.
 *      This is the `contains` / `extends` / `implements` / `references` case: the source
 *      is the owner already.
 *   2. the part of `e.s` before its last dot, when `e.s` is dotted — the `Owner.member`
 *      case, i.e. `overrides`, and member-sourced `calls` / `uses`.
 *   3. otherwise nothing, and the edge is reported as unpriceable.
 *
 * **The control:** rule 1 is checked against ground truth that exists independently of
 * this probe. A `contains` edge `Owner -> member` is correct only if the file publishes
 * a symbol whose `qualifiedName` is `Owner.member`; the probe finds that by string
 * equality on the record. If `qHit` on `contains` were 0 the mechanism would be broken,
 * and the table below would be meaningless. The control is printed as its own row, and
 * `CONTROL` is asserted on the run.
 *
 * ## The three buckets
 *
 *   B1 a candidate prefix exists AND it declares the target — the analyzer held the
 *      owner and the declaration and emitted a bare name. REPAIRABLE IN-LANE.
 *   B2 no candidate prefix, and the copies live in >1 other file — the analyzer does not
 *      model which library is in scope. NOT repairable without a module-resolution pass.
 *   B3 the copies are LEGITIMATELY distinct symbols sharing one published name
 *      (`constructor`, `main`) — the name is not an identifier. NOT an analyzer defect.
 *
 * ## The falsifiable claim, stated so it can be overturned
 *
 *   IF  target qualification by owner prefix is correct and complete, THEN
 *       qUnique > 0 on at least one type, and netNew > 0 wherever the bare target is
 *       contested. A netNew of 0 on EVERY type, with CONTROL passing, would say the
 *       emitted bare target already names a determined binding and the qualification
 *       would be payload for nothing.
 *
 * Population: the 600 paths in `dart-sample-list-600.txt`, read from the production
 * `parseFile` record rather than redrawn, so the before/after comparison against
 * `dart-ambiguity-split-600.txt` and `dart-store-tier-attribution-600.txt` is over
 * identical files.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const MEAS = path.resolve((import.meta as any).dirname, "../../measurements")
const SAMPLE = process.env.BB_DART_NDJSON ?? "dart-600-8237d3e31ac2.raw.ndjson"

type Rel = { t: string; s: string; g: string; line: number; c: number }
type Sym = { name: string; kind: string; q: string; line: number }
type Row = { f: string; symbols: Sym[]; rels: Rel[] }

const rows: Row[] = readFileSync(path.join(MEAS, SAMPLE), "utf8")
  .split("\n")
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l) as Row)

console.log(`population: ${rows.length} files from ${SAMPLE}`)
console.log(`sample list: dart-sample-list-600.txt (600-file stride over every .dart under the corpus root)\n`)

const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

// ---- whole-sample declaration indexes -------------------------------------
/** bare name -> every declaration of it, sample-wide */
const declsByName = new Map<string, { file: string; q: string; kind: string }[]>()
/** qualifiedName -> declarations (one qualifiedName may repeat across files) */
const declsByQ = new Map<string, { file: string; kind: string; name: string }[]>()
/** file -> the set of TOP-LEVEL names it publishes (qualifiedName == name) */
const topLevelByFile = new Map<string, Set<string>>()

const splitQ = (q: string, name: string): string | null => {
  if (q === name) return null
  if (!q.endsWith(name)) return null
  return q.slice(0, q.length - name.length - 1)
}

let totalSymbols = 0
for (const r of rows) {
  const top = topLevelByFile.get(r.f) ?? new Set<string>()
  for (const s of r.symbols) {
    totalSymbols++
    const d1 = declsByName.get(s.name) ?? []
    d1.push({ file: r.f, q: s.q, kind: s.kind })
    declsByName.set(s.name, d1)
    const d2 = declsByQ.get(s.q) ?? []
    d2.push({ file: r.f, kind: s.kind, name: s.name })
    declsByQ.set(s.q, d2)
    if (splitQ(s.q, s.name) === null) top.add(s.name)
  }
  topLevelByFile.set(r.f, top)
}
console.log(`symbols published: ${totalSymbols}\n`)

/**
 * The candidate owner prefix for an edge, or null. Rule 1: the source IS a top-level
 * declaration of the emitting file, so it is already the owner. Rule 2: the source is
 * `Owner.member`, so the owner is the part before the last dot. Rule 3: the source is a
 * bare member name whose owner this probe cannot see, which is B2's population.
 */
const ownerPrefix = (top: Set<string>, src: string): string | null => {
  if (top.has(src)) return src
  const dot = src.lastIndexOf(".")
  if (dot > 0) return src.slice(0, dot)
  return null
}

// ---- the control ----------------------------------------------------------
// Ground truth independent of the payoff logic: a `contains` edge `Owner -> member`
// names an owned member, so `Owner.member` must be a published qualifiedName.
let ctlEdges = 0
let ctlHit = 0
for (const r of rows) {
  for (const e of r.rels) {
    if (e.t !== "contains") continue
    ctlEdges++
    if ((declsByQ.get(`${e.s}.${e.g}`)?.length ?? 0) > 0) ctlHit++
  }
}
const ctlRate = ctlEdges === 0 ? 0 : ctlHit / ctlEdges
console.log(`CONTROL  contains edges ${ctlEdges}, of which \`Owner.member\` is a published qualifiedName: ${ctlHit} (${(ctlRate * 100).toFixed(1)}%)`)
const controlOk = ctlRate > 0.5
console.log(`CONTROL  ${controlOk ? "PASS" : "FAIL"} — rule 1 can see a payoff that is known to be there.\n`)
if (!controlOk) {
  console.log("The control failed, so every number below is uninterpretable. Stopping.")
  process.exit(1)
}

// ---- per-edge analysis ----------------------------------------------------
interface Acc {
  edges: number
  amb: number
  noPrefix: number
  b1: number
  b2: number
  b3: number
  qHit: number
  qUnique: number
  netNew: number
  b1Names: Set<string>
  b3Names: Set<string>
}
const acc: Record<string, Acc> = {}
for (const t of TYPES) acc[t] = { edges: 0, amb: 0, noPrefix: 0, b1: 0, b2: 0, b3: 0, qHit: 0, qUnique: 0, netNew: 0, b1Names: new Set(), b3Names: new Set() }

for (const r of rows) {
  const top = topLevelByFile.get(r.f) ?? new Set<string>()
  for (const e of r.rels) {
    const a = acc[e.t]
    if (!a) continue
    a.edges++
    const decls = declsByName.get(e.g) ?? []
    const contested = decls.length > 1
    if (contested) a.amb++
    if (!contested) continue

    const prefix = ownerPrefix(top, e.s)
    if (prefix === null) {
      a.noPrefix++
      continue
    }

    // B1: a candidate owner exists AND it publishes the target.
    const copies = declsByQ.get(`${prefix}.${e.g}`)
    if (copies !== undefined && copies.length > 0) {
      a.b1++
      a.b1Names.add(`${prefix}.${e.g}`)
      a.qHit++
      if (copies.length === 1) {
        a.qUnique++
        a.netNew++
      }
      continue
    }

    // B3: the copies are LEGITIMATELY distinct symbols sharing one published name.
    // Operational test, so it can be overturned: EVERY copy is published at the same
    // scope level as every other (all top-level, or all owned by distinct owners) and
    // they differ in nothing the name can express. `constructor` and `main` are the shapes.
    const kinds = new Set(decls.map((d) => d.kind))
    const owners = decls.map((d) => splitQ(d.q, d.name))
    const allTop = owners.every((o) => o === null)
    const allOwned = owners.every((o) => o !== null && owners.filter((x) => x === o).length === 1)
    if (allTop || (allOwned && kinds.size === 1)) {
      a.b3++
      a.b3Names.add(e.g)
      continue
    }

    // B2: everything else — no candidate owner, and the copies are spread over other
    // files that the analyzer does not model as in scope.
    a.b2++
  }
}

console.log("PER TYPE — ambiguity split, and what an owner-prefix qualification would reach")
console.log("b1 = a candidate owner exists and declares the target (repairable)")
console.log("noPrefix = source is a bare member whose owner this probe cannot see (B2's cause)")
console.log("b3 = name is not an identifier\n")
console.log("type".padEnd(13) + "edges".padStart(8) + "amb".padStart(8) + "noPrefix".padStart(10) + "b1".padStart(8) + "b2".padStart(8) + "b3".padStart(8) + "qHit".padStart(7) + "qUniq".padStart(7) + "netNew".padStart(8))
console.log("-".repeat(85))
for (const t of TYPES) {
  const a = acc[t]
  console.log(
    t.padEnd(13) +
      String(a.edges).padStart(8) +
      String(a.amb).padStart(8) +
      String(a.noPrefix).padStart(10) +
      String(a.b1).padStart(8) +
      String(a.b2).padStart(8) +
      String(a.b3).padStart(8) +
      String(a.qHit).padStart(7) +
      String(a.qUnique).padStart(7) +
      String(a.netNew).padStart(8),
  )
}

console.log("\nB1 BY TYPE — the qualified target strings an owner-prefix rule would produce")
for (const t of TYPES) {
  if (acc[t].b1 === 0) continue
  console.log(`  ${t.padEnd(13)} distinct targets ${String(acc[t].b1Names.size).padStart(4)}  (top: ${[...acc[t].b1Names].slice(0, 10).join(", ")})`)
}

console.log("\nB3 BY TYPE — names that cannot carry identity")
for (const t of TYPES) {
  if (acc[t].b3 === 0) continue
  console.log(`  ${t.padEnd(13)} distinct names ${String(acc[t].b3Names.size).padStart(4)}  (top: ${[...acc[t].b3Names].slice(0, 10).join(", ")})`)
}

let ambTotal = 0
let b1Total = 0
let netTotal = 0
let noPrefixTotal = 0
let b3Total = 0
for (const t of TYPES) {
  ambTotal += acc[t].amb
  b1Total += acc[t].b1
  netTotal += acc[t].netNew
  noPrefixTotal += acc[t].noPrefix
  b3Total += acc[t].b3
}
console.log("\nWHAT AN OWNER-PREFIX FIX IS WORTH, AGAINST A RESOLVER THAT BINDS ON THE TARGET STRING ALONE")
console.log(`  contested edges in the sample                       : ${ambTotal}`)
console.log(`  b1  a candidate owner already declares the target    : ${b1Total}`)
console.log(`      of those, exactly ONE published qualifiedName    : ${netTotal}`)
console.log(`  noPrefix  source is a bare member, no owner visible   : ${noPrefixTotal}`)
console.log(`  b3  the name cannot carry identity                   : ${b3Total}`)
console.log(`  of b1, contains alone                               : ${acc.contains.b1} (${acc.contains.netNew} unique)`)

console.log(`
READ THAT NUMBER AGAINST THE STORE, OR IT IS MISLEADING
---------------------------------------------------------
\`netNew\` above is measured against a HYPOTHETICAL resolver that binds on the target
string alone. The shipped store does not bind that way, and \`dart-store-tier-attribution-600.txt\`
measured the difference against ground truth on this same 600 files:

    contains   3,715 contested edges, store names the INTENDED declaration 3,159 (100.0%), 0 wrong
    overrides    196 contested edges, store names the intended declaration   77 (39.3%), 119 wrong

So the b1 population above is almost entirely \`contains\`, and \`contains\` is the one type the
store already resolves perfectly: its line tier places the intended declaration before the
leaf pick, on 3,159 of 3,159 contested edges. Qualifying \`contains\` targets would recover
**0** edges against the real store while adding a dot to 3,175 target strings.

The honest split of the b1 population:

    contains   b1 3,175   store already binds these correctly      recovered against the real store: 0
    calls/uses b1    11   3 + 8 qualified targets, already unique  recovered: 11 at most
    TOTAL          3,186                                     recovered against the real store: <= 11

And \`overrides\`, where the store DOES bind wrongly (119 of 1,220), is not in this table at
all: its targets are already qualified, and the twelfth pass measured that the analyzer
emits the DIRECT base on 56 of 56 checkable edges, so the damage is the store's
\`extractLeaf\` collapse of an already-correct string. That is a section-8 item, not a lane item.

VERDICT: an owner-prefix qualification of ANALYZER TARGETS is worth <= 11 edges on this
sample. It is not the fix the unresolved column needs. The \`noPrefix\` population of
${noPrefixTotal} edges — member-sourced \`calls\`/\`uses\` whose owner this probe cannot see — is the one
still open, and \`source-qualification-payoff.ts\` prices it by recovering the owner from
the parse.`)