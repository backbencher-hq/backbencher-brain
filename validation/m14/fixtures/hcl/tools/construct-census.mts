/**
 * HCL WHOLE-CORPUS CONSTRUCT CENSUS — the instrument that decides, for each of the ten
 * relationship types, whether HCL can EXPRESS the construct and whether it OCCURS on the
 * corpus we actually have.
 *
 * ## Why a whole-corpus census and not the firing sample
 *
 * `bun script/m14/firing-check.mjs HCL` reads 120 files drawn by even stride from ONE repo
 * (terragrunt) and reports FIVE types fired, with `calls` and `overrides` SILENT. This
 * programme's rule-book §1 is that a sample can never certify absence, and the HCL lane is the
 * live case: the lane's own fixtures record `calls` edges (a `function "x"` declaration plus a
 * same-file call, docker-bake) and `overrides` edges (Terraform `override_*` blocks carrying a
 * `target`) — neither of which exists anywhere in the terragrunt stride. A SILENT column built
 * from a one-repo sample is a fact about those 120 files, not about the language.
 *
 * So this walks the WHOLE admitted population: every git-tracked `.tf`/`.tfvars`/`.hcl`/`.tofu`
 * file under the corpus root, under the engine's own 1 MiB admission cap.
 *
 * ## The two evidence classes it feeds (HANDOFF rule-book §6)
 *
 *   grammar-absence  a node-type/keyword inventory — the language cannot express it;
 *                    LEAVES the applicable denominator.
 *   zero-sites       the construct exists but occurs 0× in our corpus; STAYS IN.
 *
 * A ruling without a count is prose, so every candidate below is counted on the corpus AND
 * tested against the pinned grammar's own vocabulary (`grammars/tree-sitter-hcl/src/node-types.json`,
 * the `vendoredSource` of the spec's grammarPin):
 *
 *   grammar inventory   every named node type, every field name, every literal token the pinned
 *                       grammar declares — searched for the candidate vocabulary of each type.
 *   keyword inventory   the COMPLETE block-type and attribute-key vocabulary the corpus writes
 *                       (not a search for a preconceived word: every distinct block header and
 *                       every distinct attribute key is enumerated, then the candidate
 *                       vocabulary is tested against that set).
 *   construct counts    function calls, function-declaration blocks, override blocks,
 *                       resource/data blocks, object/tuple literals.
 *   edge tally          the PRODUCTION path (`engine.parseFile`, the arbiter's path) over every
 *                       file: edges and files per relationship type.
 *
 * ## The control (rule-book §7: a guard with no live hits must be shown firing on a planted case)
 *
 * A census that reports `0` for everything is indistinguishable from a broken probe. The control
 * document here is GENERATED FROM the candidate vocabulary itself, parsed through the same
 * pinned grammar, and the run EXITS 3 unless every planted keyword is seen as a block type and
 * as an attribute key, every planted construct is counted, and the production path emits the
 * planted `calls`/`overrides`/`contains` edges. So a corpus zero below is a zero the probe could
 * have seen through.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/hcl/tools/construct-census.mts
 *   BB_HCL_CENSUS_LIMIT=200 npx tsx …   # bounded draw when the machine is loaded
 *   BB_HCL_CENSUS_OUT=… npx tsx …       # where the JSON artefact lands
 *   BB_HCL_CENSUS_EDGES=1 npx tsx …     # ALSO run the production path over every file (slow)
 *
 * ## Two passes, and why the cheap one is the default
 *
 * The TREE pass is the instrument the evidence classes rest on: it enumerates the grammar's
 * vocabulary and the corpus's complete block-type / attribute-key space, and counts the
 * constructs each silent type would need. It is one `parser.parse` per file.
 *
 * The EDGE pass is the `engine.parseFile` pass that answers "does it FIRE", and it is roughly an
 * order of magnitude more expensive (it re-parses, walks for ERROR nodes, builds symbols and
 * edges). It is therefore OFF by default and enabled with `BB_HCL_CENSUS_EDGES=1` — on a machine
 * shared by 20+ agents, the class-deciding measurement should not have to wait behind the
 * firing measurement. The CONTROL always runs the production path on the planted document, so
 * this instrument is never claiming a production-path fact it has not exercised.
 *
 * ## Why this file lives in `tools/` and NOT at the top of the fixtures directory
 *
 * `script/m14/completeness-inventory.ts` (`emittedKinds`) reads EVERY non-`.json` file at the TOP
 * LEVEL of a lane's fixtures directory, runs `ASTEngine.parseFile` on it — which detects the
 * language from the PATH — and counts the resulting relationship types as the LANE's emitted
 * kinds. A `.mts` census script placed there is parsed as TypeScript, and its
 * `calls`/`imports`/`references` edges are counted as HCL emissions. This lane already paid for
 * that lesson once (the prior wave's four harnesses produced a phantom `instantiates` for HCL and
 * were moved to `validation/m14/measurements/hcl/`), so this instrument lives one level down,
 * where `readdirSync(dir)` + `isFile()` does not reach it. Measured both ways: at the top level
 * the scan reads it (`calls contains imports references uses` from TypeScript), under `tools/`
 * it is not read at all.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024 // the engine's own admission cap (PY-19 cut at 1 MiB)
const LIMIT = Number(process.env.BB_HCL_CENSUS_LIMIT ?? 0)
/** The production-path edge tally is opt-in: see "Two passes" in the header. */
const EDGES = process.env.BB_HCL_CENSUS_EDGES === "1"
const OUT = process.env.BB_HCL_CENSUS_OUT ?? path.join(ROOT, "validation/m14/fixtures/hcl/construct-census.current.json")
const CONTROL_DIR = path.join(ROOT, ".tmp-hcl")
const EXTENSIONS = [".tf", ".tfvars", ".hcl", ".tofu"]

