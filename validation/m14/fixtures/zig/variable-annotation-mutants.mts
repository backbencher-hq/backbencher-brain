/**
 * Z68 REGRESSION MUTANTS — a variable's type annotation must be able to FAIL, in
 * both directions.
 *
 * The fix has two halves that fail independently, and a suite that mutants only
 * one of them reports the other as working:
 *
 *   - the SUPPRESSION half: `isTypePosition` now answers TRUE for a chain that
 *     reaches a `variable_declaration` through its annotation, so the duplicate
 *     `uses` is gone (M1, M3).
 *   - the CARRY half: Z16 already published the same fact as
 *     `references (declared_type)`, and that publication must SURVIVE (M4).
 *
 * M4 is the mutant that matters most. Suppressing the duplicate without the fact
 * being carried anywhere is the dishonest fix: the edge count drops, every gate
 * gets quieter, and the type dependency disappears from the graph entirely. It is
 * invisible to a suite that only forbids the `uses` row. M2 is the opposite
 * failure — a rule that suppresses every field_expression under a declaration
 * would pass every forbid and silently delete real runtime reads.
 *
 * **Imports `matchConstraints` from `script/m14/run-fixtures.ts`** for the reason
 * `contains-target-mutants.mts` records: a harness that restates the matcher can
 * pass a mutant the real runner would catch, and the log then says "caught" while
 * the suite disagrees.
 *
 * The mutants transform the parse RESULT, the shape every harness in this lane
 * uses: a mutant here is "what the analyzer would have emitted had it made this
 * mistake". M1 and the boundary-ordering mistake are the SAME emitted result — a
 * `variable_declaration` tested after the VALUE_BOUNDARY check answers from the
 * boundary and is exactly the pre-fix behaviour — so they are one mutant here and
 * the ordering claim is carried by M1 rather than counted twice.
 *
 * **What this file asserts that the fixture runner cannot.** The reason code lives
 * in `metadata.relationshipType`, and the runner constrains the flattened row, so
 * an expectation carrying that key is inert and is REPORTED as inert. The check
 * below therefore reads the metadata directly: the surviving `references` edges
 * must still say `declared_type` and the surviving `uses` edges must still say
 * `zig_field_access`. A relabel that kept the counts right would pass the fixture.
 *
 * Exit non-zero if any mutant survives, and exit 2 if the fixture is red before
 * any mutant is applied — otherwise "caught" below would be unattributable.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/variable-annotation-mutants.mts
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { matchConstraints } from "../../../../script/m14/run-fixtures"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, "variable-annotation-type-position.zig")
const EXPECT = JSON.parse(readFileSync(path.join(HERE, "variable-annotation-type-position.expectation.json"), "utf8"))

type Rels = { relationships?: any[]; symbols?: any[] }

function norm(r: any) {
  return { ...r, from: r.from ?? r.source ?? r.fromSymbol, target: r.target ?? r.to ?? r.toSymbol, type: r.type ?? r.relationshipType }
}

/** An `expect` row fails when NO item satisfies it; a `forbid` row fails when one
 *  does. Same shape as `owner-path-mutants.mts`. */
function failedAssertions(rels: any[], exp: any): string[] {
  const rows = rels.map(norm)
  const bad: string[] = []
  for (const want of exp.expectRelationships ?? []) {
    if (!rows.some((r) => matchConstraints(r, want))) bad.push(`expect UNMET ${want.type}[${want.source}->${want.target}]`)
  }
  for (const want of exp.forbidRelationships ?? []) {
    if (rows.some((r) => matchConstraints(r, want))) bad.push(`forbid VIOLATED ${want.type}[->${want.target}]`)
  }
  return bad
}

/** Build a `uses` edge exactly as the field-access pass builds one, so a mutant
 *  that ADDS edges produces something the matcher can see rather than a shape it
 *  would silently never match. */
function fieldUses(source: string, target: string, line: number): any {
  return {
    source, target, type: "uses", confidence: 0.75, line_number: line,
    metadata: { relationshipType: "zig_field_access", fieldAccessExpression: `${target}` },
  }
}
function declaredTypeRef(target: string, line: number): any {
  return {
    source: "(declared-type)", target, type: "references", confidence: 0.9, line_number: line,
    metadata: { relationshipType: "declared_type" },
  }
}

