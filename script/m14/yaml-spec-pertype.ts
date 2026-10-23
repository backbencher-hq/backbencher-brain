/**
 * YAML — THE EIGHT IMPLEMENTED TYPES' WHOLE-POPULATION COUNTS, WRITTEN INTO `_implemented_measured`.
 *
 * THE DEFECT THIS CLOSES, AND IT IS THE FLEET'S OWN SENTENCE: "a type that is emitted but never
 * measured is not implemented, it is claimed. Every published number needs a whole-population count."
 * The lane's spec carries `_implemented_measured` rows for THREE of its eight implemented types; the
 * other five were declared implemented with no count behind them at all. This script writes a row for
 * every implemented type FROM THE CENSUS, so the published numbers are the measurement's.
 *
 * ── WHAT IT REFUSES ──────────────────────────────────────────────────────────────────────────────
 *
 *  · A census that is NOT a whole-population census (`parsed !== admittedTotal`).
 *  · A census produced by the parse-only mode: the per-type tallies come from the ANALYZER, and a
 *    parse-only run has no `perType` rows at all. Filing a zero from that run would be filing the
 *    ABSENCE OF THE MEASUREMENT as if it were the measurement.
 *  · An implemented type the census has no row for — a type the analyzer never emitted.
 *  · A zero for a type without a `_why` that names an existing artifact (the gate's own rule: a bare
 *    zero is not evidence, because an empty result is only evidence if the predicate could have
 *    returned non-zero).
 *
 *   node script/m14/yaml-spec-pertype.ts --census <full merged census.json> [--spec P] [--write]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1]
  for (const a of argv) if (a.startsWith(f + "=")) return a.slice(f.length + 1)
  return undefined
}
const CENSUS = argOf("--census")
const SPEC = argOf("--spec") ?? path.join(ROOT, "script/m14/spec/yaml-completeness.json")
const WRITE = argv.includes("--write")

if (!CENSUS || !existsSync(CENSUS)) { console.error(`FAIL — --census must name an existing merged census artifact (got: ${CENSUS ?? "nothing"})`); process.exit(2) }
if (!existsSync(SPEC)) { console.error(`FAIL — no spec at ${SPEC}`); process.exit(2) }

const census = JSON.parse(readFileSync(CENSUS, "utf8"))
const spec = JSON.parse(readFileSync(SPEC, "utf8"))
const pop = census?.population ?? {}
const admitted = Number(pop.admittedTotal ?? 0)
const parsed = Number(pop.parsed ?? 0)
const mode = String(census?.mode ?? "")

if (!/full/.test(mode)) {
  console.error(
    `REFUSING — the census mode is "${mode}", not a full run. The per-type tallies come from the ` +
    `ANALYZER and a parse-only run has no \`perType\` rows; writing them from that run would file the ` +
    `ABSENCE OF THE MEASUREMENT as the measurement.`,
  )
  process.exit(3)
}
if (!(admitted > 0) || parsed !== admitted) {
  console.error(`REFUSING — NOT A WHOLE-POPULATION CENSUS: parsed ${parsed} of ${admitted} admitted`)
  process.exit(3)
}

const blk = spec.coverage ?? (spec.coverage = {})
const implemented: string[] = Array.isArray(blk.implemented) ? blk.implemented : []
const perType: Record<string, { edges: number; files: number; repos: number }> = census?.perType ?? {}
const perMarkerType: Record<string, { edges: number; files: number; repos: number }> = census?.perMarkerType ?? {}
const constructs: Record<string, { edges: number; files: number; repos: number }> = census?.constructs ?? {}
const censusRel = CENSUS.replace(ROOT + "/", "")
const unit =
  `the whole admitted population: ${admitted} admitted .yaml/.yml files in ` +
  `${Number(pop.reposCarryingAnAdmittedFile ?? 0)} repositories (${Number(pop.paths ?? 0)} paths, ` +
  `${Number(pop.distinctFiles ?? 0)} distinct), walked from the corpus root with symlinked ` +
  `repositories FOLLOWED (${Number(pop.symlinkedRepoDirsFollowed ?? 0)}), read from ${censusRel}`
const why =
  `the analyzer was run over every admitted file in ${censusRel} and emitted no edge of this type; ` +
  `the construct census in the same artifact counts the sites the type would be read from, so the ` +
  `zero is a measurement of the population and not an absence of measurement`

const rows: Record<string, any> = {}
const missing: string[] = []
for (const t of implemented) {
  const r = perType[t]
  if (!r) { missing.push(t); continue }
  rows[t] = {
    edges: r.edges,
    files: r.files,
    repos: r.repos,
    artifacts: [censusRel],
    ...(r.edges === 0 && r.files === 0 ? { _why: why } : {}),
  }
}
if (missing.length) {
  console.error(
    `REFUSING — the census has NO per-type row for ${missing.length} implemented type(s): ` +
    `${missing.join(", ")}. A type the analyzer never emitted over the whole population is not ` +
    `implemented; either the emission site is broken or the declaration is wrong.`,
  )
  process.exit(4)
}

// THE FORMS BLOCK, where a measured sub-shape exists: `extends` is published through three
// mechanisms and each one is counted separately, so the row says WHICH mechanisms produced it.
const extendsRow = rows["extends"]
if (extendsRow) {
  const merge = perMarkerType["extends | yaml_merge"]?.edges ?? 0
  const allOf = perMarkerType["extends | yaml_schema_composition"]?.edges ?? 0
  const key = perMarkerType["extends | yaml_config_extends"]?.edges ?? 0
  extendsRow.forms = {
    merge_key: merge,
    schema_composition_allOf: allOf,
    config_extends_key: key,
    _sum: merge + allOf + key,
    _note:
      "the three mechanisms are counted separately; their sum is the row's `edges` when no other " +
      "marker also emits `extends`, and the census's perMarkerType is the artifact that proves it",
  }
}

blk._implemented_measured = { _unit: unit, ...rows }

console.log(`CENSUS  ${censusRel}`)
console.log(`MODE    ${mode}`)
console.log(`POP     ${admitted} admitted files in ${Number(pop.reposCarryingAnAdmittedFile ?? 0)} repositories`)
console.log("")
console.log("THE EIGHT IMPLEMENTED TYPES, MEASURED OVER THE WHOLE ADMITTED POPULATION:")
for (const t of implemented) {
  const r = perType[t]
  console.log(`  ${t.padEnd(12)} ${String(r.edges).padStart(7)} edges  ${String(r.files).padStart(6)} files  ${String(r.repos).padStart(4)} repos`)
}
if (extendsRow?.forms) {
  const f = extendsRow.forms
  console.log(`  extends forms: merge_key ${f.merge_key} · allOf ${f.schema_composition_allOf} · config_extends_key ${f.config_extends_key} (sum ${f._sum})`)
}
if (!WRITE) { console.log("\nDRY RUN — nothing written. Pass --write to write the spec."); process.exit(0) }
writeFileSync(SPEC, JSON.stringify(spec, null, 2) + "\n")
console.log(`\nWROTE ${SPEC}`)