const { parseFile, getParser } = await import(`${ROOT}/src/ast/engine.ts`)
const { RelationshipType } = await import(`${ROOT}/src/ast/types.ts`)
const ALL_TYPES: string[] = [...new Set(Object.values(RelationshipType) as string[])]

/** Candidate vocabulary. NOT regexes and NOT source reading: literal token lists tested against
 *  the grammar's own declared vocabulary and against the corpus's complete keyword space. */
const CANDIDATES: Record<string, { grammar: string[]; keywords: string[]; note: string }> = {
  calls: {
    grammar: ["call", "calls", "function_call", "call_expression", "invocation", "invoke", "apply"],
    keywords: ["call", "calls", "callee", "invoke", "invocation"],
    note: "HCL's call syntax is `function_call` (the analyzer's own gate for `calls`).",
  },
  extends: {
    grammar: ["extends", "extend", "inherits", "inheritance", "base", "base_class", "super", "superclass", "parent", "derives", "derive", "mixin", "trait", "prototype"],
    keywords: ["extends", "extend", "inherits", "inheritance", "base", "super", "superclass", "parent", "derives", "mixin", "trait", "prototype"],
    note: "a supertype clause: one declaration naming another as its base.",
  },
  implements: {
    grammar: ["implements", "implement", "implementation", "interface", "protocol", "trait", "impl", "satisfies"],
    keywords: ["implements", "implement", "implementation", "interface", "protocol", "trait", "impl", "satisfies"],
    note: "interface satisfaction: a declaration naming a contract it fulfils.",
  },
  overrides: {
    grammar: ["override", "overrides", "overridden", "virtual", "abstract", "super"],
    keywords: ["override", "overrides", "override_resource", "override_data", "override_module", "virtual", "abstract"],
    note: "Terraform's test framework spells it `override_resource`/`override_data`/`override_module`.",
  },
  instantiates: {
    grammar: ["new", "instantiate", "instantiates", "instantiation", "constructor", "ctor", "alloc", "construct", "class", "struct", "type_declaration"],
    keywords: ["new", "instantiate", "instantiates", "instantiation", "constructor", "ctor", "construct"],
    note: "object construction of a declared type; a `resource` block is a declaration, not an expression.",
  },
  contains: {
    grammar: ["block", "body", "attribute", "object_elem"],
    keywords: ["contains"],
    note: "the container relation: present, and emitted.",
  },
  imports: {
    grammar: ["import", "include", "source", "module"],
    keywords: ["import", "imports", "include", "source"],
    note: "terragrunt `include` / module `source`: present, and emitted.",
  },
  exports: {
    grammar: ["export", "exports", "label"],
    keywords: ["export", "exports"],
    note: "the public surface of a module; emitted from top-level blocks.",
  },
  references: {
    grammar: ["variable_expr", "get_attr", "index", "identifier"],
    keywords: ["reference", "references"],
    note: "a project address read from an expression; emitted.",
  },
  uses: {
    grammar: ["identifier", "get_attr"],
    keywords: ["uses", "use"],
    note: "a builtin-rooted read (count/each/self/path/terraform); emitted.",
  },
}

