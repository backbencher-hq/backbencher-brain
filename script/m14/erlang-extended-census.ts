#!/usr/bin/env bun
/**
 * ERLANG EXTENDED-TYPE + POPULATION CENSUS — the lane's own whole-population instrument.
 *
 * ## WHAT IT MEASURES, AND WHAT IT IS FOR
 *
 * Three things the completion gate's five conditions need and the arbiter cannot give:
 *
 *   1. THE POPULATION, rule-for-rule the gate's own (`script/m14/incoming-gate.ts:discoverFiles`):
 *      every entry of `$BB_CORPUS_ROOT` is considered, symlinked directories are followed and counted,
 *      only real git checkouts are corpus (`git rev-parse --git-dir`), the file set is `git ls-files -z`
 *      (TRACKED, never the disk), extension admission is the router's ONE table
 *      (`extensionsFor("erlang")`), the size cap is the engine's full-AST limit (1 MiB), and paths are
 *      deduplicated by realpath into DISTINCT FILES. Three denominators are reported and never mixed:
 *      PATHS · DISTINCT FILES · ADMITTED.
 *
 *   2. THE CONSTRUCT COUNTS THE FOUR EXTENDED-TYPE DISPOSITIONS REST ON — every one a count of a
 *      CONSTRUCT on the tree, not a sentence. The negative counters are DECLARED ZEROS emitted as
 *      READINGS (the probe sets are looked up per node, so a grammar change that added a production
 *      would move them), and every near miss the rulings name is counted beside them.
 *
 *   3. THE DECLARED-NAME INDEX the cause census reads: per repository, the sorted unique NAMES the
 *      PRODUCTION path published as symbols. That is what makes the unresolved classes SEMANTIC.
 *
 * ## TWO PHASES, AND WHY (a measured WASM abort, not a preference)
 *
 * MEASURED 2026-10-23: doing the construct parse AND `pool-worker.ts:parseFile` in ONE process made the
 * tree-sitter WASM module die with `Out of bounds memory access` in `_ts_parser_parse_wasm` after ~500
 * files: two live parser instances each grow their own module memory, and the process aborts — after
 * which every remaining file "fails" while a whole-population header is still printed. THE FLEET'S
 * TENTH FORM. So the census is split into ONE PROCESS PER PARSER:
 *   · `--phase=constructs` — one parser, `parser.parse` + tree.delete() in a finally, construct counters;
 *   · `--phase=analyzer`   — `pool-worker.ts:parseFile`, the SAME production entry the arm calls
 *                            (symbol sanitizer + relationship filter included), symbols/edges/index;
 *   · `--phase=merge`      — reads both partials, refuses a mismatch, writes the artifact.
 *
 * THE ANALYZER HALF MUST USE parseFile AND NOT THE ANALYZER DIRECTLY. Measured: calling
 * `RealErlangAnalyzer.analyze` directly gave 1,033,906 relationships against the arm's 1,023,190 edges.
 * The 10,716-row delta IS the production filters; the declared-name index would have carried names the
 * arm never receives, and the two instruments would have disagreed about the same run.
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun script/m14/erlang-extended-census.ts --phase=constructs --cap=0 --beat-every=500
 *   bun script/m14/erlang-extended-census.ts --phase=analyzer  --cap=0 --beat-every=500
 *   bun script/m14/erlang-extended-census.ts --phase=merge
 *
 * EXIT: 0 measured · 2 no corpus / no admitted files · 10 the population did not close (parsed !=
 * admitted, or failed > 0) or the phases disagree — the measurement is NOT promoted to an artifact.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, realpathSync, readdirSync, statSync, lstatSync, readlinkSync } from "node:fs"
import * as path from "node:path"

import { ASTEngine } from "../../src/ast/engine"
import { parseFile } from "../../src/ast/pool-worker"
import { decodeSourceText } from "../../src/util/source-text"
import { extensionsFor } from "./language-extensions"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024 // the engine's own FULL_AST_LIMIT (pool-worker.ts)
const LANE = "erlang"
const EXTS = extensionsFor(LANE) // THE ONE TABLE — never a hand-written copy (dotted, e.g. ".erl")
const EXT_NAMES = EXTS.map((e) => e.replace(/^\./, ""))

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i >= 0) return argv[i + 1]
  for (const a of argv) if (a.startsWith(f + "=")) return a.slice(f.length + 1)
  return undefined
}
const CAP = Number(argOf("--cap") ?? 0)
const BEAT_EVERY = Number(argOf("--beat-every") ?? 0)
const PHASE = argOf("--phase") ?? "merge"
const OUT = argOf("--out") ?? path.join(ROOT, "validation", "m14", "measurements", "erlang-extended-census.json")
const PART_CONSTRUCTS = OUT + ".constructs.json"
const PART_ANALYZER = OUT + ".analyzer.json"

const say = (s: string) => process.stderr.write(s + "\n")
const admitByExtension = (rel: string): boolean => {
  const base = path.basename(rel).toLowerCase()
  const dot = base.lastIndexOf(".")
  const ext = dot >= 0 ? base.slice(dot) : base
  return EXTS.includes(ext)
}

// ═══════════════════════════════════════════════════════════════════════════
// THE POPULATION — copied rule-for-rule from the gate's discoverFiles.
// ═══════════════════════════════════════════════════════════════════════════
interface Discovery {
  files: string[]
  total: number
  repos: Set<string>
  absent: number
  overCap: number
  overCapLargest: number
  paths: number
  distinctFiles: number
  repoPaths: Record<string, number>
  repoDistinct: Record<string, number>
  symlinkedRepoDirs: number
  corpusEntries: number
  root: string
  exts: string[]
}
function discover(cap: number): Discovery {
  const found: string[] = []
  const repos = new Set<string>()
  const repoPaths: Record<string, number> = {}
  const repoDistinct: Record<string, number> = {}
  const distinct = new Set<string>()
  let absent = 0, overCap = 0, overCapLargest = 0, paths = 0, symlinkedRepoDirs = 0, corpusEntries = 0
  let entries: string[]
  try { entries = readdirSync(CR) } catch {
    return { files: [], total: 0, repos, absent: 0, overCap: 0, overCapLargest: 0, paths: 0, distinctFiles: 0, repoPaths, repoDistinct, symlinkedRepoDirs: 0, corpusEntries: 0, root: CR, exts: EXT_NAMES }
  }
  corpusEntries = entries.length
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    let st: any
    try { st = statSync(dir) } catch { continue }
    if (!st.isDirectory()) continue
    // A REPO ENTRY THAT IS A SYMLINK IS A SYMLINKED DIRECTORY THE WALK FOLLOWED.
    try { if (lstatSync(dir).isSymbolicLink() && readlinkSync(dir)) symlinkedRepoDirs++ } catch { /* not a symlink */ }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
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
  return { files, total, repos, absent, overCap, overCapLargest, paths, distinctFiles: distinct.size, repoPaths, repoDistinct, symlinkedRepoDirs, corpusEntries, root: CR, exts: EXT_NAMES }
}

