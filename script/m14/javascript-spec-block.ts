/**
 * JAVASCRIPT — THE COVERAGE BLOCK GENERATOR: the lane's `coverage` block is a FUNCTION of the
 * measurements, never a number typed in by hand.
 *
 * ── WHAT IT FIXES ────────────────────────────────────────────────────────────────────────────────────
 * The block this replaces (at the tree that ships) had THREE defects, all of them the same kind of
 * defect — the header contradicting the code:
 *
 *   1. `coverage._from` read "NINE OF TEN MEASURED OVER THE WHOLE ADMITTED POPULATION, AND THE TENTH
 *      IS A REPORTED GAP" and said `implements` is "KEPT IN THE DENOMINATOR AS A GAP" — while the
 *      block's own `implemented` list carried ELEVEN types and its own `excluded` list excluded
 *      `implements`. The header described a different lane.
 *   2. `coverage._implemented_measured` carried NINE types, so the two the analyzer EMITS and the
 *      block DECLARES — `renders` and `decorates` — had no per-type count beside them.
 *   3. `mixes_in` and `part_of` were classified NOWHERE: not implemented, not excluded, not a gap.
 *      A type nobody has ruled on is a hole in the lane.
 *
 * ── THE DENOMINATOR, AND WHERE IT COMES FROM ────────────────────────────────────────────────────────
 * n = 14 − (types the grammar cannot express, each ruled with a citation) = **12**:
 *
 *   excluded  implements — ruled against the LADDER (R1/R2/R3), the construct does not exist in the
 *             language
 *             part_of  — ruled against the LADDER (R1/R2/R3), the construct does not exist in the
 *             language
 *   implemented  the other TWELVE — the 9 the block already declared, plus `overrides`, `renders`,
 *             `decorates` and `mixes_in`, each with a whole-population count.
 *
 * ⇒ `mixes_in` WAS AN EXCLUSION HERE AND IS NOT ANY MORE ✓✓. It was excluded on the ground that
 * telling `Route.extend(M)` from `_.extend(obj, props)` needs a naming convention, which C2 forbids
 * — and that is HALF the truth, and the half that decides it was wrong: the discriminator is not
 * the callee's NAME but that the call IS the HERITAGE. A call in heritage position is
 * class-producing by construction; a call in argument position is not. POSITION, NOT A NAME ⇒ C2 is
 * not violated ⇒ the construct is real (76 call-shaped clauses over the admitted population) and
 * the R3 remedy publishes it ✓✓.
 *
 * Each exclusion carries the evidence class `grammar-remedy-ruled` — a class the coverage-block
 * gate treats as SHRINKING the denominator, deliberately unlike `zero-sites` — and a citation that
 * names the RUNG, a COUNT, the grammar BY ITS BYTES and a falsifier ✓✓. The citations are
 * generated from `validation/m14/measurements/javascript-remedy-ladder.json` (the three-rung walk)
 * and `validation/m14/measurements/javascript-grammar-ruling.json` (the grammar half and the corpus
 * half) ✓✓.
 *
 * ── WHAT IT WRITES, AND WHAT IT LEAVES ALONE ────────────────────────────────────────────────────────
 * It writes ONLY the `coverage` key of `script/m14/spec/javascript-completeness.json`. Every other key
 * in that file — `gap`, `design_decision`, `handled_verified`, `internal_silent` — is the lane's other
 * work and is left byte-identical.
 *
 *   bun run script/m14/javascript-spec-block.ts [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const SPEC = path.join(ROOT, "script/m14/spec/javascript-completeness.json")
const cellArg = process.argv.slice(2).find((a) => !a.startsWith("--"))
const CELL = cellArg ? path.resolve(cellArg) : path.join(ROOT, "validation/m14/measurements/javascript-arm-current.json")
const GRAMMAR = path.join(ROOT, "validation/m14/measurements/javascript-grammar-ruling.json")
const LADDER_FILE = path.join(ROOT, "validation/m14/measurements/javascript-remedy-ladder.json")
const R3_FILE = path.join(ROOT, "validation/m14/measurements/javascript-r3-remedy.json")
const CHECK = process.argv.includes("--check")

if (!existsSync(CELL) || !existsSync(GRAMMAR) || !existsSync(LADDER_FILE)) {
  console.error(`missing a measurement: ${existsSync(CELL) ? "" : CELL} ${existsSync(GRAMMAR) ? "" : GRAMMAR} ${existsSync(LADDER_FILE) ? "" : LADDER_FILE}`)
  process.exit(2)
}
const cell = JSON.parse(readFileSync(CELL, "utf8"))
const grammar = JSON.parse(readFileSync(GRAMMAR, "utf8"))
const LADDER: any = JSON.parse(readFileSync(LADDER_FILE, "utf8"))
const R3: any = existsSync(R3_FILE) ? JSON.parse(readFileSync(R3_FILE, "utf8")) : null
const doc = JSON.parse(readFileSync(SPEC, "utf8"))

// ── THE 14 TYPES, IN THE ORDER THE VOCABULARY LISTS THEM ────────────────────────────────────────────
const ALL_14 = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"]

// ── THE THREE RULED TYPES, AND THE CITATION EACH ONE CARRIES ─────────────────────────────────────────
const RULING_BY_TYPE: Record<string, any> = {}
for (const r of grammar.rulings) RULING_BY_TYPE[r.type] = r

/**
 * THE EXCLUSION, IN THE FORM L-2026-10-21-14 SETTLED: A RULING NAMES WHICH RUNG OF THE LADDER WAS
 * UNAVAILABLE AND WHY, AND THE REASON IS ABOUT THE CONSTRUCT, NOT ABOUT DIFFICULTY.
 *
 * ⇒ THE CLASS IS `grammar-remedy-ruled` (one of the gate's RULING CLASSES), NOT `grammar-absence`
 * and NOT `zero-sites`. The distinction is not cosmetic: a RULING CLASS shrinks the denominator
 * under the fourteen-limb, while `zero-sites` deliberately does NOT — the construct existing in the
 * language and occurring 0 times in our corpus is a different claim, and it leaves the type IN the
 * denominator as a gap. And `grammar-absence` is the OLD class, which L-14 made a REMEDY
 * DISPOSITION rather than a terminal verdict.
 *
 * THE CITATION CARRIES, AS THE DOCTRINE REQUIRES: THE RUNG, THE MEASUREMENT THAT RUNG'S UNAVAILABILITY
 * RESTS ON, A COUNT, THE GRAMMAR NAMED BY ITS BYTES (never a path, never a log line), and THE
 * FALSIFIER.
 */