// ------------------------------------------------------------------ grammar inventory
const NODE_TYPES = path.join(ROOT, "grammars/tree-sitter-hcl/src/node-types.json")
const grammarDoc = JSON.parse(readFileSync(NODE_TYPES, "utf8")) as any[]
const grammarTypes = new Set<string>()
const grammarFields = new Set<string>()
const grammarLiterals = new Set<string>()
for (const entry of grammarDoc) {
  if (typeof entry?.type === "string") grammarTypes.add(entry.type)
  if (entry?.named !== true && typeof entry?.type === "string") grammarLiterals.add(entry.type)
  if (entry?.fields && typeof entry.fields === "object") for (const k of Object.keys(entry.fields)) grammarFields.add(k)
}
const namedTypes = grammarDoc.filter((e) => e?.named === true && typeof e?.type === "string").map((e) => e.type)

// ------------------------------------------------------------------ tree helpers (no regex anywhere)
const kids = (n: any): any[] => { const o: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) o.push(c) } return o }
const walk = (n: any, fn: (x: any) => void): void => { const st = [n]; while (st.length) { const x = st.pop(); fn(x); const cs = kids(x); for (let i = cs.length - 1; i >= 0; i--) st.push(cs[i]) } }
const textOf = (n: any): string => String(n?.text ?? "")

/** The first child identifier of a `block` node is its block TYPE; the string literals after it are labels. */
function blockHeader(node: any): { type: string; labels: string[] } | null {
  const cs = kids(node)
  if (cs.length === 0) return null
  const head = cs[0]
  if (head.type !== "identifier") return null
  const labels: string[] = []
  for (let i = 1; i < cs.length; i++) if (cs[i].type === "string_lit" || cs[i].type === "quoted_template") labels.push(textOf(cs[i]))
  return { type: textOf(head), labels }
}

type TreeCensus = {
  nodeTypes: Map<string, number>
  blockTypes: Map<string, number>
  attrKeys: Map<string, number>
  nodes: number
  functionCalls: number
  callees: Map<string, number>
  functionDecls: number
  functionDeclSites: string[]
  functionDeclFiles: Set<string>
  overrideBlocks: number
  overrideBlockFiles: Set<string>
  overrideFileList: string[]
  overrideWithTarget: number
  overrideKinds: Map<string, number>
  resourceBlocks: number
  resourceTypeLabels: Set<string>
  blocksInExpressionPosition: number
  objectLiterals: number
  tupleLiterals: number
  blocks: number
  /** Every site where a CANDIDATE word occurs as a block type or an attribute key. A candidate
   *  hit is not a ruling: `protocol = "tcp"` is data, not interface satisfaction. The sites are
   *  captured so the adjudication is over named files, not over the word's existence. */
  candidateSites: Array<{ word: string; kind: "block-type" | "attribute-key"; file: string; line: number; text: string }>
  /** Which files each candidate word occurs in. A count without a population is not evidence:
   *  `inherits` 44 times is one DSL spelled in one file family, or it is a language-wide construct,
   *  and only the file set can say which. */
  candidateWordFiles: Map<string, Set<string>>
}
const newTreeCensus = (): TreeCensus => ({
  nodeTypes: new Map(), blockTypes: new Map(), attrKeys: new Map(), nodes: 0, functionCalls: 0,
  callees: new Map(), functionDecls: 0, functionDeclSites: [], functionDeclFiles: new Set(),
  overrideBlocks: 0, overrideBlockFiles: new Set(), overrideFileList: [],
  overrideWithTarget: 0, overrideKinds: new Map(), resourceBlocks: 0, resourceTypeLabels: new Set(),
  blocksInExpressionPosition: 0, objectLiterals: 0, tupleLiterals: 0, blocks: 0, candidateSites: [],
  candidateWordFiles: new Map(),
})