const repoOf = (abs: string): string => {
  const rel = path.relative(CR, abs)
  return rel.split(path.sep)[0] ?? "-"
}
const repoRootOf = (abs: string): string => path.join(CR, repoOf(abs))
const populationRule = (disc: Discovery) => ({
  rule:
    "GIT-TRACKED set per repository: every entry of the corpus root is considered, symlinked directories are followed, only real git checkouts are corpus, the file set is git ls-files -z, extension admission is extensionsFor(\"erlang\") = the router's ONE table, the cap is the engine's FULL_AST_LIMIT 1 MiB, and paths are deduplicated by realpath into DISTINCT FILES.",
  root: disc.root,
  exts: EXT_NAMES,
  corpusEntries: disc.corpusEntries,
  symlinkedDirEntriesFollowed: disc.symlinkedRepoDirs,
  paths: disc.paths,
  distinctFiles: disc.distinctFiles,
  admitted: disc.total,
  absent: disc.absent,
  overCap: disc.overCap,
  overCapLargest: disc.overCapLargest,
  repos: disc.repos.size,
  repoPaths: disc.repoPaths,
  repoDistinct: disc.repoDistinct,
  sample: disc.files.length,
  cap: CAP,
  index:
    "no — there is no INDEX_SPECS entry for erlang, so the arm's (and this census's) resolution scope is the arm's own per-repository declaration table, not a production project index",
})

