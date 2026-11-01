/**
 * GROOVY ONTOLOGY CENSUS — the groovy lane's instrument for the
 * relationship-type workstream (docs/analyzers/ONTOLOGY-WORKSTREAM.md).
 *
 * LANE-OWNED. It does not import `differential.ts`: that file runs a corpus
 * sweep on import and is MASTER-owned. This one drives the PRODUCTION entry
 * (`parseFile` from `src/ast/pool-worker`) and computes its own numbers.
 *
 * NO REGEXP, anywhere. Every fact below is read from the tree-sitter AST by
 * node type / field / named-child position, or from the analyzer's own result
 * object. The workstream's rule is a text regex is the WRONG instrument for
 * "does this language have this construct": it matches comments and string
 * literals, misses nested syntax, and breaks silently on the next grammar
 * version. There is not one regex literal or `RegExp` node in this file, and
 * `script/m14/no-regex-gate.sh` covers this path.
 *
 * THE THREE INSTRUMENTS, and why one cannot answer all of the question
 * (`ontology-coverage-gate.ts` §instruments):
 *
 *   A. PRODUCTION EMISSION (parseFile) — Part 1 q2 "fires". A branch that
 *      never matches is dead code and source derivation cannot see it, so the
 *      number that decides EMITTED-vs-RULED comes from the production path or
 *      it does not count. Also q5 "resolved", q6 "confident", and R7.
 *      Read on THREE channels, because they are three channels:
 *        relationships[]  the ten RelationshipType values
 *        imports[]        ParseResult.imports  (src/ast/types.ts:206-216)
 *        exports[]        ParseResult.exports  (src/ast/types.ts:222)
 *
 *   B. GRAMMAR INVENTORY — every node type the pinned wasm actually produces
 *      across the drawn corpus, with counts. Positive evidence of absence for
 *      a type that needs a node the language does not have.
 *
 *   C. PARSE-TREE CONSTRUCT COUNT — for a type the language expresses through
 *      a CONVENTION rather than a keyword. Groovy has no `export` node:
 *      exportability is "a top-level declaration in a .groovy file, which
 *      every Groovy compilation unit makes importable". A grammar inventory is
 *      blind to a convention BY CONSTRUCTION, which is exactly how the
 *      `exports` ruling for json was overturned. So the export surface is
 *      COUNTED on the tree, per visibility, and compared against what the
 *      analyzer's `exports[]` array actually carries.
 *
 * POPULATION IS DERIVED, never hand-listed (honesty contract §"an instrument
 * must declare the population it covered"). `git ls-files` over the corpus
 * roots named on the command line, filtered by `detectLanguageFromPath`, and
 * the admitted/drawn counts are printed beside every number. A count of zero
 * is a claim that needs its population attached.
 *
 * USAGE
 *   npx tsx script/m14/groovy-ontology-census.mts --out census.json
 *   npx tsx script/m14/groovy-ontology-census.mts --merge a.json b.json --out census.json
 *   npx tsx script/m14/groovy-ontology-census.mts --list=paths.txt --out chunk.json
 *
 * `--list` takes ONE ABSOLUTE PATH PER LINE. It exists because
 * `parser.parse()` is synchronous WASM: when the grammar loops on a pathological
 * input the event loop is blocked, a timer cannot interrupt it, and the engine
 * answers with `process.exit()` — `[BB-HANG] parser stuck 120s` — which destroys
 * every remaining file in this process. Measured on this corpus: 4 files abort
 * the run, two of them with a wasm `memory access out of bounds`
 * (`src/test/groovy/bugs/Groovy3519.groovy`, `Groovy3560.groovy`) and two by the
 * 120 s guard (`config/codenarc/codenarc.groovy`, `config/codenarc/gate.groovy`),
 * plus `gradle/build-scans.gradle` and `gradle/eclipse.gradle` on the parser
 * timeout. A measurement one input file can delete is not a measurement, so
 * `script/m14/tmp/groovy-census-driver.mts` drives this script in chunks and
 * bisects a chunk that dies. Those six files are REPORTED as
 * `skippedForParseBudget`, never silently dropped.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]
const SAMPLE_CAP = 6

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1]
  const j = process.argv.find((a) => a.startsWith(`${flag}=`))
  return j ? j.slice(flag.length + 1) : dflt
}
const REPOS = (argOf("--repo", "groovy") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MODE = argOf("--mode", "emit")
const IS_MERGE = process.argv.includes("--merge")
const MAX_BYTES = 512 * 1024

/** The node types that would EXPRESS each of the ten types if the language
 *  wrote them as syntax rather than as a convention. This is instrument A's
 *  candidate list, and the report prints which of them the grammar produced —
 *  a candidate the grammar never produces is a fact, not an assumption. */
const NODE_TYPES_THAT_WOULD_MEAN_IT: Record<Type, string[]> = {
  calls: ["method_invocation", "juxt_function_call", "leading_dot_call", "explicit_constructor_invocation"],
  uses: ["field_access", "array_access", "interpolated_identifier", "string_interpolation"],
  contains: ["class_body", "interface_body", "enum_body_declarations"],
  imports: ["import_declaration"],
  references: ["scoped_type_identifier", "scoped_identifier"],
  exports: ["module_declaration", "export_declaration", "export_statement", "exports_clause"],
  extends: ["superclass", "extends_interfaces"],
  implements: ["super_interfaces"],
  overrides: ["annotation", "marker_annotation"],
  instantiates: ["object_creation_expression"],
}