/** Walk ONE file's tree. `fileLabel` is only used to name the files a construct occurs in. */
function censusTree(root: any, c: TreeCensus, fileLabel: string): void {
  walk(root, (n) => {
    c.nodes++
    c.nodeTypes.set(n.type, (c.nodeTypes.get(n.type) ?? 0) + 1)
    if (n.type === "function_call") {
      c.functionCalls++
      const id = kids(n).find((x: any) => x.type === "identifier")
      if (id) c.callees.set(textOf(id), (c.callees.get(textOf(id)) ?? 0) + 1)
    }
    if (n.type === "object") c.objectLiterals++
    if (n.type === "tuple") c.tupleLiterals++
    if (n.type === "attribute") {
      const key = kids(n).find((x: any) => x.type === "identifier")
      if (key) {
        const k = textOf(key)
        c.attrKeys.set(k, (c.attrKeys.get(k) ?? 0) + 1)
        if (CANDIDATE_WORD_SET.has(k)) {
          addCandidateSite(c, { word: k, kind: "attribute-key", file: fileLabel, line: n.startPosition.row + 1, text: textOf(n).slice(0, 120) })
          const set = c.candidateWordFiles.get(k) ?? new Set<string>()
          set.add(fileLabel)
          c.candidateWordFiles.set(k, set)
        }
      }
    }
    if (n.type === "block") {
      c.blocks++
      // A `block` inside an `expression` would be a construction-shaped expression; HCL's grammar
      // cannot produce one, and this measures that rather than asserting it.
      if (inExpressionPosition(n)) c.blocksInExpressionPosition++
      const h = blockHeader(n)
      if (!h) return
      c.blockTypes.set(h.type, (c.blockTypes.get(h.type) ?? 0) + 1)
      if (CANDIDATE_WORD_SET.has(h.type)) {
        addCandidateSite(c, { word: h.type, kind: "block-type", file: fileLabel, line: n.startPosition.row + 1, text: textOf(n).slice(0, 120) })
        const set = c.candidateWordFiles.get(h.type) ?? new Set<string>()
        set.add(fileLabel)
        c.candidateWordFiles.set(h.type, set)
      }
      // `function "name" { … }` (docker-bake) and `func "name" { … }` (Terraform 1.8+) are the
      // ecosystem's function-DECLARATION spellings; both are ordinary one-label blocks.
      if ((h.type === "function" || h.type === "func") && h.labels.length > 0) {
        c.functionDecls++
        c.functionDeclFiles.add(fileLabel)
        if (c.functionDeclSites.length < 20) c.functionDeclSites.push(`${fileLabel}:${h.type} ${h.labels[0]}`)
      }
      if (h.type.startsWith("override")) {
        c.overrideBlocks++
        c.overrideBlockFiles.add(fileLabel)
        if (c.overrideFileList.length < 60) c.overrideFileList.push(fileLabel)
        c.overrideKinds.set(h.type, (c.overrideKinds.get(h.type) ?? 0) + 1)
        const hasTarget = kids(n).some((b: any) => {
          if (b.type !== "body") return false
          return walkFind(b, (x: any) => x.type === "attribute" && kids(x).some((k: any) => k.type === "identifier" && textOf(k) === "target"))
        })
        if (hasTarget) c.overrideWithTarget++
      }
      if (h.type === "resource" || h.type === "data") {
        c.resourceBlocks++
        if (h.labels.length > 0) c.resourceTypeLabels.add(h.labels[0].split('"').join(""))
      }
    }
  })
}
/** Is this node inside an `expression`? Parent chain, so one walk per file is enough. */
function inExpressionPosition(n: any): boolean {
  let p = n.parent
  while (p) { if (p.type === "expression") return true; p = p.parent }
  return false
}
/** Bounded site capture: 400 sites overall, 40 per candidate word, so no single word can swamp
 *  the artefact and the adjudication always has named sites to read. */
function addCandidateSite(c: TreeCensus, site: TreeCensus["candidateSites"][number]): void {
  if (c.candidateSites.length >= 400) return
  if (c.candidateSites.filter((s) => s.word === site.word).length >= 40) return
  c.candidateSites.push(site)
}
function walkFind(n: any, pred: (x: any) => boolean): boolean {
  let found = false
  walk(n, (x) => { if (!found && pred(x)) found = true })
  return found
}

// ------------------------------------------------------------------ THE CONTROL, generated from the vocabulary
const candidateWords: string[] = []
for (const spec of Object.values(CANDIDATES)) for (const w of spec.keywords) if (!candidateWords.includes(w)) candidateWords.push(w)
const controlWords: string[] = []
for (const spec of Object.values(CANDIDATES)) for (const w of spec.grammar) if (!controlWords.includes(w)) controlWords.push(w)
/** Every keyword candidate, for the site capture in `censusTree` (filled before any call). */
const CANDIDATE_WORD_SET = new Set<string>(candidateWords)

function controlDocument(): string {
  const lines: string[] = [
    "# PLANTED CONTROL — do not edit by hand; generated from CANDIDATES.keywords in",
    "# validation/m14/fixtures/hcl/construct-census.mts. Every keyword below is planted as a",
    "# block type AND as an attribute key so the enumerators must see all of them.",
  ]
  for (const w of candidateWords) lines.push(`${w} "control" {\n  planted = true\n}`)
  for (const w of candidateWords) lines.push(`${w} = "planted-attribute"`)
  lines.push(
    'function "double" {',
    "  params = [n]",
    "  result = n * 2",
    "}",
    "override_resource {",
    "  target = aws_instance.first",
    "  values = { ami = \"planted\" }",
    "}",
    'resource "aws_instance" "first" {',
    '  ami = "ami-planted"',
    "}",
    "locals {",
    "  doubled = double(21)",
    "  merged  = merge({ a = 1 }, { b = 2 })",
    "  obj     = { x = 1 }",
    "  tup     = [1, 2]",
    "}",
  )
  return lines.join("\n") + "\n"
}

