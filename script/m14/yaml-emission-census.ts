/**
 * script/m14/yaml-emission-census.ts — WHAT the YAML analyzer emits, and WHAT the pinned grammar
 * can express, counted over the WHOLE admitted population.
 *
 * WHY THIS FILE IS LANE-OWNED (and not the shared `.tmp-census/census.mts`). The shared census
 * instrument enumerates a fixed six-language list and its `newAnalyzer()` THROWS for anything
 * else, so it cannot run yaml at all; and it writes one fleet-wide `.tmp-census/grammar-nodes.json`
 * for all six, so running it here would overwrite the fleet's grammar artifact with a one-language
 * file. The grammar inventory therefore lives in this lane's own
 * `script/m14/yaml-grammar-binding-probe.ts` and writes only into `validation/m14/measurements/`.
 *
 * WHAT IT COUNTS, per admitted `.yaml`/`.yml` file, through the PRODUCTION path
 * (`ASTEngine.getParser` -> `parser.parse` -> `RealYamlAnalyzer.analyze` — the same sequence
 * `engine.ts` runs, with the SAME context the incoming gate passes):
 *
 *   per relationship type   edges, and the number of FILES that emitted at least one, and REPOS
 *   per emission marker     `metadata.relationshipType` — marker x type — so a per-type number can
 *                           be attributed to the SITE that produced it and not to a neighbour
 *   THE FOUR EXTENDED VALUES `decorates` . `renders` . `mixes_in` . `part_of` — rows/files/repos,
 *                           so a cell is never a blank
 *   THE CONSTRUCT COUNTS   the counts every ruling rests on, MEASURED and not prose:
 *                             - MERGE KEYS (`<<`) — the `extends` construct, and the nearest
 *                               neighbour of `mixes_in`
 *                             - ALIAS and ANCHOR nodes — the `uses`/`references` constructs
 *                             - TAG nodes, split by handle form — the `decorates` near-miss and
 *                               the `implements` near-miss (a tag names a TYPE)
 *                             - THE OPEN INCLUDE SWEEP — every tag whose name is in the include
 *                               family, counted from the TREE, so a tag the analyzer's CLOSED set
 *                               misses is still visible (this is the R3 test for `imports`)
 *                             - INCLUDE/IMPORT KEYS — the other `imports` construct
 *                             - JOB-LEVEL `uses:` — the `calls` construct
 *                             - SCHEMA PUBLICATION containers — the `exports` construct
 *                             - DUPLICATE MAPPING KEYS — the `overrides` construct
 *                             - `$ref` POINTERS — the `references` construct
 *                             - MULTI-DOCUMENT STREAMS and the include family — the `part_of`
 *                               near-miss (a file-level relation)
 *                             - TEMPLATE INTERPOLATION in a scalar — the `renders` near-miss
 *
 * THE POPULATION IS DERIVED, NEVER LISTED — copied rule-for-rule from
 * `script/m14/incoming-gate.ts:discoverFiles`: every entry of BB_CORPUS_ROOT is considered,
 * symlinks are FOLLOWED (statSync), only real git checkouts are corpus (`git rev-parse --git-dir`),
 * the file set is `git ls-files -z` (TRACKED files only), extension admission is the lane's own
 * spelling set (`yaml,yml`), and the size cap is the engine's own FULL_AST_LIMIT (1 MB).
 *
 * THREE DENOMINATORS, NEVER MIXED: PATHS (tracked admitted paths) · DISTINCT FILES (the realpaths
 * behind those paths) · ADMITTED (the files this run PARSED — the denominator every count is over).
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   npx tsx script/m14/yaml-emission-census.ts --cap=0 --json   # whole admitted population
 *   npx tsx script/m14/yaml-emission-census.ts --cap=200        # triage stride
 *
 * EXIT 0 measured · 2 no corpus / no admitted files · 3 the population closed on nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, realpathSync, readdirSync, statSync, lstatSync, readlinkSync } from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { createHash } from "node:crypto"

import { ASTEngine } from "../../src/ast/engine"
import { RealYamlAnalyzer } from "../../src/ast/real-yaml-analyzer"
import { decodeSourceText } from "../../src/util/source-text"
import { hasWasmInRegistry } from "../../src/util/wasm"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024 // the engine's own FULL_AST_LIMIT (pool-worker.ts:1143)
const EXTS = ["yaml", "yml"] // the lane's own spelling set (incoming-gate.ts:243 `yaml: "yaml,yml"`)

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i >= 0) return argv[i + 1]
  for (const a of argv) if (a.startsWith(f + "=")) return a.slice(f.length + 1)
  return undefined
}
const CAP = Number(argOf("--cap") ?? 0)
const JSON_OUT = argv.includes("--json")
const OUT = argOf("--out") ?? path.join(ROOT, "validation", "m14", "measurements", "yaml-emission-census-whole.json")

/**
 * THE CHUNKED WALK — `--chunk-idx=N --chunk-size=K`.
 *
 * TWO REASONS, AND BOTH ARE MEASURED RATHER THAN ANTICIPATED:
 *
 *  1. THE SMALL ARM SLOT. It refuses a declared population above 2,000 files, and it refuses 0
 *     (which means "the whole population" — a heavy arm in disguise). The yaml population is
 *     ~19,000 files, so the whole population CANNOT be declared to the small slot — but it CAN be
 *     WALKED in disjoint chunks of 2,000, each chunk taking the slot with its own declared
 *     population, and the chunks' tallies merged. The dart lane worked this out for itself: the
 *     chunked walk is both the memory-safe path and the QUEUE-FAIR path.
 *  2. THE WASM MODULE'S MEMORY GROWS WITH EVERY PARSE AND NEVER SHRINKS. The dart lane measured
 *     that at roughly 7,600 parses the module runs out and every later `new Parser` ABORTS — and
 *     a single-process walk that LOOKS complete measures a fraction of the population while
 *     printing a whole-population header. A chunk per process cannot hit that wall, because the
 *     module is fresh in each one.
 *
 * THE CHUNKS ARE DISJOINT AND THE ORDER IS FIXED: the admitted file list is sorted ONCE by
 * `discover()` and chunk N takes the slice `[N*K, (N+1)*K)`. So every file is walked by exactly one
 * chunk, a per-key FILE count is the SUM of the chunks' counts (no set to intersect), and the
 * chunks' union is the whole population.
 *
 * WHAT CANNOT BE SUMMED IS A DISTINCT REPO COUNT: a repository spans chunks, so the repo SET is
 * carried per key (`repoSets`) and the merge UNIONS it. The file counts sum exactly; the repo
 * counts are a union; the merge script asserts which is which.
 */
/**
 * `--discover-only` — the ENUMERATION WITHOUT THE PARSE.
 *
 * The chunked runner must DECLARE each chunk's population to the small arm slot BEFORE it takes
 * the slot, and the declaration must be the chunk's ACTUAL file count ("the arm PRINTS ITS OWN
 * POPULATION, so a false declaration is caught by reading the arm's header against the number the
 * slot was given"). The chunk's slice is `[idx*size, (idx+1)*size)` of the sorted admitted list,
 * so its size is `min(size, admittedTotal - idx*size)` — and the admitted total is what this mode
 * reports, at the cost of the enumeration alone.
 */
const DISCOVER_ONLY = argv.includes("--discover-only")

/**
 * `--analyzer=<path>` — WHICH ANALYZER THIS RUN MEASURES.
 *
 * The BEFORE measurement is the analyzer at git HEAD and the AFTER measurement is the analyzer
 * with the R3 work. Reverting the working tree to measure the BEFORE would put the repository in
 * a state where the lane's work is MISSING for the length of the walk — and another agent
 * committing in that window would commit the lane's work as gone. So the BEFORE run measures a
 * COPY of the git-HEAD analyzer (`git show HEAD:src/ast/real-yaml-analyzer.ts`, with its one
 * relative import rewritten for its new home), and the working tree is never touched.
 */
const ANALYZER_PATH = argOf("--analyzer")

