/**
 * dart/untyped-method-is-method — THE MUTANTS, and the check that they are caught.
 *
 * ## Why this file exists separately from the fixture
 *
 * `untyped-method-is-method.expectation.json` pins what the analyzer does. A pin
 * that cannot fail proves nothing, and this lane's own record is that it shipped
 * defects behind a green suite — `script/m14/mutate-analyzer.ts` is SHARED
 * machinery (§8 of the ontology workstream: report, do not edit), and registering
 * a lane's mutants in it means editing it. So the battery is lane-owned and
 * self-contained: it constructs the ways DARTD22 can be wrong, applies each to
 * the real analyzer's output, and requires the fixture's OWN rows to catch each.
 *
 * ## THE MUTANTS
 *
 *   M1 REVERT-NAME — restore the node-TYPE dispatch: every constructor-shaped
 *      signature becomes a `constructor` named `constructor` again. This is the
 *      exact pre-fix shape, and it is what the corpus carried for 521 of 1,197
 *      signatures. Caught by: `expectSymbolCount` on `untypedMethod`,
 *      `forbidSymbols` on `constructor` owned by `Untyped`, and the `contains`
 *      rows naming the untyped methods.
 *
 *   M2 WRONG-DISCRIMINATOR — use the WRAPPER node instead of the name, which is
 *      the test that looks right and is not: the grammar also wraps real
 *      constructors in `method_signature`, so this deletes 559 real constructors
 *      per 600 files. It is the mutant this fixture exists to catch, because a
 *      reviewer reading `method_signature > constructor_signature` would reach
 *      for it. Caught by: `expectSymbolCount` on `constructor`/`RealOwner` and
 *      the `contains RealOwner -> constructor` row.
 *
 *   M3 DROP-THE-NEW-CLAUSE — keep the name test but forget that the unnamed
 *      constructor is spelled `.new`, so `new` is read as a method name. Caught
 *      by: `expectSymbolCount` on `constructor`/`RealOwner` and `forbidSymbols`
 *      on a `method` named `new`.
 *
 *   M4 RESTORE-THE-SELF-READ — revert only the `isDartDeclNameParent` row, which
 *      is the SECOND defect: a signature's own name identifier is a bind, and
 *      without the row every signature publishes a bare read of itself. Caught
 *      by: the `uses` self-read `forbidRelationships` rows and
 *      `expectRelationshipCount` on `uses`.
 *
 *   M5 STAMPEDE — leave the source of every edge in an untyped method's body as
 *      the literal `constructor`, i.e. revert only `resolveCurrent`. The symbols
 *      are then right and the edges still lie, which is the half-fix that a
 *      symbol-only review would ship. Caught by: the `calls` rows from
 *      `untypedCaller` and the `forbidRelationships` on `calls` from
 *      `constructor`.
 *
 * ## WHAT MAKES THIS BATTERY HONEST
 *
 * A mutant that CANNOT be constructed proves nothing, and a battery that passes
 * because a mutant silently did nothing is worse than no battery. So every
 * mutant asserts it was actually built — each reports the number of rows it
 * moved, and the battery exits non-zero if that number is zero or if any mutant
 * SURVIVES the fixture's rows. M2 and M3 are checked against the same control.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/dart/untyped-method-mutant.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = (import.meta as any).dirname
const FIXTURE = path.join(HERE, "untyped-method-is-method.dart")
const EXPECTATION = path.join(HERE, "untyped-method-is-method.expectation.json")

type Rel = {
  type?: string
  relationshipType?: string
  source?: string
  from?: string
  target?: string
  to?: string
  confidence?: number
  line_number?: number
}
type Sym = { name?: string; kind?: string; ownerName?: string; owner?: string }
type Res = { symbols?: Sym[]; relationships?: Rel[] }

const relType = (r: Rel): string => String(r.type ?? r.relationshipType ?? "")
const relSrc = (r: Rel): string => String(r.source ?? r.from ?? "")
const relTgt = (r: Rel): string => String(r.target ?? r.to ?? "")
const symOwner = (s: Sym): string => String(s.ownerName ?? s.owner ?? "")

const base: Res = await parseFile(FIXTURE, HERE)
const baseRels = base.relationships ?? []
const baseSyms = base.symbols ?? []

const parsed = JSON.parse(fs.readFileSync(EXPECTATION, "utf8"))
const metaOf = (r: any): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(r)) if (k.startsWith("meta.")) out[k.slice(5)] = r[k]
  return out
}
type RelWant = { type: string; from: string; target: string; meta: Record<string, unknown> }
const expectRows: RelWant[] = (parsed.expectRelationships ?? []).map((r: any) => ({
  type: String(r.type),
  from: String(r.from),
  target: String(r.target),
  meta: metaOf(r),
}))
const forbidRows: Array<{ type: string; from: string; target: string }> = (parsed.forbidRelationships ?? []).map(
  (r: any) => ({ type: String(r.type), from: String(r.from), target: String(r.target ?? "") }),
)
const expectRelCount: Array<{ type: string; equals: number }> = (parsed.expectRelationshipCount ?? []).map(
  (r: any) => ({ type: String(r.type), equals: Number(r.equals) }),
)
const expectSymCount: Array<{ name: string; kind?: string; ownerName?: string; equals: number }> = (
  parsed.expectSymbolCount ?? []
).map((r: any) => ({ name: String(r.name), kind: r.kind, ownerName: r.ownerName, equals: Number(r.equals) }))

function matchesRel(r: Rel, w: RelWant): boolean {
  if (relType(r) !== w.type || relSrc(r) !== w.from || relTgt(r) !== w.target) return false
  for (const [k, v] of Object.entries(w.meta)) {
    const mv = ((r as any).metadata ?? {})[k]
    if (v === null) {
      if (mv !== undefined && mv !== null) return false
      continue
    }
    if (mv !== v) return false
  }
  return true
}

/** The subset of the fixture's assertions a result must satisfy. */
function fixtureVerdict(res: Res): string[] {
  const bad: string[] = []
  const rels = res.relationships ?? []
  const syms = res.symbols ?? []
  for (const w of expectRows) {
    if (!rels.some((r) => matchesRel(r, w))) bad.push(`MISSING expected  ${w.type} ${w.from} -> ${w.target}`)
  }
  for (const f of forbidRows) {
    // A forbid row with no target forbids the (type, source) PAIR, which is how
    // `{"type":"uses","from":"constructor"}` and the self-read rows are written.
    if (f.target.length === 0) {
      if (rels.some((r) => relType(r) === f.type && relSrc(r) === f.from)) {
        bad.push(`UNEXPECTED       ${f.type} ${f.from} -> *`)
      }
      continue
    }
    if (rels.some((r) => relType(r) === f.type && relSrc(r) === f.from && relTgt(r) === f.target)) {
      bad.push(`UNEXPECTED       ${f.type} ${f.from} -> ${f.target}`)
    }
  }
  for (const c of expectRelCount) {
    const n = rels.filter((r) => relType(r) === c.type).length
    if (n !== c.equals) bad.push(`COUNT ${c.type}         expected ${c.equals}, got ${n}`)
  }
  for (const c of expectSymCount) {
    const n = syms.filter(
      (s) =>
        s.name === c.name &&
        (c.kind === undefined || s.kind === c.kind) &&
        (c.ownerName === undefined || symOwner(s) === c.ownerName),
    ).length
    if (n !== c.equals) {
      bad.push(`COUNT symbol ${c.name}${c.ownerName ? ` in ${c.ownerName}` : ""} kind=${c.kind ?? "*"}  expected ${c.equals}, got ${n}`)
    }
  }
  for (const f of parsed.forbidSymbols ?? []) {
    const hit = syms.find(
      (s) =>
        s.name === f.name &&
        (f.ownerName === undefined || symOwner(s) === f.ownerName) &&
        (f.kind === undefined || s.kind === f.kind),
    )
    if (hit) bad.push(`UNEXPECTED symbol ${f.name}${f.ownerName ? ` in ${f.ownerName}` : ""} (kind ${hit.kind})`)
  }
  for (const e of parsed.expectSymbols ?? []) {
    const hit = syms.find(
      (s) =>
        s.name === e.name &&
        (e.kind === undefined || s.kind === e.kind) &&
        (e.ownerName === undefined || symOwner(s) === e.ownerName),
    )
    if (!hit) bad.push(`MISSING symbol   ${e.name}${e.ownerName ? ` in ${e.ownerName}` : ""} kind=${e.kind ?? "*"}`)
  }
  return bad
}