const parser = await getParser("hcl")
const controlSrc = controlDocument()
const controlTree = newTreeCensus()
censusTree((await parser.parse(controlSrc, "control.tf")).rootNode, controlTree, "control.tf")
mkdirSync(CONTROL_DIR, { recursive: true })
const controlPath = path.join(CONTROL_DIR, "hcl-census-control.tf")
writeFileSync(controlPath, controlSrc)
const controlEdges: Record<string, number> = {}
try {
  const res: any = await parseFile(controlPath, controlSrc)
  for (const r of res.relationships ?? []) {
    const t = r.relationshipType ?? r.type
    if (t) controlEdges[t] = (controlEdges[t] ?? 0) + 1
  }
} catch (e) { controlEdges["__THREW__"] = 1 }

// The MATCHER control: the same membership test used for the real vocabularies must report every
// planted word when the vocabulary set is built from the words themselves.
const matcherControl: Record<string, boolean> = {}
for (const [t, spec] of Object.entries(CANDIDATES)) {
  const planted = new Set(spec.grammar.concat(spec.keywords))
  matcherControl[t] = spec.grammar.every((w) => planted.has(w)) && spec.keywords.every((w) => planted.has(w))
}

const controlFailures: string[] = []
for (const w of candidateWords) {
  if ((controlTree.blockTypes.get(w) ?? 0) < 1) controlFailures.push(`keyword \`${w}\` planted as a BLOCK TYPE was not seen by the block-type enumerator`)
  if ((controlTree.attrKeys.get(w) ?? 0) < 1) controlFailures.push(`keyword \`${w}\` planted as an ATTRIBUTE KEY was not seen by the attribute-key enumerator`)
}
if (controlTree.functionDecls < 1) controlFailures.push("planted `function \"double\"` declaration was not counted")
if (controlTree.functionCalls < 2) controlFailures.push(`planted function calls counted ${controlTree.functionCalls}, expected >= 2`)
if (controlTree.overrideBlocks < 1) controlFailures.push("planted `override_resource` block was not counted")
if (controlTree.overrideWithTarget < 1) controlFailures.push("planted override block carrying `target` was not counted")
if (controlTree.resourceBlocks < 1) controlFailures.push("planted `resource` block was not counted")
if ((controlEdges["calls"] ?? 0) < 1) controlFailures.push("production path emitted no `calls` edge for the planted declaration+call")
if ((controlEdges["overrides"] ?? 0) < 1) controlFailures.push("production path emitted no `overrides` edge for the planted override block")
if ((controlEdges["contains"] ?? 0) < 1) controlFailures.push("production path emitted no `contains` edge for the planted document")
for (const [t, ok] of Object.entries(matcherControl)) if (!ok) controlFailures.push(`matcher control failed for \`${t}\``)
if (grammarTypes.size < 10) controlFailures.push(`grammar inventory read only ${grammarTypes.size} types from node-types.json`)
if (!grammarTypes.has("function_call")) controlFailures.push("grammar inventory did not see `function_call`, a token that IS in the pinned grammar")
if (controlFailures.length > 0) {
  console.error("FATAL: this census's own control did not fire. A corpus zero below would not be a measurement.")
  for (const f of controlFailures) console.error(`  - ${f}`)
  process.exit(3)
}

// ------------------------------------------------------------------ corpus discovery (incoming gate's admission rule)
function discover(): { files: string[]; total: number; repos: number; skippedLarge: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let skippedLarge = 0, entries: string[]
  try { entries = readdirSync(CR) } catch { return { files: [], total: 0, repos: 0, skippedLarge: 0 } }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      const lower = rel.toLowerCase()
      if (!EXTENSIONS.some((x) => lower.endsWith(x))) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) { skippedLarge++; continue } } catch { continue }
      found.push(abs); repos.add(name)
    }
  }
  found.sort()
  if (LIMIT > 0 && found.length > LIMIT) {
    const stride = Math.max(1, Math.floor(found.length / LIMIT))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < LIMIT; i += stride) picked.push(found[i])
    return { files: picked, total: found.length, repos: repos.size, skippedLarge }
  }
  return { files: found, total: found.length, repos: repos.size, skippedLarge }
}