const MUTANTS: { id: string; what: string; caughtBy: string; apply: (r: Rels) => Rels }[] = [
  {
    id: "M1",
    what: "revert the fix: a chain reaching a variable_declaration is a value again, so the duplicate `uses` edges come back",
    caughtBy: "the three forbid rows — the pre-fix output is exactly this",
    apply: (r) => {
      const rels = [...(r.relationships ?? [])]
      rels.push(fieldUses("annotationIsNotARead", "Foo", 20))
      rels.push(fieldUses("annotationIsNotARead", "Bar", 24))
      rels.push(fieldUses("annotationIsNotARead", "Quux", 28))
      return { ...r, relationships: rels }
    },
  },
  {
    id: "M2",
    what: "over-suppress: treat EVERY field_expression under a variable_declaration as a type position, testing the DECLARATION rather than arriving at the ANNOTATION",
    caughtBy: "the two initializer expect rows — real runtime reads must survive",
    apply: (r) => {
      const rels = (r.relationships ?? []).filter((e: any) => !norm(e).from.startsWith("annotationIsNotARead") || (norm(e).target !== "baz" && norm(e).target !== "qux"))
      return { ...r, relationships: rels }
    },
  },
  {
    id: "M3",
    what: "identity test instead of an ancestry test: the annotation node IS the chain node, so `?c.Bar`'s inner segment (a DESCENDANT of the annotation) is not recognised",
    caughtBy: "the `Bar` forbid row alone — the plain `c.Foo` shape still passes",
    apply: (r) => {
      const rels = [...(r.relationships ?? [])]
      rels.push(fieldUses("annotationIsNotARead", "Bar", 24))
      return { ...r, relationships: rels }
    },
  },
  {
    id: "M4",
    what: "THE ANTI-SUPPRESSION MUTANT: the duplicate is suppressed and the fact is NOT carried anywhere — Z16's variable_declaration read is dropped",
    caughtBy: "the three `references` expect rows. Invisible to any suite that only forbids the `uses`",
    apply: (r) => {
      const rels = (r.relationships ?? []).filter((e: any) => {
        const n = norm(e)
        return !(n.type === "references" && n.from === "(declared-type)" && (n.target === "Foo" || n.target === "Bar" || n.target === "Quux"))
      })
      return { ...r, relationships: rels }
    },
  },
  {
    id: "M5",
    what: "the fact is carried under a NEW source string, simulating a fix that adds a separate `(variable-annotation)` pass instead of reusing Z16",
    caughtBy: "the three `references` expect rows, which pin `(declared-type)` — every consumer keyed on that string would break",
    apply: (r) => {
      const rels = (r.relationships ?? []).map((e: any) => {
        const n = norm(e)
        if (n.type === "references" && n.from === "(declared-type)" && (n.target === "Foo" || n.target === "Bar" || n.target === "Quux")) {
          return { ...e, source: "(variable-annotation)" }
        }
        return e
      })
      return { ...r, relationships: rels }
    },
  },
]

const real: Rels = (await parseFile(FIXTURE, "zig")) ?? {}
const baseline = failedAssertions(real.relationships ?? [], EXPECT)
if (baseline.length > 0) {
  console.error("FIXTURE IS RED BEFORE ANY MUTANT — every result below would be unattributable:")
  for (const b of baseline) console.error("  " + b)
  process.exit(2)
}

// The reason-code check the fixture runner cannot express.
const rels: any[] = (real.relationships ?? []).map(norm)
const reasonProblems: string[] = []
for (const t of ["Foo", "Bar", "Quux"]) {
  const e = rels.find((r) => r.type === "references" && r.target === t && r.from === "(declared-type)")
  if (!e) reasonProblems.push(`no declared_type edge for ${t}`)
  else if (e.metadata?.relationshipType !== "declared_type") reasonProblems.push(`${t} carries reasonCode ${e.metadata?.relationshipType}`)
}
for (const t of ["baz", "qux"]) {
  const e = rels.find((r) => r.type === "uses" && r.target === t)
  if (!e) reasonProblems.push(`value read ${t} was lost`)
  else if (e.metadata?.relationshipType !== "zig_field_access") reasonProblems.push(`${t} carries reasonCode ${e.metadata?.relationshipType}`)
}
if (reasonProblems.length > 0) {
  console.error("REASON-CODE CHECK FAILED (the runner cannot assert this):")
  for (const p of reasonProblems) console.error("  " + p)
  process.exit(2)
}
console.log("reason-code check: PASS — declared_type and zig_field_access survive on the edges that remain")

let survivors = 0
for (const m of MUTANTS) {
  const bad = failedAssertions(m.apply(structuredClone(real)).relationships ?? [], EXPECT)
  if (bad.length === 0) {
    survivors++
    console.log(`SURVIVED  ${m.id}  ${m.what}`)
    console.log(`          expected ${m.caughtBy}, but the fixture still passed`)
  } else {
    console.log(`CAUGHT    ${m.id}  ${bad.length} assertion(s) failed`)
    console.log(`          ${m.what}`)
    console.log(`          ${bad.join("; ")}`)
  }
}
console.log(`\n${MUTANTS.length - survivors}/${MUTANTS.length} caught`)
process.exit(survivors > 0 ? 1 : 0)