/** The declaration node types that make a Groovy file's unit. */
const TYPE_DECL_TYPES = new Set([
  "class_declaration", "interface_declaration", "trait_declaration",
  "enum_declaration", "record_declaration", "annotation_type_declaration",
])
/** Member declaration node types — a `contains` parent, whatever its body. */
const MEMBER_DECL_TYPES = new Set([
  "method_declaration", "constructor_declaration", "function_definition",
  "field_declaration", "constant_declaration", "enum_constant",
  "property_declaration",
])

type Counter = Record<string, number>
type Shard = {
  schema: "groovy-ontology-census/1"
  mode: string
  repos: string[]
  revisions: Record<string, string>
  corpusAdmitted: number
  drawn: number
  parsedThroughProductionEntry: number
  parseFailures: number
  /** Files whose parse tree carries an ERROR or MISSING node. */
  filesWithErrorNodes: number
  errorNodes: number
  missingNodes: number
  symbols: number
  relationships: number
  /** imports[] channel — the SEPARATE channel ParseResult declares. */
  importsChannel: { entries: number; files: number; staticEntries: number; wildcardEntries: number }
  /** exports[] channel — ParseResult.exports. */
  exportsChannel: { entries: number; files: number }
  wallMs: number
  types: Record<string, {
    edges: number
    files: Counter
    fileTotal: number
    sampleFiles: string[]
    confidence: Counter
    evidenceClass: Counter
    /** metadata.relationshipType — the sub-label the analyzer stamps on itself. */
    subLabel: Counter
    metadataKeySets: Counter
    lines: Counter
  }>
  resolutionFileScope: Record<string, Counter>
  integrity: Record<string, Counter>
  symbolIntegrity: Counter
  r7samples: string[]
  probes: Record<string, { occurrences: number; files: Counter; fileTotal: number; samples: string[] }>
  grammarNodeTypes: Counter
  /** Anonymous token texts seen at file scope, for the export-construct question. */
  fileScopeTokens: Counter
  confidenceOutliers: string[]
  neitherEndpointSamples: string[]
  targetOnlySamples: string[]
  /** Files the engine's own guard kills the process on. Named, never dropped. */
  skippedForParseBudget: string[]
}

// ── merge ─────────────────────────────────────────────────────────────────────
if (IS_MERGE) {
  // `.filter(a => a.endsWith(".json"))` also matched `--out=….json`, so the
  // merge tried to read its own OUTPUT path as an input shard and died
  // ENOENT. Flags are excluded by their leading dashes, not by their suffix.
  const parts = process.argv.slice(2).filter((a) => !a.startsWith("--") && a.endsWith(".json"))
  if (parts.length === 0) {
    console.error("groovy census --merge: no shard arguments. Refusing to report a merged census over an empty population.")
    process.exit(2)
  }
  const acc: Shard = {
    schema: "groovy-ontology-census/1", mode: MODE, repos: [], revisions: {}, corpusAdmitted: 0, drawn: 0,
    parsedThroughProductionEntry: 0, parseFailures: 0, filesWithErrorNodes: 0, errorNodes: 0, missingNodes: 0,
    symbols: 0, relationships: 0, importsChannel: { entries: 0, files: 0, staticEntries: 0, wildcardEntries: 0 },
    exportsChannel: { entries: 0, files: 0 }, wallMs: 0,
    types: {}, resolutionFileScope: {}, integrity: {}, symbolIntegrity: {}, r7samples: [], probes: {},
    grammarNodeTypes: {}, fileScopeTokens: {}, confidenceOutliers: [], neitherEndpointSamples: [], targetOnlySamples: [],
    skippedForParseBudget: [],
  }
  const add = (dst: Counter, src?: Counter) => { for (const [k, v] of Object.entries(src ?? {})) dst[k] = (dst[k] ?? 0) + v }
  for (const p of parts) {
    const s: Shard = JSON.parse(readFileSync(p, "utf8"))
    for (const r of s.repos) if (!acc.repos.includes(r)) acc.repos.push(r)
    for (const [k, v] of Object.entries(s.revisions)) acc.revisions[k] = v
    acc.corpusAdmitted = Math.max(acc.corpusAdmitted, s.corpusAdmitted)
    acc.drawn += s.drawn
    acc.parsedThroughProductionEntry += s.parsedThroughProductionEntry
    acc.parseFailures += s.parseFailures
    acc.filesWithErrorNodes += s.filesWithErrorNodes
    acc.errorNodes += s.errorNodes
    acc.missingNodes += s.missingNodes
    acc.symbols += s.symbols
    acc.relationships += s.relationships
    acc.importsChannel.entries += s.importsChannel.entries
    acc.importsChannel.staticEntries += s.importsChannel.staticEntries
    acc.importsChannel.wildcardEntries += s.importsChannel.wildcardEntries
    acc.exportsChannel.entries += s.exportsChannel.entries
    acc.wallMs += s.wallMs
    for (const t of ALL_TYPES) {
      const a = (acc.types[t] ??= { edges: 0, files: {}, fileTotal: 0, sampleFiles: [], confidence: {}, evidenceClass: {}, subLabel: {}, metadataKeySets: {}, lines: {} })
      const b = s.types[t]
      if (!b) continue
      a.edges += b.edges
      a.fileTotal += b.fileTotal
      add(a.files, b.files)
      add(a.confidence, b.confidence)
      add(a.evidenceClass, b.evidenceClass)
      add(a.subLabel, b.subLabel)
      add(a.metadataKeySets, b.metadataKeySets)
      add(a.lines, b.lines)
      for (const f of b.sampleFiles) if (a.sampleFiles.length < SAMPLE_CAP && !a.sampleFiles.includes(f)) a.sampleFiles.push(f)
      add((acc.resolutionFileScope[t] ??= {}), s.resolutionFileScope[t])
      add((acc.integrity[t] ??= {}), s.integrity[t])
    }
    for (const [k, v] of Object.entries(s.probes)) {
      const a = (acc.probes[k] ??= { occurrences: 0, files: {}, fileTotal: 0, samples: [] })
      a.occurrences += v.occurrences
      a.fileTotal += v.fileTotal
      add(a.files, v.files)
      for (const sm of v.samples) if (a.samples.length < SAMPLE_CAP * 2) a.samples.push(sm)
    }
    add(acc.grammarNodeTypes, s.grammarNodeTypes)
    add(acc.fileScopeTokens, s.fileScopeTokens)
    add(acc.symbolIntegrity, s.symbolIntegrity)
    for (const r of s.r7samples) if (acc.r7samples.length < 200) acc.r7samples.push(r)
    for (const r of s.confidenceOutliers) if (acc.confidenceOutliers.length < 200) acc.confidenceOutliers.push(r)
    for (const r of s.neitherEndpointSamples) if (acc.neitherEndpointSamples.length < 240) acc.neitherEndpointSamples.push(r)
    for (const r of s.targetOnlySamples) if (acc.targetOnlySamples.length < 240) acc.targetOnlySamples.push(r)
    for (const r of s.skippedForParseBudget) if (!acc.skippedForParseBudget.includes(r)) acc.skippedForParseBudget.push(r)
  }
  if (OUT) { writeFileSync(OUT, JSON.stringify(acc, null, 2)); console.log(`merged ${parts.length} shards -> ${OUT}`) }
  printReport(acc)
  process.exit(0)
}