// ═══════════════════════════════════════════════════════════════════════════
// THE CONSTRUCT SETS — each one is the FILTER a ruling names, not a fragment.
// ═══════════════════════════════════════════════════════════════════════════
/** A render SITE is a component-element production. This grammar declares none (grammar inventory). */
const RENDER_ELEMENT_TYPES = new Set(["jsx_element", "jsx_self_closing_element", "jsx_opening_element", "element"])
/** A mixin APPLICATION is a with-clause / mixin-application production. This grammar declares none. */
const MIXIN_TYPES = new Set(["mixins", "mixin_application", "mixin_application_class", "with_clause", "trait_declaration", "class_declaration", "extends_clause"])
/** A decorator is an APPLIED-CALLABLE production. This grammar declares none (attributes are annotations). */
const DECORATOR_TYPES = new Set(["decorator", "annotation", "annotation_declaration"])
/** The attribute directive names that DECLARE ANNOTATION METADATA rather than a symbol. */
const WILD_ANNOTATION_NAMES = new Set(["nifs", "on_load", "doc", "moduledoc", "dialyzer", "format", "vsn", "author", "copyright", "deprecated"])

interface Constructs {
  pp_include: number
  pp_include_lib: number
  include_sites: number
  include_sites_plain: number
  include_sites_lib: number
  include_sites_in_erl: number
  include_sites_in_hrl: number
  behaviour_attribute: number
  spec: number
  callback: number
  wild_attribute_sites: number
  annotation_attribute_sites: number
  annotation_attribute_names: Record<string, number>
  attribute_nodes_by_type: Record<string, number>
  remote_nodes: number
  render_near_miss_widget_construction_calls: number
  try_class_sites: number
  render_component_element_sites: number
  mixin_with_clause_sites: number
  decorator_production_sites: number
}
const emptyConstructs = (): Constructs => ({
  pp_include: 0, pp_include_lib: 0, include_sites: 0, include_sites_plain: 0, include_sites_lib: 0,
  include_sites_in_erl: 0, include_sites_in_hrl: 0, behaviour_attribute: 0, spec: 0, callback: 0,
  wild_attribute_sites: 0, annotation_attribute_sites: 0, annotation_attribute_names: {},
  attribute_nodes_by_type: {}, remote_nodes: 0, render_near_miss_widget_construction_calls: 0,
  try_class_sites: 0, render_component_element_sites: 0, mixin_with_clause_sites: 0, decorator_production_sites: 0,
})
const ATTR_NODE_TYPES = new Set([
  "module_attribute", "export_attribute", "export_type_attribute", "import_attribute",
  "optional_callbacks_attribute", "behaviour_attribute", "deprecated_attribute",
  "compile_options_attribute", "file_attribute", "feature_attribute", "wild_attribute",
])
const childText = (n: any): string => (typeof n?.text === "string" ? n.text : "")

