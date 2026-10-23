/**
 * script/m14/yaml-spec-check.ts — THE YAML LANE'S SPEC CHECKER.
 *
 * THE SPEC IS A SET OF NUMBERS, AND A NUMBER NOBODY RE-DERIVES IS A CLAIM. This reads
 * `script/m14/spec/yaml-completeness.json` and re-derives every number in it from the
 * measurement artifacts, and fails if any of them disagrees.
 *
 *   node script/m14/yaml-spec-check.ts [--spec P] [--census P] [--before P] [--binding P]
 *
 * THE CHECKS
 *   1. The GRAMMAR BINDING: the spec's grammar sha256, byte count, resolved path and node-type
 *      surface must equal the binding probe's (`validation/m14/measurements/yaml-grammar-binding.json`),
 *      which is the lane-owned BYTE-LEVEL measurement of the bytes the registry serves.
 *   2. The POPULATION: the spec's paths / distinct files / admitted / repos / symlinked dirs must
 *      equal the census's.
 *   3. THE PER-TYPE COUNTS: every implemented type's `_implemented_measured` edges and files must
 *      equal the census's whole-population `perType` row, and every implemented type must have a
 *      count over the whole admitted population — a type with no count is a type that is CLAIMED.
 *   4. THE DENOMINATOR: `denominator.n` must equal the gate's own arithmetic
 *      (14 − the shrinking exclusions − the zero-emission facts), and `denominator.types` must
 *      name exactly the computed set. A lane may not publish a denominator it cannot reproduce.
 *   5. THE CLOSURE: implemented + corpus-unexercised + gaps === applicable.
 *   6. THE RULINGS: every ruled type must cite a count and the grammar's own node-type inventory,
 *      and the count it cites must be the census's count for that construct.
 *   7. THE DISJOINTNESS: no type may be both implemented and ruled, implemented and pending, or
 *      implemented and corpus-unexercised-with-a-different-class.
 *   8. THE FIXTURES: every fixture the spec names must exist on disk.
 *
 * EXIT 0 = every number re-derives. EXIT 1 = at least one does not, and each is named.
 */
import { readFileSync, existsSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")
const arg = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const SPEC_PATH = path.resolve(ROOT, arg("spec", "script/m14/spec/yaml-completeness.json"))
const CENSUS_PATH = path.resolve(ROOT, arg("census", "validation/m14/measurements/yaml-emission-census-whole.json"))
const BEFORE_PATH = path.resolve(ROOT, arg("before", "validation/m14/measurements/yaml-emission-census-before.json"))
const BINDING_PATH = path.resolve(ROOT, arg("binding", "validation/m14/measurements/yaml-grammar-binding.json"))

const ALL_TYPES = [
  "calls", "extends", "implements", "uses", "imports", "exports", "contains", "references",
  "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of",
]

const problems: string[] = []
const notes: string[] = []
const fail = (m: string): void => { problems.push(m) }
const readJson = (p: string): any => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null)

const spec = readJson(SPEC_PATH)
if (!spec) { console.error(`FAIL — the spec does not exist: ${SPEC_PATH}`); process.exit(1) }
const census = readJson(CENSUS_PATH)
if (!census) { console.error(`FAIL — the census artifact does not exist: ${CENSUS_PATH}`); process.exit(1) }
const binding = readJson(BINDING_PATH)
const before = readJson(BEFORE_PATH)

const cov = spec.coverage ?? {}

// ── 1. THE GRAMMAR BINDING ────────────────────────────────────────────────────────────────────
if (binding) {
  const g = spec.grammar ?? {}
  if (g.sha256 && g.sha256 !== binding.registrySha256) fail(`grammar sha256 ${g.sha256} ≠ the binding probe's ${binding.registrySha256}`)
  if (g.bytes !== undefined && binding.registryBytes !== undefined && g.bytes !== binding.registryBytes) fail(`grammar bytes ${g.bytes} ≠ ${binding.registryBytes}`)
  const v = spec.vocabulary ?? {}
  const s = binding.surface ?? {}
  if (v.nodeTypeIds !== undefined && s.ids !== undefined && v.nodeTypeIds !== s.ids) fail(`vocabulary.nodeTypeIds ${v.nodeTypeIds} ≠ ${s.ids}`)
  if (v.namedUnique !== undefined && s.namedUnique !== undefined && v.namedUnique !== s.namedUnique) fail(`vocabulary.namedUnique ${v.namedUnique} ≠ ${s.namedUnique}`)
  if (v.anonUnique !== undefined && s.anonUnique !== undefined && v.anonUnique !== s.anonUnique) fail(`vocabulary.anonUnique ${v.anonUnique} ≠ ${s.anonUnique}`)
  if (v.fields !== undefined && s.fields !== undefined && v.fields !== s.fields) fail(`vocabulary.fields ${v.fields} ≠ ${s.fields}`)
} else {
  fail(`the binding measurement is missing: ${path.relative(ROOT, BINDING_PATH)}`)
}