// ── corpus ────────────────────────────────────────────────────────────────────
type File = { repo: string; dir: string; rel: string; abs: string; label: string; text: string }
const files: File[] = []
const revisions: Record<string, string> = {}
const SKIP = new Set(
  (process.env.BB_GROOVY_SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean),
)
/** Files the driver quarantined because the engine's own guard killed the
 *  process on them. Named, counted and reported: see `skippedForParseBudget`. */
const quarantined: string[] = []

// ── THE POPULATION, AND WHY IT IS NOT RE-DERIVED PER CHUNK ────────────────────
//
// `--list` names the paths this chunk must measure. The predecessor of this
// block ran the FULL derivation on every invocation and then filtered to the
// list:
//
//     for (const rel of tracked) {
//       const text = readFileSync(abs, "utf8")          <- every file, every chunk
//       if (detectLanguageFromPath(abs, text) !== "groovy") continue
//     }
//
// which is O(chunks x population): the driver drives 2,825 files in chunks of
// 10, so 283 chunk invocations each read all 2,825 files from disk and ran the
// detector over them, then threw away 99.6% of the work. Measured wall clock on
// this corpus: about 67 s per chunk with that overhead against about 3 s of
// actual measurement, so a full-corpus census was projected at 4+ hours instead
// of 25 minutes. The instrument was the cost.
//
// So a chunked invocation reads ONLY the listed paths, still runs the language
// detector on each (the filter stays a real filter, not a path-suffix guess),
// and takes the ADMITTED population count from the driver - which derives it
// once, correctly, with the detector - via BB_GROOVY_ADMITTED. A missing or
// unparseable admitted count is a FATAL in chunked mode, never a silent zero:
// `corpusAdmitted` is what every reported count is a fraction of, and a shard
// that reported 0 admitted would make a whole number read as a measurement of
// nothing.
const LIST = argOf("--list")
const ADMITTED_ENV = process.env.BB_GROOVY_ADMITTED
const chunked = LIST !== undefined

function admit(rel: string, dir: string, repo: string): void {
  const abs = path.join(dir, rel)
  let text: string
  try { if (statSync(abs).size > MAX_BYTES) return; text = readFileSync(abs, "utf8") } catch { return }
  if (detectLanguageFromPath(abs, text) !== "groovy") return
  if (SKIP.has(abs)) { quarantined.push(abs); return }
  files.push({ repo, dir, rel, abs, label: `${repo}/${rel}`, text })
}

for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { revisions[e] = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  if (chunked) {
    // Only the listed paths are read. `git ls-files` still runs because the
    // revision pin is part of every shard, and because a listed path that is not
    // tracked must not be silently admitted.
    const listed = new Set(readFileSync(LIST!, "utf8").split("\n").map((s) => s.trim()).filter(Boolean))
    const trackedSet = new Set(tracked)
    for (const abs of listed) {
      if (!abs.startsWith(dir + path.sep)) continue
      const rel = abs.slice(dir.length + 1)
      if (!trackedSet.has(rel)) continue
      admit(rel, dir, e)
    }
  } else {
    for (const rel of tracked) admit(rel, dir, e)
  }
}
files.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))

