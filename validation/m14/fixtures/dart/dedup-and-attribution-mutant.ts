/**
 * dart/contains-qualification — THE MUTANTS, and the check that they are caught.
 *
 * ## The change this battery exists for
 *
 * `addContainmentRelationships` (src/ast/real-dart-analyzer.ts) used to publish
 * `target: symbol.name` — the member's BARE name. It now publishes the member's
 * published spelling, `symbol.scope ? `${scope}.${name}` : name`, so the target
 * is the same string `pool-worker.ts` synthesises into the symbol's
 * `qualifiedName`.
 *
 * This was the lane's last type emitting two bare names, and its largest:
 * whole-corpus, `contains` was 700,265 edges / 169,829 resolved / 530,368
 * ambiguous, i.e. 75.7% of the type unwalkable — and not because any member was
 * wrong. A Dart project repeats member names constantly (`value`, `build`,
 * `props`, `constructor`), and a bare name that two declarations carry is
 * ambiguous BY CONSTRUCTION: the shared resolver accepts a bare name only under
 * `HAVING COUNT(*) = 1`. Priced before it was built on whole checkouts
 * (validation/m14/fixtures/dart/contains-target-price.ts, dart-http + riverpod +
 * proxicall, 292,017 contains edges): 267,878 ambiguous -> resolved (91.7%),
 * 14,564 ambiguous -> ambiguous (every one an OWNER-name collision), 9,575
 * resolved -> resolved, 0 resolved -> ambiguous.
 *
 * ## Why a battery rather than a fixture edit
 *
 * A pin that cannot fail proves nothing, and this lane's record includes shipping
 * defects behind a green suite. `script/m14/mutate-analyzer.ts` is SHARED
 * machinery (report, do not edit), so the battery is lane-owned and
 * self-contained, exactly like `untyped-method-mutant.ts` and
 * `object-interface-mutant.ts`: it constructs the ways the qualification can be
 * wrong, applies each to the REAL analyzer's output, and requires the fixture's
 * OWN `contains` rows to catch each.
 *
 * ## THE MUTANTS
 *
 *   M1 BARE-TARGET — strip the owner from every contains target. This is the
 *      exact pre-fix emission, not a paraphrase of it. Caught by the fixture's
 *      `contains` expect rows (`IconSet.acorn`, `IconSet.constructor`, ...).
 *
 *   M2 MODULE-PREFIX — qualify with the FILE's module name instead of the
 *      member's scope. This is the plausible slip, not a straw man: the analyzer
 *      already computes a module identity (`DartLibrarySite.moduleIdentity`) for
 *      `imports`/`exports`, so "reuse the module identity" is one line away and
 *      reads as consistent. Caught by the same rows (the module is
 *      `dedup-and-attribution`, no member's owner).
 *
 *   M3 DOUBLE-QUALIFY — prefix an already-qualified target. Also a real slip, not
 *      a straw man: `pool-worker.ts` synthesises `s.qualifiedName || s.metadata?.fqn
 *      || (s.scope ? ... : s.name)`, so a producer that re-derives the spelling
 *      from an already-qualified value publishes `Owner.Owner.member`. Caught by
 *      the same rows — which is the point: they pin the EXACT spelling, not
 *      merely "the target contains a dot".
 *
 * ## THE COLLISION CENSUS (an assertion, not a mutant)
 *
 * The three mutants above prove the fixture discriminates the SPELLING. They
 * cannot say why the spelling matters, so the battery also measures it locally:
 * of this fixture's `contains` edges, how many name a member whose BARE name is
 * declared more than once IN THIS ONE FILE. That is a floor on the project-wide
 * ambiguity the corpus table prices, and the battery exits non-zero if it is
 * zero — a fixture with no repeated member name could not demonstrate the
 * problem the qualifier solves, and the battery would be claiming a reason it
 * had not shown.
 *
 * ## WHAT THIS BATTERY DOES NOT PROVE (stated because it is easy to over-read)
 *
 * It mutates the PUBLISHED PAYLOAD, not the analyzer source. It therefore proves
 * the fixture rows DISCRIMINATE the qualified spelling; it does not prove the
 * analyzer computes that spelling from the member's own fields by the right
 * route. That is a separate probe, run in the round that made the change and
 * recorded in docs/analyzers/dart.md: for every member symbol,
 * `scope === ownerName` and the published `qualifiedName === Owner.member`, so
 * the edge and the node it names are one string from one rule.
 *
 * The battery reads ONLY `contains` rows (expect + forbid). The fixture's other
 * rows are deliberately out of scope here: several types (`imports` especially)
 * resolve differently under the harness's synthetic `fixtures/dart/<name>.dart`
 * path than under this battery's real on-disk path, so including them would make
 * the control fail for a reason that has nothing to do with this round.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/dart/dedup-and-attribution-mutant.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = (import.meta as any).dirname
const FIXTURE = path.join(HERE, "dedup-and-attribution.dart")
const EXPECTATION = path.join(HERE, "dedup-and-attribution.expectation.json")
const MODULE = path.basename(FIXTURE, ".dart")

type Rel = {
  type?: string
  relationshipType?: string
  source?: string
  from?: string
  fromSymbol?: string
  target?: string
  to?: string
  toSymbol?: string
  confidence?: number
  line_number?: number
  metadata?: Record<string, unknown>
}
type Sym = { name?: string; kind?: string; ownerName?: string; owner?: string }
type Res = { symbols?: Sym[]; relationships?: Rel[] }

const relType = (r: Rel): string => String(r.type ?? r.relationshipType ?? "")
const relSrc = (r: Rel): string => String(r.source ?? r.from ?? r.fromSymbol ?? "")
const relTgt = (r: Rel): string => String(r.target ?? r.to ?? r.toSymbol ?? "")

const base: Res = await parseFile(FIXTURE, HERE)
const baseRels = base.relationships ?? []
const baseSyms = base.symbols ?? []
const containsRels = baseRels.filter((r) => relType(r) === "contains")

const parsed = JSON.parse(fs.readFileSync(EXPECTATION, "utf8"))
const metaOf = (r: any): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(r)) if (k.startsWith("meta.")) out[k.slice(5)] = r[k]
  return out
}
type RelWant = {
  from?: string
  target?: string
  meta: Record<string, unknown>
  prose: string
}
/** `contains` rows only — see the header's scope note. */
const rowsOf = (sect: string): RelWant[] =>
  (parsed[sect] ?? [])
    .filter((r: any) => String(r.type) === "contains")
    .map((r: any) => ({
      from: r.from ?? r.source ?? r.fromSymbol,
      target: r.target ?? r.to ?? r.toSymbol,
      meta: metaOf(r),
      prose: JSON.stringify(r).slice(0, 140),
    }))