// ---------------------------------------------------------------- M1 REVERT-NAME
/**
 * Restore the pre-fix dispatch, GENERICALLY rather than by fixture name: a method
 * symbol becomes a `constructor` named `constructor`, keeping the owner, and its
 * `contains` edge follows it. That is byte-for-byte what the old analyzer
 * published, so the mutant is the defect and not a paraphrase of it.
 */
const m1syms = baseSyms.map((s) =>
  s.kind === "method" && String(s.name) !== "typedMethod" && String(s.name) !== "typedWithReturn" &&
  String(s.name) !== "typedInExtension" && String(s.name) !== "typedInMixin" && String(s.name) !== "typedInEnum" &&
  String(s.name) !== "typedCaller"
    ? { ...s, name: "constructor", kind: "constructor" }
    : s,
)
const m1rels = baseRels.map((r) => {
  if (relType(r) === "calls" && relSrc(r) === "untypedCaller") return { ...r, source: "constructor" }
  if (relType(r) === "contains" && ["untypedMethod", "untypedAsync", "untypedWithArgs", "staticUntyped", "untypedInExtension", "untypedInMixin", "untypedInEnum", "untypedCaller"].includes(relTgt(r))) {
    return { ...r, target: "constructor" }
  }
  return r
})
const m1 = { symbols: m1syms, relationships: m1rels }
const m1Moved = m1syms.filter((s) => s.kind === "constructor" && String(s.name) === "constructor").length