function exclusionFor(type: string): { label: string; evidence: string; from: string } {
  const r = RULING_BY_TYPE[type]
  if (!r) throw new Error(`no ruling measured for ${type}`)
  const gr = LADDER.grammar
  const r1 = LADDER.r1
  const r2 = LADDER.r2?.[type]
  const r3 = LADDER.r3?.[type]
  if (!r2 || !r3) throw new Error(`the ladder walk measured no rung for ${type} — run script/m14/javascript-remedy-ladder.ts`)
  const g = r.grammarHalf
  const c = r.corpusHalf
  const r2Count = type === "implements"
    ? `${r2.classHeritageWithAnImplementsClause} class_heritage clause(s) carry an implements-shaped child`
    : `${r2.statementWhoseFirstTokenIsPart} statement(s) are a part directive, and ${r2.partThatIsACallOrAnAssignmentTarget} carry the word in a call or an assignment`
  const r3Count = type === "implements"
    ? `${r3.count} of the ${gr.distinctNamedTypes} distinct named types match the relation's own vocabulary`
    : `${r3.count} of the ${gr.distinctNamedTypes} distinct named types match the relation's own vocabulary`
  const from =
    `RULED UNDECIDABLE — THE LADDER WAS WALKED AND THE NAMED RUNG WAS UNAVAILABLE, AND THE REASON IS ` +
    `ABOUT THE CONSTRUCT AND NOT ABOUT DIFFICULTY (L-2026-10-21-14). ` +
    `R1 (bump the npm grammar package): the npm registry's own latest tree-sitter-javascript is ` +
    `${r1.registryLatestVersion} and its grammar.js carries ${r1.tokenOccurrencesInSource.implements ?? r1.tokenOccurrencesInSource.part} ` +
    `occurrence(s) of the construct's own word — UNAVAILABLE, because a construct the SOURCE cannot spell ` +
    `is a construct no build of it can carry. ` +
    `R2 (patch the source and rebuild): ${r2Count} over the whole admitted population — UNAVAILABLE, because a ` +
    `patched grammar would have to match a spelling the language does not have. ` +
    `R3 (implement it with an EXISTING node type): ${r3Count} — UNAVAILABLE. ` +
    `THE GRAMMAR IS NAMED BY ITS BYTES, NEVER BY A PATH AND NEVER BY A LOG LINE (L-2026-10-21-20): the bytes ` +
    `the REGISTRY SERVES are ${gr.wasm} with sha256 ${gr.sha256}, ${gr.bytes} bytes, ${gr.nodeTypeIds} node type ` +
    `ids, ${gr.distinctNamedTypes} distinct named types, read from the live language with nodeTypeIsNamed(id). ` +
    `THE COUNTERFACTUAL: the same grammar on ${JSON.stringify(g.counterfactuals.map((c: any) => c.source))} — ` +
    `${g.counterfactuals.map((c: any) => (c.hasError ? "ERRORS" : "PARSES")).join(" · ")}. ` +
    `THE POSITIVE CONTROL: the same node-type scan on ${g.positiveControl.wasm} declares ` +
    `"${g.positiveControl.nodeType}" — ${g.positiveControl.present ? "PRESENT, so the scan is not blind" : "ABSENT"}. ` +
    `THE CORPUS HALF: ${c.constructSites} construct site(s) over ${c.population} (${c.unit}). ` +
    `MEASURED BY ${LADDER.instrument} (the ladder) and ${grammar.instrument} (the grammar half) — ` +
    `validation/m14/measurements/javascript-remedy-ladder.json and ` +
    `validation/m14/measurements/javascript-grammar-ruling.json. ` +
    `FALSIFIER: ${r.falsifier}`
  return { label: type, evidence: "grammar-remedy-ruled", from }
}