const expectRows = rowsOf("expectRelationships")
const forbidRows = rowsOf("forbidRelationships")

function matchesRel(r: Rel, w: RelWant): boolean {
  // A row that omits `from` / `target` is a wildcard on that end, exactly as the
  // runner's matchConstraints treats it (it only compares the keys present).
  if (w.from !== undefined && relSrc(r) !== w.from) return false
  if (w.target !== undefined && relTgt(r) !== w.target) return false
  for (const [k, v] of Object.entries(w.meta)) {
    const mv = (r.metadata ?? {})[k]
    if (v === null) {
      if (mv !== undefined && mv !== null) return false
      continue
    }
    if (mv !== v) return false
  }
  return true
}

/** The subset of the fixture's assertions this battery covers: its contains rows. */
function fixtureVerdict(res: Res): string[] {
  const bad: string[] = []
  const rels = res.relationships ?? []
  for (const w of expectRows) {
    if (!rels.some((r) => matchesRel(r, w))) bad.push(`MISSING    contains ${w.from ?? "*"} -> ${w.target ?? "*"}`)
  }
  for (const f of forbidRows) {
    if (rels.some((r) => matchesRel(r, f))) bad.push(`UNEXPECTED contains ${f.from ?? "*"} -> ${f.target ?? "*"}`)
  }
  return bad
}

// ------------------------------------------------------------------- the mutants
/** M1 BARE-TARGET — the exact pre-fix emission: two bare names on every contains edge. */
const m1rels = baseRels.map((r) =>
  relType(r) === "contains" && relTgt(r).includes(".")
    ? { ...r, target: relTgt(r).slice(relTgt(r).lastIndexOf(".") + 1) }
    : r,
)
const m1 = { symbols: baseSyms, relationships: m1rels }
const m1Moved = containsRels.filter((r) => relTgt(r).includes(".")).length