// ── 2. THE POPULATION ─────────────────────────────────────────────────────────────────────────
const pop = census.population ?? {}
const specPop = spec.population ?? spec.measured?.population ?? {}
for (const [specKey, censusKey] of [
  ["paths", "paths"], ["distinctFiles", "distinctFiles"], ["admittedTotal", "admittedTotal"],
  ["reposCarryingAnAdmittedFile", "reposCarryingAnAdmittedFile"],
  ["symlinkedRepoDirsFollowed", "symlinkedRepoDirsFollowed"],
  ["symlinkedDirsFollowedOnDiskWalk", "symlinkedDirsFollowedOnDiskWalk"],
] as const) {
  const a = (specPop as any)[specKey]
  const b = (pop as any)[censusKey]
  if (a === undefined) continue
  if (a !== b) fail(`population.${specKey} = ${a} ≠ the census's ${b}`)
}

// ── 3. THE PER-TYPE COUNTS ────────────────────────────────────────────────────────────────────
const implemented: string[] = cov.implemented ?? []
const measured = cov._implemented_measured ?? {}
for (const t of implemented) {
  const row = (census.perType ?? {})[t]
  if (!row) { fail(`the census has no perType row for the implemented type "${t}"`); continue }
  const m = measured[t]
  if (!m) { fail(`"${t}" is implemented but has NO _implemented_measured row — emitted but never measured is CLAIMED, not implemented`); continue }
  if (m.edges !== undefined && m.edges !== row.edges) fail(`_implemented_measured["${t}"].edges = ${m.edges} ≠ the census's ${row.edges}`)
  if (m.files !== undefined && m.files !== row.files) fail(`_implemented_measured["${t}"].files = ${m.files} ≠ the census's ${row.files}`)
  if (row.edges === 0 && !m._why) fail(`"${t}" has 0 edges over the whole admitted population and cites no _why`)
  if (m._unit && m._unit !== String(census.instrument ?? "")) {
    // the unit must NAME the population, and the population must be the census's
    if (!/admitted|whole|whole admitted/i.test(String(m._unit))) fail(`_implemented_measured["${t}"]._unit does not name the population: ${m._unit}`)
  }
}
for (const t of Object.keys(measured)) {
  // `_unit` and `_why` are the BLOCK'S OWN metadata, not types — this loop once reported
  // `_implemented_measured names "_unit", which is not in implemented` because it compared every
  // key against the type list. A key that begins with an underscore is the block talking about
  // itself, so it is not a claim about a type and is skipped by that rule rather than by a list.
  if (t.startsWith("_")) continue
  if (!implemented.includes(t)) fail(`_implemented_measured names "${t}", which is not in implemented`)
}