const CHUNK_IDX = argOf("--chunk-idx") !== undefined ? Number(argOf("--chunk-idx")) : null
const CHUNK_SIZE = argOf("--chunk-size") !== undefined ? Number(argOf("--chunk-size")) : 2000

/**
 * PARSE-ONLY: THE FOUR EXTENDED TYPES' DECISIVE COUNTERS DO NOT NEED THE ANALYZER.
 *
 * The construct census reads the TREE — a tag's text, a merge key's value shape, an
 * include-family tag's POSITION, a template interpolation inside a scalar. None of that is the
 * analyzer's product; the analyzer is only needed for the per-TYPE emission counts. So a ruling's
 * whole-population count can be taken at parse cost instead of at analyze cost, which is roughly
 * an order of magnitude cheaper and is the only reason a lane short of the arm can afford it.
 *
 * THE COUNTERS ARE IDENTICAL IN BOTH MODES: same walk, same tree, same `add()` calls. The flag
 * removes ONLY the analyzer and the per-type tallies, so a parse-only count and a full count of
 * the same construct are the same measurement, and a parse-only run is a SUBSET of a full run's
 * work by construction — not a different instrument with a different rule.
 */
const PARSE_ONLY = process.argv.slice(2).includes("--parse-only")

/** THE FOURTEEN emitted relationship values (types.ts, 2026-10-18) — a label this census omits is a silence. */
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
] as const

/** The analyzer's CLOSED include-family tag set, quoted so the census can show the OPEN sweep beside it. */
const ANALYZER_INCLUDE_TAGS = new Set([
  "include", "inc",
  "include_tasks", "include_role", "include_vars", "include_file",
  "import", "import_tasks", "import_playbook", "import_role", "import_file",
])
/** The analyzer's CLOSED include-family KEY set (real-yaml-analyzer.ts `FILE_IMPORT_KEYS` + `ROLE_IMPORT_KEYS`). */
const ANALYZER_INCLUDE_KEYS = new Set([
  "include_tasks", "import_tasks", "import_playbook", "import_role", "include_role",
  "import_values", "import", "include",
])
/** The include FAMILY, open — the sweep the census runs to find a tag or key the closed set misses. */
const INCLUDE_FAMILY = /^(inc|include|included|import|imports?)([_-].*)?$/i

/**
 * THE SUPERTYPE-CANDIDATE KEY VOCABULARY.
 *
 * A CLOSED SET, and the set is the QUESTION, not the answer: these are the keys that could, in
 * some language, name a supertype, a base class, a conformance clause or a mixin. The JSON lane
 * ruled `implements` out on this vocabulary's counterpart — of the 28 supertype-candidate keys it
 * lists, only `extends`, `inherits` and `base` occur at all in JSON, and each names a config or
 * manifest field rather than a supertype clause. THE SAME LIST IS ASKED HERE, IN YAML, AND IT IS
 * COUNTED FROM THE TREE over the whole admitted population with the per-key breakdown published,
 * so a reader sees WHICH keys occur and how often.
 *
 * The set is a superset of the JSON lane's 28 (it adds the `inherit`/`conform`/`subclass` spellings
 * and the `super_type` underscore form), because a wider list can only FIND more sites, and a
 * ruling that survives the wider list is stronger than one that survives a narrow one.
 */
const SUPERTYPE_CANDIDATE_KEYS = new Set([
  "implements", "implements_interface", "implement", "inherits", "inherit", "inherited",
  "superclass", "super_class", "supertype", "super_type", "base", "bases", "prototype",
  "satisfies", "conformsTo", "conforms_to", "conformsto", "extends", "extend", "extended",
  "derived_from", "derives_from", "subclass_of", "subclass", "mixin", "mixins", "is_a", "isa",
])

/** admitByExtension, copied from `script/m14/incoming-gate.ts:447` for the lane's own spelling set. */
function admitByExtension(rel: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (EXTS.some((e) => low.endsWith(`.${e}`))) return true
  return EXTS.some((e) => base === e)
}

/**
 * THE ON-DISK WALK — the PATHS and DISTINCT-FILES denominators, measured independently of git.
 * The corpus on disk also holds files in directories that are not git checkouts, and the same file
 * can be reachable under two paths through a symlinked directory. Mixing those numbers is the
 * denominator defect the fleet rule names (PATHS / DISTINCT FILES / ADMITTED, never mixed), so this
 * walk counts them SEPARATELY, and REPORTS THE NUMBER OF SYMLINKED DIRECTORIES IT FOLLOWED — the
 * corpus rule requires the count to be printed, never left implicit.
 */
function walkOnDisk(): { paths: number; distinct: number; repos: number; symlinkedDirs: number; symlinkedRepoDirs: number } {
  let paths = 0
  let repos = 0
  let symlinkedDirs = 0
  let symlinkedRepoDirs = 0
  const distinct = new Set<string>()
  const stack: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { paths: 0, distinct: 0, repos: 0, symlinkedDirs: 0, symlinkedRepoDirs: 0 }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    let st: any
    try { st = statSync(dir) } catch { continue }
    if (!st.isDirectory()) continue
    repos++
    // A REPO ENTRY THAT IS ITSELF A SYMLINK is counted separately: the corpus root holds absolute
    // symlinks into the repository store, and following one is the rule, not an accident.
    try {
      const lst = readdirSync(dir, { withFileTypes: true })
      void lst
    } catch { /* counted below by the walk */ }
    stack.push(dir)
  }
  while (stack.length > 0) {
    const d = stack.pop()!
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      const abs = path.join(d, e.name)
      let isDir = e.isDirectory()
      let isFile = e.isFile()
      if (e.isSymbolicLink()) {
        try {
          const st = statSync(abs)
          if (st.isDirectory()) { isDir = true; isFile = false; symlinkedDirs++ }
          else if (st.isFile()) { isDir = false; isFile = true }
        } catch { continue }
      }
      if (isDir) { stack.push(abs); continue }
      if (!isFile) continue
      const low = e.name.toLowerCase()
      if (!EXTS.some((x) => low.endsWith(`.${x}`))) continue
      paths++
      try { distinct.add(realpathSync(abs)) } catch { distinct.add(abs) }
    }
  }
  return { paths, distinct: distinct.size, repos, symlinkedDirs, symlinkedRepoDirs }
}

/**
 * The POPULATION, copied rule-for-rule from `script/m14/incoming-gate.ts:discoverFiles` — the same
 * corpus walk, the same size cap, the same counters.
 */
function discover(cap: number): {
  files: string[]; total: number; repos: Set<string>; absent: number; overCap: number; overCapLargest: number
  paths: number; distinctFiles: number; repoPaths: Record<string, number>; repoDistinct: Record<string, number>
  symlinkedRepoDirs: number
} {
  const found: string[] = []
  const repos = new Set<string>()
  const repoPaths: Record<string, number> = {}
  const repoDistinct: Record<string, number> = {}
  const distinct = new Set<string>()
  let absent = 0
  let overCap = 0
  let overCapLargest = 0
  let paths = 0
  let symlinkedRepoDirs = 0
  let entries: string[]
  try { entries = readdirSync(CR) } catch {
    return { files: [], total: 0, repos, absent: 0, overCap: 0, overCapLargest: 0, paths: 0, distinctFiles: 0, repoPaths, repoDistinct, symlinkedRepoDirs: 0 }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    let st: any
    try { st = statSync(dir) } catch { continue }
    if (!st.isDirectory()) continue
    // A REPO ENTRY THAT IS A SYMLINK IS A SYMLINKED DIRECTORY THE WALK FOLLOWED.
    try { if (readlinkSyncSafe(dir)) symlinkedRepoDirs++ } catch { /* not a symlink */ }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!admitByExtension(rel)) continue
      const abs = path.join(dir, rel)
      let fst
      try { fst = statSync(abs) } catch { absent++; continue }
      if (!fst.isFile()) continue
      if (fst.size > SIZE_CAP) { overCap++; overCapLargest = Math.max(overCapLargest, fst.size); continue }
      paths++
      let real = abs
      try { real = realpathSync(abs) } catch { /* the stat already proved it readable */ }
      if (!distinct.has(real)) {
        distinct.add(real)
        repoDistinct[name] = (repoDistinct[name] ?? 0) + 1
      }
      repoPaths[name] = (repoPaths[name] ?? 0) + 1
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  let files = found
  if (cap > 0 && total > cap) {
    const stride = Math.max(1, Math.floor(total / cap))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < cap; i += stride) picked.push(found[i])
    files = picked
  }
  return {
    files, total, repos, absent, overCap, overCapLargest,
    paths, distinctFiles: distinct.size, repoPaths, repoDistinct, symlinkedRepoDirs,
  }
}