const { files, total, repos, skippedLarge } = discover()
const corpus = newTreeCensus()
const edgesByType = new Map<string, { edges: number; files: number }>()
const degradedFiles: string[] = []
let parsed = 0, failed = 0, treeFiles = 0
const declaredAddresses = new Set<string>()

for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { failed++; continue }
  const rel = f.slice(CR.length + 1)
  // (1) the tree census, on the pinned grammar — the pass the evidence classes rest on.
  try { censusTree((await parser.parse(content, f)).rootNode, corpus, rel); treeFiles++ } catch { failed++; continue }
  if (treeFiles % 1000 === 0) console.log(`  … ${treeFiles}/${files.length} files (${corpus.nodes} nodes)`)
  // (2) the edge tally, on the PRODUCTION path the arbiter uses — OFF unless asked for.
  if (!EDGES) continue
  try {
    const res: any = await parseFile(f, content)
    const md = res?.metadata ?? {}
    if (md.fallback === true || md.analysisVersion === "2.0-basic-fallback") { degradedFiles.push(rel); continue }
    parsed++
    const seen = new Set<string>()
    for (const r of res.relationships ?? []) {
      const t = r.relationshipType ?? r.type
      if (!t) continue
      const rec = edgesByType.get(t) ?? { edges: 0, files: 0 }
      rec.edges++
      if (!seen.has(t)) { seen.add(t); rec.files++ }
      edgesByType.set(t, rec)
    }
    for (const s of res.symbols ?? []) {
      const addr = s?.metadata?.hclAddress
      if (typeof addr === "string") declaredAddresses.add(addr)
    }
  } catch { failed++ }
}

// ------------------------------------------------------------------ derived readings
/**
 * THE `extends` RESOLUTION PROBE. `inherits = ["_common"]` inside a docker-bake `target` block is
 * an inheritance-shaped construct: the value names OTHER DECLARATIONS in the same file. Whether
 * those names resolve is what separates a real `extends` site from a dangling string, so this
 * re-reads only the files the keyword inventory found `inherits` in and counts, per site, how many
 * named parents are declared as `target "<name>"` in the same file.
 */
function probeInherits(): any {
  const files = [...(corpus.candidateWordFiles.get("inherits") ?? new Set<string>())].sort()
  let sites = 0, namesTotal = 0, namesResolved = 0, filesWithATargetDecl = 0
  const unresolved: string[] = []
  const samples: string[] = []
  for (const rel of files) {
    let src: string
    try { src = readFileSync(path.join(CR, rel), "utf8") } catch { continue }
    let root: any
    try { root = parser.parse(src, rel).rootNode } catch { continue }
    const targets = new Set<string>()
    walk(root, (n) => {
      if (n.type !== "block") return
      const h = blockHeader(n)
      if (h && h.type === "target" && h.labels.length > 0) targets.add(h.labels[0].split('"').join(""))
    })
    if (targets.size > 0) filesWithATargetDecl++
    walk(root, (n) => {
      if (n.type !== "attribute") return
      const key = kids(n).find((x: any) => x.type === "identifier")
      if (!key || textOf(key) !== "inherits") return
      sites++
      for (const str of walkCollect(n, (x: any) => x.type === "string_lit")) {
        const parent = str.split('"').join("")
        namesTotal++
        if (targets.has(parent)) namesResolved++
        else {
          namesResolved += 0
          if (unresolved.length < 12) unresolved.push(`${rel}: inherits "${parent}" has no \`target "${parent}"\` in the same file`)
        }
      }
      if (samples.length < 8) samples.push(`${rel}:${n.startPosition.row + 1} ${textOf(n).slice(0, 90).split("\n").join(" ")}`)
    })
  }
  return { files: files.length, fileSamples: files.slice(0, 10), filesWithATargetDecl, sites, namesTotal, namesResolved, namesUnresolved: namesTotal - namesResolved, unresolvedSamples: unresolved, samples }
}
function walkCollect(n: any, pred: (x: any) => boolean): string[] {
  const out: string[] = []
  walk(n, (x) => { if (pred(x)) out.push(textOf(x)) })
  return out
}
const extendsProbe = probeInherits()