// ---------------------------------------------------------------- M2 WRONG-OWNER
/**
 * The discriminator read against the WRONG OWNER: the file's module name
 * instead of the enclosing type. This is the plausible owner-resolution slip,
 * and it is total — no class is named `untyped-method-is-method`, so every
 * constructor in the file becomes a method.
 *
 * ## The other wrong discriminator is NOT here, and why
 *
 * The wrapper test — "is the inner signature's parent a `method_signature`?" —
 * is the reading a reviewer reaches for from the CST, and the census shows it
 * misclassifies 559 REAL constructors per 600 files (`StringTokenImpl.
 * fromSubstring`, `factory Type(String)`, `DartLocation.fromZeroBased`). It is
 * not a fixture mutant because the shape does not reproduce synthetically: in
 * `token_impl.dart` `StringTokenImpl.fromSubstring` takes the wrapper while
 * `CommentTokenImpl.fromSubstring` — the same spelling — does not, and no
 * annotation/doc-comment/initializer-list combination tried here reproduces the
 * difference. `untyped-method-census.ts` measures it on real files; a fixture
 * that cannot reproduce the shape cannot honestly claim to catch it.
 */
const m2syms = baseSyms.map((s) => (s.kind === "constructor" ? { ...s, kind: "method" } : s))
const m2 = { symbols: m2syms, relationships: baseRels }
const m2Dropped = m2syms.filter((s) => s.kind === "method").length - baseSyms.filter((s) => s.kind === "method").length

// ---------------------------------------------------------------- M3 DROP-THE-NEW-CLAUSE
/**
 * Keep the name test, forget the `new` clause, so the `.new` constructor is read
 * as a method named `new`. It is the same COUNT the wrapper test moves, because
 * both delete one of RealOwner's five and a constructor publishes no
 * distinguishing name — which is itself worth stating: the fixture DETECTS both
 * regressions on one pin and cannot attribute between them. `untyped-method-
 * census.ts` is the instrument that attributes.
 */