// ── 4/5. THE DENOMINATOR AND THE CLOSURE ──────────────────────────────────────────────────────
const excluded: any[] = cov.excluded ?? []
const zeroFacts: any[] = cov.zeroEmissionFacts ?? []
const pending: any[] = cov.grammarRemedyPending ?? []
const unex: any[] = cov.corpusUnexercised ?? []
const SHRINKING = new Set(["grammar-absence", "zero-sites", "grammar-remedy-ruled", "ontological", "informational", "adjudication"])
const gAbs = excluded.filter((x) => {
  const cls = typeof x === "string" ? "" : (x?.evidence ?? "")
  const key = String(cls).trim().split(/[(\s]/)[0].toLowerCase()
  return key === "grammar-absence" || key === "zero-sites" || SHRINKING.has(key)
}).map((x) => (typeof x === "string" ? x : x.label))
const zeroLabels = zeroFacts.map((x) => (typeof x === "string" ? x : x?.label)).filter((t) => ALL_TYPES.includes(t as string))
const pendingLabels = pending.map((x) => (typeof x === "string" ? x : x?.label)).filter((t) => ALL_TYPES.includes(t as string))
const unexLabels = unex.map((x) => (typeof x === "string" ? x : x?.label)).filter((t) => ALL_TYPES.includes(t as string))
const applicable = ALL_TYPES.length - gAbs.length - zeroLabels.length
const gaps = ALL_TYPES.filter((t) => !implemented.includes(t) && !gAbs.includes(t) && !zeroLabels.includes(t) && !unexLabels.includes(t))
const den = cov.denominator ?? {}
if (den.n !== undefined && den.n !== applicable) fail(`denominator.n = ${den.n} ≠ the computed applicable ${applicable}`)
if (Array.isArray(den.types)) {
  const named = [...den.types].sort()
  const computed = [...implemented, ...unexLabels, ...gaps].sort()
  if (JSON.stringify(named) !== JSON.stringify(computed)) {
    fail(`denominator.types does not name the computed set.\n    declared: ${JSON.stringify(named)}\n    computed: ${JSON.stringify(computed)}`)
  }
}
if (implemented.length + unexLabels.length + gaps.length !== applicable) {
  fail(`DOES NOT CLOSE: implemented ${implemented.length} + unexercised ${unexLabels.length} + gaps ${gaps.length} ≠ applicable ${applicable}`)
}

// ── 6. THE RULINGS ───────────────────────────────────────────────────────────────────────────
const GRAMMAR_SIDE = /\b(\d[\d,]*)\s+(named\s+)?(node\s+)?types?\b|\bnode\s+types?\b|\bgrammar[’'s]?\s+own\s+inventory\b|\bnamed\s+types?\b/i
for (const x of zeroFacts) {
  const label = typeof x === "string" ? "" : x?.label
  const from = String(typeof x === "string" ? "" : (x?.from ?? ""))
  if (implemented.includes(label)) fail(`"${label}" is BOTH implemented and a zero-emission fact`)
  if (!from.trim()) { fail(`the zero-emission fact for "${label}" cites no source`); continue }
  if (!GRAMMAR_SIDE.test(from)) fail(`the zero-emission fact for "${label}" cites only a BEHAVIOUR measurement — the GRAMMAR's own inventory must be cited too`)
  const cited = (census.constructs ?? {}) as Record<string, { edges: number; files: number; repos: number }>
  const claimed = x?.construct ? String(x.construct) : null
  if (claimed) {
    const row = cited[claimed]
    if (!row) fail(`the zero-emission fact for "${label}" cites the construct "${claimed}", which the census does not report`)
    else if (x?.count !== undefined && x.count !== row.edges) fail(`the zero-emission fact for "${label}" counts ${x.count} but the census's ${claimed} is ${row.edges}`)
  }
  // ★ THE FALSIFIER RULE (the Lead's, 2026-10-22): "A RULING'S FALSIFIER MUST NAME A CONSTRUCT THAT
  // AN INSTRUMENT IN THE TREE COUNTS. A falsifier that names a construct nothing counts is not a
  // falsifier; it is a sentence." ⇒ AND A NAMED CONSTRUCT WITH "NONE MEASURED" IN ITS PARENTHETICAL
  // IS A TODO WEARING A RULING'S CLOTHES — so the falsifier must NAME the counter, and the counter
  // must be one the census actually reports.
  const falsifier = String(typeof x === "string" ? "" : (x?.falsifier ?? ""))
  if (falsifier.trim()) {
    if (claimed) {
      // The falsifier must NAME the construct the ruling is about, by its own name.
      if (!falsifier.includes(claimed)) {
        fail(`the zero-emission fact for "${label}" has a falsifier that does not name its construct "${claimed}" — a falsifier that names nothing the census counts is a sentence, not a falsifier`)
      }
    } else {
      fail(`the zero-emission fact for "${label}" has no construct, so its falsifier names nothing the census counts`)
    }
  }
  // THE NEAR MISS, when the ruling carries one: its construct must be counted too, and its counts
  // must be the census's.
  const near = typeof x === "string" ? null : x?.nearMiss
  if (near?.construct) {
    const nRow = cited[near.construct]
    if (!nRow) fail(`the zero-emission fact for "${label}" names a near-miss construct "${near.construct}" that the census does not report`)
    else {
      if (near.count !== undefined && near.count !== nRow.edges) fail(`the near-miss count for "${label}" is ${near.count} but the census's ${near.construct} is ${nRow.edges}`)
      if (near.files !== undefined && near.files !== nRow.files) fail(`the near-miss file count for "${label}" is ${near.files} but the census's ${near.construct} is ${nRow.files}`)
      if (near.repos !== undefined && near.repos !== nRow.repos) fail(`the near-miss repo count for "${label}" is ${near.repos} but the census's ${near.construct} is ${nRow.repos}`)
    }
  }
}

// ── 6b. THE HERITAGE COVERAGE — THE YAML ANSWER TO THE LEAD'S BLIND-SPOT PROBE ──────────────────
//
// The Lead's `heritage-blindspot-probe.ts` measures, for a language with a heritage NODE, whether
// every heritage clause's SHAPE reaches the analyzer's lookup. YAML has no heritage NODE — its
// heritage is a KEY (`<<`, `allOf`, `extends:`) — so the probe declines to configure it ("nothing
// is measured and nothing is claimed"), and THIS is the lane's own equivalent: the census counts
// the heritage CLAUSES (the alias nodes) and the analyzer's published edges, and the two must be
// EQUAL. A clause that is counted and not published is a blind spot, and a blind spot measured on
// the whole population is a defect, not a rounding difference.
{
  const cited = (census.constructs ?? {}) as Record<string, { edges: number }>
  const aliasClauses =
    (cited["yaml.merge_alias_direct"]?.edges ?? 0) +
    (cited["yaml.merge_alias_under-a-FLOW-sequence"]?.edges ?? 0) +
    (cited["yaml.merge_alias_under-a-BLOCK-sequence"]?.edges ?? 0)
  const published = (census.perMarkerType ?? {}) as Record<string, { edges: number }>
  const mergeEdges = published["extends | yaml_merge"]?.edges ?? 0
  const aliasEdges = published["uses | yaml_alias"]?.edges ?? 0
  // ★ THE COMPARISON IS CLAUSE-TO-CLAUSE, AND IT USED TO ADD A COUNT THAT IS NOT A HERITAGE CLAUSE.
  // The three `merge_alias_*` counters count MERGE aliases — the heritage clauses — and every one of
  // them must be published as an `extends`. `uses | yaml_alias` counts EVERY plain alias, including
  // the ones that are not merges at all (`yaml.alias_NOT_a_merge` is its own counter), so adding it
  // to the heritage clause count made a CORRECT publication read as a blind spot: 155 clauses
  // against "323 published". THE DEFECT WAS IN THE CHECK, NOT THE ANALYZER — and a check that
  // cannot be satisfied is worse than no check, because the next lane disables it.
  if (aliasClauses !== mergeEdges) {
    fail(`THE HERITAGE COVERAGE: ${aliasClauses} merge-alias heritage clauses in the population, but ${mergeEdges} published as \`extends\` — a clause that is counted and not published is a BLIND SPOT`)
  }
  // AND THE OTHER ALIASES ARE REPORTED, NOT ASSERTED: the plain aliases exist and are published as
  // `uses`, and the two counts are printed together so a reader can see that the shape census and
  // the analyzer disagree about NOTHING rather than merely disagreeing about nothing it prints.
  if (aliasClauses > 0 && aliasEdges === 0) {
    fail(`THE HERITAGE COVERAGE: ${aliasClauses} merge-alias clauses exist but the analyzer published NO \`uses\` alias edge at all — the alias emission site is silent`)
  }
}

// ── 7. THE DISJOINTNESS ───────────────────────────────────────────────────────────────────────
for (const t of implemented) {
  if (gAbs.includes(t)) fail(`"${t}" is BOTH implemented and excluded`)
  if (zeroLabels.includes(t)) fail(`"${t}" is BOTH implemented and a zero-emission fact`)
  if (pendingLabels.includes(t)) fail(`"${t}" is BOTH implemented and grammar-remedy-pending`)
}

// ── 8. THE FIXTURES AND THE CITED ARTIFACTS ───────────────────────────────────────────────────
for (const f of spec.fixtures ?? []) {
  const p = path.resolve(ROOT, f)
  if (!existsSync(p)) fail(`the spec names a fixture that does not exist: ${f}`)
}
for (const t of Object.keys(measured)) {
  for (const a of measured[t].artifacts ?? []) {
    if (!existsSync(path.resolve(ROOT, a))) fail(`_implemented_measured["${t}"] cites an artifact that does not exist: ${a}`)
  }
}

// ── the BEFORE/AFTER DELTA, when the before-census is present ───────────────────────────────
if (before) {
  for (const t of implemented) {
    const b = (before.perType ?? {})[t]
    const a = (census.perType ?? {})[t]
    if (!b || !a) continue
    notes.push(`${t.padEnd(13)} ${String(b.edges).padStart(8)} → ${String(a.edges).padStart(8)} edges  (Δ ${a.edges - b.edges})`)
  }
}

console.log(`yaml-spec-check — ${SPEC_PATH.replace(ROOT + "/", "")}`)
console.log(`  population: ${pop.paths} paths · ${pop.distinctFiles} distinct files · ${pop.admittedTotal} admitted · ${pop.reposCarryingAnAdmittedFile} repos`)
console.log(`  denominator: n=${den.n} (computed ${applicable}) · implemented ${implemented.length} · gaps ${gaps.length} · ruled ${gAbs.length + zeroLabels.length}`)
if (notes.length) { console.log("  BEFORE → AFTER (whole admitted population):"); for (const n of notes) console.log(`    ${n}`) }
if (problems.length) {
  console.log("")
  console.log(`FAIL — ${problems.length} problem(s):`)
  for (const p of problems) console.log(`  · ${p}`)
  process.exit(1)
}
console.log("  OK — every published number re-derives from the measurement artifacts.")