const hitsIn = (vocab: string[], set: Set<string>): string[] => vocab.filter((w) => set.has(w))
const countIn = (vocab: string[], m: Map<string, number>): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const w of vocab) { const n = m.get(w); if (n !== undefined) out[w] = n }
  return out
}
const byTypeReport: Record<string, any> = {}
for (const t of ALL_TYPES) {
  const spec = CANDIDATES[t] ?? { grammar: [], keywords: [], note: "" }
  const rec = edgesByType.get(t)
  byTypeReport[t] = {
    // `null` is "not measured in this run" (edges pass off), NEVER a zero. A zero that was not
    // measured is the one thing this programme does not allow to look like a number.
    edges: EDGES ? (rec?.edges ?? 0) : null,
    files: EDGES ? (rec?.files ?? 0) : null,
    grammarVocabularyHits: hitsIn(spec.grammar, grammarTypes).concat(hitsIn(spec.grammar, grammarFields)),
    corpusKeywordHits: countIn(spec.keywords, corpus.blockTypes),
    corpusAttributeKeyHits: countIn(spec.keywords, corpus.attrKeys),
    note: spec.note,
    evidenceClass: !EDGES ? "not-measured(edges pass off)"
      : rec && rec.edges > 0 ? "implemented+firing(corpus)"
        : hitsIn(spec.grammar, grammarTypes).length > 0 ? "grammar-expressible/no-edge"
          : "no-grammar-vocabulary",
  }
}

// `instantiates` candidate constructs, measured rather than argued: a `resource`/`data` block is
// a DECLARATION, so its type label is only resolvable if some site declares that label. The
// number below is how many of the distinct labels the corpus writes are declared addresses.
const resourceLabelsDeclared = [...corpus.resourceTypeLabels].filter((l) => declaredAddresses.has(l))

const top = (m: Map<string, number>, n: number): Record<string, number> =>
  Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n))

const artefact = {
  instrument: "validation/m14/fixtures/hcl/tools/construct-census.mts",
  generatedAt: new Date().toISOString(),
  corpusRoot: CR,
  admissionRule: "git-tracked, extension .tf/.tfvars/.hcl/.tofu, size <= 1 MiB (the engine's own cap)",
  population: { filesDiscovered: total, filesMeasured: files.length, filesTreeCensused: treeFiles, filesParsedForEdges: EDGES ? parsed : null, edgesPass: EDGES, filesFailed: failed, repos, skippedLarge, limit: LIMIT || null },
  grammarInventory: {
    source: "grammars/tree-sitter-hcl/src/node-types.json",
    namedTypes: namedTypes.length,
    namedTypeNames: [...namedTypes].sort(),
    allTypes: grammarTypes.size,
    fieldNames: [...grammarFields].sort(),
    literalTokens: grammarLiterals.size,
  },
  treeCensus: {
    namedNodes: corpus.nodes, namedNodeNote: "NAMED nodes only (the walk uses namedChild); anonymous tokens are excluded, so this is NOT comparable with a count that includes them",
    blocks: corpus.blocks, distinctBlockTypes: corpus.blockTypes.size,
    distinctAttributeKeys: corpus.attrKeys.size, functionCalls: corpus.functionCalls,
    distinctCallees: corpus.callees.size, topCallees: top(corpus.callees, 25),
    functionDeclarationBlocks: corpus.functionDecls, functionDeclarationSites: corpus.functionDeclSites,
    functionDeclarationFiles: [...corpus.functionDeclFiles],
    overrideBlocks: corpus.overrideBlocks, overrideBlockFiles: corpus.overrideBlockFiles.size,
    overrideFileSamples: corpus.overrideFileList,
    overrideBlocksWithTarget: corpus.overrideWithTarget, overrideKinds: Object.fromEntries(corpus.overrideKinds),
    resourceOrDataBlocks: corpus.resourceBlocks, distinctResourceTypeLabels: corpus.resourceTypeLabels.size,
    resourceTypeLabelsDeclaredAsAddresses: EDGES ? resourceLabelsDeclared.length : null,
    blocksInExpressionPosition: corpus.blocksInExpressionPosition,
    objectLiterals: corpus.objectLiterals, tupleLiterals: corpus.tupleLiterals,
    topBlockTypes: top(corpus.blockTypes, 30),
    observedNodeTypes: [...corpus.nodeTypes.keys()].sort(),
    candidateSites: corpus.candidateSites,
    candidateWordPopulations: Object.fromEntries([...corpus.candidateWordFiles.entries()].sort().map(([w, set]) => [w, {
      sites: (corpus.blockTypes.get(w) ?? 0) + (corpus.attrKeys.get(w) ?? 0),
      files: set.size,
      fileSamples: [...set].sort().slice(0, 8),
    }])),
  },
  extendsProbe,
  edgesByType: EDGES ? Object.fromEntries(edgesByType) : null,
  degraded: { files: degradedFiles.length, samples: degradedFiles.slice(0, 10) },
  byType: byTypeReport,
  control: {
    plantedKeywords: candidateWords.length,
    plantedGrammarWords: controlWords.length,
    keywordsSeenAsBlockType: candidateWords.filter((w) => (controlTree.blockTypes.get(w) ?? 0) > 0).length,
    keywordsSeenAsAttributeKey: candidateWords.filter((w) => (controlTree.attrKeys.get(w) ?? 0) > 0).length,
    functionDeclarations: controlTree.functionDecls, functionCalls: controlTree.functionCalls,
    overrideBlocks: controlTree.overrideBlocks, overrideBlocksWithTarget: controlTree.overrideWithTarget,
    resourceBlocks: controlTree.resourceBlocks, blocksInExpressionPosition: controlTree.blocksInExpressionPosition,
    productionPathEdges: controlEdges, matcherControl, failures: controlFailures,
  },
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(artefact, null, 2) + "\n")