/** `readlinkSync` without throwing on a non-symlink. */
function readlinkSyncSafe(p: string): string | null {
  try {
    if (!lstatSync(p).isSymbolicLink()) return null
    return readlinkSync(p)
  } catch { return null }
}

type Tally = { edges: number; files: Set<string>; repos: Set<string> }
const mk = (): Tally => ({ edges: 0, files: new Set<string>(), repos: new Set<string>() })
const repoOf = (rel: string) => rel.split(path.sep)[0]
const add = (m: Map<string, Tally>, key: string, rel: string) => {
  let t = m.get(key)
  if (!t) { t = mk(); m.set(key, t) }
  t.edges++
  t.files.add(rel)
  t.repos.add(repoOf(rel))
  if (m === constructs || m === includeTagSpellings || m === includeKeySpellings) sample(key, rel)
}

/**
 * SAMPLE PATHS, so every citation in the spec can name a FILE the reader can open. Five per
 * construct is enough to show the shape and not enough to make the artifact unreadable. The
 * samples are the first five DISTINCT files in corpus order, so the same corpus gives the same
 * samples on a re-run.
 */
const SAMPLES_PER_KEY = 5
const samples = new Map<string, string[]>()
const sample = (key: string, rel: string) => {
  let arr = samples.get(key)
  if (!arr) { arr = []; samples.set(key, arr) }
  if (arr.length < SAMPLES_PER_KEY && !arr.includes(rel)) arr.push(rel)
}

/**
 * ★ THE COUNTER INVENTORY, DECLARED SO THAT A ZERO IS A MEASUREMENT AND NOT AN ABSENCE.
 *
 * THE DEFECT THIS FIXES, FOUND IN THIS LANE'S OWN ARTIFACT: the construct map was built by `add()`,
 * which creates a key only when it sees a site — so a counter with ZERO sites left NO KEY AT ALL,
 * and a reader could not tell "this counter ran and found nothing" from "this counter never ran".
 * The merged whole-population artifact had 42 keys and the four EXTENDED TYPES' decisive counters
 * were simply MISSING from it, exactly where a ruling needs a number. That is the fleet's own
 * hazard — "a census that cannot distinguish counted from counted-by-a-convention will report a
 * shortlist as a census" — appearing in the one artifact a zero-emission ruling cites.
 *
 * SO THE CENSUS NOW DECLARES EVERY COUNTER IT MAINTAINS, EMITS A ZERO ROW FOR EVERY ONE OF THEM,
 * AND SELF-CHECKS THAT NO COUNTER IT OBSERVED IS ABSENT FROM THE DECLARATION (a counter added and
 * not declared fails the run loudly rather than vanishing into the artifact).
 */
const DECLARED_COUNTERS: readonly string[] = [
  "yaml.alias_NOT_a_merge",
  "yaml.alias_node",
  "yaml.allOf_key",
  "yaml.allOf_with_a_ref",
  "yaml.allOf_without_a_ref",
  "yaml.alternative_of_key",
  "yaml.anchor_node",
  "yaml.anyOf_key",
  "yaml.directive",
  "yaml.duplicate_mapping_key",
  "yaml.extends_key",
  "yaml.extends_key_SHAPE_azure_template",
  "yaml.extends_key_SHAPE_config_preset",
  "yaml.extends_key_SHAPE_docker_compose_service",
  "yaml.extends_key_SHAPE_other_mapping",
  "yaml.extends_key_SHAPE_other_scalar",
  "yaml.extends_key_SHAPE_sibling_dot_name",
  "yaml.implements_key",
  "yaml.include_family_key",
  "yaml.include_family_key_OUTSIDE_the_analyzer_closed_set",
  "yaml.include_family_tag",
  "yaml.include_family_tag_OUTSIDE_the_analyzer_closed_set",
  "yaml.include_family_tag_at_a_key_position",
  "yaml.include_family_tag_at_the_document_root",
  "yaml.instantiates_key",
  "yaml.job_level_uses",
  "yaml.json_pointer_ref_key",
  "yaml.merge_alias_under-a-BLOCK-sequence",
  "yaml.merge_alias_under-a-FLOW-sequence",
  "yaml.merge_key",
  "yaml.merge_key_with_mapping_target",
  "yaml.merge_key_with_sequence_target",
  "yaml.merge_list",
  "yaml.merge_list_with_a_separate_base_clause",
  "yaml.merge_sequence_with_aliases",
  "yaml.merge_sequence_with_more_than_one_alias",
  "yaml.multi_document_stream",
  "yaml.non_job_level_uses",
  "yaml.oneOf_key",
  "yaml.schema_publication_definition",
  "yaml.supertype_candidate_key",
  "yaml.tag_core_schema",
  "yaml.tag_local",
  "yaml.tag_naming_a_declaration_in_the_document",
  "yaml.tag_node",
  "yaml.tag_verbatim",
  "yaml.tag_with_a_call_shaped_argument",
  "yaml.tag_with_a_constructor_argument",
  "yaml.template_component_named_in_a_scalar",
  "yaml.template_component_named_in_the_file_text",
  "yaml.template_interpolation_in_scalar",
  "yaml.uses_key",
] as const

const perType = new Map<string, Tally>()
const perMarker = new Map<string, Tally>()
const perMarkerType = new Map<string, Tally>()
const constructs = new Map<string, Tally>()
/** The include-family tag spellings the census saw, and whether the analyzer's CLOSED set knows them. */
const includeTagSpellings = new Map<string, Tally>()
/** The include-family KEY spellings the census saw. */
const includeKeySpellings = new Map<string, Tally>()
/** The per-key breakdown of the SUPERTYPE-CANDIDATE vocabulary, counted from the tree. */
const supertypeKeySpellings = new Map<string, Tally>()
/** The shape of a file that carries template interpolation — the `renders` near-miss, by PATH. */
const templateFileShapes = new Map<string, Tally>()
/** The component names a template expression names — the `renders` near-miss, by spelling. */
const templateComponentNames = new Map<string, Tally>()
for (const t of ALL_TYPES) perType.set(t, mk())

const AnalyzerClass: any = ANALYZER_PATH
  ? (await import(pathToFileURL(path.resolve(ROOT, ANALYZER_PATH)).href)).RealYamlAnalyzer
  : RealYamlAnalyzer
if (!AnalyzerClass || typeof AnalyzerClass !== "function") {
  console.error(`FAIL — no analyzer class at ${ANALYZER_PATH ?? "src/ast/real-yaml-analyzer.ts"}`)
  process.exit(4)
}

const { files: discoveredFiles, total, repos, absent, overCap, overCapLargest, paths, distinctFiles, repoPaths, repoDistinct, symlinkedRepoDirs } = discover(CAP)
// THE CHUNK SLICE, taken from the SORTED admitted list, so the chunks are DISJOINT and their
// union is the whole population. The slice is taken AFTER the stride, never before: a stride
// applied per chunk would make the chunks overlap in the population they claim to cover.
const files = CHUNK_IDX === null
  ? discoveredFiles
  : discoveredFiles.slice(CHUNK_IDX * CHUNK_SIZE, (CHUNK_IDX + 1) * CHUNK_SIZE)