let corpusAdmitted = files.length
if (chunked) {
  const n = Number(ADMITTED_ENV)
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`groovy census: chunked mode (--list) needs BB_GROOVY_ADMITTED, and it is ${JSON.stringify(ADMITTED_ENV ?? null)}.`)
    console.error("Without it every count in this shard would be a fraction of a population it cannot name.")
    process.exit(2)
  }
  corpusAdmitted = n
}

// ── tree helpers ──────────────────────────────────────────────────────────────
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-groovy.wasm"))))

/** A plain identifier, or a dotted path — the two endpoint spellings Groovy
 *  writes. Char-code test, no regex. */
function isPlainEndpoint(s: string): boolean {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ok =
      (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) ||
      c === 95 || c === 46 || c === 36
    if (!ok) return false
  }
  return !(s.charCodeAt(0) >= 48 && s.charCodeAt(0) <= 57)
}
/** R7 placeholder literal. Adjudicated across scopes AFTER the walk, because
 *  a file-scope test convicts real declarations: Groovy code writes
 *  `Unknown`, `unknown`, `default` and `anonymous` as ordinary identifiers
 *  (`Unknown.class`, `Configuration.default`, `new Anonymous()`), so the
 *  discriminator is "the FILE DOES NOT DECLARE IT", plus a corpus pass. */
const PLACEHOLDER_LITERALS = new Set(["unknown", "undefined", "n/a", "todo", "fixme", "?", "", "<name>", "unnamed", "anonymous", "symbol", "(script)", "(anonymous)"])

const bump = (m: Counter, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by }

// ── accumulators ──────────────────────────────────────────────────────────────
const out: Shard = {
  schema: "groovy-ontology-census/1", mode: MODE, repos: REPOS, revisions, corpusAdmitted, drawn: files.length,
  parsedThroughProductionEntry: 0, parseFailures: 0, filesWithErrorNodes: 0, errorNodes: 0, missingNodes: 0,
  symbols: 0, relationships: 0,
  importsChannel: { entries: 0, files: 0, staticEntries: 0, wildcardEntries: 0 },
  exportsChannel: { entries: 0, files: 0 },
  wallMs: 0, types: {}, resolutionFileScope: {}, integrity: {}, symbolIntegrity: {},
  r7samples: [], probes: {}, grammarNodeTypes: {}, fileScopeTokens: {},
  confidenceOutliers: [], neitherEndpointSamples: [], targetOnlySamples: [],
  skippedForParseBudget: quarantined.slice().sort(),
}
for (const t of ALL_TYPES) {
  out.types[t] = { edges: 0, files: {}, fileTotal: 0, sampleFiles: [], confidence: {}, evidenceClass: {}, subLabel: {}, metadataKeySets: {}, lines: {} }
  out.resolutionFileScope[t] = { both: 0, sourceOnly: 0, targetOnly: 0, neither: 0 }
  out.integrity[t] = {
    emptySource: 0, emptyTarget: 0, placeholderSource: 0, placeholderTarget: 0,
    placeholderSourceDeclared: 0, placeholderTargetDeclared: 0,
    nonIdentSource: 0, nonIdentTarget: 0, selfLoop: 0,
  }
}
const probe = (kind: string, fileLabel: string, detail: string) => {
  const p = (out.probes[kind] ??= { occurrences: 0, files: {}, fileTotal: 0, samples: [] })
  p.occurrences++
  p.fileTotal++
  bump(p.files, fileLabel)
  if (p.samples.length < SAMPLE_CAP * 2) p.samples.push(`${fileLabel}: ${detail}`)
}

// ── INSTRUMENT B — grammar inventory ──────────────────────────────────────────
// B runs INSIDE the per-file worker, on the SAME tree instrument C reads. It was
// a separate pre-pass and that cost a third full parse of every corpus file:
// `parser.parse` is synchronous WASM, so 2,825 files x 2 extra parses dominated
// the wall clock of a run that has no other serial phase. One tree per file
// serves B and C; instrument A's parse is the analyzer's own and stays separate,
// because comparing the analyzer's result against a tree is the whole point.
const wall0 = Date.now()