console.log(`hcl construct census — population ${files.length}/${total} tracked files, ${repos} repos, ${corpus.nodes} NAMED nodes`)
console.log(`edges pass: ${EDGES ? "ON (engine.parseFile over every file)" : "OFF — `edges` below reads NOT MEASURED, not 0 (BB_HCL_CENSUS_EDGES=1 to run it)"}`)
console.log(`control: ${candidateWords.length} keywords planted as block types AND attribute keys; ` +
  `function decls ${controlTree.functionDecls}, override blocks ${controlTree.overrideBlocks}, ` +
  `production edges ${JSON.stringify(controlEdges)} — PASS (a corpus zero can be seen through)`)
console.log(`grammar: ${namedTypes.length} named node types, ${grammarTypes.size} total types, ${grammarFields.size} field names`)
for (const t of ALL_TYPES) {
  const r = byTypeReport[t]
  const edgeCell = r.edges === null ? "NOT MEASURED" : `${String(r.edges).padStart(7)} on ${String(r.files).padStart(4)} files`
  console.log(`  ${t.padEnd(13)} edges ${edgeCell} · ` +
    `grammarVocab ${JSON.stringify(r.grammarVocabularyHits)} · corpusKeywords ${JSON.stringify(r.corpusKeywordHits)} · ` +
    `attributeKeys ${JSON.stringify(r.corpusAttributeKeyHits)}`)
}
console.log(`constructs: function_call ${corpus.functionCalls} (${corpus.callees.size} distinct callees) · ` +
  `function decls ${corpus.functionDecls} · override blocks ${corpus.overrideBlocks} in ${corpus.overrideBlockFiles.size} files ` +
  `(${corpus.overrideWithTarget} with target) · resource/data blocks ${corpus.resourceBlocks} ` +
  `(${corpus.resourceTypeLabels.size} labels, ${resourceLabelsDeclared.length} declared as addresses)`)
console.log(`block nodes inside expression position: ${corpus.blocksInExpressionPosition} of ${corpus.blocks} blocks; ` +
  `object literals ${corpus.objectLiterals}, tuple literals ${corpus.tupleLiterals}`)
if (corpus.candidateSites.length > 0) {
  console.log(`candidate-word SITES (each one is data unless its own text says otherwise):`)
  for (const s of corpus.candidateSites.slice(0, 20)) console.log(`  ${s.kind.padEnd(13)} ${s.word.padEnd(16)} ${s.file}:${s.line}  ${s.text.split("\n").join(" ")}`)
  if (corpus.candidateSites.length > 20) console.log(`  … ${corpus.candidateSites.length - 20} more in the artefact`)
}
console.log(`candidate-word POPULATIONS (site count over file count):`)
for (const [w, set] of [...corpus.candidateWordFiles.entries()].sort()) {
  const n = (corpus.blockTypes.get(w) ?? 0) + (corpus.attrKeys.get(w) ?? 0)
  console.log(`  ${w.padEnd(18)} ${String(n).padStart(5)} sites in ${String(set.size).padStart(3)} files  e.g. ${[...set].sort().slice(0, 2).join(", ")}`)
}
console.log(`extends probe (docker-bake \`inherits\`): ${extendsProbe.sites} sites in ${extendsProbe.files} files, ` +
  `${extendsProbe.namesTotal} named parents, ${extendsProbe.namesResolved} resolved to a \`target\` declared in the same file, ` +
  `${extendsProbe.namesUnresolved} unresolved`)
for (const u of extendsProbe.unresolvedSamples.slice(0, 4)) console.log(`  unresolved: ${u}`)
console.log(`degraded ${degradedFiles.length}; full artefact -> ${OUT}`)