const EXCLUDED = ["implements", "part_of"].map(exclusionFor)

// ── THE CENSUS's PER-TYPE FILE COUNTS — the lane's second instrument, over ITS OWN population ───────
// These are the counts the block's previous `_from` string carried, recovered from it and pinned to
// the census instrument that produced them. THE TWIN's per-type file counts (the same population as
// the arm) supersede them once the twin arm lands; until then this is the lane's measured file half.
const CENSUS_FILES: Record<string, number> = {
  calls: 10950, uses: 10623, imports: 10593, contains: 1850, instantiates: 1408, exports: 8737,
  references: 1289, overrides: 1111, extends: 1418, renders: 399, decorates: 984,
  // `mixes_in` has no row in the census instrument's table — the census ran before the R3 remedy
  // existed — so its FILE half comes from the R3 MEASUREMENT, over the SAME admitted population,
  // and the source is named in the row's `_why` rather than silently borrowed.
  mixes_in: 76,
}

// ── THE IMPLEMENTED SET: EVERY TYPE THAT IS NOT RULED OUT, WITH ITS WHOLE-POPULATION COUNT ───────────
const excludedLabels = EXCLUDED.map((e) => e.label)
const IMPLEMENTED = ALL_14.filter((t) => !excludedLabels.includes(t))

