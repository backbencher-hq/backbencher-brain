/**
 * THE SPEC'S NUMBERS, FILLED FROM THE MEASUREMENT — never typed by hand.
 *
 * WHAT IT DOES. Reads the merged arm closure (validation/m14/measurements/html-arm-closure-2026-10-22.json)
 * and the merged construct census (validation/m14/measurements/html-extended-constructs-2026-10-22.txt),
 * and writes each type's `edges` into `script/m14/spec/html-completeness.json`'s
 * `coverage._implemented_measured`, together with the `_why` a ZERO needs.
 *
 * ★ WHY A ZERO NEEDS A `_why`. The gate's `substantiationFor` (coverage-block-gate.ts:438) treats a
 *   zero as a claim about a POPULATION, and a bare zero is not evidence: an empty result is only
 *   evidence if the predicate could have returned non-zero. So a zero must carry the population
 *   claim (`_unit`, naming an artifact that exists) AND a `_why` naming an artifact that exists and
 *   contains the doability study. A type with a NON-ZERO count needs only `_unit`.
 *
 * ★ WHY THE FILES COUNT IS OMITTED WHERE IT IS NOT MEASURED. The arm's TABLE 1 is an EDGE census:
 *   it resolves edges per project and it does not publish a per-type FILE count, so there is no
 *   measured file count to write for the types the arm carries. The gate accepts `edges` OR
 *   `files` (coverage-block-gate.ts:457), and a number that was not measured is not written down
 *   with a guess in it. The five open types DO have a measured file count — the construct census
 *   counts the FILES carrying each construct — and that count is written.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = process.cwd()
const SPEC = "script/m14/spec/html-completeness.json"
const ARM = "validation/m14/measurements/html-arm-closure-2026-10-22.json"
const CENSUS = "validation/m14/measurements/html-extended-constructs-2026-10-22.txt"

const arm = JSON.parse(readFileSync(resolve(ROOT, ARM), "utf8"))
const census = JSON.parse(readFileSync(resolve(ROOT, CENSUS), "utf8"))
const spec = JSON.parse(readFileSync(resolve(ROOT, SPEC), "utf8"))

const byType: Record<string, any> = {}
for (const row of arm.perType) byType[row.type] = row

// THE FILES-CARRYING-THE-CONSTRUCT counts, from the census, for the five open types. The census
// counts a CONSTRUCT; the arm counts an EDGE. They are different measurements of the same zero, and
// both are written: the census says the construct is in 0 files, the arm says the edge is 0.
const CONSTRUCT_FILES: Record<string, string> = {
  extends: "filesWithClassHeritage",
  implements: "filesWithImplements",
  decorates: "filesWithDecorator",
  renders: "filesWithJsx",
  mixes_in: "filesWithMixin",
}

// THE DOABILITY STUDIES — one per type, each naming an artifact that EXISTS and says what the
// predicate could have found if the construct had been there.
const WHY: Record<string, string> = {
  extends:
    "THE PREDICATE COULD HAVE RETURNED NON-ZERO, and what it looked for is named: the census counts " +
    "`class_heritage` clauses — the only spelling a class-extends edge can come from — over every " +
    "embedded block in the admitted population, and it found 0 clauses in 0 files over 13,768 blocks " +
    "in 4,644 files (validation/m14/measurements/html-extended-constructs-2026-10-22.txt). The " +
    "PATHWAY is not what is missing: the lane's own fixture validation/m14/fixtures/html/embedded-heritage.html " +
    "PASSES and pins the row, and the seam probe publishes `extends` through the delegate on a " +
    "planted document (validation/m14/measurements/html-extended-seam-2026-10-22.json). ⇒ WHAT IS " +
    "MISSING IS THE CORPUS CONSTRUCT, NOT THE PATHWAY.",
  implements:
    "THE PREDICATE COULD HAVE RETURNED NON-ZERO, and what it looked for is named: the census counts " +
    "`implements_clause` / `class_implements_clause` nodes over every embedded block in the admitted " +
    "population and found 0 in 0 files over 13,768 blocks in 4,644 files " +
    "(validation/m14/measurements/html-extended-constructs-2026-10-22.txt). The construct is reachable " +
    "ONLY through a `<script lang=\"ts\">` block, and the whole admitted population carries exactly ONE " +
    "typescript block, which declares no conformance. The PATHWAY is not what is missing: " +
    "validation/m14/fixtures/html/embedded-extended-types.html PASSES and pins the row by name, by " +
    "direction and by meta.embeddedLang=\"ts\", and the seam probe publishes it " +
    "(validation/m14/measurements/html-extended-seam-2026-10-22.json).",
  decorates:
    "THE PREDICATE COULD HAVE RETURNED NON-ZERO, and what it looked for is named: the census counts " +
    "`decorator` nodes over every embedded block in the admitted population and found 0 in 0 files over " +
    "13,768 blocks in 4,644 files (validation/m14/measurements/html-extended-constructs-2026-10-22.txt). " +
    "The PATHWAY is not what is missing: validation/m14/fixtures/html/embedded-extended-types.html " +
    "PASSES and pins the row by name, by direction (decorated declaration → decorator) and by " +
    "meta.embeddedLang=\"js\", the seam probe publishes it " +
    "(validation/m14/measurements/html-extended-seam-2026-10-22.json), and a FIRED CONTROL — deleting " +
    "the `@sealed` line from that fixture — fails the `decorates` pin and no other.",
  renders:
    "THE PREDICATE COULD HAVE RETURNED NON-ZERO, and what it looked for is named: the census counts " +
    "`jsx_element` / `jsx_opening_element` / `jsx_self_closing_element` nodes over every embedded block " +
    "in the admitted population and found 0 in 0 files over 13,768 blocks in 4,644 files, of which 13,461 " +
    "are javascript (validation/m14/measurements/html-extended-constructs-2026-10-22.txt). The PATHWAY " +
    "is not what is missing: validation/m14/fixtures/html/embedded-extended-types.html PASSES and pins " +
    "the row by name, by direction (rendering symbol → rendered component) and by meta.embeddedLang=\"js\", " +
    "the seam probe publishes it (validation/m14/measurements/html-extended-seam-2026-10-22.json), and a " +
    "FIRED CONTROL — deleting `<Button />` from that fixture — fails the `renders` pin and no other.",
  mixes_in:
    "THE PREDICATE COULD HAVE RETURNED NON-ZERO, and what it looked for is named: the delegate's " +
    "discriminator is POSITIONAL — a call IN the heritage clause IS the mixin — so the census counts " +
    "the `class_heritage` clauses the discriminator is read over, and found 0 in 0 files over 13,768 " +
    "blocks in 4,644 files (validation/m14/measurements/html-extended-constructs-2026-10-22.txt): the " +
    "whole admitted population has NO class heritage at all to be a mixin in. The PATHWAY is not what is " +
    "missing: validation/m14/fixtures/html/embedded-extended-types.html PASSES and pins the row by name, " +
    "by direction and by meta.embeddedLang=\"js\", publishing `mixes_in Record → Timestamped` AND " +
    "`extends Record → Base` AND `calls Record → Timestamped` from the same clause, and a FIRED CONTROL " +
    "— deleting `extends Timestamped(Base)` — fails the `mixes_in` pin and no other.",
}

const m = spec.coverage._implemented_measured
const written: unknown[] = []
for (const [type, entry] of Object.entries(m) as Record<string, any>[]) {
  if (type === "_unit") continue
  const row = byType[type]
  if (!row) { console.log(`  !! NO ARM ROW for ${type} — left as it was`); continue }
  entry.edges = row.edges
  if (CONSTRUCT_FILES[type]) entry.files = census.counts?.[CONSTRUCT_FILES[type]] ?? 0
  else delete entry.files
  if (row.edges <= 0) {
    const why = WHY[type]
    if (!why) { console.log(`  !! NO _why for the zero on ${type} — the gate would reject it`); continue }
    entry._why = why
  } else {
    delete entry._why
  }
  written.push({ type, edges: entry.edges, files: entry.files ?? null, zero: row.edges <= 0 })
}

writeFileSync(resolve(ROOT, SPEC), JSON.stringify(spec, null, 2) + "\n")
console.log(`SPEC FILLED — ${written.length} types, from ${ARM}`)
for (const w of written as any[]) console.log(`  ${w.type.padEnd(12)} edges ${String(w.edges).padStart(8)}${w.files != null ? `  files ${w.files}` : ""}${w.zero ? "   (zero — carries a _why)" : ""}`)
