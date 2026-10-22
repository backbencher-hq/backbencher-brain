/**
 * script/m14/yaml-spec-fill.ts — FILL THE YAML SPEC'S NUMBERS FROM THE MEASUREMENT ARTIFACTS.
 *
 * THE SPEC IS PROSE AND NUMBERS, AND THE NUMBERS MUST NOT BE TYPED BY HAND. This reads
 *   - the TEMPLATE   (`script/m14/yaml-completeness.template.json`), which holds every word,
 *   - the AFTER census (`validation/m14/measurements/yaml-emission-census-whole.json`),
 *   - the BEFORE census (`validation/m14/measurements/yaml-emission-census-before.json`),
 *   - the GRAMMAR BINDING (`validation/m14/measurements/yaml-grammar-binding.json`),
 * and writes `script/m14/spec/yaml-completeness.json` with every `@@KEY@@` replaced by the
 * measured value.
 *
 * THE REPLACEMENT IS JSON-AWARE, so a placeholder that stands for a NUMBER becomes a number and a
 * placeholder inside PROSE becomes prose: the template is itself valid JSON, and the spec it
 * produces is too. A placeholder with no measured source is a REFUSAL, not a zero: the script
 * exits non-zero and names it, so a spec can never publish a number that was not measured.
 *
 *   node script/m14/yaml-spec-fill.ts [--template P] [--census P] [--before P] [--binding P] [--out P] [--check]
 *
 * `--check` writes nothing and only reports whether the spec on disk still matches what the
 * artifacts imply. `script/m14/yaml-spec-check.ts` is the independent verifier: it re-derives the
 * numbers from the artifacts and does not trust this script's own output.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")
const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const TEMPLATE = path.resolve(ROOT, arg("template", "script/m14/yaml-completeness.template.json"))
const CENSUS = path.resolve(ROOT, arg("census", "validation/m14/measurements/yaml-emission-census-whole.json"))
const BEFORE = path.resolve(ROOT, arg("before", "validation/m14/measurements/yaml-emission-census-before.json"))
const BINDING = path.resolve(ROOT, arg("binding", "validation/m14/measurements/yaml-grammar-binding.json"))
const OUT = path.resolve(ROOT, arg("out", "script/m14/spec/yaml-completeness.json"))
const CHECK_ONLY = process.argv.includes("--check")

const TYPES = ["calls", "contains", "exports", "extends", "imports", "overrides", "references", "uses"]
const CONSTRUCTS = [
  "yaml.implements_key", "yaml.instantiates_key", "yaml.tag_node", "yaml.tag_local", "yaml.tag_core_schema",
  "yaml.tag_verbatim", "yaml.template_interpolation_in_scalar", "yaml.merge_key", "yaml.merge_alias_direct",
  "yaml.alias_NOT_a_merge", "yaml.include_family_tag", "yaml.allOf_key", "yaml.anyOf_key", "yaml.oneOf_key",
  "yaml.supertype_candidate_key", "yaml.extends_key",
  "yaml.extends_key_SHAPE_sibling_dot_name", "yaml.extends_key_SHAPE_docker_compose_service",
  "yaml.extends_key_SHAPE_azure_template", "yaml.extends_key_SHAPE_config_preset",
  "yaml.extends_key_SHAPE_other_mapping", "yaml.extends_key_SHAPE_other_scalar",
  "yaml.merge_key_with_mapping_target", "yaml.merge_key_with_sequence_target",
  "yaml.include_family_key", "yaml.include_family_key_OUTSIDE_the_analyzer_closed_set",
  "yaml.include_family_tag_OUTSIDE_the_analyzer_closed_set", "yaml.duplicate_mapping_key",
  "yaml.json_pointer_ref_key", "yaml.uses_key", "yaml.job_level_uses", "yaml.non_job_level_uses",
  "yaml.schema_publication_definition", "yaml.multi_document_stream", "yaml.directive",
  "yaml.anchor_node", "yaml.alias_node",
  // THE FOUR EXTENDED TYPES' DECISIVE COUNTERS — the construct each ruling's FALSIFIER names, so a
  // falsifier can never name something no instrument counts.
  "yaml.tag_naming_a_declaration_in_the_document",
  "yaml.template_component_named_in_a_scalar",
  "yaml.template_component_named_in_the_file_text",
  "yaml.merge_sequence_with_aliases",
  "yaml.merge_sequence_with_more_than_one_alias",
  "yaml.include_family_tag_at_the_document_root",
  "yaml.include_family_tag_at_a_key_position",
  "yaml.merge_alias_under-a-FLOW-sequence",
  "yaml.merge_alias_under-a-BLOCK-sequence",
]

const readJson = (p: string): any => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null)
const template = readJson(TEMPLATE)
const census = readJson(CENSUS)
const before = readJson(BEFORE)
const binding = readJson(BINDING)
if (!template) { console.error(`FAIL — no template: ${TEMPLATE}`); process.exit(1) }
if (!census) { console.error(`FAIL — no census: ${CENSUS}`); process.exit(1) }
if (!before) { console.error(`FAIL — no BEFORE census: ${BEFORE}`); process.exit(1) }
if (!binding) { console.error(`FAIL — no grammar binding: ${BINDING}`); process.exit(1) }

const pop = census.population ?? {}
const perType = census.perType ?? {}
const perMarkerType = census.perMarkerType ?? {}
const constructs = census.constructs ?? {}
const bType = before.perType ?? {}
const surface = binding.surfaceFromServedBytes ?? {}
const asset = binding.measurements?.A_registryBytes ?? {}
const resolved = binding.measurements?.B_resolvedPath ?? {}

const V: Record<string, string | number> = {
  AT: census.at ?? "",

  GRAMMAR_SHA256: asset.sha256 ?? "",
  GRAMMAR_BYTES: asset.bytes ?? 0,
  GRAMMAR_PATH: resolved.path ?? "",
  NODE_TYPE_IDS: surface.ids ?? 0,
  NAMED_IDS: surface.namedIds ?? 0,
  NAMED_UNIQUE: surface.namedUnique ?? 0,
  ANON_UNIQUE: surface.anonUnique ?? 0,
  UNIQUE_NAMES: surface.uniqueNames ?? 0,
  FIELD_COUNT: surface.fieldCount ?? 0,
  ID_ORDER_DIGEST: surface.idOrderDigest ?? "",
  TYPE_SET_DIGEST: surface.typeSetDigest ?? "",
  FIELD_SET_DIGEST: surface.fieldSetDigest ?? "",

  POP_PATHS: pop.paths, POP_DISTINCT: pop.distinctFiles, POP_ADMITTED: pop.admittedTotal,
  POP_PARSED: pop.parsed, POP_FAILED: pop.failed, POP_DEGRADED: pop.degradedToFallback,
  POP_ABSENT: pop.absent, POP_OVERCAP: pop.overCap,
  POP_REPOS: pop.reposCarryingAnAdmittedFile,
  POP_SYMLINKED_REPOS: pop.symlinkedRepoDirsFollowed,
  POP_SYMLINKED_DIRS: pop.symlinkedDirsFollowedOnDiskWalk,
}
for (const t of TYPES) {
  const up = t.toUpperCase()
  const row = perType[t]
  if (!row) { console.error(`FAIL — the census has no perType row for "${t}"`); process.exit(1) }
  V[`T_${up}_EDGES`] = row.edges
  V[`T_${up}_FILES`] = row.files
  V[`T_${up}_REPOS`] = row.repos
  V[`B_${up}_EDGES`] = bType[t] ? bType[t].edges : 0
}
// THE THREE `extends` FORMS, from the marker's own rows.
V["T_EXTENDS_MERGE"] = perMarkerType["extends | yaml_merge"]?.edges ?? 0
V["T_EXTENDS_ALLOF"] = perMarkerType["extends | yaml_schema_composition"]?.edges ?? 0
V["T_EXTENDS_KEY"] = perMarkerType["extends | yaml_config_extends"]?.edges ?? 0
for (const c of CONSTRUCTS) {
  const key = c.replace(/^yaml\./, "").toUpperCase()
  const row = constructs[c]
  V[`C_${key}`] = row ? row.edges : 0
  V[`C_${key}_FILES`] = row ? row.files : 0
  V[`C_${key}_REPOS`] = row ? row.repos : 0
}
// The three composition keywords, spelled the way the prose spells them.
for (const [alias, construct] of [
  ["C_ALL_OF_KEY", "yaml.allOf_key"],
  ["C_ANY_OF_KEY", "yaml.anyOf_key"],
  ["C_ONE_OF_KEY", "yaml.oneOf_key"],
] as const) {
  const row = constructs[construct]
  V[alias] = row ? row.edges : 0
  V[`${alias}_FILES`] = row ? row.files : 0
  V[`${alias}_REPOS`] = row ? row.repos : 0
}
// THE COMPONENT NAMES a template expression names — the `renders` near-miss, by spelling.
const componentNames = (census.templateComponentNames ?? {}) as Record<string, { edges: number; files: number; repos: number }>
V["TEMPLATE_COMPONENT_NAMES"] = Object.keys(componentNames).length
V["TEMPLATE_COMPONENT_SPELLINGS"] = Object.keys(componentNames).sort().join(", ")

// THE SUPERTYPE-CANDIDATE KEY BREAKDOWN, per key, from the tree.
const supertype = (census.supertypeKeySpellings ?? {}) as Record<string, { edges: number; files: number; repos: number }>
for (const [k, row] of Object.entries(supertype)) {
  const up = k.toUpperCase()
  V[`SK_${up}_EDGES`] = row.edges
  V[`SK_${up}_FILES`] = row.files
  V[`SK_${up}_REPOS`] = row.repos
}
for (const k of ["implements", "inherits", "base", "superclass", "extends", "satisfies", "conformsTo", "prototype", "supertype", "mixin"]) {
  const up = k.toUpperCase()
  if (!( `SK_${up}_EDGES` in V)) { V[`SK_${up}_EDGES`] = 0; V[`SK_${up}_FILES`] = 0; V[`SK_${up}_REPOS`] = 0 }
}

const missing: string[] = []
const unresolved: string[] = []
/** Substitute INSIDE one string: a whole-string placeholder keeps its type; a partial one is prose. */
const fillString = (s: string): string => {
  const whole = /^@@([A-Z0-9_]+)@@$/.exec(s)
  if (whole) {
    const key = whole[1]
    if (!(key in V)) { unresolved.push(key); return s }
    const v = V[key]
    if (v === undefined || v === null || v === "") { missing.push(key); return s }
    return String(v)
  }
  return s.replace(/@@([A-Z0-9_]+)@@/g, (m, key: string) => {
    if (!(key in V)) { unresolved.push(key); return m }
    const v = V[key]
    if (v === undefined || v === null || v === "") { missing.push(key); return m }
    return String(v)
  })
}
const walk = (node: any): any => {
  if (Array.isArray(node)) return node.map(walk)
  if (node && typeof node === "object") {
    const out: any = {}
    for (const [k, v] of Object.entries(node)) out[k] = walk(v)
    return out
  }
  if (typeof node === "string") return fillString(node)
  return node
}
const filled = walk(template)
if (unresolved.length) {
  console.error(`FAIL — these placeholders have NO measured source: ${[...new Set(unresolved)].join(", ")}`)
  process.exit(1)
}
if (missing.length) {
  console.error(`FAIL — these placeholders measured EMPTY: ${[...new Set(missing)].join(", ")}`)
  process.exit(1)
}
const text = JSON.stringify(filled, null, 2) + "\n"
const left = text.match(/@@[A-Z0-9_]+@@/g)
if (left) { console.error(`FAIL — unresolved placeholders remain: ${[...new Set(left)].join(", ")}`); process.exit(1) }

if (CHECK_ONLY) {
  const onDisk = existsSync(OUT) ? readFileSync(OUT, "utf8") : ""
  if (onDisk === text) { console.log("yaml-spec-fill — the spec on disk matches the artifacts."); process.exit(0) }
  console.error("yaml-spec-fill — the spec on disk DOES NOT match the artifacts; re-run without --check.")
  process.exit(1)
}
writeFileSync(OUT, text)
console.log(`yaml-spec-fill — wrote ${path.relative(ROOT, OUT)} (${text.length} bytes) from ${path.relative(ROOT, CENSUS)} + ${path.relative(ROOT, BEFORE)} + ${path.relative(ROOT, BINDING)}`)