/**
 * THE BUILD TEST. A ruling that rests on the grammar is only as good as the GRAMMAR THE CENSUS
 * LOADED, so the census states the build it loaded — the sha256 of the bytes the REGISTRY serves
 * (never a path, never a log line), beside the grammar's own node-type count — and a POSITIVE
 * CONTROL (node types that MUST be there, so the census is provably about the YAML grammar) and a
 * NEGATIVE CONTROL (node types that must NOT be there, so the absence the rulings rest on is an
 * absence in THIS grammar and not in some other one).
 */
const build = await (async () => {
  const registryBytes = hasWasmInRegistry("tree-sitter-yaml/tree-sitter-yaml.wasm")
  const wasmSha = registryBytes ? createHash("sha256").update(registryBytes).digest("hex") : "(no registry bytes)"
  const parser: any = await ASTEngine.getParser("yaml" as any)
  const lang: any = parser?.language
  const named: string[] = []
  const idCount = Number(lang?.nodeTypeCount ?? 0)
  for (let id = 0; id < idCount; id++) {
    // THE ACCESSOR IS `nodeTypeIsNamed(id)`, NOT `.named` ON THE STRING `nodeTypeForId(id)` RETURNS.
    try { if (lang.nodeTypeIsNamed(id)) named.push(String(lang.nodeTypeForId(id))) } catch { /* not a named type */ }
  }
  const has = (t: string) => named.includes(t)
  const presentMustBe = ["block_mapping", "block_mapping_pair", "block_sequence", "block_sequence_item", "alias", "alias_name", "anchor", "anchor_name", "tag", "flow_mapping", "flow_pair", "stream", "document"]
  const absentMustBe = [
    "call", "call_expression", "function_call", "method_call",
    "import", "import_statement", "include", "include_statement",
    "class_declaration", "interface_declaration", "mixin", "mixin_declaration",
    "part", "part_directive", "decorator", "decorated_definition", "extends", "implements",
    "template", "render", "override", "new_expression",
  ]
  return {
    citationRule: "the sha256 of the BYTES THE REGISTRY SERVES — never a path, never a log line (L-20)",
    wasmSha256: wasmSha,
    nodeTypeIds: idCount,
    // TWO counts, because they are two different facts: `namedNodeTypeIds` is how many IDS the
    // grammar marks named (an alias and its canonical share one id space), and
    // `namedNodeTypesUnique` is how many DISTINCT NAMES those ids carry. The NAMED/ANONYMOUS TRAP
    // lives here: `nodeTypeForId` returns a NAME as a string and a string has no `.named`, so
    // reading `t.named` counts EVERY type as anonymous. The accessor is `nodeTypeIsNamed(id)`, and
    // the tell is a TOTAL that agrees with a prior measurement while the named-count is 0.
    namedNodeTypeIds: named.length,
    namedNodeTypesUnique: new Set(named).size,
    namedNodeTypeNames: [...new Set(named)].sort(),
    positiveControl: { mustBe: presentMustBe, checked: presentMustBe.map((t) => ({ type: t, present: has(t) })) },
    negativeControl: { mustNotBe: absentMustBe, checked: absentMustBe.map((t) => ({ type: t, present: has(t) })) },
  }
})()

const onDisk = walkOnDisk()

if (DISCOVER_ONLY) {
  const out = {
    instrument: "script/m14/yaml-emission-census.ts",
    lane: "yaml",
    at: new Date().toISOString(),
    mode: "discover-only",
    population: {
      corpusRoot: CR, reposOnDisk: onDisk.repos,
      symlinkedRepoDirsFollowed: symlinkedRepoDirs, symlinkedDirsFollowedOnDiskWalk: onDisk.symlinkedDirs,
      paths, distinctFiles, admittedTotal: total, absent, overCap, overCapLargest,
      reposCarryingAnAdmittedFile: repos.size, reposWithAdmittedPaths: Object.keys(repoPaths).length,
      perRepoPaths: repoPaths, perRepoDistinctFiles: repoDistinct,
    },
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
  console.log(`DISCOVER-ONLY — admitted ${total} files over ${paths} paths (${distinctFiles} distinct) in ${repos.size} repositories`)
  process.exit(0)
}

if (files.length === 0) {
  console.error(`yaml-emission-census: 0 admitted YAML files under ${CR}. Set BB_CORPUS_ROOT to the corpus.`)
  process.exit(2)
}

/** The repo root of a corpus file, exactly as the incoming gate computes it. */
const repoRootOf = (abs: string): string => {
  const rel = abs.startsWith(CR) ? abs.slice(CR.length + 1) : abs
  return path.join(CR, rel.split(path.sep)[0])
}

/**
 * THE PATH SHAPE of a file, for the `renders` near-miss. A template interpolation inside a YAML
 * scalar is not a YAML construct — the interpolation belongs to whichever template engine wrote
 * it, and the PATH is what says which one. The shapes are deliberately coarse: the question is
 * "is this another language's template?", and a directory named `templates/` or a file named
 * `Chart.yaml` answers it.
 */
function shapeOfFile(rel: string): string {
  const segs = rel.split("/")
  const base = segs[segs.length - 1] ?? ""
  const lower = base.toLowerCase()
  if (lower === "chart.yaml" || lower === "chart.yml") return "helm/chart"
  if (segs.some((s) => s === "templates")) return "under-templates/"
  if (lower.endsWith(".j2") || lower.endsWith(".jinja") || lower.endsWith(".jinja2")) return "jinja-suffix"
  if (lower.endsWith(".tpl") || lower.endsWith(".gotmpl")) return "gotemplate-suffix"
  if (lower.endsWith(".tmpl")) return "tmpl-suffix"
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "plain-yaml"
  return "other"
}

const parseErrors: string[] = []
let parsed = 0
let failed = 0
let degraded = 0
let constructWalked = 0
const fileMs: number[] = []
const t0All = performance.now()

function walkNamed(root: any, visit: (n: any, parent: any) => void): void {
  const stack: Array<{ n: any; p: any }> = [{ n: root, p: null }]
  while (stack.length > 0) {
    const { n, p } = stack.pop()!
    visit(n, p)
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, p: n })
    }
  }
}

/** The text of a node's KEY field, or "" — read through the grammar's own `key` field. */
function keyTextOf(pair: any): string {
  const k = pair?.childForFieldName?.("key")
  return k ? String(k.text ?? "") : ""
}

/** The node a pair's VALUE field names, or null. */
function valueNodeOf(pair: any): any {
  return pair?.childForFieldName?.("value") ?? null
}

/**
 * THE VALUE, UNWRAPPED. The grammar does not put the value itself in the `value` FIELD — it puts
 * a WRAPPER there: a `flow_node` (for a value on the same line) or a `block_node` (for a value on
 * the following lines), and the real content (a `block_mapping`, a `flow_sequence`, an `alias`, a
 * `plain_scalar`) is INSIDE that wrapper. MEASURED on the tree, not assumed: a merge key
 * `<<: *k6_custom` parses as
 *
 *     block_mapping_pair
 *       ├─ flow_node  "<<"          <- the KEY field
 *       ├─ ":"                       (anon)
 *       └─ flow_node  "*k6_custom"  <- the VALUE field
 *            └─ alias
 *
 * so an unwrapped value is what a construct census has to read, and a census that reads the
 * wrapper sees neither the mapping nor the alias.
 */
function unwrapValue(v: any): any {
  let cur = v
  for (let i = 0; i < 4 && cur; i++) {
    if (cur.type !== "flow_node" && cur.type !== "block_node") break
    const inner = cur.namedChildren.find((c: any) => c.type !== "comment")
    if (!inner) break
    cur = inner
  }
  return cur
}