/** The ERROR/MISSING tally and the node-type inventory, over one tree. */
function inventoryTree(root: any): void {
  const errs = (n: any) => {
    if (n.type === "ERROR") out.errorNodes++
    else if (n.type === "MISSING" || n.isMissing) out.missingNodes++
    for (let i = 0; i < n.childCount; i++) errs(n.child(i))
  }
  const v = (n: any) => {
    bump(out.grammarNodeTypes, n.type)
    // File-scope anonymous tokens: the export-construct question needs the
    // grammar's own KEYWORD vocabulary, not a text search. `exports` is a
    // JPMS keyword (`module M { exports p; }`) and Groovy has no module
    // system, so if `exports` were a token in THIS grammar it would appear
    // here. It is recorded, not assumed absent.
    if (n.parent === null && !n.isNamed) bump(out.fileScopeTokens, n.type)
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(root)
  const before = out.errorNodes + out.missingNodes
  errs(root)
  if (out.errorNodes + out.missingNodes > before) out.filesWithErrorNodes++
}

// ── INSTRUMENT C — parse-tree construct counts, independent of the analyzer ───
/** Every fact here is read off the tree. No analyzer output is consulted, so a
 *  disagreement between C and A is a real disagreement and not a shared bug in
 *  one place. It is NOT an independent GRAMMAR: both paths load the same
 *  `tree-sitter-groovy.wasm`, so a bug in the grammar is invisible here exactly
 *  as it is to the differential. That limit is stated rather than papered over. */
function runProbes(f: File, root: any): void {
  // ── exports ────────────────────────────────────────────────────────────────
  // THE question for this lane. Groovy's unit of importability is the FILE: any
  // top-level type in a .groovy compilation unit is importable by any other
  // Groovy file on the classpath. So the export surface is counted directly
  // from the root's named children, per visibility, and compared against what
  // the analyzer's `exports[]` array carries.
  const topLevelVis = (n: any): string => {
    const mods = n.childForFieldName?.("modifiers")
    if (!mods) return "(no modifiers node)"
    let sawPrivate = false
    let sawProtected = false
    let sawPublic = false
    for (let i = 0; i < mods.childCount; i++) {
      const c = mods.child(i)
      if (!c) continue
      if (c.type === "private") sawPrivate = true
      else if (c.type === "protected") sawProtected = true
      else if (c.type === "public") sawPublic = true
    }
    if (sawPrivate) return "private"
    if (sawProtected) return "protected"
    if (sawPublic) return "public"
    return "(modifiers, no visibility keyword)"
  }
  for (let i = 0; i < root.namedChildCount; i++) {
    const d = root.namedChild(i)
    if (!d) continue
    if (TYPE_DECL_TYPES.has(d.type)) {
      const nm = d.childForFieldName?.("name")
      probe("C:exports:top_level_type", f.label, `${nm?.text ?? "(unnamed)"} (${d.type}, ${topLevelVis(d)})`)
    } else if (d.type === "method_declaration" || d.type === "function_definition" || d.type === "constructor_declaration") {
      const nm = d.childForFieldName?.("name") ?? d.namedChild(0)
      probe("C:exports:top_level_member", f.label, `${nm?.text ?? "(unnamed)"} (${d.type})`)
    } else if (d.type === "package_declaration") {
      probe("C:package_declaration", f.label, d.text.slice(0, 60))
    } else if (d.type === "import_declaration") {
      let isStatic = false
      let isWildcard = false
      for (let k = 0; k < d.childCount; k++) {
        const c = d.child(k)
        if (!c) continue
        if (c.type === "static") isStatic = true
        else if (c.type === "asterisk") isWildcard = true
      }
      const mod = d.childForFieldName?.("path") ?? d.namedChild(1) ?? d.namedChild(0)
      probe("C:imports:import_declaration", f.label, `${mod?.text ?? "?"}${isStatic ? " (static)" : ""}${isWildcard ? " (wildcard)" : ""}`)
    }
  }
  // A `private` top-level type would be a non-exported unit. Counted so the
  // ruling about the export surface is measured, not argued.
  for (let i = 0; i < root.namedChildCount; i++) {
    const d = root.namedChild(i)
    if (!d || !TYPE_DECL_TYPES.has(d.type)) continue
    if (topLevelVis(d) === "private" || topLevelVis(d) === "protected") {
      probe("C:exports:non_public_top_level_type", f.label, `${d.childForFieldName?.("name")?.text ?? "?"} (${topLevelVis(d)})`)
    }
  }

  // ── the rest, per node type ────────────────────────────────────────────────
  const visit = (n: any): void => {
    switch (n.type) {
      case "superclass": probe("C:extends:superclass", f.label, n.text.slice(0, 60)); break
      case "extends_interfaces": probe("C:extends:extends_interfaces", f.label, n.text.slice(0, 60)); break
      case "super_interfaces": probe("C:implements:super_interfaces", f.label, n.text.slice(0, 60)); break
      case "object_creation_expression": probe("C:instantiates:object_creation_expression", f.label, n.text.slice(0, 60)); break
      case "method_invocation": probe("C:calls:method_invocation", f.label, String(n.childForFieldName?.("name")?.text ?? "?").slice(0, 50)); break
      case "juxt_function_call": probe("C:calls:juxt_function_call", f.label, String(n.childForFieldName?.("name")?.text ?? "?").slice(0, 50)); break
      case "leading_dot_call": probe("C:calls:leading_dot_call", f.label, String(n.childForFieldName?.("name")?.text ?? "?").slice(0, 50)); break
      case "explicit_constructor_invocation": probe("C:calls:explicit_constructor_invocation", f.label, n.text.slice(0, 40)); break
      case "field_access": probe("C:uses:field_access", f.label, String(n.childForFieldName?.("field")?.text ?? "?").slice(0, 50)); break
      case "array_access": probe("C:uses:array_access", f.label, n.text.slice(0, 50)); break
      case "interpolated_identifier": probe("C:uses:interpolated_identifier", f.label, n.text.slice(0, 40)); break
      case "string_interpolation": probe("C:uses:string_interpolation", f.label, n.text.slice(0, 40)); break
      case "scoped_type_identifier": probe("C:references:scoped_type_identifier", f.label, n.text.slice(0, 60)); break
      case "record_pattern": probe("C:references:record_pattern", f.label, n.text.slice(0, 50)); break
      case "method_reference": probe("C:references:method_reference", f.label, n.text.slice(0, 50)); break
      default: break
    }
    if (TYPE_DECL_TYPES.has(n.type)) {
      const parents = n.parent
      const inBody = parents !== null && (
        parents.type === "class_body" || parents.type === "interface_body" ||
        parents.type === "enum_body_declarations" || parents.type === "annotation_type_body"
      )
      probe(inBody ? "C:contains:member_declaration_in_body" : "C:contains:type_declaration_at_top", f.label,
        String(n.childForFieldName?.("name")?.text ?? "?").slice(0, 50))
    }
    if (n.type === "method_declaration" || n.type === "constructor_declaration") {
      const anns = n.childForFieldName?.("modifiers")
      let override = false
      if (anns) {
        for (let k = 0; k < anns.namedChildCount; k++) {
          const a = anns.namedChild(k)
          if (!a) continue
          if (a.type === "annotation" || a.type === "marker_annotation") {
            const txt = a.text
            if (txt.includes("Override")) override = true
          }
        }
      }
      if (override) probe("C:overrides:override_annotated", f.label, String(n.childForFieldName?.("name")?.text ?? "?").slice(0, 50))
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) visit(c)
    }
  }
  visit(root)
}