function censusTree(root: any, isHrl: boolean, c: Constructs): void {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    const t = String(n.type ?? "")
    // DECLARED ZEROS ARE READINGS, NOT CONSTANTS: the sets are looked up per node.
    if (RENDER_ELEMENT_TYPES.has(t)) c.render_component_element_sites++
    if (MIXIN_TYPES.has(t)) c.mixin_with_clause_sites++
    if (DECORATOR_TYPES.has(t)) c.decorator_production_sites++
    if (t === "pp_include" || t === "pp_include_lib") {
      c.include_sites++
      if (t === "pp_include") { c.pp_include++; c.include_sites_plain++ } else { c.pp_include_lib++; c.include_sites_lib++ }
      if (isHrl) c.include_sites_in_hrl++; else c.include_sites_in_erl++
    } else if (t === "behaviour_attribute") c.behaviour_attribute++
    else if (t === "spec") c.spec++
    else if (t === "callback") c.callback++
    else if (t === "try_class") c.try_class_sites++
    else if (t === "remote") {
      c.remote_nodes++
      // NEAR MISS for `renders`: the nearest thing Erlang has to a UI construction site is a remote
      // call into wx/wxe (the OTP GUI widget bindings). It is a CALL (module:function), never a
      // rendered component — the vocabulary's own MUST-NOT ("React.createElement(Foo) stays calls").
      const mod = n.namedChildren?.find((x: any) => x?.type === "remote_module")
      const atom = mod?.namedChildren?.find((x: any) => x?.type === "atom")
      if (childText(atom).startsWith("wx")) c.render_near_miss_widget_construction_calls++
    }
    if (ATTR_NODE_TYPES.has(t)) {
      c.attribute_nodes_by_type[t] = (c.attribute_nodes_by_type[t] ?? 0) + 1
      if (t === "wild_attribute") c.wild_attribute_sites++
      const attrNameNode = n.namedChildren?.find((x: any) => x?.type === "attr_name")
      if (attrNameNode) {
        const inner = attrNameNode.namedChildren?.find((x: any) => x?.type === "atom")
        const raw = childText(inner) || childText(attrNameNode)
        const name = raw.replace(/^-+/, "").toLowerCase()
        if (WILD_ANNOTATION_NAMES.has(name)) {
          c.annotation_attribute_sites++
          c.annotation_attribute_names[name] = (c.annotation_attribute_names[name] ?? 0) + 1
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
  }
}

const beat = () => {
  try { execFileSync("bash", [path.join(ROOT, "script/m14/arm-token.sh"), "beat", LANE], { stdio: "ignore" }) } catch { /* a beat that cannot be written does not stop the work */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 — CONSTRUCTS (ONE parser; tree.delete() every file)
// ═══════════════════════════════════════════════════════════════════════════
async function runConstructsPhase(): Promise<void> {
  const disc = discover(CAP)
  if (disc.total === 0) { say(`NO ADMITTED FILES under ${CR} — a population of zero is a CONTROL FAILURE.`); process.exit(2) }
  say(`[constructs] population: parsed target ${disc.files.length}/${disc.total}; exts ${EXT_NAMES.join(",")}; root ${CR}`)
  const parser: any = await ASTEngine.getParser(LANE as any)
  const constructs = emptyConstructs()
  const stats = { parsed: 0, failed: 0, parseErrorFiles: 0, crashedFiles: 0 }
  const failedFiles: string[] = []
  const parseErrorSamples: string[] = []
  const startedAt = Date.now()
  for (let i = 0; i < disc.files.length; i++) {
    const abs = disc.files[i]!
    let tree: any = null
    try {
      const content = decodeSourceText(readFileSync(abs)).text
      tree = parser.parse(content, abs)
      if (!tree?.rootNode) { stats.failed++; if (failedFiles.length < 25) failedFiles.push(`${path.relative(CR, abs)}: no rootNode`); continue }
      censusTree(tree.rootNode, abs.toLowerCase().endsWith(".hrl"), constructs)
      if (tree.rootNode.hasError) {
        stats.parseErrorFiles++
        if (parseErrorSamples.length < 10) parseErrorSamples.push(path.relative(CR, abs))
      }
      stats.parsed++
    } catch (e: any) {
      stats.crashedFiles++
      stats.failed++
      if (failedFiles.length < 25) failedFiles.push(`${path.relative(CR, abs)}: ${String(e?.message ?? e).slice(0, 200)}`)
    } finally {
      try { tree?.delete?.() } catch { /* a tree that cannot be deleted is not a failed measurement */ }
    }
    if (BEAT_EVERY > 0 && (i + 1) % BEAT_EVERY === 0) {
      beat()
      say(`  [constructs] ${i + 1}/${disc.files.length} parsed ${stats.parsed} failed ${stats.failed} rss ${Math.round(process.memoryUsage().rss / 1048576)} MB ${Math.round((Date.now() - startedAt) / 1000)}s`)
    }
  }
  const part = {
    schemaVersion: 1,
    kind: "erlang-extended-census.constructs",
    phase: "constructs",
    instrument: "script/m14/erlang-extended-census.ts --phase=constructs (ONE parser; parser.parse + tree.delete() in a finally; construct counters only)",
    population: `parsed=${stats.parsed}/${disc.files.length} admitted=${disc.total} exts=${EXT_NAMES.join(",")} index=no`,
    populationRule: populationRule(disc),
    run: { parsed: stats.parsed, failed: stats.failed, parseErrorFiles: stats.parseErrorFiles, crashedFiles: stats.crashedFiles, failedFiles, parseErrorSamples, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) },
    constructs,
  }
  if (stats.parsed !== disc.total || stats.failed !== 0) {
    say(`*** [constructs] THE RUN DID NOT CLOSE: parsed ${stats.parsed} of admitted ${disc.total}, failed ${stats.failed}`)
    for (const f of failedFiles.slice(0, 5)) say(`    FAILED: ${f}`)
    process.exit(10)
  }
  mkdirSync(path.dirname(PART_CONSTRUCTS), { recursive: true })
  writeFileSync(PART_CONSTRUCTS, JSON.stringify(part, null, 2) + "\n")
  say(`POPULATION CLOSED [constructs]: ${part.population}`)
  say(`  include ${constructs.include_sites} (plain ${constructs.include_sites_plain} · lib ${constructs.include_sites_lib}) · behaviour ${constructs.behaviour_attribute} · annotation attrs ${constructs.annotation_attribute_sites} · render/mixin/decorator sites ${constructs.render_component_element_sites}/${constructs.mixin_with_clause_sites}/${constructs.decorator_production_sites} · wx calls ${constructs.render_near_miss_widget_construction_calls} · try_class ${constructs.try_class_sites}`)
  say(`partial: ${PART_CONSTRUCTS}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — ANALYZER (the PRODUCTION path: pool-worker.ts parseFile)
// ═══════════════════════════════════════════════════════════════════════════
interface TypeRow { edges: number; files: number; repos: Set<string> }
async function runAnalyzerPhase(): Promise<void> {
  const disc = discover(CAP)
  if (disc.total === 0) { say(`NO ADMITTED FILES under ${CR} — a population of zero is a CONTROL FAILURE.`); process.exit(2) }
  say(`[analyzer] population: parsed target ${disc.files.length}/${disc.total}; exts ${EXT_NAMES.join(",")}; root ${CR}`)
  const perType = new Map<string, TypeRow>()
  const namesByRepo: Record<string, string[]> = {}
  const repoNameSets = new Map<string, Set<string>>()
  const stats = { parsed: 0, failed: 0, degraded: 0, symbols: 0, relationships: 0, crashedFiles: 0 }
  const failedFiles: string[] = []
  const startedAt = Date.now()
  for (let i = 0; i < disc.files.length; i++) {
    const abs = disc.files[i]!
    const repo = repoOf(abs)
    try {
      // THE PRODUCTION PATH, CALLED — NOT COPIED: pool-worker.ts parseFile is the SAME function
      // script/m14/incoming-gate.ts:measure() calls for every edge it counts, including the symbol
      // sanitizer and filterNoiseRelationships. See the file header for the measured delta.
      const result: any = await parseFile(abs, repoRootOf(abs), { projectRoot: repoRootOf(abs) } as any)
      if (!result) { stats.failed++; if (failedFiles.length < 25) failedFiles.push(`${path.relative(CR, abs)}: no result`); continue }
      stats.parsed++
      if (result?.fallback === true || result?.metadata?.analysisVersion === "2.0-basic-fallback") stats.degraded++
      stats.symbols += result?.symbols?.length ?? 0
      stats.relationships += result?.relationships?.length ?? 0
      let nameSet = repoNameSets.get(repo)
      if (!nameSet) { nameSet = new Set(); repoNameSets.set(repo, nameSet) }
      for (const s of (result?.symbols ?? []) as any[]) {
        const nm = typeof s?.name === "string" ? s.name : ""
        if (nm && nm.length <= 200) nameSet.add(nm)
      }
      const seen = new Set<string>()
      for (const r of (result?.relationships ?? []) as any[]) {
        const t = String(r?.type ?? "")
        let row = perType.get(t)
        if (!row) { row = { edges: 0, files: 0, repos: new Set() }; perType.set(t, row) }
        row.edges++
        row.repos.add(repo)
        if (!seen.has(t)) { seen.add(t); row.files++ }
      }
    } catch (e: any) {
      stats.failed++
      if (failedFiles.length < 25) failedFiles.push(`${path.relative(CR, abs)}: ${String(e?.message ?? e).slice(0, 200)}`)
    }
    if (BEAT_EVERY > 0 && (i + 1) % BEAT_EVERY === 0) {
      beat()
      say(`  [analyzer] ${i + 1}/${disc.files.length} parsed ${stats.parsed} failed ${stats.failed} rss ${Math.round(process.memoryUsage().rss / 1048576)} MB ${Math.round((Date.now() - startedAt) / 1000)}s`)
    }
  }
  for (const [repo, set] of repoNameSets) namesByRepo[repo] = [...set].sort()
  const types: Record<string, { edges: number; files: number; repos: number }> = {}
  for (const [t, row] of [...perType.entries()].sort(([a], [b]) => a.localeCompare(b))) types[t] = { edges: row.edges, files: row.files, repos: row.repos.size }
  const part = {
    schemaVersion: 1,
    kind: "erlang-extended-census.analyzer",
    phase: "analyzer",
    instrument: "script/m14/erlang-extended-census.ts --phase=analyzer (pool-worker.ts parseFile — the production entry the arm calls)",
    population: `parsed=${stats.parsed}/${disc.files.length} admitted=${disc.total} exts=${EXT_NAMES.join(",")} index=no`,
    populationRule: populationRule(disc),
    run: {
      parsed: stats.parsed, failed: stats.failed, degraded: stats.degraded, symbols: stats.symbols,
      relationships: stats.relationships, crashedFiles: stats.crashedFiles,
      // A CENSUS THAT READ parseFile's SYMBOLS CANNOT MEASURE qualifiedName ALIASES: pool-worker.ts:1438
      // projects a DERIVED qualifiedName onto EVERY symbol (`s.qualifiedName || s.metadata?.fqn || …`),
      // so that reading would count 203,984 "aliases" — every symbol — and a falsifier citing it would
      // never fire. ER-D1 is a fact about the ANALYZER (it never sets one), which the cause census's
      // Q1 falsifier states as a source-level check, not as a corpus count.
      analyzerQualifiedNameAliases: null,
      analyzerQualifiedNameNote: "not measurable through parseFile: the projection derives a qualifiedName for every symbol; the analyzer sets none (ER-D1 in src/ast/real-erlang-analyzer.ts).",
      failedFiles, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    },
    types,
    declaredNameIndex: {
      note: "PER REPOSITORY, the sorted unique NAMES the PRODUCTION path published as symbols (sanitizer included). Read by script/m14/erlang-cause-census.ts to split an unresolved bare target into 'declared in ANOTHER repository of the corpus' and 'declared NOWHERE in the corpus'. The index is names, not arities: the cause census classifies CAUSES, and an arity-exact claim is the arm's job.",
      namesByRepo,
    },
  }
  if (stats.parsed !== disc.total || stats.failed !== 0) {
    say(`*** [analyzer] THE RUN DID NOT CLOSE: parsed ${stats.parsed} of admitted ${disc.total}, failed ${stats.failed}`)
    for (const f of failedFiles.slice(0, 5)) say(`    FAILED: ${f}`)
    process.exit(10)
  }
  mkdirSync(path.dirname(PART_ANALYZER), { recursive: true })
  writeFileSync(PART_ANALYZER, JSON.stringify(part, null, 2) + "\n")
  say(`POPULATION CLOSED [analyzer]: ${part.population}`)
  say(`  symbols ${stats.symbols} · relationships ${stats.relationships} · per-type ${Object.keys(types).length} · names ${Object.values(namesByRepo).reduce((a, n) => a + n.length, 0)}`)
  say(`partial: ${PART_ANALYZER}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — MERGE (refuse a mismatch; write the artifact)
// ═══════════════════════════════════════════════════════════════════════════
function runMergePhase(): void {
  let constructsPart: any, analyzerPart: any
  try { constructsPart = JSON.parse(readFileSync(PART_CONSTRUCTS, "utf8")) } catch { say(`REFUSED — no constructs partial at ${PART_CONSTRUCTS}; run --phase=constructs first.`); process.exit(2) }
  try { analyzerPart = JSON.parse(readFileSync(PART_ANALYZER, "utf8")) } catch { say(`REFUSED — no analyzer partial at ${PART_ANALYZER}; run --phase=analyzer first.`); process.exit(2) }
  if (constructsPart.population !== analyzerPart.population) {
    say(`REFUSED — the phases measured DIFFERENT populations: constructs ${JSON.stringify(constructsPart.population)} vs analyzer ${JSON.stringify(analyzerPart.population)}.`)
    process.exit(10)
  }
  const pop = constructsPart.population
  const m = /^parsed=(\d+)\/(\d+) admitted=(\d+)/.exec(pop)
  if (!m) { say(`REFUSED — unreadable population string ${JSON.stringify(pop)}`); process.exit(10) }
  const parsed = Number(m[1]), sample = Number(m[2]), admitted = Number(m[3])
  if (parsed !== admitted || parsed !== sample) { say(`REFUSED — the merged phases are not a whole population: ${pop}`); process.exit(10) }
  const c = constructsPart.constructs
  const types = analyzerPart.types ?? {}
  for (const t of ["extends", "overrides", "decorates", "renders", "mixes_in"]) {
    if ((types[t]?.edges ?? 0) !== 0) { say(`REFUSED — ruled type "${t}" has ${types[t]?.edges} emitted edges over the whole population: A RULING THE ANALYZER VIOLATES IS NOT A RULING.`); process.exit(10) }
  }
  if (c.include_sites !== (types.part_of?.edges ?? 0)) {
    say(`REFUSED — the include site count (${c.include_sites}) differs from the analyzer's part_of rows (${types.part_of?.edges ?? 0}); the relabel is not 1:1.`)
    process.exit(10)
  }
  const artifact = {
    schemaVersion: 1,
    kind: "erlang-extended-census",
    lane: LANE,
    generatedAt: new Date().toISOString(),
    instrument: "script/m14/erlang-extended-census.ts — THREE phases, one process per parser (the two-parser WASM abort is recorded in the file header): constructs (parser.parse + tree.delete) then analyzer (pool-worker.ts parseFile, the production entry the arm calls), merged here after a population/agreement check",
    command: `BB_CORPUS_ROOT=${CR} bun script/m14/erlang-extended-census.ts --phase=constructs --cap=${CAP} && bun script/m14/erlang-extended-census.ts --phase=analyzer --cap=${CAP} && bun script/m14/erlang-extended-census.ts --phase=merge`,
    population: pop,
    populationRule: analyzerPart.populationRule, // identical by the assertion above
    phases: { constructs: constructsPart.run, analyzer: analyzerPart.run },
    run: {
      parsed,
      failed: analyzerPart.run.failed + constructsPart.run.failed,
      degraded: analyzerPart.run.degraded,
      parseErrorFiles: constructsPart.run.parseErrorFiles,
      crashedFiles: analyzerPart.run.crashedFiles + constructsPart.run.crashedFiles,
      symbols: analyzerPart.run.symbols,
      relationships: analyzerPart.run.relationships,
      qualifiedNameAliases: analyzerPart.run.qualifiedNameAliases,
      parseErrorSamples: constructsPart.run.parseErrorSamples,
      failedFiles: [...analyzerPart.run.failedFiles, ...constructsPart.run.failedFiles],
      analyzerQualifiedNameAliases: null,
      analyzerQualifiedNameNote: analyzerPart.run.analyzerQualifiedNameNote,
      elapsedSeconds: analyzerPart.run.elapsedSeconds + constructsPart.run.elapsedSeconds,
    },
    types,
    constructs: c,
    declaredNameIndex: analyzerPart.declaredNameIndex,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")
  say("")
  say(`POPULATION CLOSED: ${pop}`)
  say(`  symbols ${artifact.run.symbols} · relationships ${artifact.run.relationships} · per-type rows ${Object.keys(types).length}`)
  say(`  constructs: include ${c.include_sites} (plain ${c.include_sites_plain} · lib ${c.include_sites_lib}) · behaviour ${c.behaviour_attribute} · annotation attrs ${c.annotation_attribute_sites} · render/mixin/decorator sites ${c.render_component_element_sites}/${c.mixin_with_clause_sites}/${c.decorator_production_sites} · wx calls ${c.render_near_miss_widget_construction_calls}`)
  say(`artifact: ${OUT}`)
}

async function main(): Promise<void> {
  if (PHASE === "constructs") return runConstructsPhase()
  if (PHASE === "analyzer") return runAnalyzerPhase()
  if (PHASE === "merge") return runMergePhase()
  say(`unknown --phase=${PHASE}; expected constructs | analyzer | merge`)
  process.exit(2)
}

main().catch((e) => { say(`FATAL: ${String(e?.stack ?? e)}`); process.exit(2) })