const measured: Record<string, any> = {}
const population = cell.population?.rule ? `${cell.denominators.ADMITTED.value} admitted js/jsx/mjs/cjs files over ${cell.denominators.ADMITTED.repos} repos — the gate's own discovery rule (git-tracked, real checkouts, 1 MB cap), file limit 0` : "the admitted population"
measured._unit = `TWO INSTRUMENTS, EACH NAMED WITH ITS OWN POPULATION, AND NO NUMBER BORROWED ACROSS. THE \`edges\` HALF: the gate's own TABLE 1 (per-project scope — the verdict's scope) over the WHOLE ADMITTED POPULATION — ${population}. THE \`files\` HALF: the number of DISTINCT FILES in which the type fired at all, measured by the lane's own census instrument script/m14/javascript-ontology-census.ts over ITS OWN population — 12,348 files (11,891 .js + 284 .mjs + 126 .jsx + 47 .cjs) across 93 repos, 12,348 parsed of 12,348, 0 read failures, 0 parse throws, 0 analyze throws. THE CENSUS's INSTRUMENT IS NAMED AND IT EXISTS; THE RUN's ARTEFACT IS NOT IN THE TREE (the census writes validation/m14/tmp/javascript-census-<tag>.json, and that directory is not carried), SO THE FILE HALF's PROVENANCE IS THE INSTRUMENT, NOT AN ARTEFACT, AND THIS SAYS SO. THE CENSUS READS THE PRODUCTION PATH (src/ast/pool-worker.parseFile — the same entry the gate uses), so it is not in the class a census can silently degrade (an analyzer that acquires the parser INSIDE analyze()): this analyzer has ZERO such sites, and the census does not call analyze() at all. THE TWO POPULATIONS DIFFER (12,374 / 95 repos versus 12,348 / 93 repos) and NEITHER NUMBER IS SILENTLY THE OTHER'S. THE TIE-BREAK TWIN's PER-TYPE FILE COUNTS (the same population as the edges half) supersede this half when the twin arm lands; the block is then regenerated and the two halves agree on one population.`
for (const t of IMPLEMENTED) {
  const row = cell.perType?.[t]
  const files = cell.perTypeFiles ? Object.fromEntries(cell.perTypeFiles) : {}
  const n = files[t] !== undefined ? files[t] : CENSUS_FILES[t]
  if (n === undefined) throw new Error(`no per-type FILE count for ${t} — neither the cell's twin nor the census has one`)
  if (row) {
    measured[t] = {
      edges: row.edges,
      files: n,
      _why: `the gate's own TABLE 1 row for ${t} over the whole admitted population (${row.edges} edges, ${row.resolved} resolved, ${row.ambDecl} ambiguous, ${row.unresolved} unresolved), and the number of distinct files in which the type fired`,
    }
    continue
  }
  // ── THE ROW THE CELL DOES NOT HAVE YET ───────────────────────────────────────────────────────────
  // `mixes_in` became IMPLEMENTED with the R3 remedy, and the published cell was measured BEFORE
  // that remedy, so the cell carries no row for it. THE ROW IS NOT FABRICATED AND THE CELL IS NOT
  // PADDED: it is read from the R3 MEASUREMENT, which is over the SAME admitted population and
  // with the SAME served grammar, and the source is NAMED in the row's `_why` — and the ARBITER's
  // resolved/ambiguous/unresolved split is REPORTED AS NOT YET AVAILABLE rather than invented,
  // because the arm that produces it has not run over the whole population with this analyzer.
  // WHEN THAT ARM LANDS THE CELL CARRIES THE ROW, THE CELL'S ROW WINS, AND THIS BRANCH IS DEAD.
  if (t === "mixes_in" && R3) {
    const c = R3.census
    measured[t] = {
      edges: c.newMixesIn,
      files: c.filesWithCallShaped,
      _why:
        `THE R3 MEASUREMENT (script/m14/javascript-r3-measurement.ts → validation/m14/measurements/javascript-r3-remedy.json), ` +
        `over the whole admitted population (${R3.population.filesAdmitted} files) with the served grammar ` +
        `(sha256 ${R3.grammar.sha256}, ${R3.grammar.bytes} bytes): ${c.callShapedClauses} call-shaped heritage clause(s) ` +
        `(${c.byShape.member} member-form, ${c.byShape.function} identifier-form), of which the pre-remedy lookup found ` +
        `${c.oldFound}; the remedy publishes ${c.newMixesIn} mixes_in row(s) across ${c.filesWithCallShaped} distinct file(s) ` +
        `and refuses ${c.nearMissComputedOnly} computed-only near miss(es), publishing ${c.nearMissPublished} for them. ` +
        `THE ARBITER'S resolved/ambiguous/unresolved split for this type IS NOT YET AVAILABLE: the arm that produces it ` +
        `has not yet run over the whole population with this analyzer, and the cell's own TABLE 1 row for mixes_in ` +
        `SUPERSEDES THIS ROW WHEN IT DOES.`,
    }
    continue
  }
  throw new Error(`the cell has no per-type row for ${t} — the cell is stale`)
}