// ── INSTRUMENT A — production emission, per file ─────────────────────────────
/**
 * PER-FILE WALL-CLOCK BUDGET, and why this census needs one of its own.
 *
 * `parser.parse()` is synchronous WASM. When the pinned grammar loops on a
 * pathological input the event loop is blocked, so NOTHING can interrupt it
 * from inside the process: not a promise rejection, not the engine's
 * `parseWithTimeout` (its `parsePromise = parseRaw(...)` is evaluated eagerly at
 * engine.ts:1488, so the sync parse runs BEFORE the `setTimeout` at :1490 is
 * even armed), and not the census's own `parser.parse(f.text)` here, which is a
 * raw web-tree-sitter call on the census's own parser instance and is not the
 * engine's guarded path at all.
 *
 * Measured on this corpus: instrument A's chunk 0001 (40 files) completed in
 * under 45 s and chunk 0002 had not finished after 5 minutes, killed by hand.
 * The engine's `parseBomb` (engine.ts:1441) is a `setTimeout` too, so it can
 * only fire at a yield — it names a file but cannot bound one.
 *
 * So the bound has to be SYNCHRONOUS and it has to be checked at the one moment
 * the process is still alive to notice: immediately after each blocking call
 * returns. Exceeding the budget prints the file and exits NON-ZERO, which is the
 * signal `groovy-census-driver.mts` bisects on to isolate the file, names it in
 * `quarantine.txt`, and report it as `skippedForParseBudget`. Nothing is dropped
 * silently: the driver's own header states the same rule and the census refuses
 * to publish a shard it did not finish.
 */
const FILE_BUDGET_MS = Number(process.env.BB_GROOVY_FILE_BUDGET_MS ?? "30000")
function overBudget(what: string, f: File, ms: number): void {
  if (ms <= FILE_BUDGET_MS) return
  process.stderr.write(`[GROOVY-CENSUS-BUDGET] ${what} ${ms} ms on ${f.abs} (budget ${FILE_BUDGET_MS} ms)\n`)
  process.exit(3)
}

