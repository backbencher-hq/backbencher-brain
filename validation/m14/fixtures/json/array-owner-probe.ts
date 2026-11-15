/**
 * DOES THE BRACKET-FORM FIX CHANGE EDGE RESOLUTION, OR ONLY SPELLINGS?
 *
 * The fix at `afterModuleImpl` renames 17,803 symbols from the truncated `3][2][6]` to the
 * bracket form `[3][2][6]`. A rename is only safe if the edges that NAMED those symbols move
 * with them, so the question this answers is not "are the names better" — the probe answers
 * that — but "did any edge stop resolving".
 *
 * The risk is specific and worth naming. `contains` is emitted FROM THE OWNER symbol, and the
 * owner is derived from the child's NAME by cutting at the last `[`. So the owner name and the
 * child name are two spellings of one chain, derived by two separate pieces of code. If the
 * fix corrected the child's name but not the owner's, or corrected them at different depths,
 * the chain would still be self-consistent — every edge would still resolve INSIDE the file —
 * while no longer being true. Resolution alone therefore cannot distinguish "fixed" from
 * "fixed but wrong", which is why this reports both, plus the owner/child agreement that
 * resolution is blind to.
 *
 * ## What it measures, per relationship type
 *
 *   edges            total emitted
 *   resQualified     BOTH endpoints bind to a published symbol by qualifiedName
 *   resName          both endpoints bind by name when qualifiedName misses
 *   unresolved       neither — the bucket the graph cannot walk
 *   ownerAgrees      for `contains`, the edge's from-endpoint name is a PREFIX of its
 *                    to-endpoint name, i.e. the owner really is the enclosing scope rather
 *                    than a symbol that merely sorts near it
 *
 * Both endpoint spellings are tested against the published symbol set of the SAME file, and
 * an endpoint is only counted resolved if the file published a symbol for it. An endpoint that
 * resolves in no file is external, and the honest question about it is whether it is a
 * package, a path or an unpublished declaration — a different probe (`unknown-endpoints.ts`)
 * answers that; this one only reports the rate.
 *
 * Regex-free: string comparisons and `indexOf`/`slice` only.
 *
 *   xargs -a <list> -d '\n' npx tsx validation/m14/fixtures/json/array-owner-probe.ts
 */
import { parseFile } from "../../../../src/ast/pool-worker"
import { statSync } from "node:fs"
import * as path from "node:path"

const files = process.argv.slice(2).filter((a) => statSync(a, { throwIfNoEntry: false })?.isFile())

type Row = {
  edges: number
  resQualified: number
  resName: number
  ownerIsEnclosing: number
  ownerNameUnambiguous: number
  ownerNameAbsent: number
  ownerNameCollides: number
  ownerMatchesDeclared: number
}
const stats = new Map<string, Row>()

let filesRead = 0
let parseFailures = 0
let totalEdges = 0
let untyped = 0
const unresolvedExamples: string[] = []
const ownerAbsentExamples: string[] = []

function row(type: string): Row {
  let r = stats.get(type)
  if (!r) {
    r = { edges: 0, resQualified: 0, resName: 0, ownerIsEnclosing: 0, ownerNameUnambiguous: 0, ownerNameAbsent: 0, ownerNameCollides: 0, ownerMatchesDeclared: 0 }
    stats.set(type, r)
  }
  return r
}