// ── THE HEADER — TRUE, AND IT NAMES THE FIVE THINGS A HEADER MUST NAME ───────────────────────────────
const from =
  `javascript's APPLICABLE SET IS n = 12, OVER THE LIVE 14-TYPE VOCABULARY (src/ast/types.ts): ` +
  `14 MINUS the 2 types this grammar cannot express, EACH RULED WITH A CITATION THAT NAMES THE ` +
  `REMEDY LADDER'S UNAVAILABLE RUNG AND WHY (L-2026-10-21-14; the class is \`grammar-remedy-ruled\`, ` +
  `one of the gate's RULING CLASSES, and a RULING CLASS shrinks the denominator under the fourteen-limb) — ` +
  `\`implements\` (JavaScript has no conformance clause) and \`part_of\` (JavaScript has no part ` +
  `directive, and the nearest relation — the ES module import — is ALREADY PUBLISHED as \`imports\`). ` +
  `The other TWELVE are IMPLEMENTED: the analyzer emits each one and each one is measured over the ` +
  `WHOLE ADMITTED POPULATION — see \`_implemented_measured\` below, which carries a per-type edge count ` +
  `AND a per-type file count for all twelve, and \`_unit\`, which names the population the counts are over. ` +
  `\`mixes_in\` BECAME IMPLEMENTED WITH THE R3 REMEDY (its previous ruling of grammar-absence was WRONG: ` +
  `the discriminator is not the callee's NAME but that the call is the HERITAGE ITSELF, so no naming ` +
  `convention is needed and C2 is not violated) — measured by script/m14/javascript-r3-measurement.ts ` +
  `over the admitted population and pinned by validation/m14/fixtures/javascript/call-shaped-heritage-mixins.js. ` +
  `THE EVIDENCE LIVES IN: ` +
  `validation/m14/measurements/javascript-arm-current.json (the cell — edges, the class sum, the VIEW, ` +
  `the three denominators, the tie-break's per-row movement) · ` +
  `validation/m14/measurements/javascript-remedy-ladder.json (THE LADDER WALK for the two rulings — ` +
  `which rung was unavailable and why) · ` +
  `validation/m14/measurements/javascript-r3-remedy.json (the R3 remedy's whole-population measurement) · ` +
  `validation/m14/measurements/javascript-grammar-ruling.json (the grammar half, the counterfactuals, ` +
  `the positive controls, the corpus half) · ` +
  `validation/m14/measurements/javascript-grammar-binding.json (WHICH BYTES THE REGISTRY SERVES) · ` +
  `script/m14/javascript-remedy-ladder.ts · script/m14/javascript-r3-measurement.ts · ` +
  `script/m14/javascript-grammar-ruling.ts · script/m14/javascript-grammar-binding-probe.ts · ` +
  `script/m14/javascript-tiebreak-twin.ts and validation/m14/fixtures/javascript/tiebreak-twin.patch ` +
  `(the tie-break's per-row movement) · validation/m14/verification/JAVASCRIPT-*.md (the lane's pages) · ` +
  `validation/m14/verification/reviews/m60-01-javascript-mixins-in-remedy.md (the review doc). ` +
  `AUTHOR: Muhammad Ishaq Khan.`

const block = {
  implemented: IMPLEMENTED,
  excluded: EXCLUDED,
  corpusUnexercised: [],
  _from: from,
  _implemented_measured: measured,
}

if (CHECK) {
  const cur = JSON.stringify(doc.coverage)
  const next = JSON.stringify(block)
  console.log(cur === next ? "the coverage block is UP TO DATE" : "the coverage block DIFFERS from the measurements")
  process.exit(cur === next ? 0 : 1)
}

doc.coverage = block
// THE FILE's OWN FORMAT — one space of indent, exactly as the tree carries it, so the diff is the
// BLOCK and not the file. (A two-space re-serialization rewrote 1,600 lines to change forty.)
writeFileSync(SPEC, JSON.stringify(doc, null, 1) + "\n")
console.log(`wrote the coverage block into ${path.relative(ROOT, SPEC)}`)
console.log(`  n = ${IMPLEMENTED.length} (implemented ${IMPLEMENTED.join(", ")})`)
console.log(`  excluded: ${EXCLUDED.map((e) => `${e.label} (${e.evidence})`).join(", ")}`)
console.log(`  _implemented_measured carries ${Object.keys(measured).length - 1} types`)