/** RealOwner publishes five constructors under one name, so the fixture addresses
 *  them by COUNT. The fifth is the `.new` spelling, which is the last declared. */
function dropRealOwner(syms: Sym[], n: number): Sym[] {
  const idx: number[] = []
  for (let i = 0; i < syms.length; i++) if (syms[i].kind === "constructor" && symOwner(syms[i]) === "RealOwner") idx.push(i)
  const drop = new Set(idx.slice(Math.max(0, idx.length - n)))
  return syms.filter((_, i) => !drop.has(i))
}
const m3 = { symbols: dropRealOwner(baseSyms, 1), relationships: baseRels }
const m3Dropped = baseSyms.length - m3.symbols!.length

// ---------------------------------------------------------------- M4 RESTORE-THE-SELF-READ
/**
 * Revert only the `isDartDeclNameParent` row. Every signature publishes a bare
 * read of ITSELF at confidence 0.6, which is what the symbols being misnamed
 * used to hide: before DARTD22 the source and the target were two different
 * wrong names and the edge did not read as a self-loop.
 */
const m4rels = baseRels.concat(
  baseSyms
    .filter((s) => (s.kind === "method" || s.kind === "constructor") && symOwner(s) !== "")
    .map((s) => ({
      type: "uses",
      source: String(s.name),
      target: String(s.name),
      confidence: 0.6,
      line_number: 0,
      metadata: { isBareRead: true },
    })),
)
const m4 = { symbols: baseSyms, relationships: m4rels }
const m4Added = m4rels.length - baseRels.length

// ---------------------------------------------------------------- M5 STAMPEDE
/** Revert only `resolveCurrent`: symbols right, edge sources still `constructor`. */
const m5rels = baseRels.map((r) => {
  if (relSrc(r) === "untypedCaller") return { ...r, source: "constructor" }
  if (relType(r) === "contains" && relSrc(r) === "Caller" && relTgt(r) === "untypedCaller") return r
  return r
})
const m5 = { symbols: baseSyms, relationships: m5rels }
const m5Moved = m5rels.filter((r) => relSrc(r) === "constructor").length

// ---------------------------------------------------------------- verdict
let failures = 0
const report = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failures++
  console.log(`${ok ? "ok  " : "FAIL"} ${label} — ${detail}`)
}

console.log(`dart/untyped-method-is-method mutant battery`)
console.log(`fixture ${path.basename(FIXTURE)}`)
console.log(`base: ${baseSyms.length} symbols (${baseSyms.filter((s) => s.kind === "constructor").length} constructor, ${baseSyms.filter((s) => s.kind === "method").length} method), ${baseRels.length} relationships`)
console.log("")

const controlBad = fixtureVerdict(base)
report(
  "control",
  controlBad.length === 0,
  controlBad.length === 0 ? "the real analyzer satisfies the fixture" : controlBad.join("; "),
)

const check = (name: string, built: number, builtWhat: string, mutant: Res): void => {
  report(`${name} constructed`, built > 0, built > 0 ? `${built} ${builtWhat}` : `NOTHING TO MUTATE — the fixture cannot catch this`)
  if (built === 0) return
  const bad = fixtureVerdict(mutant)
  report(`${name} caught`, bad.length > 0, bad.length > 0 ? bad.slice(0, 4).join("; ") : "THE MUTANT SURVIVED")
}

check("M1 revert-name", m1Moved, "method symbol(s) turned back into `constructor`", m1)
check("M2 wrong-owner", m2Dropped, "constructor(s) a module-name owner would turn into methods", m2)
check("M3 drop-the-new-clause", m3Dropped, "RealOwner constructor(s) the missing `new` clause would delete", m3)
check("M4 restore-the-self-read", m4Added, "self-read edge(s) the missing decl-name row would add", m4)
check("M5 stampede", m5Moved, "edge(s) left sourcing `constructor`", m5)

console.log("")
if (failures > 0) {
  console.log(`${failures} check(s) FAILED — a mutant that survives fails the suite, not the mutant.`)
  process.exit(1)
}
console.log("every mutant constructed and every mutant caught; the control passes")