let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const fileT0 = Date.now()
    // The tree, ONCE per file, serving instrument B (grammar inventory) and
    // instrument C (construct counts). It is taken BEFORE the production entry
    // so a file the analyzer refuses still contributes its grammar facts — the
    // refusals are exactly the interesting files. The analyzer's own walk is a
    // SECOND walk of the SAME tree, so a shared grammar bug is invisible to
    // both; that limit is stated, not claimed away.
    let tree: any
    const t0 = Date.now()
    try { tree = parser.parse(f.text) } catch { tree = undefined }
    overBudget("direct parse", f, Date.now() - t0)
    if (tree) { inventoryTree(tree.rootNode); runProbes(f, tree.rootNode) }

    let r: any
    const t1 = Date.now()
    try { r = await parseFile(f.abs, f.dir) } catch { out.parseFailures++; tree?.delete?.(); continue }
    overBudget("production parseFile", f, Date.now() - t1)
    out.parsedThroughProductionEntry++
    tree?.delete?.()

    const symNames = new Set<string>()
    for (const s of r?.symbols ?? []) {
      if (typeof s?.name !== "string") { bump(out.symbolIntegrity, "nonStringName"); continue }
      if (s.name.length === 0) bump(out.symbolIntegrity, "emptyName")
      if (PLACEHOLDER_LITERALS.has(s.name.trim().toLowerCase())) bump(out.symbolIntegrity, `placeholderName:${s.name}`)
      if (s.kind === undefined || s.kind === null || String(s.kind).length === 0 || String(s.kind) === "unknown") {
        bump(out.symbolIntegrity, `emptyOrUnknownKind:${String(s.kind)}`)
      }
      symNames.add(s.name)
    }
    out.symbols += (r?.symbols ?? []).length
    out.relationships += (r?.relationships ?? []).length

    // imports[] — the SEPARATE channel. Counted here because a type being
    // absent from the relationship tally while imports[] is non-zero is NOT a
    // defect (archive/docs-pre-consolidation/analyzers-REVIEW-2026-10-04.md §1).
    const imps = r?.imports ?? []
    if (imps.length) out.importsChannel.files++
    out.importsChannel.entries += imps.length
    for (const im of imps) {
      if (im?.metadata?.isStatic) out.importsChannel.staticEntries++
      if (im?.metadata?.isWildcard) out.importsChannel.wildcardEntries++
    }

    // exports[] — the third channel. `ParseResult.exports` is declared
    // optional (src/ast/types.ts:222), `engine.ts:1831` forwards it and
    // `pool-worker.ts:1196` forwards it again, and NOTHING in src/ reads it
    // back. Measured here so "the analyzer emits exports" and "exports reaches
    // the graph" cannot be confused for one number.
    const exps = r?.exports ?? []
    if (exps.length) out.exportsChannel.files++
    out.exportsChannel.entries += exps.length

    for (const x of r?.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const row = out.types[t]
      row.edges++
      row.fileTotal++
      bump(row.files, f.label)
      if (row.sampleFiles.length < SAMPLE_CAP && !row.sampleFiles.includes(f.label)) row.sampleFiles.push(f.label)
      const conf = String(x.confidence ?? "undefined")
      bump(row.confidence, conf)
      bump(row.lines, x.line_number === null || x.line_number === undefined ? "(no line)" : "(has line)")
      if (typeof x.confidence === "number" && x.confidence < 0.7 && out.confidenceOutliers.length < 120) {
        out.confidenceOutliers.push(`${t} conf=${x.confidence} ${f.label} L${x.line_number ?? "?"} ${JSON.stringify(String(x.source ?? ""))} -> ${JSON.stringify(String(x.target ?? ""))}`)
      }
      bump(row.evidenceClass, String(x.metadata?.evidenceClass ?? "(none)"))
      bump(row.subLabel, String(x.metadata?.relationshipType ?? "(none)"))
      const mk = Object.keys(x.metadata ?? {}).filter((k) => k !== "evidenceClass" && k !== "relationshipType").sort().join("+") || "(none)"
      bump(row.metadataKeySets, mk)
      const src = String(x.source ?? "")
      const tgt = String(x.target ?? "")
      const ig = out.integrity[t]
      if (src.length === 0) ig.emptySource++
      if (tgt.length === 0) ig.emptyTarget++
      const srcPh = PLACEHOLDER_LITERALS.has(src.trim().toLowerCase())
      const tgtPh = PLACEHOLDER_LITERALS.has(tgt.trim().toLowerCase())
      if (srcPh) { if (symNames.has(src)) ig.placeholderSourceDeclared++ ; else { ig.placeholderSource++; if (out.r7samples.length < 120) out.r7samples.push(`${t} source=${JSON.stringify(src)} ${f.label}`) } }
      if (tgtPh) { if (symNames.has(tgt)) ig.placeholderTargetDeclared++ ; else { ig.placeholderTarget++; if (out.r7samples.length < 120) out.r7samples.push(`${t} target=${JSON.stringify(tgt)} ${f.label}`) } }
      if (!isPlainEndpoint(src)) ig.nonIdentSource++
      if (!isPlainEndpoint(tgt)) ig.nonIdentTarget++
      if (src.length > 0 && src === tgt) ig.selfLoop++
      const res = out.resolutionFileScope[t]
      const sb = symNames.has(src)
      const tb = symNames.has(tgt)
      if (sb && tb) res.both++
      else if (sb) res.sourceOnly++
      else if (tb) res.targetOnly++
      else {
        res.neither++
        if (out.neitherEndpointSamples.length < 160) out.neitherEndpointSamples.push(`${t} ${f.label} ${JSON.stringify(src)} -> ${JSON.stringify(tgt)}`)
      }
      if (!tb && out.targetOnlySamples.length < 160) out.targetOnlySamples.push(`${t} ${f.label} tgt=${JSON.stringify(tgt)}`)
    }
    overBudget("whole file (B + C + production)", f, Date.now() - fileT0)
  }
}
await Promise.all(Array.from({ length: Number(process.env.BB_GROOVY_CENSUS_WORKERS ?? "6") }, () => worker()))
out.wallMs = Date.now() - wall0

if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2))