/** M2 MODULE-PREFIX — the owner read off the wrong table: the file's identity, not the member's scope. */
const m2rels = baseRels.map((r) =>
  relType(r) === "contains"
    ? { ...r, target: `${MODULE}.${relTgt(r).slice(relTgt(r).lastIndexOf(".") + 1)}` }
    : r,
)
const m2 = { symbols: baseSyms, relationships: m2rels }
const m2Moved = containsRels.length

/** M3 DOUBLE-QUALIFY — the qualifier applied to an already-qualified target. */
const m3rels = baseRels.map((r) =>
  relType(r) === "contains" && relTgt(r).includes(".")
    ? { ...r, target: `${relTgt(r).slice(0, relTgt(r).indexOf("."))}.${relTgt(r)}` }
    : r,
)
const m3 = { symbols: baseSyms, relationships: m3rels }
const m3Moved = containsRels.filter((r) => relTgt(r).includes(".")).length

// ---------------------------------------------------------- the collision census
/**
 * Of this fixture's contains edges, how many name a member whose BARE name is
 * declared more than once in this file? Counted over the analyzer's own symbol
 * table, so the number is a floor on the project-wide ambiguity production sees
 * (`WHERE project_id = ?` over every file of the repository, not just this one).
 */
const declCount = new Map<string, number>()
for (const s of baseSyms) {
  const n = String(s.name ?? "")
  declCount.set(n, (declCount.get(n) ?? 0) + 1)
}
const colliding = containsRels
  .map((r) => relTgt(r).slice(relTgt(r).lastIndexOf(".") + 1))
  .filter((bare) => (declCount.get(bare) ?? 0) > 1)
const worst = [...declCount.entries()]
  .filter(([n]) => containsRels.some((r) => relTgt(r).slice(relTgt(r).lastIndexOf(".") + 1) === n))
  .sort((a, b) => b[1] - a[1])[0]

// --------------------------------------------------------------------- the run
let failures = 0
const report = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failures++
  console.log(`${ok ? "ok  " : "FAIL"} ${label} — ${detail}`)
}

console.log(`dart/contains-qualification mutant battery (host fixture: dedup-and-attribution)`)
console.log(
  `base: ${baseSyms.length} symbols, ${containsRels.length} contains edges of ${baseRels.length} relationships; ` +
    `${expectRows.length} contains expect row(s), ${forbidRows.length} contains forbid row(s)`,
)
console.log("")

const controlBad = fixtureVerdict(base)
report(
  "control",
  controlBad.length === 0,
  controlBad.length === 0
    ? "the real analyzer satisfies the fixture's contains rows"
    : controlBad.join("; "),
)

const check = (name: string, built: number, builtWhat: string, mutant: Res): void => {
  report(
    `${name} constructed`,
    built > 0,
    built > 0 ? `${built} ${builtWhat}` : "NOTHING TO MUTATE — the fixture cannot catch this",
  )
  if (built === 0) return
  const bad = fixtureVerdict(mutant)
  report(`${name} caught`, bad.length > 0, bad.length > 0 ? bad.slice(0, 3).join("; ") : "THE MUTANT SURVIVED")
}

check("M1 bare-target", m1Moved, "contains target(s) de-qualified to the bare member name", m1)
check("M2 module-prefix", m2Moved, "contains target(s) qualified with the file's identity instead of the owner", m2)
check("M3 double-qualify", m3Moved, "contains target(s) qualified a second time", m3)

report(
  "collision census",
  colliding.length > 0,
  colliding.length > 0
    ? `${colliding.length} of ${containsRels.length} contains edge(s) name a member whose BARE name is declared ` +
      `more than once in this file (worst: \`${worst?.[0]}\` x${worst?.[1]}) — a bare target for those is ambiguous ` +
      `by construction, which is the defect the qualifier closes`
    : "NO REPEATED MEMBER NAME — this fixture cannot demonstrate why the qualifier is required",
)

console.log("")
if (failures > 0) {
  console.log(`${failures} check(s) FAILED — a mutant that survives fails the suite, not the mutant.`)
  process.exit(1)
}
console.log("every mutant constructed and every mutant caught; the control passes")
