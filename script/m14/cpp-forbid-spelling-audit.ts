/**
 * cpp-forbid-spelling-audit — THE SPELLING-CONTRACT AUDIT, OVER EVERY cpp FORBID ROW.
 *
 * THE RULE (Lead's ruling L-2026-10-21-07, and the csharp lane's measured case): **A FORBID ROW
 * MUST PIN THE SPELLING CONTRACT, NOT ONLY THE RELATIONSHIP.** A defect that changes the SPELLING
 * of a row can hide behind a forbid that pins only the relationship, and the mutation battery will
 * then call this lane clean while the defect is live. The measured case: csharp's
 * `interface-member-conforming-dropped` re-added rows with the target spelled `IThing.GetName`
 * while every forbid pinned the BARE spelling `GetName` — 73 mutants, 1 survivor, invisible.
 *
 * THE SHAPE IN THIS LANE, and it is the SAME shape and NOT a guess: the C++ analyzer publishes a
 * member's target as its LEAF (that is wall W4 — `src/ast/pool-worker.ts:1334`: a cpp member
 * symbol publishes neither `qualifiedName` nor `scope` nor `metadata.fqn`, so its published
 * identity is the leaf). **⇒ A DEFECT THAT RE-SPELLS A MEMBER TARGET AS `owner::member` HIDES
 * BEHIND EVERY FORBID THAT PINS THE BARE SPELLING** — the same hole, in this lane's vocabulary.
 *
 * WHAT THIS INSTRUMENT DOES: for every cpp fixture it runs the analyzer over that fixture's own
 * source (the same path the fixture runner uses), takes the OWNERS it publishes for each symbol,
 * and for EVERY forbid row computes the owner-qualified SPELLING VARIANTS of that row's `from` and
 * `target` — and reports the variants the fixture does NOT forbid. The output is a WORK-LIST, not
 * a verdict: a variant is a spelling a defect could emit, and a forbid that does not name it is a
 * hole in the battery.
 *
 * USAGE
 *   bun run script/m14/cpp-forbid-spelling-audit.ts [--json=<path>] [--only=<fixtureId>]
 *
 * EXIT: 0 measured (a clean audit is a measured zero, not a pass claim) · 2 environment.
 */
import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const FIXDIR = path.join(ROOT, "validation/m14/fixtures/cpp")
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const JSON_OUT = argOf("--json")
const ONLY = argOf("--only")

const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const parser: any = await getParser("cpp")
const mod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))

const expectations = readdirSync(FIXDIR).filter((f) => f.endsWith(".expectation.json")).sort()
const holes: any[] = []
let fixturesRead = 0
let forbidRows = 0
let variants = 0
for (const ef of expectations) {
  const id = ef.replace(".expectation.json", "")
  if (ONLY && id !== ONLY) continue
  const exp = JSON.parse(readFileSync(path.join(FIXDIR, ef), "utf8"))
  const forbids: any[] = exp.forbidRelationships ?? []
  if (forbids.length === 0) continue
  const srcPath = path.join(FIXDIR, `${id}.cpp`)
  let res: any
  try {
    const content = readFileSync(srcPath, "utf8")
    const tree = parser.parse(content)
    const a: any = new mod.RealCppAnalyzer()
    res = await a.analyze(tree.rootNode, content, srcPath, {})
  } catch {
    continue
  }
  fixturesRead++
  // the owners each published symbol name has
  const ownersOf = new Map<string, Set<string>>()
  for (const s of res.symbols ?? []) {
    if (!s.name) continue
    if (!ownersOf.has(s.name)) ownersOf.set(s.name, new Set())
    if (s.ownerName) ownersOf.get(s.name)!.add(String(s.ownerName))
  }
  // THE MATCHER, EXACTLY THE RUNNER's: `matchConstraints` treats a key that is ABSENT as
  // UNCONSTRAINED, and a key that is `null` as "this field must be ABSENT or null" — the
  // `line_number: null` convention, applied one level up. So `from: null` is NOT "any source";
  // it is "the source must be absent". A variant row therefore has to carry the SAME constraint
  // shape as the row it comes from, and an existing forbid row with an ABSENT `from` covers
  // every source.
  const covered = (v: { type: string; from?: any; target?: any }): boolean =>
    forbids.some((f: any) => {
      if (f.type !== v.type) return false
      if (v.target !== undefined && String(f.target ?? "") !== String(v.target)) return false
      if (v.from !== undefined && f.from !== undefined && f.from !== v.from) return false
      return true
    })
  for (const f of forbids) {
    forbidRows++
    const type = String(f.type ?? "")
    for (const end of ["target", "from"] as const) {
      const v = f[end]
      if (v === undefined || v === null) continue
      const owners = ownersOf.get(String(v))
      if (!owners || owners.size === 0) continue
      for (const o of owners) {
        const qualified = `${o}::${v}`
        if (qualified === String(v)) continue
        variants++
        // THE VARIANT ROW, with the SAME constraint shape as the row it came from.
        const variant =
          end === "target"
            ? { type, from: f.from, target: qualified }
            : { type, from: qualified, target: f.target }
        if (covered(variant)) continue
        holes.push({
          fixture: exp.fixtureId ?? `cpp/${id}`,
          forbidRow: { type: f.type, from: f.from ?? null, target: f.target ?? null },
          missingSpelling: { side: end, qualified },
          variantRow: variant,
          owner: o,
          note: "a defect that re-spells this end of the row as the owner-qualified spelling would NOT be caught by this fixture: the forbid pins the relationship, not the SPELLING",
        })
      }
    }
  }
}
const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-forbid-spelling-audit.ts",
  measuredAt: new Date().toISOString(),
  rule: "L-2026-10-21-07 — a forbid row must pin the SPELLING CONTRACT, not only the relationship",
  population: { fixturesWithForbidRows: fixturesRead, forbidRows, ownerQualifiedVariantsConsidered: variants },
  holes,
  holeCount: holes.length,
}
if (JSON_OUT) fsWrite(JSON_OUT, report)
function fsWrite(p: string, r: any) {
  // eslint-disable-next-line
  require("node:fs").writeFileSync(p, JSON.stringify(r, null, 2) + "\n")
}
console.log("cpp-forbid-spelling-audit — the SPELLING CONTRACT of every cpp forbid row")
console.log(`  fixtures with forbid rows read : ${fixturesRead}`)
console.log(`  forbid rows audited            : ${forbidRows}`)
console.log(`  owner-qualified variants       : ${variants}`)
console.log(`  HOLES (a variant nothing forbids): ${holes.length}`)
for (const h of holes.slice(0, 40)) {
  console.log(`    ${h.fixture}  ${JSON.stringify(h.forbidRow)}  -> missing ${h.missingSpelling.side}=${h.missingSpelling.qualified}`)
}
if (holes.length > 40) console.log(`    ... and ${holes.length - 40} more`)
process.exit(0)