// ── report ────────────────────────────────────────────────────────────────────
function pct(a: number, b: number): string {
  if (b === 0) return "n/a"
  return `${((a / b) * 100).toFixed(1)}%`
}
function printReport(s: Shard): void {
  console.log(`\nGROOVY ONTOLOGY CENSUS [${s.mode}]`)
  console.log(`population: repos ${s.repos.join(",")}  admitted ${s.corpusAdmitted} tracked .groovy/.gradle files  drawn ${s.drawn}`)
  for (const [k, v] of Object.entries(s.revisions)) console.log(`  ${k} @ ${v}`)
  console.log(`parse: production entry ok ${s.parsedThroughProductionEntry}/${s.drawn}  failures ${s.parseFailures}`)
  console.log(`grammar: ${Object.keys(s.grammarNodeTypes).length} distinct node types over the drawn corpus; ${s.filesWithErrorNodes} files carry ERROR/MISSING (${s.errorNodes} ERROR, ${s.missingNodes} MISSING)`)
  console.log(`symbols ${s.symbols}  relationships ${s.relationships}  wall ${s.wallMs} ms`)
  if (s.skippedForParseBudget.length) {
    console.log(`skipped for parse budget (${s.skippedForParseBudget.length} of ${s.corpusAdmitted} admitted): ${s.skippedForParseBudget.join(", ")}`)
  }
  console.log(`imports[] channel: ${s.importsChannel.entries} entries in ${s.importsChannel.files} files (${s.importsChannel.staticEntries} static, ${s.importsChannel.wildcardEntries} wildcard)`)
  console.log(`exports[] channel: ${s.exportsChannel.entries} entries in ${s.exportsChannel.files} files`)

  console.log(`\n── A. PRODUCTION EMISSION, per type (population: ${s.drawn} files) ─────────────────────────────`)
  console.log(`${"type".padEnd(13)}${"edges".padStart(9)}${"files".padStart(8)}   confidence / evidenceClass`)
  for (const t of ALL_TYPES) {
    const r = s.types[t]
    const conf = Object.entries(r.confidence).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
    const ec = Object.entries(r.evidenceClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
    console.log(`${t.padEnd(13)}${String(r.edges).padStart(9)}${String(Object.keys(r.files).length).padStart(8)}   ${conf} | ${ec}`)
  }
  console.log(`\nsub-label (metadata.relationshipType) per type:`)
  for (const t of ALL_TYPES) {
    const sub = s.types[t].subLabel
    if (Object.keys(sub).length === 0) continue
    console.log(`  ${t.padEnd(13)} ${Object.entries(sub).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
  }
  console.log(`\nline_number present per type:`)
  for (const t of ALL_TYPES) {
    const l = s.types[t].lines
    if (Object.keys(l).length === 0) continue
    console.log(`  ${t.padEnd(13)} ${Object.entries(l).map(([k, v]) => `${k}:${v}`).join("  ")}`)
  }

  console.log(`\n── q5 RESOLVED (both endpoints bind to a symbol THIS file declares) ─────────────────────────────`)
  for (const t of ALL_TYPES) {
    const r = s.resolutionFileScope[t]
    const total = r.both + r.sourceOnly + r.targetOnly + r.neither
    if (total === 0) continue
    console.log(`  ${t.padEnd(13)} both ${String(r.both).padStart(7)} ${pct(r.both, total).padStart(7)}   source-only ${String(r.sourceOnly).padStart(6)}   target-only ${String(r.targetOnly).padStart(6)}   neither ${String(r.neither).padStart(7)} ${pct(r.neither, total).padStart(7)}`)
  }

  console.log(`\n── R7 ENDPOINT INTEGRITY ────────────────────────────────────────────────────────────`)
  for (const t of ALL_TYPES) {
    const g = s.integrity[t]
    const interesting = Object.entries(g).filter(([, v]) => v > 0)
    if (interesting.length === 0) continue
    console.log(`  ${t.padEnd(13)} ${interesting.map(([k, v]) => `${k}:${v}`).join("  ")}`)
  }
  console.log(`  symbols: ${Object.entries(s.symbolIntegrity).map(([k, v]) => `${k}:${v}`).join("  ") || "(clean)"}`)
  if (s.r7samples.length) {
    console.log(`  R7 samples (first 12):`)
    for (const r of s.r7samples.slice(0, 12)) console.log(`    ${r}`)
  }

  console.log(`\n── B. GRAMMAR INVENTORY vs "node types that would mean it" ────────────────────────────`)
  for (const t of ALL_TYPES) {
    const want = NODE_TYPES_THAT_WOULD_MEAN_IT[t]
    const have = want.filter((w) => s.grammarNodeTypes[w])
    console.log(`  ${t.padEnd(13)} ${String(want.length).padStart(2)} candidates, present: ${have.length ? have.map((w) => `${w}(${s.grammarNodeTypes[w]})`).join(" ") : "NONE"}`)
  }
  const nodeTypesWithExport = Object.keys(s.grammarNodeTypes).filter((n) => n.includes("export") || n.includes("module"))
  console.log(`  any grammar node type whose name contains "export" or "module": ${nodeTypesWithExport.length ? nodeTypesWithExport.map((n) => `${n}(${s.grammarNodeTypes[n]})`).join(" ") : "NONE over " + Object.keys(s.grammarNodeTypes).length + " node types"}`)

  console.log(`\n── C. PARSE-TREE CONSTRUCT COUNTS (independent of the analyzer's walk) ───────────────`)
  for (const k of Object.keys(s.probes).sort()) {
    const p = s.probes[k]
    console.log(`  ${k.padEnd(46)} ${String(p.occurrences).padStart(8)} occurrences  ${String(Object.keys(p.files).length).padStart(6)} files`)
    for (const sm of p.samples.slice(0, 2)) console.log(`      ${sm}`)
  }

  console.log(`\nfile-scope anonymous tokens (the grammar's own keyword vocabulary at root): ${Object.keys(s.fileScopeTokens).length} distinct`)
  const interestingTokens = Object.entries(s.fileScopeTokens).filter(([k]) => k.includes("export") || k.includes("open") || k.includes("module") || k.includes("requires") || k.includes("uses"))
  console.log(`  of which export/module-flavoured: ${interestingTokens.length ? interestingTokens.map(([k, v]) => `${k}:${v}`).join("  ") : "NONE"}`)

  console.log(`\nsub-0.7 confidence edges (contract §4: heuristic, countable): ${s.confidenceOutliers.length} sampled of ${Object.entries(s.types).reduce((n, [, r]) => n + r.edges, 0)}`)
  for (const c of s.confidenceOutliers.slice(0, 8)) console.log(`    ${c}`)
  if (OUT) console.log(`\nwrote ${OUT}`)
}
printReport(out)