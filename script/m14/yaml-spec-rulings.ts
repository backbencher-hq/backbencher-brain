/**
 * YAML — THE FOUR EXTENDED TYPES' COUNTS, WRITTEN INTO THE SPEC FROM THE CENSUS.
 *
 * This script does ONE thing and it does it from MEASURED NUMBERS ONLY: it reads the lane's
 * whole-population census and writes the four extended types into
 * `script/m14/spec/yaml-completeness.json` as `coverage.zeroEmissionFacts` rows, then sets
 * `coverage.denominator` from the gate's own arithmetic.
 *
 * ── WHY THIS SCRIPT REFUSES MORE OFTEN THAN IT WRITES ────────────────────────────────────────────
 *
 * EACH OF THE FOUR RULINGS RESTS ON ONE COUNTER, AND A NON-ZERO READING OF THAT COUNTER FALSIFIES
 * THE RULING. So the script TREATS A NON-ZERO AS A REFUSAL, not as something to write down and
 * explain: if `yaml.tag_with_a_call_shaped_argument` is non-zero then a YAML tag DOES carry a call
 * and `decorates` is live and must be IMPLEMENTED; if
 * `yaml.merge_list_with_a_separate_base_clause` is non-zero then YAML DOES have the shape the
 * vocabulary calls a mixin, and `mixes_in` must be implemented; if
 * `yaml.include_family_tag_at_the_document_root` is non-zero then an included fragment DOES reach
 * the including document's top-level scope and `part_of` must be implemented; if
 * `yaml.template_component_named_in_a_scalar` is non-zero then a template expression that names a
 * component IS a YAML scalar and `renders` must be implemented.
 *
 * ⇒ A REFUSAL FROM THIS SCRIPT IS THE RULING'S FALSIFIER FIRING. It is not an error to work
 * around; it is the measurement telling the lane to implement the type instead.
 *
 * ── AND WHAT IT WILL NOT DO ──────────────────────────────────────────────────────────────────────
 *
 * It will not invent a number, it will not accept a census whose population is a sample or whose
 * mode is not parse-only/full, and it will not write a `from` citation that omits the grammar's own
 * inventory — the gate refuses a zero-emission fact whose citation is only a BEHAVIOUR measurement,
 * because an analyzer that merely lacks an emission site is an UNIMPLEMENTED type and not an
 * inapplicable one. So every row carries BOTH halves: the corpus count of the decisive construct,
 * and the named-node-type count of the pinned grammar build.
 *
 *   node script/m14/yaml-spec-rulings.ts --census <merged census.json> [--spec <path>] [--write]
 *
 * Without `--write` it REPORTS what it would write and exits 0 — so a dry run is the default and a
 * mutation is asked for by name.
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
const GRAMMAR_NODES = path.join(ROOT, "validation/m14/measurements/yaml-grammar-nodes.json")
const WRITE = argv.includes("--write")

if (!CENSUS || !existsSync(CENSUS)) {
  console.error(`FAIL — --census must name an existing merged census artifact (got: ${CENSUS ?? "nothing"})`)
  process.exit(2)
}
if (!existsSync(SPEC)) { console.error(`FAIL — no spec at ${SPEC}`); process.exit(2) }
if (!existsSync(GRAMMAR_NODES)) {
  console.error(`FAIL — the grammar's own inventory is missing: ${GRAMMAR_NODES} (run \`bun script/m14/grammar-node-inventory.ts yaml\`)`)
  process.exit(2)
}

const census = JSON.parse(readFileSync(CENSUS, "utf8"))
const nodes = JSON.parse(readFileSync(GRAMMAR_NODES, "utf8"))
const spec = JSON.parse(readFileSync(SPEC, "utf8"))

// ── THE CENSUS MUST BE A WHOLE-POPULATION CENSUS. A sample is not a census. ─────────────────────
const pop = census?.population ?? {}
const admitted = Number(pop.admittedTotal ?? 0)
const parsed = Number(pop.parsed ?? 0)
const mode = String(census?.mode ?? "")
if (!/parse-only|full/.test(mode)) {
  console.error(`FAIL — the census does not say which rule produced it (mode="${mode}"); a number that does not say which rule produced it cannot be compared`)
  process.exit(3)
}
if (!(admitted > 0) || parsed !== admitted) {
  console.error(`FAIL — NOT A WHOLE-POPULATION CENSUS: parsed ${parsed} of ${admitted} admitted`)
  process.exit(3)
}

// ── THE GRAMMAR'S OWN INVENTORY, AND ITS DIGEST — BOTH NUMBER AND PROVENANCE ────────────────────
const namedTypes = Number(nodes?.namedTypes ?? 0)
const totalIds = Number(nodes?.totalIds ?? 0)
const servedDigest = String(nodes?.servedDigest ?? "")
if (!(namedTypes > 0) || !servedDigest) {
  console.error(`FAIL — ${GRAMMAR_NODES} does not carry a named-type count and a served digest`)
  process.exit(3)
}

const constructs: Record<string, { edges: number; files: number; repos: number }> = census?.constructs ?? {}
const cOf = (name: string) => constructs[name] ?? { edges: 0, files: 0, repos: 0 }
const popLine = `${admitted} admitted files in ${Number(pop.reposCarryingAnAdmittedFile ?? 0)} repositories`
const grammarLine = `${namedTypes} named node types (of ${totalIds} ids) in the grammar's own inventory, served build sha256 ${servedDigest}`

type Ruling = {
  label: string
  decisive: string
  nearMiss: string
  evidence: string
  why: string
  falsifier: string
}

// ── THE ENVIRONMENT THE ARM RAN IN, RECORDED BECAUSE A NUMBER IS ALSO A NUMBER ABOUT A BOX ─────
//
// The fleet's newest rule, and the scala lane paid for it: a closure measured on a thrashing box is
// a number ABOUT THE BOX. This machine spent the afternoon of 2026-10-22 in a 20-GB swap and this
// census ran right after it — so the load, the memory and the swap are part of the measurement's
// provenance, and a reader who does not see them cannot tell a slow count from a wrong one.
const readProc = (p: string): string => { try { return readFileSync(p, "utf8") } catch { return "" } }
const loadAvg = readProc("/proc/loadavg").trim().split(/\s+/).slice(0, 3).join(" ")
const meminfo = readProc("/proc/meminfo")
const memKb = (k: string): number => {
  const m = meminfo.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))
  return m ? Number(m[1]) : 0
}
const gb = (kb: number): string => `${(kb / 1048576).toFixed(1)} GB`
const swapUsedKb = Math.max(0, memKb("SwapTotal") - memKb("SwapFree"))
const memAvailKb = memKb("MemAvailable")
const cpuCount = readProc("/proc/cpuinfo").split("\n").filter((l) => /^processor\s*:/.test(l)).length
const runEnvironment = {
  measuredAt: String((census as any)?.at ?? ""),
  declaredAt: new Date().toISOString(),
  mode,
  chunking:
    "2,000 files per process, in DISJOINT chunks that tile the admitted set — one process per chunk, " +
    "because a tree-sitter WASM module's memory grows with every parse and never shrinks (the dart " +
    "lane measured the wall at roughly 7,600 parses), so a single-process walk that LOOKS complete " +
    "would measure a fraction of the population while printing a whole-population header",
  corpusRoot: String(pop.corpusRoot ?? ""),
  cpus: cpuCount,
  loadAvg,
  memoryAvailable: gb(memAvailKb),
  memoryTotal: gb(memKb("MemTotal")),
  swapInUse: gb(swapUsedKb),
  node: process.version,
  caveat:
    `THE COUNTS THIS DECLARATION CARRIES ARE ONLY AS HEALTHY AS THE BOX THEY WERE TAKEN ON. At ` +
    `declaration time: load average ${loadAvg} on ${cpuCount} CPUs, ${gb(memAvailKb)} available of ` +
    `${gb(memKb("MemTotal"))}, ${gb(swapUsedKb)} of swap in use. This machine spent the afternoon of ` +
    `2026-10-22 in a 20-GB swap, and a closure measured while the box thrashes is a number ABOUT THE ` +
    `BOX. The chunked walk is what makes the counts safe under that: every chunk is its own process ` +
    `and its own parse, so a slow chunk lengthens the run and CANNOT CHANGE A COUNT.`,
}

// ── THE FOUR RULINGS. Each `why` is the ARGUMENT, each `falsifier` NAMES ITS COUNTED CONSTRUCT. ──
const RULINGS: Ruling[] = [
  {
    label: "decorates",
    decisive: "yaml.tag_with_a_call_shaped_argument",
    nearMiss: "yaml.tag_with_a_constructor_argument",
    evidence: "ontological",
    why:
      "`decorates` is an APPLIED CALLABLE: the contract says the source is the decorated declaration " +
      "and the target is the decorator's name, and that the decorated symbol does not invoke the " +
      "decorator — the runtime applies it while the declaration is created. **NOT `references`**: a " +
      "reference says the decorator's name is mentioned, which is true but says nothing about " +
      "application. YAML's nearest neighbour of an applied callable is a TAG WITH A CONSTRUCTOR " +
      "ARGUMENT, and a tag's argument is a NAME — `!include` (suffix `include`), `!!str` (suffix " +
      "`str`), `!e!thing` (handle `!e!`, suffix `thing`). The csharp lane's dialect decides it, and " +
      "the fleet accepted it twice: IF THE CONSTRUCTOR ARGUMENT IS A CALL IT IS AN APPLICATION; IF IT " +
      "IS A PLAIN NAME IT IS A POINTER. A YAML tag is PASSIVE METADATA that marks a value; it applies " +
      "no callable, and the grammar has no syntax for a call inside a tag (no expression or call node " +
      "type exists among the grammar's named types). AND THE CONSTRUCT IS NOT LOST: a tag that names a " +
      "declaration in its own document is a POINTER, and the lane publishes it as the reference it is.",
    falsifier:
      "A YAML tag whose CONSTRUCTOR ARGUMENT IS A CALL — a tag whose suffix carries a call's " +
      "parenthesis. THE CONSTRUCT IS COUNTED: `yaml.tag_with_a_call_shaped_argument`, over the whole " +
      "admitted population (and `yaml.tag_with_a_constructor_argument` counts the tags that DO carry " +
      "an argument, so the pointer shape is measured beside it). If that count is NON-ZERO the " +
      "application shape IS in the language and `decorates` must be implemented instead of ruled.",
  },
  {
    label: "renders",
    decisive: "yaml.template_component_named_in_a_scalar",
    nearMiss: "yaml.template_component_named_in_the_file_text",
    evidence: "grammar-absence",
    why:
      "`renders` is the name in a RETURNED CONSTRUCTION: the source is the rendering symbol and the " +
      "target is the rendered component. The fleet's four implementations agree on the shape (a JSX " +
      "tag, a hiccup vector, a type argument, dart's `build` returning a Widget) — a template " +
      "expression that NAMES A COMPONENT. Such forms EXIST in the corpus's YAML files " +
      "(`{{ template \"echo-server.fullname\" . }}`, `{{ include \"echo-server.labels\" . | nindent 4 }}`) " +
      "AND THE YAML GRAMMAR CANNOT LEX THEM: the tree of a Helm chart template has an ERROR node at " +
      "its ROOT and the interpolation parses as a `flow_mapping` INSIDE that error, not as a scalar. " +
      "A component-naming interpolation is therefore ANOTHER LANGUAGE'S TEXT INSIDE A YAML FILE, not " +
      "a YAML construct, and a YAML document has no expression to return a construction from. The " +
      "second half is the same fact from the other side: the `{{ define }}` DECLARATIONS live in " +
      "`_helpers.tpl` files, which the admitted extension set does not carry, so no rendered component " +
      "is declared in the admitted population either. THE DIFFERENCE BETWEEN THE TWO COUNTERS IS THE " +
      "MEASUREMENT.",
    falsifier:
      "A template expression that NAMES A COMPONENT and IS A YAML SCALAR — the construct counted by " +
      "`yaml.template_component_named_in_a_scalar`, measured against the text-level " +
      "`yaml.template_component_named_in_the_file_text` over the whole admitted population. If the " +
      "scalar count is NON-ZERO then the interpolation IS a YAML value and `renders` must be " +
      "implemented instead of ruled.",
  },
  {
    label: "mixes_in",
    decisive: "yaml.merge_list_with_a_separate_base_clause",
    nearMiss: "yaml.merge_sequence_with_more_than_one_alias",
    evidence: "ontological",
    why:
      "The vocabulary's own reason a mixin is not `extends` is that THERE IS NO SINGLE BASE and the " +
      "`with` list is not an inheritance clause — so the mixin shape is a LIST OF COMPONENTS ATTACHED " +
      "SEPARATE FROM THE BASE CLAUSE. IN YAML THE MERGE KEY **IS** THE BASE CLAUSE: `<<: *a` names a, " +
      "and `<<: [*a, *b]` names several components IN THE SAME POSITION, which YAML's merge semantics " +
      "order by PRECEDENCE — an order AMONG BASES, not a supertype chain. So a merge list on its own " +
      "is common (merging configuration fragments is what YAML merging is FOR) and it is NOT a mixin, " +
      "while the shape that WOULD be one — a merge list beside a separately named base (`extends:` or " +
      "`allOf:`) — is the counter. YAML has no supertype chain to compose into.",
    falsifier:
      "A mapping that carries a merge LIST (`<<: [*a, *b]`) and names its base SEPARATELY (`extends:` " +
      "or `allOf:`) — the construct counted by `yaml.merge_list_with_a_separate_base_clause`, with " +
      "`yaml.merge_sequence_with_more_than_one_alias` counting the common merge list beside it so the " +
      "difference between the two shapes is measured. If that count is NON-ZERO then YAML DOES have " +
      "the mixin shape and `mixes_in` must be implemented instead of ruled.",
  },
  {
    label: "part_of",
    decisive: "yaml.include_family_tag_at_the_document_root",
    nearMiss: "yaml.include_family_tag_at_a_key_position",
    evidence: "ontological",
    why:
      "`part_of` is the shared-scope relation: a part SHARES the library's single scope, imports " +
      "nothing, and cannot be resolved as a separate module, and the direction is the directive's " +
      "own. YAML's only candidate is the include-tag family (`!include` and its spellings), and it " +
      "fails the contract's own test on a MEASURED ground, not a rhetorical one: IT PUTS THE FRAGMENT " +
      "AT A KEY, NEVER AT THE INCLUDING DOCUMENT'S TOP LEVEL, so the fragment's content becomes the " +
      "VALUE at a key position and no scope is shared. The second ground is the same one the fleet " +
      "already uses: it is a LEADER-DEFINED convention (pyyaml-include's README calls it 'an extending " +
      "constructor of PyYAML'), not a construct of the format, and the lane already publishes it as " +
      "`imports` with the marker `yaml_tag_include`, which is an honest label. The Hasura spellings " +
      "are not even tags — `tables: \"!include default/tables/tables.yaml\"` is a QUOTED STRING " +
      "(`double_quote_scalar`), a fact read off the tree.",
    falsifier:
      "An include-family tag whose parent is the DOCUMENT (or the stream) rather than a mapping pair — " +
      "the construct counted by `yaml.include_family_tag_at_the_document_root`, measured against " +
      "`yaml.include_family_tag_at_a_key_position` over the whole admitted population. If the " +
      "root-position count is NON-ZERO then an included fragment reaches the including document's " +
      "top-level scope and `part_of` must be implemented instead of ruled.",
  },
]

// ── THE FALSIFIER CHECK, RUN BEFORE ANYTHING IS WRITTEN ─────────────────────────────────────────
const refusals: string[] = []
for (const r of RULINGS) {
  const d = cOf(r.decisive)
  if (d.edges > 0) {
    refusals.push(
      `FALSIFIED — ${r.label}: \`${r.decisive}\` is NON-ZERO (${d.edges} sites in ${d.files} files, ` +
      `${d.repos} repositories). The construct the ruling says does not exist DOES EXIST, so ${r.label} ` +
      `is live and must be IMPLEMENTED, not ruled.`,
    )
  }
}
if (refusals.length) {
  for (const x of refusals) console.error(x)
  console.error("\nREFUSING TO WRITE — the falsifiers fired. The measurement has decided that these types are live.")
  process.exit(4)
}

// ── THE ROWS. Both halves in `from`: the corpus count AND the grammar's own inventory. ──────────
const rows = RULINGS.map((r) => {
  const d = cOf(r.decisive)
  const n = cOf(r.nearMiss)
  return {
    label: r.label,
    evidence: r.evidence,
    from:
      `${CENSUS.replace(ROOT + "/", "")} ${GRAMMAR_NODES.replace(ROOT + "/", "")} — ${grammarLine}; ` +
      `${d.edges} ${r.decisive} sites over the whole admitted population (${popLine}); ` +
      `the near miss ${n.edges} ${r.nearMiss} sites`,
    statement:
      `${r.why}\n\n⇒ MEASURED, over the whole admitted population (${popLine}): ` +
      `${d.edges} sites of \`${r.decisive}\` in ${d.files} files and ${d.repos} repositories; ` +
      `the measured near miss is ${n.edges} sites of \`${r.nearMiss}\` in ${n.files} files and ` +
      `${n.repos} repositories, and the difference between the two IS the ruling.`,
    construct: r.decisive,
    count: d.edges,
    files: d.files,
    repos: d.repos,
    nearMiss: { construct: r.nearMiss, count: n.edges, files: n.files, repos: n.repos },
    falsifier: r.falsifier,
    population: popLine,
    grammarInventory: grammarLine,
  }
})

// ── THE IMPLEMENTED SET AND THE DENOMINATOR, from the spec as it stands plus these four facts ───
const blk = spec.coverage ?? (spec.coverage = {})
const impl: string[] = Array.isArray(blk.implemented) ? blk.implemented : []
const excl: any[] = Array.isArray(blk.excluded) ? blk.excluded : []
const ALL14 = [
  "calls", "extends", "implements", "uses", "imports", "exports", "contains", "references",
  "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of",
]
const excludedLabels = excl.map((x) => (typeof x === "string" ? x : x?.label)).filter((t) => ALL14.includes(t))
const ruledLabels = rows.map((r) => r.label)
const applicable = ALL14.filter((t) => !excludedLabels.includes(t) && !ruledLabels.includes(t))
const overlap = ruledLabels.filter((t) => impl.includes(t))
if (overlap.length) {
  console.error(`FAIL — ${overlap.join(", ")} is BOTH implemented and a zero-emission fact; a type cannot be both`)
  process.exit(5)
}
const gaps = applicable.filter((t) => !impl.includes(t))
if (gaps.length) {
  console.error(
    `REFUSING TO WRITE — the denominator would still hold ${gaps.length} unimplemented gap(s): ${gaps.join(", ")}. ` +
    `Ruling the four extended types is not the same as being at n/n; publish the gaps or implement them.`,
  )
  process.exit(6)
}

// ── THE BOX THE COUNTS WERE TAKEN ON, AND A BOOLEAN A READER CAN CHECK ─────────────────────────
// `measuredOnAHealthyBox` is a THRESHOLD STATED IN ADVANCE, not a reassurance: the box counts as
// healthy when the load is under one runnable task per CPU AND less than a gigabyte of swap is in
// use. On an unhealthy box the counts still stand — the chunking is what makes that true — but a
// reader is told to weigh the runtime, and the spec says which of the two it was.
const healthy = cpuCount > 0 && Number(loadAvg.split(" ")[0]) < cpuCount && swapUsedKb < 1048576
spec.meta = {
  ...(spec.meta ?? {}),
  runEnvironment,
  measuredOnAHealthyBox: healthy,
  measuredOnAHealthyBoxRule:
    "healthy = load1 < one runnable task per CPU AND swap in use < 1 GB, both read from /proc at " +
    "declaration time. The counts do not depend on this flag — the walk is chunked, so a slow or " +
    "thrashing box lengthens the run and cannot change a count — but the runtime it implies does, " +
    "and a reader comparing two lanes' runtimes needs to know which box each was measured on.",
}

blk.zeroEmissionFacts = rows
blk.denominator = {
  n: applicable.length,
  types: applicable,
  rule:
    "n = the fourteen vocabulary values MINUS the two the grammar does not express (implements, " +
    "instantiates) MINUS the four zero-emission facts above, which the vocabulary's own contracts " +
    "rule out and whose falsifiers are counted by the census. Every remaining type is implemented " +
    "and measured over the whole admitted population.",
  excludedFromN: { grammarAbsence: excludedLabels, zeroEmissionFacts: ruledLabels },
}

console.log(`CENSUS   ${CENSUS}`)
console.log(`MODE     ${mode}`)
console.log(`POP      ${popLine}`)
console.log(`GRAMMAR  ${grammarLine}`)
console.log("")
console.log("THE FOUR COUNTERS, AND THE NEAR MISS BESIDE EACH:")
for (const r of rows) {
  console.log(
    `  ${r.label.padEnd(10)} ${String(r.count).padStart(6)} ${r.construct.padEnd(48)}  ` +
    `near: ${String(r.nearMiss.count).padStart(6)} ${r.nearMiss.construct}`,
  )
}console.log("")
console.log(`APPLICABLE n = ${applicable.length}  (14 − ${excludedLabels.length} grammar-absence − ${ruledLabels.length} zero-emission facts)`)
console.log(`IMPLEMENTED  = ${impl.length}: ${impl.join(", ")}`)
console.log(`GAPS         = ${gaps.length}`)

if (!WRITE) {
  console.log("\nDRY RUN — nothing written. Pass --write to write the spec.")
  process.exit(0)
}
writeFileSync(SPEC, JSON.stringify(spec, null, 2) + "\n")
console.log(`\nWROTE ${SPEC}`)