for (const file of files) {
  let result: Awaited<ReturnType<typeof parseFile>>
  try {
    result = await parseFile(file, path.dirname(file))
  } catch {
    parseFailures++
    continue
  }
  filesRead++

  const symbols = result.symbols ?? []
  const byQualified = new Map<string, string>()
  const byName = new Map<string, number>()
  const ownerNameOf = new Map<string, string | undefined>()
  const nameToQualified = new Map<string, string>()
  // Pass 1 — counts. A name's multiplicity is a property of the whole file, so it cannot be
  // known while the file is still being counted; the first version of this probe resolved
  // names inside this loop and every name it saw looked unique because it was the first.
  for (const s of symbols) {
    byName.set(s.name, (byName.get(s.name) ?? 0) + 1)
  }
  // Pass 2 — attribution, now that multiplicity is known.
  for (const s of symbols) {
    byQualified.set(s.qualifiedName, s.name)
    // If two symbols share a qualifiedName the declared owner is not attributable to one of
    // them, so the first occurrence is kept and the ambiguity is not resolved away silently.
    if (!ownerNameOf.has(s.qualifiedName)) ownerNameOf.set(s.qualifiedName, s.ownerName)
    // Only a name that occurs once may be resolved to a path; a colliding name is left out
    // so `nameToQualified` never asserts an attribution the file does not support.
    if ((byName.get(s.name) ?? 0) === 1) nameToQualified.set(s.name, s.qualifiedName)
  }

  for (const rel of result.relationships ?? []) {
    totalEdges++
    // `UniversalRelationship` declares `source`/`target` and accepts `from`/`to` as
    // aliases (src/ast/types.ts). This lane emits the `source` spelling, but the alias is
    // read too rather than assumed absent, so the probe reports a resolution rate instead
    // of reporting a field name it happened to guess.
    const type = String(rel.type ?? rel.relationshipType ?? "unknown")
    const src = (rel.source ?? rel.from ?? rel.fromSymbol) as string | undefined
    const dst = (rel.target ?? rel.to ?? rel.toSymbol) as string | undefined
    if (typeof src !== "string" || typeof dst !== "string") {
      row(type).edges++
      untyped++
      continue
    }
    const r = row(type)
    r.edges++
    const fromQ = byQualified.has(src)
    const toQ = byQualified.has(dst)
    if (fromQ && toQ) {
      r.resQualified++
      // Two agreement tests for `contains`, because resolution is blind to this defect and
      // these are the checks that could still fail.
      //
      // `ownerIsEnclosing`: the source's QUALIFIED PATH is a proper prefix of the target's,
      // which is what containment means — `GitHub[3]` contains `GitHub[3][2][6]`. Tested on
      // paths, not names, because a name deliberately does NOT carry the module prefix after
      // the bracket-form fix and so cannot express this relation at all.
      //
      // `ownerMatchesDeclared`: the edge points at the symbol the CHILD declared as its own
      // `ownerName`. This is the check a rename can silently break: the owner is derived from
      // the child's name by one piece of code and consumed by another.
      // `ownerMatchesDeclared`: the child declared an `ownerName`, that name occurs ONCE in
      // the file (so it identifies one published symbol rather than a collision), and it is
      // the NAME of the edge's source. Two things this deliberately does not do, because both
      // produced a wrong number first:
      //
      //   - it does not compare `ownerName` to the source's qualified PATH. `ownerName` is a
      //     bare name and the path carries the module prefix, so after the bracket-form fix
      //     the two spellings differ by construction and the comparison read 58.3% agreement
      //     when the real agreement is higher;
      //   - it does not count a name that occurs more than once. In these documents a name
      //     like `url` occurs at dozens of paths, so a bare-name match would confirm an
      //     attribution the file cannot actually support.
      //
      // Ambiguous children are therefore EXCLUDED and counted separately rather than being
      // scored either way.
      if (type === "contains") {
        if (src !== dst && dst.startsWith(src)) r.ownerIsEnclosing++
        const declared = ownerNameOf.get(dst)
        if (typeof declared === "string" && declared.length > 0) {
          const occurrences = byName.get(declared) ?? 0
          if (occurrences === 1) {
            r.ownerNameUnambiguous++
            if (nameToQualified.get(declared) === src) r.ownerMatchesDeclared++
          } else if (occurrences === 0) {
            // The child names an owner the file never published. This is a DIFFERENT finding
            // from a collision and was folded into it by the first version of this probe,
            // which reported the two as one number and so hid a real defect: the
            // `contains` edge still resolves, because it is emitted against the qualified
            // PATH, so the graph walks correctly while the symbol's own `ownerName` metadata
            // points at nothing. Graph-walkability and metadata agreement are separate
            // properties and only one of them was being counted.
            r.ownerNameAbsent++
            if (ownerAbsentExamples.length < 12) {
              ownerAbsentExamples.push(
                `        child qname=${JSON.stringify(dst)} name=${JSON.stringify(
                  byQualified.get(dst) ?? "",
                )} declares ownerName=${JSON.stringify(declared)} — not published; edge source=${JSON.stringify(src)}`,
              )
            }
          } else {
            r.ownerNameCollides++
          }
        }
      }
      continue
    }
    const fromN = byName.has(src)
    const toN = byName.has(dst)
    if (fromN && toN) {
      r.resName++
      continue
    }
    if (unresolvedExamples.length < 25) {
      unresolvedExamples.push(`        ${type} source=${JSON.stringify(src)} target=${JSON.stringify(dst)}`)
    }
  }
}

console.log(`array owner probe — ${files.length} file(s), ${filesRead} read, ${parseFailures} threw`)
console.log(`total edges emitted: ${totalEdges} (${untyped} with an endpoint this probe could not read)`)
{
  const c = stats.get("contains")
  if (c) {
    console.log(
      `declared ownerName UNIQUE in file (scored)        : ${c.ownerNameUnambiguous}`,
    )
    console.log(`declared ownerName ABSENT from file (defect)    : ${c.ownerNameAbsent}`)
    console.log(`declared ownerName COLLIDES in file (unscored)  : ${c.ownerNameCollides}`)
  }
}
console.log("")
console.log(
  `  ${"type".padEnd(14)}${"edges".padStart(9)}${"resQual".padStart(9)}${"resName".padStart(9)}${"unresolv".padStart(9)}${"enclosing".padStart(11)}${"nameUnamb".padStart(11)}${"declMatch".padStart(11)}`,
)
for (const [type, r] of [...stats.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
  const unresolv = r.edges - r.resQualified - r.resName
  const isContains = type === "contains"
  const cell = (n: number) => (isContains ? String(n).padStart(11) : "-".padStart(11))
  console.log(
    `  ${type.padEnd(14)}` +
      `${String(r.edges).padStart(9)}` +
      `${String(r.resQualified).padStart(9)}` +
      `${String(r.resName).padStart(9)}` +
      `${String(unresolv).padStart(9)}` +
      cell(r.ownerIsEnclosing) +
      cell(r.ownerNameUnambiguous) +
      cell(r.ownerMatchesDeclared),
  )
}
if (ownerAbsentExamples.length) {
  console.log("")
  console.log("children naming an owner the file never published (the edge still resolves by PATH):")
  for (const l of ownerAbsentExamples) console.log(l)
}
if (unresolvedExamples.length) {
  console.log("")
  console.log("unresolved edge examples:")
  for (const l of unresolvedExamples) console.log(l)
}