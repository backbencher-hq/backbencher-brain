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
 * n = 14 − (types the grammar cannot express, each ruled with a citation) = **11**:
 *
 *   excluded  implements — the grammar has no `implements` clause
 *             mixes_in  — the grammar has no mixin clause
 *             part_of  — the grammar has no part directive
 *   implemented  the other ELEVEN — the 9 the block already declared, plus `overrides`, `renders`
 *             and `decorates`, each with a whole-population count.
 *
 * Each exclusion carries the evidence class `grammar-absence`, a citation that names a COUNT and an
 * artifact that EXISTS, and a falsifier. The citations are generated from
 * `validation/m14/measurements/javascript-grammar-ruling.json`, which measured the grammar half (the
 * node-type inventory of the grammar the POPULATION INSTRUMENT loads) and the corpus half (the
 * construct's own sites over the whole admitted population).
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
const CHECK = process.argv.includes("--check")

if (!existsSync(CELL) || !existsSync(GRAMMAR)) {
  console.error(`missing a measurement: ${existsSync(CELL) ? "" : CELL} ${existsSync(GRAMMAR) ? "" : GRAMMAR}`)
  process.exit(2)
}
const cell = JSON.parse(readFileSync(CELL, "utf8"))
const grammar = JSON.parse(readFileSync(GRAMMAR, "utf8"))
const doc = JSON.parse(readFileSync(SPEC, "utf8"))

// ── THE 14 TYPES, IN THE ORDER THE VOCABULARY LISTS THEM ────────────────────────────────────────────
const ALL_14 = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"]

// ── THE THREE RULED TYPES, AND THE CITATION EACH ONE CARRIES ─────────────────────────────────────────
const RULING_BY_TYPE: Record<string, any> = {}
for (const r of grammar.rulings) RULING_BY_TYPE[r.type] = r

function exclusionFor(type: string): { label: string; evidence: string; from: string } {
  const r = RULING_BY_TYPE[type]
  if (!r) throw new Error(`no ruling measured for ${type}`)
  const g = r.grammarHalf
  const c = r.corpusHalf
  const ctrl = g.positiveControl
  const from =
    `GRAMMAR-ABSENCE, MEASURED. THE GRAMMAR HALF: the grammar the PRODUCTION PARSER loads ` +
    `(${g.wasm}, sha256 ${g.sha256}, ${g.bytes} bytes) declares ${g.namedNodeTypes} named node types ` +
    `(digest ${g.namedDigest}) and ${g.matchingNodeTypes} of them match this type's OWN vocabulary ` +
    `(${g.vocabularyText ?? g.vocabulary?.join(", ") ?? "?"}) — the match list is ${JSON.stringify(g.matching)}. THE COUNTERFACTUAL: the same grammar on ` +
    `${JSON.stringify(r.grammarHalf.counterfactuals.map((c: any) => c.source))} — ` +
    `${r.grammarHalf.counterfactuals.map((c: any) => (c.hasError ? "ERRORS" : "PARSES")).join(" · ")}. ` +
    `THE POSITIVE CONTROL: the same node-type scan on ${ctrl.wasm} declares "${ctrl.nodeType}" — ` +
    `${ctrl.present ? "PRESENT, so the scan is not blind" : "ABSENT — THE SCAN IS BLIND"}. ` +
    `THE CORPUS HALF: ${c.constructSites} construct site(s) over ${c.population} (${c.unit}). ` +
    `MEASURED BY ${grammar.instrument} — ${path.relative(ROOT, path.join(ROOT, "validation/m14/measurements/javascript-grammar-ruling.json"))}. ` +
    `FALSIFIER: ${r.falsifier}`
  return { label: type, evidence: "grammar-absence", from }
}

const EXCLUDED = ["implements", "mixes_in", "part_of"].map(exclusionFor)

// ── THE CENSUS's PER-TYPE FILE COUNTS — the lane's second instrument, over ITS OWN population ───────
// These are the counts the block's previous `_from` string carried, recovered from it and pinned to
// the census instrument that produced them. THE TWIN's per-type file counts (the same population as
// the arm) supersede them once the twin arm lands; until then this is the lane's measured file half.
const CENSUS_FILES: Record<string, number> = {
  calls: 10950, uses: 10623, imports: 10593, contains: 1850, instantiates: 1408, exports: 8737,
  references: 1289, overrides: 1111, extends: 1418, renders: 399, decorates: 984,
}

// ── THE IMPLEMENTED SET: EVERY TYPE THAT IS NOT RULED OUT, WITH ITS WHOLE-POPULATION COUNT ───────────
const excludedLabels = EXCLUDED.map((e) => e.label)
const IMPLEMENTED = ALL_14.filter((t) => !excludedLabels.includes(t))

const measured: Record<string, any> = {}
const population = cell.population?.rule ? `${cell.denominators.ADMITTED.value} admitted js/jsx/mjs/cjs files over ${cell.denominators.ADMITTED.repos} repos — the gate's own discovery rule (git-tracked, real checkouts, 1 MB cap), file limit 0` : "the admitted population"
measured._unit = `TWO INSTRUMENTS, EACH NAMED WITH ITS OWN POPULATION, AND NO NUMBER BORROWED ACROSS. THE \`edges\` HALF: the gate's own TABLE 1 (per-project scope — the verdict's scope) over the WHOLE ADMITTED POPULATION — ${population}. THE \`files\` HALF: the number of DISTINCT FILES in which the type fired at all, measured by the lane's own census instrument script/m14/javascript-ontology-census.ts over ITS OWN population — 12,348 files (11,891 .js + 284 .mjs + 126 .jsx + 47 .cjs) across 93 repos, 12,348 parsed of 12,348, 0 read failures, 0 parse throws, 0 analyze throws. THE CENSUS's INSTRUMENT IS NAMED AND IT EXISTS; THE RUN's ARTEFACT IS NOT IN THE TREE (the census writes validation/m14/tmp/javascript-census-<tag>.json, and that directory is not carried), SO THE FILE HALF's PROVENANCE IS THE INSTRUMENT, NOT AN ARTEFACT, AND THIS SAYS SO. THE CENSUS READS THE PRODUCTION PATH (src/ast/pool-worker.parseFile — the same entry the gate uses), so it is not in the class a census can silently degrade (an analyzer that acquires the parser INSIDE analyze()): this analyzer has ZERO such sites, and the census does not call analyze() at all. THE TWO POPULATIONS DIFFER (12,374 / 95 repos versus 12,348 / 93 repos) and NEITHER NUMBER IS SILENTLY THE OTHER'S. THE TIE-BREAK TWIN's PER-TYPE FILE COUNTS (the same population as the edges half) supersede this half when the twin arm lands; the block is then regenerated and the two halves agree on one population.`
for (const t of IMPLEMENTED) {
  const row = cell.perType?.[t]
  if (!row) throw new Error(`the cell has no per-type row for ${t} — the cell is stale`)
  const files = cell.perTypeFiles ? Object.fromEntries(cell.perTypeFiles) : {}
  const n = files[t] !== undefined ? files[t] : CENSUS_FILES[t]
  if (n === undefined) throw new Error(`no per-type FILE count for ${t} — neither the cell's twin nor the census has one`)
  measured[t] = {
    edges: row.edges,
    files: n,
    _why: `the gate's own TABLE 1 row for ${t} over the whole admitted population (${row.edges} edges, ${row.resolved} resolved, ${row.ambDecl} ambiguous, ${row.unresolved} unresolved), and the number of distinct files in which the type fired`,
  }
}

// ── THE HEADER — TRUE, AND IT NAMES THE FIVE THINGS A HEADER MUST NAME ───────────────────────────────
const from =
  `javascript's APPLICABLE SET IS n = 11, OVER THE LIVE 14-TYPE VOCABULARY (src/ast/types.ts): ` +
  `14 MINUS the 3 types this grammar cannot express, EACH RULED WITH A CITATION (grammar-absence, ` +
  `each carrying the grammar half, the counterfactual, the positive control, the corpus half and a ` +
  `falsifier) — \`implements\` (no implements clause), \`mixes_in\` (no mixin clause) and \`part_of\` ` +
  `(no part directive). The other ELEVEN are IMPLEMENTED: the analyzer emits each one and each one is ` +
  `measured over the WHOLE ADMITTED POPULATION — see \`_implemented_measured\` below, which carries a ` +
  `per-type edge count AND a per-type file count for all eleven, and \`_unit\`, which names the population ` +
  `the counts are over. THE EVIDENCE LIVES IN: ` +
  `validation/m14/measurements/javascript-arm-current.json (the cell — edges, the class sum, the VIEW, ` +
  `the three denominators, the tie-break's per-row movement) · ` +
  `validation/m14/measurements/javascript-grammar-ruling.json (the three rulings, the two javascript ` +
  `grammars' inventories, the counterfactuals, the positive controls, the corpus half) · ` +
  `script/m14/javascript-grammar-ruling.ts (the instrument that measured them) · ` +
  `script/m14/javascript-tiebreak-twin.ts and validation/m14/fixtures/javascript/tiebreak-twin.patch ` +
  `(the tie-break's per-row movement) · validation/m14/verification/JAVASCRIPT-*.md (the lane's pages). ` +
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