/**
 * THE KEY PATH of a node, RELATIVE TO ITS DOCUMENT — the tree-side equivalent of the analyzer's
 * `current.parentPath`, which is a SEMANTIC path (`<document>.jobs.<jobId>`) that the analyzer
 * builds while it walks. A tree walk can rebuild the same thing by climbing to the nearest
 * `document` ancestor and collecting the key of every `block_mapping_pair`/`flow_pair` on the way
 * down. The analyzer's two role rules are stated on THAT path, so the near-miss census must be
 * stated on the same path or it would count a different construct from the one the analyzer acts
 * on (`isJobLevelPath` — `src/ast/real-yaml-analyzer.ts:625` — and `schemaPublicationRole` — :613).
 */
function keyPathOf(node: any): string[] {
  const segs: string[] = []
  let cur = node
  while (cur) {
    const p = cur.parent
    if (!p) break
    if (p.type === "block_mapping_pair" || p.type === "flow_pair") {
      const k = keyTextOf(p)
      if (k) segs.unshift(k)
    }
    if (p.type === "document") break
    cur = p
  }
  return segs
}

/** The SUFFIX of a tag's text — the constructor argument — or null when it has none. */
function tagSuffixOf(raw: string): string | null {
  const t = String(raw ?? "")
  if (!t) return null
  // A VERBATIM tag (`!<...>`) carries its whole text as the tag URI.
  if (t.startsWith("!<")) return t.slice(2, t.endsWith(">") ? -1 : undefined)
  // The suffix is what follows the LAST `!`: `!!str` → "str", `!e!thing` → "thing",
  // `!include` → "include". A handle with no suffix (`!e!`) has none.
  const at = t.lastIndexOf("!")
  if (at < 0) return null
  const suffix = t.slice(at + 1)
  return suffix.length ? suffix : null
}

/** The `alias` node inside a sequence item, if there is one. */
function findAliasIn(node: any): any {
  if (!node) return null
  if (node.type === "alias") return node
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c?.type === "alias") return c
  }
  return null
}

/** The text of a `tag` node, minus the leading `!`. */
function tagNameOf(tag: any): string {
  const t = String(tag?.text ?? "")
  return t.replace(/^!/, "").replace(/^<.*>$/, "")
}

for (const abs of files) {
  const rel = path.relative(CR, abs)
  const relSlug = rel.split(path.sep).join("/")
  const repo = repoOf(relSlug)
  let result: any
  let tree: any = null
  const t0 = performance.now()
  try {
    // THE PRODUCTION PATH, SPELLED OUT: the same `getParser -> parse -> analyze` sequence
    // `ASTEngine.parseFile` runs, with the SAME context the incoming gate passes
    // (`{ projectRoot }` — yaml has no INDEX_SPECS entry, so the gate passes no projectIndex).
    const content = decodeSourceText(readFileSync(abs)).text
    const parser: any = await ASTEngine.getParser("yaml" as any)
    tree = parser.parse(content, abs)
    if (!tree?.rootNode) { failed++; continue }
    if (!PARSE_ONLY) {
      const analyzer = new AnalyzerClass()
      result = analyzer.analyze(tree.rootNode, content, abs, { projectRoot: repoRootOf(abs) } as any)
    }
  } catch (e: any) {
    failed++
    if (parseErrors.length < 25) parseErrors.push(`${rel}: ${String(e?.message ?? e).slice(0, 160)}`)
    continue
  }
  fileMs.push(performance.now() - t0)
  parsed++
  if (result?.fallback === true) degraded++

  if (!PARSE_ONLY) {
    for (const r of (result?.relationships ?? []) as any[]) {
      const type = String(r?.type ?? "")
      add(perType, type, relSlug)
      const md = (r?.metadata ?? {}) as Record<string, unknown>
      const marker = typeof md.relationshipType === "string" ? md.relationshipType : ""
      if (marker) {
        add(perMarker, marker, relSlug)
        add(perMarkerType, `${type} | ${marker}`, relSlug)
      }
    }
  }

  // ── THE CONSTRUCT CENSUS, on the SAME tree the analyzer just read (one parse per file) ─────────
  //
  // THE PER-FILE STATE for the FOUR EXTENDED-TYPE DECISIVE COUNTS. Each of the four rulings rests
  // on ONE count, and each count is a count of a CONSTRUCT — not a sentence about a construct.
  // A ruling whose falsifier names something no instrument counts is a sentence (the scala lane
  // found exactly that in the fleet's own mixin ruling), so each of these is counted HERE.
  const fileKeys = new Set<string>()        // every key text in the file
  const fileTagNames: string[] = []         // the tag names, to be checked against the keys
  const includeTagPositions: string[] = []  // "key" | "root", for the `part_of` falsifier
  // THE `mixes_in` DECISIVE COUNT needs the SHAPE OF A MAPPING, not a single pair: the Dart
  // contract's own words are that a mixin is not `extends` because "the `with` list is not an
  // inheritance clause" — so the mixin shape is a LIST OF COMPONENTS ATTACHED SEPARATE FROM THE
  // BASE CLAUSE. In YAML the base clause is the merge key itself, so the shape is a mapping that
  // carries a merge LIST and names its base SEPARATELY. Per mapping: the two flags.
  const mappingShapes = new Map<any, { mergeList: boolean; separateBase: boolean }>()
  const shapeOf = (m: any) => {
    let s = mappingShapes.get(m)
    if (!s) { s = { mergeList: false, separateBase: false }; mappingShapes.set(m, s) }
    return s
  }
  let fileText = ""
  try {
    if (!tree?.rootNode) continue
    constructWalked++
    // The mapping key space of each container, so a DUPLICATE KEY is counted where it occurs.
    const keySeen = new Map<any, Set<string>>()
    walkNamed(tree.rootNode, (n: any, parent: any) => {
      switch (n.type) {
        case "block_mapping_pair":
        case "flow_pair": {
          const k = keyTextOf(n)
          if (k) fileKeys.add(k)
          // THE CONTAINER PATH — the path of the CONTAINING mapping, which is what the analyzer's
          // two role rules are stated on.
          const cpath = keyPathOf(parent)
          if (k === "<<") {
            // THE MERGE KEY — YAML's inheritance construct, and the nearest neighbour of `mixes_in`.
            add(constructs, "yaml.merge_key", relSlug)
            const v = unwrapValue(valueNodeOf(n))
            if (v && (v.type === "block_mapping" || v.type === "flow_mapping")) {
              // THE DISTINGUISHING FACT for `mixes_in`: a merge target is a MAPPING — a set of keys to
              // inherit — and not a composed-in unit with its own behaviour.
              add(constructs, "yaml.merge_key_with_mapping_target", relSlug)
            }
            if (v && (v.type === "block_sequence" || v.type === "flow_sequence")) {
              add(constructs, "yaml.merge_key_with_sequence_target", relSlug)
              // THE `mixes_in` DECISIVE COUNT. The vocabulary says a mixin is not `extends`
              // "because there is no single base" (src/ast/types.ts) — so the construct that would
              // make `mixes_in` live in YAML is a merge key with MORE THAN ONE alias: several bases
              // and no single one. This counts the elements, because the COUNT of the elements is
              // the difference between "one base" and "no single base", and a count is what a
              // falsifier needs.
              const aliases = v.namedChildren.filter((c: any) => {
                const inner = unwrapValue(c)
                return inner?.type === "alias" || inner?.type === "flow_node" || inner?.type === "block_node"
              })
              let aliasCount = 0
              for (const c of aliases) {
                const inner = unwrapValue(c)
                const al = inner?.type === "alias" ? inner : findAliasIn(inner)
                if (al) aliasCount++
              }
              if (aliasCount > 0) add(constructs, "yaml.merge_sequence_with_aliases", relSlug)
              if (aliasCount > 1) add(constructs, "yaml.merge_sequence_with_more_than_one_alias", relSlug)
              // THE `mixes_in` NEAR MISS: a merge LIST — common in YAML, because merging config
              // fragments is what YAML merging is FOR. A merge list is NOT a mixin: every member
              // of it is a base, and YAML's merge semantics order them by precedence.
              add(constructs, "yaml.merge_list", relSlug)
              shapeOf(parent).mergeList = true
            }
          }
          if (k === "$ref") add(constructs, "yaml.json_pointer_ref_key", relSlug)
          // THE `mixes_in` DECISIVE COUNT'S OTHER HALF: a clause that names a BASE separately
          // from a merge LIST. `extends:` is the configuration family's base clause and `allOf`
          // is the JSON Schema composition's, so a mapping that carries BOTH a merge list and
          // one of these has the Dart shape — a list of components attached beside a base.
          if (k === "extends" || k === "allOf") shapeOf(parent).separateBase = true
          if (k === "uses") {
            add(constructs, "yaml.uses_key", relSlug)
            // THE `calls` CONSTRUCT: a job-level `uses:` names a reusable workflow. The analyzer's own
            // rule (`isJobLevelPath`, real-yaml-analyzer.ts:625) is: the container path is EXACTLY
            // `<document>.jobs.<jobId>` and nothing deeper — a job id containing a dot is one job,
            // and a job id followed by `steps` is a STEP. The same rule is applied here, so the
            // near-miss census counts the same construct the analyzer acts on.
            const isJobLevel = cpath.length === 2 && cpath[0] === "jobs" && cpath[1].length > 0 && !cpath[1].includes(".")
            if (isJobLevel) add(constructs, "yaml.job_level_uses", relSlug)
            else add(constructs, "yaml.non_job_level_uses", relSlug)
          }
          if (k === "extends") {
            add(constructs, "yaml.extends_key", relSlug)
            // THE SHAPE OF THE `extends:` KEY, because the key name alone does not decide whether
            // it is an INHERITANCE between two YAML things or another tool's directive. The
            // measured dialects and their shapes:
            //   `extends: .hidden-job`      GitLab CI — a SIBLING KEY in the same file
            //   `extends: {service: X}`     Docker Compose — another SERVICE, optionally in another file
            //   `extends: {template: f.yml}` Azure Pipelines — a TEMPLATE FILE
            //   `extends: eslint:recommended` ESLint — a config PRESET of another tool
            // The first three are configuration inheritance and the fourth is not, so the shape
            // is what the ruling has to rest on.
            const v = unwrapValue(valueNodeOf(n))
            if (v && (v.type === "block_mapping" || v.type === "flow_mapping")) {
              const sub = new Set<string>()
              for (let i = 0; i < v.namedChildCount; i++) {
                const c = v.namedChild(i)
                if (c && (c.type === "block_mapping_pair" || c.type === "flow_pair")) sub.add(keyTextOf(c))
              }
              if (sub.has("service")) add(constructs, "yaml.extends_key_SHAPE_docker_compose_service", relSlug)
              else if (sub.has("template")) add(constructs, "yaml.extends_key_SHAPE_azure_template", relSlug)
              else add(constructs, "yaml.extends_key_SHAPE_other_mapping", relSlug)
            } else {
              const t = v ? (v.text ?? "").trim() : ""
              if (t.startsWith(".")) add(constructs, "yaml.extends_key_SHAPE_sibling_dot_name", relSlug)
              else if (t.includes(":")) add(constructs, "yaml.extends_key_SHAPE_config_preset", relSlug)
              else add(constructs, "yaml.extends_key_SHAPE_other_scalar", relSlug)
            }
          }
          if (k === "implements" || k === "implements_interface") add(constructs, "yaml.implements_key", relSlug)
          if (k === "instantiates" || k === "new") add(constructs, "yaml.instantiates_key", relSlug)
          // THE CONFORMANCE NEAR-MISS FOR `implements`: JSON Schema's `allOf`, which says "an
          // instance must validate against ALL of these subschemas". `oneOf`/`anyOf` are
          // ALTERNATIVES, not conformance, and are counted apart so the distinction is measured
          // rather than assumed.
          if (k === "allOf") {
            add(constructs, "yaml.allOf_key", relSlug)
            const v = unwrapValue(valueNodeOf(n))
            let refs = 0
            if (v) {
              const stack2: any[] = [v]
              while (stack2.length) {
                const cur2 = stack2.pop()
                if (!cur2) continue
                if (cur2.type === "block_mapping_pair" || cur2.type === "flow_pair") {
                  if (keyTextOf(cur2) === "$ref") refs++
                }
                for (let i = 0; i < cur2.namedChildCount; i++) {
                  const c = cur2.namedChild(i)
                  if (c) stack2.push(c)
                }
              }
            }
            if (refs > 0) add(constructs, "yaml.allOf_with_a_ref", relSlug)
            else add(constructs, "yaml.allOf_without_a_ref", relSlug)
          }
          if (k === "oneOf") add(constructs, "yaml.oneOf_key", relSlug)
          if (k === "anyOf") add(constructs, "yaml.anyOf_key", relSlug)
          if (k === "oneOf" || k === "anyOf") add(constructs, "yaml.alternative_of_key", relSlug)
          // THE SUPERTYPE-CANDIDATE KEY VOCABULARY — the OPEN list of keys that could, in some
          // language, name a supertype. The JSON lane's own ruling (`script/m14/spec/json-
          // completeness.json`) is the precedent: of the 28 supertype-candidate keys it lists,
          // only `extends`, `inherits` and `base` occur at all in JSON, and each names a config or
          // manifest field rather than a supertype clause. THE SAME QUESTION IS ASKED HERE, IN
          // YAML, AND IT IS COUNTED FROM THE TREE over the whole admitted population — with the
          // per-key breakdown, so the reader can see WHICH keys occur and how often instead of
          // being told that "the supertype keys are not supertype clauses".
          if (SUPERTYPE_CANDIDATE_KEYS.has(k)) {
            add(constructs, "yaml.supertype_candidate_key", relSlug)
            add(supertypeKeySpellings, k, relSlug)
          }
          if (INCLUDE_FAMILY.test(k)) {
            add(constructs, "yaml.include_family_key", relSlug)
            add(includeKeySpellings, k, relSlug)
            // THE OPEN SWEEP ON THE KEY SIDE — a key in the include family that the analyzer's
            // CLOSED set does not know. If this counter is non-zero, `imports` has a live R3 gap:
            // the construct exists in the corpus and the analyzer does not attempt it.
            if (!ANALYZER_INCLUDE_KEYS.has(k)) {
              add(constructs, "yaml.include_family_key_OUTSIDE_the_analyzer_closed_set", relSlug)
            }
          }
          // THE DUPLICATE-KEY CONSTRUCT — the `overrides` construct.
          if (parent) {
            let set = keySeen.get(parent)
            if (!set) { set = new Set<string>(); keySeen.set(parent, set) }
            if (set.has(k)) add(constructs, "yaml.duplicate_mapping_key", relSlug)
            else set.add(k)
          }
          // THE `exports` CONSTRUCT: a named schema definition under a PUBLICATION container. The
          // analyzer's own rule (`schemaPublicationRole`, real-yaml-analyzer.ts:613) is: the
          // container path is `definitions`/`$defs` at document level, or `components.<container>`
          // with the container being one of the OpenAPI component containers. The same rule here.
          const OPENAPI_COMPONENT_CONTAINERS = new Set([
            "schemas", "responses", "parameters", "examples", "requestBodies",
            "headers", "securitySchemes", "links", "callbacks", "pathItems",
          ])
          const isPublication =
            (cpath.length === 1 && (cpath[0] === "definitions" || cpath[0] === "$defs")) ||
            (cpath.length === 2 && cpath[0] === "components" && OPENAPI_COMPONENT_CONTAINERS.has(cpath[1]!))
          if (isPublication) add(constructs, "yaml.schema_publication_definition", relSlug)
          else if (cpath.length === 2 && cpath[0] === "components" && cpath[1] === "schemas") {
            add(constructs, "yaml.schema_publication_definition", relSlug)
          }
          break
        }
        case "alias":
          add(constructs, "yaml.alias_node", relSlug)
          // THE R3 TEST FOR `extends`, DECIDED ON THE TREE. The analyzer decides "is this alias a
          // MERGE alias?" by reading the alias's PARENT's `isMergeKey` flag
          // (real-yaml-analyzer.ts:1825) — and that flag is set on the PAIR whose key is `<<`
          // (:1312, :1392). So the analyzer recognises `<<: *base` (the alias's parent IS the merge
          // pair) and — on this tree — would NOT recognise `<<: [*a, *b]` (the alias's parent is
          // the SEQUENCE, whose own parent is the merge pair). The two forms are counted apart here,
          // because the second is exactly what an R3 gap looks like: the construct exists in the
          // language, the analyzer does not attempt it, and the type is therefore UNIMPLEMENTED
          // rather than excluded.
          {
            // THE SHAPE of the merge: climb to the NEAREST pair ancestor and ask whether its key is
            // `<<`. Three shapes, and they are the shapes the analyzer's rule can and cannot see:
            //   DIRECT   `<<: *base`     — the alias's parent IS the merge pair
            //   FLOW-SEQ `<<: [*a, *b]`  — the alias's parent is a flow_sequence under the merge pair
            //   BLK-SEQ  `<<:` + a block sequence on the following lines
            let shape: string | null = null
            let cur = parent
            let steps = 0
            const between: string[] = []
            while (cur && steps < 6) {
              if (cur.type === "block_mapping_pair" || cur.type === "flow_pair") {
                if (keyTextOf(cur) === "<<") {
                  // THE SHAPE IS THE NODES BETWEEN THE ALIAS AND THE MERGE PAIR: a sequence node
                  // in that chain means the alias is one of SEVERAL merge sources, and the absence
                  // of one means the alias IS the merge source.
                  shape = between.some((t) => t === "flow_sequence") ? "under-a-FLOW-sequence"
                    : between.some((t) => t === "block_sequence") ? "under-a-BLOCK-sequence"
                    : "direct"
                }
                break
              }
              between.push(cur.type)
              cur = cur.parent
              steps++
            }
            if (shape) add(constructs, `yaml.merge_alias_${shape}`, relSlug)
            else add(constructs, "yaml.alias_NOT_a_merge", relSlug)
          }
          break
        case "anchor":
          add(constructs, "yaml.anchor_node", relSlug)
          break
        case "tag": {
          add(constructs, "yaml.tag_node", relSlug)
          const raw = String(n.text ?? "")
          const name = tagNameOf(n)
          fileTagNames.push(name)
          // THE `decorates` DECISIVE COUNT. The csharp lane's measurement is "how many ATTRIBUTES
          // APPLY A CALLABLE", and its dialect is exact: IF THE CONSTRUCTOR ARGUMENT IS A CALL, IT
          // IS AN APPLICATION; IF IT IS A PLAIN NAME, IT IS A POINTER. The YAML nearest neighbour of
          // a constructor argument is a TAG'S SUFFIX — `!include` (the suffix "include"), `!!str`
          // (the suffix "str"), `!e!thing` (the handle "!e!" and the suffix "thing"). This
          // grammar keeps a tag's whole text in one node (no `tag_handle` child), so the suffix is
          // read from the TEXT, and a CALL-SHAPED suffix is one that carries a call's parenthesis —
          // the shape YAML itself has no syntax for.
          const suffix = tagSuffixOf(raw)
          if (suffix !== null) {
            add(constructs, "yaml.tag_with_a_constructor_argument", relSlug)
            if (/[(]/.test(suffix)) {
              add(constructs, "yaml.tag_with_a_call_shaped_argument", relSlug)
              sample(`tag-call-arg:${suffix}`, relSlug)
            }
          }
          // THE `part_of` FALSIFIER'S CONSTRUCT, COUNTED: an include-family tag at the DOCUMENT's
          // ROOT would put the included fragment's keys at the including document's TOP LEVEL — the
          // shared-scope relation `part_of` names. A tag in a VALUE position puts the fragment AT
          // A KEY, which is a different relation, and this counts which of the two it is.
          if (INCLUDE_FAMILY.test(name)) {
            const atRoot = n.parent?.type === "document" || n.parent?.type === "stream"
            add(constructs, atRoot ? "yaml.include_family_tag_at_the_document_root" : "yaml.include_family_tag_at_a_key_position", relSlug)
          }
          if (raw.startsWith("!<")) add(constructs, "yaml.tag_verbatim", relSlug)
          else if (raw.startsWith("!!")) add(constructs, "yaml.tag_core_schema", relSlug)
          else add(constructs, "yaml.tag_local", relSlug)
          // THE OPEN INCLUDE SWEEP — the tag family, counted from the TREE, so a spelling the
          // analyzer's CLOSED set does not know is still visible. This is the R3 test for `imports`.
          if (INCLUDE_FAMILY.test(name)) {
            add(constructs, "yaml.include_family_tag", relSlug)
            add(includeTagSpellings, name, relSlug)
            if (!ANALYZER_INCLUDE_TAGS.has(name)) {
              add(constructs, "yaml.include_family_tag_OUTSIDE_the_analyzer_closed_set", relSlug)
            }
          }
          break
        }
        case "stream": {
          // THE `part_of` NEAR-MISS: a multi-document stream is a file-level relation between
          // documents that share one file.
          const docs = n.namedChildren.filter((c: any) => c.type === "document")
          if (docs.length > 1) add(constructs, "yaml.multi_document_stream", relSlug)
          break
        }
        case "yaml_directive":
        case "tag_directive":
        case "reserved_directive":
          add(constructs, "yaml.directive", relSlug)
          break
        case "comment":
          break
        default: {
          // THE `renders` NEAR-MISS: a template interpolation inside a scalar. The file's PATH
          // SHAPE is recorded too, because the question the near-miss has to answer is whether the
          // interpolation is a YAML construct or a DIFFERENT LANGUAGE's construct embedded in a YAML
          // string — and the path is the evidence (`templates/` and `chart/` say Helm, `.j2` says
          // Jinja, `{{ .Values` says Go-template, and none of them is YAML).
          if (n.type.endsWith("_scalar")) {
            const t = String(n.text ?? "")
            if (t.includes("{{") || t.includes("${")) {
              add(constructs, "yaml.template_interpolation_in_scalar", relSlug)
              const shp = shapeOfFile(relSlug)
              add(templateFileShapes, shp, relSlug)
              sample(`shape:${shp}`, relSlug)
              // THE `renders` DECISIVE COUNT. The fleet's shape for `renders` is "the name in a
              // RETURNED CONSTRUCTION" (typescript's JSX tag, clojure's hiccup vector, csharp's
              // type argument, dart's `build` method) — so the construct is a template expression
              // that NAMES A COMPONENT. In YAML that expression is another language's text embedded
              // in a YAML scalar, and the count below says how many of them name a component AND
              // are in a scalar. The contrast with the text-level count is the measurement: a
              // `{{ template "x" . }}` that the YAML grammar cannot lex is not a YAML construct.
              for (const m of t.matchAll(/\{\{[-]?\s*(template|include|define)\s+\"([^\"]+)\"/g)) {
                add(constructs, `yaml.template_component_named_in_a_scalar`, relSlug)
                add(templateComponentNames, `${m[1]}:${m[2]}`, relSlug)
              }
            }
          }
          break
        }
      }
    })
    // THE `renders` TEXT-LEVEL COUNT: the same component-naming forms anywhere in the file's TEXT.
    // The contrast with the scalar-level count above IS the measurement — a `{{ template "x" . }}`
    // that the YAML grammar cannot lex is not a YAML construct, and this is where it shows up.
    try {
      fileText = decodeSourceText(readFileSync(abs)).text
    } catch { fileText = "" }
    for (const m of fileText.matchAll(/\{\{[-]?\s*(template|include|define)\s+\"([^\"]+)\"/g)) {
      add(constructs, "yaml.template_component_named_in_the_file_text", relSlug)
    }
    // THE `mixes_in` DECISIVE COUNT: a mapping that carries a merge LIST and names its base
    // SEPARATELY — the Dart contract's shape ("the `with` list is not an inheritance clause")
    // translated into YAML's own vocabulary. A merge list alone is common and says nothing
    // about mixins; a merge list BESIDE a separate base clause would be the mixin.
    for (const shape of mappingShapes.values()) {
      if (shape.mergeList && shape.separateBase) add(constructs, "yaml.merge_list_with_a_separate_base_clause", relSlug)
    }
    // THE `decorates` DECISIVE COUNT: a tag whose name names a DECLARATION in the same document.
    // The csharp lane's ontological test — "does the construct APPLY a callable, or MARK the
    // declaration?" — has a countable form in YAML: a tag that names a declaration in the document
    // is marking it with a TYPE, and the relation the fleet publishes for that is `references`
    // (`references{declared_type}`), not `decorates` (which is an APPLICATION).
    for (const name of fileTagNames) {
      if (name && fileKeys.has(name)) add(constructs, "yaml.tag_naming_a_declaration_in_the_document", relSlug)
    }
  } catch { /* the construct census is an ADDITION to the relationship census, never a precondition */ }
  finally {
    try { tree?.delete?.() } catch { /* a tree that is not disposed is a leak the arm pays for */ }
  }
}

// ── EVERY DECLARED COUNTER GETS A ROW, SO A ZERO IS A MEASUREMENT AND NOT AN ABSENCE ──────────
// The construct map is built by `add()`, which creates a key only on a hit. Without this block a
// counter with zero sites leaves NO KEY, and a reader cannot tell "ran and found nothing" from
// "never ran" — which is how this lane's own whole-population artifact came to have 42 construct
// keys and NONE of the four extended types' decisive counters, exactly where a ruling needs a
// number. A DECLARED ZERO IS EVIDENCE; AN ABSENT KEY IS NOT.
for (const name of DECLARED_COUNTERS) if (!constructs.has(name)) constructs.set(name, mk())
// AND THE OTHER DIRECTION: a counter that FIRED but is not declared would silently sit outside the
// declaration, so the run FAILS LOUDLY instead of publishing a shortlist as a census.
const undeclared = [...constructs.keys()].filter((k) => !DECLARED_COUNTERS.includes(k)).sort()
if (undeclared.length) {
  console.error(
    `FAIL — ${undeclared.length} construct counter(s) emitted but NOT DECLARED: ${undeclared.join(", ")}. ` +
    `Add them to DECLARED_COUNTERS; a counter outside the declaration is a shortlist pretending to be a census.`,
  )
  process.exit(9)
}

const totalMs = performance.now() - t0All
const dump = (m: Map<string, Tally>) => {
  const out: Record<string, any> = {}
  for (const [k, v] of [...m.entries()].sort()) {
    out[k] = { edges: v.edges, files: v.files.size, repos: v.repos.size }
  }
  return out
}

/** The REPO SET per tally key, so a chunked merge can UNION it (a repository spans chunks). */
const repoSets = (m: Map<string, Tally>): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  for (const [k, v] of [...m.entries()].sort()) out[k] = [...v.repos].sort()
  return out
}

const report = {
  instrument: "script/m14/yaml-emission-census.ts",
  lane: "yaml",
  at: new Date().toISOString(),
  // WHICH RULE PRODUCED THESE NUMBERS. A parse-only run and a full run count the constructs with
  // the SAME walk over the SAME tree; the flag removes only the analyzer and the per-type tallies.
  // A published construct count must say which of the two it came from, so it can be compared.
  mode: PARSE_ONLY ? "parse-only (constructs only; no analyzer, no per-type tallies)" : "full (analyzer + constructs on one tree)",
  grammar: build,
  chunk: CHUNK_IDX === null
    ? { mode: "single", files: files.length, of: total }
    : { mode: "chunked", idx: CHUNK_IDX, size: CHUNK_SIZE, files: files.length, of: total, first: discoveredFiles[CHUNK_IDX * CHUNK_SIZE] ?? null, last: discoveredFiles[Math.min((CHUNK_IDX + 1) * CHUNK_SIZE, discoveredFiles.length) - 1] ?? null },
  population: {
    corpusRoot: CR,
    reposOnDisk: onDisk.repos,
    symlinkedRepoDirsFollowed: symlinkedRepoDirs,
    symlinkedDirsFollowedOnDiskWalk: onDisk.symlinkedDirs,
    paths: paths,
    distinctFiles: distinctFiles,
    admittedTotal: total,
    absent,
    overCap,
    overCapLargest,
    parsed,
    failed,
    degradedToFallback: degraded,
    constructWalked,
    reposCarryingAnAdmittedFile: repos.size,
    reposWithAdmittedPaths: Object.keys(repoPaths).length,
    perRepoPaths: repoPaths,
    perRepoDistinctFiles: repoDistinct,
    note:
      "THREE DENOMINATORS, NEVER MIXED. PATHS = tracked admitted paths (a path is a path even when two " +
      "paths are one file). DISTINCT FILES = the realpaths behind those paths (the symlink-aware " +
      "identity). ADMITTED = the files this run PARSED — the denominator every count below is over. " +
      "The REPO COUNT is the number of repositories CARRYING AN ADMITTED FILE, and it is derivable " +
      "from the per-repo rows above.",
  },
  repoSets: {
    perType: repoSets(perType),
    perMarker: repoSets(perMarker),
    perMarkerType: repoSets(perMarkerType),
    constructs: repoSets(constructs),
    includeTagSpellings: repoSets(includeTagSpellings),
    includeKeySpellings: repoSets(includeKeySpellings),
    supertypeKeySpellings: repoSets(supertypeKeySpellings),
    templateComponentNames: repoSets(templateComponentNames),
  },
  templateComponentNames: dump(templateComponentNames),
  perType: dump(perType),
  perMarker: dump(perMarker),
  perMarkerType: dump(perMarkerType),
  constructs: dump(constructs),
  includeTagSpellings: dump(includeTagSpellings),
  includeKeySpellings: dump(includeKeySpellings),
  supertypeKeySpellings: dump(supertypeKeySpellings),
  samples: Object.fromEntries([...samples.entries()].sort()),
  templateFileShapes: dump(templateFileShapes),
  analyzerClosedIncludeTagSet: [...ANALYZER_INCLUDE_TAGS].sort(),
  analyzerClosedIncludeKeySet: [...ANALYZER_INCLUDE_KEYS].sort(),
  parseErrors,
  // WHICH COUNTERS THIS ARTIFACT EVALUATED — so `countersDeclared` minus the observed keys IS the
  // set of counters that ran and found nothing, and that subtraction is checkable by a reader.
  countersDeclared: DECLARED_COUNTERS,
  timing: { totalMs, files: parsed, meanFileMs: parsed ? totalMs / parsed : 0 },
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`yaml-emission-census — population ${total} admitted (${paths} paths, ${distinctFiles} distinct files, ${repos.size} repos), ${parsed} parsed, ${failed} failed, ${degraded} degraded`)
  console.log(`  symlinked repo dirs followed: ${symlinkedRepoDirs} · on-disk symlinked dirs followed: ${onDisk.symlinkedDirs}`)
  console.log(`  grammar: registry sha ${build.wasmSha256.slice(0, 16)} · ids ${build.nodeTypeIds} · named ids ${build.namedNodeTypeIds} · named unique ${build.namedNodeTypesUnique}`)
  console.log("")
  console.log("  per type:")
  for (const t of ALL_TYPES) {
    const v = perType.get(t)!
    console.log(`    ${t.padEnd(13)} edges ${String(v.edges).padStart(8)}  files ${String(v.files.size).padStart(6)}  repos ${String(v.repos.size).padStart(4)}`)
  }
  console.log("")
  console.log("  constructs:")
  for (const [k, v] of [...constructs.entries()].sort()) {
    console.log(`    ${k.padEnd(52)} edges ${String(v.edges).padStart(8)}  files ${String(v.files.size).padStart(6)}  repos ${String(v.repos.size).padStart(4)}`)
  }
  console.log("")
  console.log(`  report: ${path.relative(ROOT, OUT)}`)
}
process.exit(parsed === 0 ? 3 : 0)
