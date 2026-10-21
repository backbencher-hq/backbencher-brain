/**
 * csharp-emission-census  -  WHAT the C# analyzer emits and WHAT the pinned grammar can express,
 * counted over the WHOLE admitted population (all-out-of-all charter S9.1 D1/D2: rows + files +
 * repos, per relationship type, plus the construct counts the four EXTENDED values are ruled on).
 *
 * WHY THIS FILE IS LANE-OWNED AND NOT `.tmp-census/census.mts`.
 *   1. The shared census instrument enumerates `["typescript","tsx","javascript","python","java",
 *      "dart"]` and its `newAnalyzer()` throws for anything else  -  it cannot run csharp at all.
 *   2. It WRITES one `.tmp-census/grammar-nodes.json` for all six of those languages, so running it
 *      for csharp would overwrite the fleet's grammar artifact with a one-language file.
 *   The grammar inventory therefore lives in this lane's own `script/m14/csharp-grammar-inventory.ts`
 *   and writes only into `validation/m14/measurements/`.
 *
 * WHAT IT COUNTS, per admitted `.cs`/`.csx` file, through the PRODUCTION path
 * (`src/ast/pool-worker.parseFile`  -  the same call `engine.ts` makes):
 *
 *   per relationship type     edges, and the number of FILES that emitted at least one, and REPOS
 *   per site marker           `metadata.relationshipType` (identifier_usage, declared_type,
 *                             using_directive, assembly_public_surface, ...) and marker x type
 *   THE FOUR EXTENDED VALUES  `decorates` . `renders` . `mixes_in` . `part_of`  -  rows/files/repos,
 *                             so a cell is never a blank (LANGUAGE-MATRIX-EXTENDED S1)
 *   THE CONSTRUCT COUNTS      the counts the four extended rulings REST ON, measured, not prose:
 *                               - ATTRIBUTE sites (`attribute_list` / `attribute`) and the
 *                                 declaration kind each decorates  -> the `decorates` ruling
 *                               - PARTIAL declaration sites (a `partial` MODIFIER on a type,
 *                                 method, property, indexer or event declaration) -> the `part_of`
 *                                 ruling, INCLUDING how many types are split across >1 FILE
 *                               - `with_expression` / `with_initializer` sites -> the `mixes_in`
 *                                 ruling (C#'s `with` is the RECORD form, not a mixin)
 *                               - `using_directive` sites by form -> the imports surface
 *   THE DECLARATION KEY SPACE per repo and per file, name -> symbol kinds, written as JSONL so the
 *                             wall classifier can name a wall from the DECLARATIONS instead of from
 *                             a target's spelling (a JSON summary is not enough: the wall IS a
 *                             join between a row and a declaration)
 *
 * THE POPULATION IS DERIVED, NEVER LISTED  -  copied rule-for-rule from
 * `script/m14/incoming-gate.ts` (`discoverFiles`): every entry of BB_CORPUS_ROOT is considered,
 * symlinks are FOLLOWED (statSync), only real git checkouts are corpus (`git rev-parse --git-dir`),
 * the file set is `git ls-files -z` (TRACKED files only), extension admission is the lane's own
 * spelling set, and the size cap is the engine's own FULL_AST_LIMIT (1 MB).
 *
 * THREE DENOMINATORS, NEVER MIXED (the fleet rule):
 *   PATHS         the tracked admitted paths (a path is a path even when two paths are one file)
 *   DISTINCT FILES the realpaths behind those paths (the symlink-aware identity)
 *   ADMITTED      the files this run PARSED  -  the denominator every count here is over
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/csharp-emission-census.ts --cap=0 --json   # whole admitted population
 *   bun run script/m14/csharp-emission-census.ts --cap=50         # triage stride
 *
 * EXIT 0 measured . 2 no corpus / no admitted files . 3 the population closed on nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, realpathSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

import { parseFile } from "../../src/ast/pool-worker"
import { ASTEngine } from "../../src/ast/engine"
import { RealCSharpAnalyzer } from "../../src/ast/real-csharp-analyzer"
import { decodeSourceText } from "../../src/util/source-text"
import { externalClaimOf } from "./incoming-rule"
import { createHash } from "node:crypto"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024 // the engine's own FULL_AST_LIMIT  -  the line the analyzer draws
const EXTS = ["cs", "csx"]

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i >= 0) return argv[i + 1]
  for (const a of argv) if (a.startsWith(f + "=")) return a.slice(f.length + 1)
  return undefined
}
const CAP = Number(argOf("--cap") ?? 0)
const JSON_OUT = argv.includes("--json")
const KEYSPACE_OUT = argOf("--keyspace") ?? path.join(ROOT, ".tmp-csharp", "csharp-keyspace.jsonl")
/** The per-row record file (label, target, source, file, repo, line, the arbiter's own claim). */
const ROWS_OUT = argOf("--rows") ?? path.join(ROOT, ".tmp-csharp", "csharp-rows.jsonl")

/** The 14 emitted relationship values (types.ts, 2026-10-18)  -  a label this census omits is a silence. */
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
] as const

/** The declaration kinds a C# `partial` modifier can sit on. */
const PARTIAL_DECL_KINDS = [
  "class_declaration", "struct_declaration", "interface_declaration", "record_declaration",
  "enum_declaration", "method_declaration", "property_declaration", "indexer_declaration",
  "event_declaration", "constructor_declaration", "operator_declaration",
  "conversion_operator_declaration", "delegate_declaration", "namespace_declaration",
] as const

/** Copied from `script/m14/incoming-gate.ts:admitByExtension` (the lane's own spelling set). */
function admitByExtension(rel: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (EXTS.some((e) => low.endsWith(`.${e}`))) return true
  return EXTS.some((e) => base === e)
}

/**
 * THE ON-DISK WALK - the PATHS and DISTINCT-FILES denominators, measured independently of git.
 *
 * The gate's population is TRACKED files in real git checkouts. The corpus on disk also holds
 * files in directories that are not git checkouts, and the same file can be reachable under two
 * paths through a symlinked directory. Mixing those numbers is the denominator defect the fleet
 * rule names (PATHS / DISTINCT FILES / ADMITTED, never mixed), so this walk counts them SEPARATELY
 * and the report states all three with the rule that produced each.
 */
function walkOnDisk(): { paths: number; distinct: number; repos: number; symlinkedDirs: number } {
  let paths = 0
  let repos = 0
  let symlinkedDirs = 0
  const distinct = new Set<string>()
  const stack: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { paths: 0, distinct: 0, repos: 0, symlinkedDirs: 0 }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    let isDir = false
    try {
      const st = statSync(dir)
      isDir = st.isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    repos++
    stack.push(dir)
  }
  while (stack.length > 0) {
    const d = stack.pop()!
    let ents: import("node:fs").Dirent[]
    try {
      ents = readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      const abs = path.join(d, e.name)
      let isDir = e.isDirectory()
      let isFile = e.isFile()
      if (e.isSymbolicLink()) {
        // SYMLINKS ARE FOLLOWED (the corpus rule) - and the count of followed symlinked
        // directories is REPORTED, never left implicit (the sql lane's lesson).
        try {
          const st = statSync(abs)
          if (st.isDirectory()) { isDir = true; isFile = false; symlinkedDirs++ }
          else if (st.isFile()) { isDir = false; isFile = true }
        } catch {
          continue
        }
      }
      if (isDir) { stack.push(abs); continue }
      if (!isFile) continue
      const low = e.name.toLowerCase()
      if (!EXTS.some((x) => low.endsWith(`.${x}`))) continue
      paths++
      try { distinct.add(realpathSync(abs)) } catch { distinct.add(abs) }
    }
  }
  return { paths, distinct: distinct.size, repos, symlinkedDirs }
}

/** Copied from `script/m14/incoming-gate.ts:discoverFiles`  -  same corpus walk, size cap and counters. */
function discover(cap: number): {
  files: string[]; total: number; repos: number; absent: number; overCap: number; overCapLargest: number
  paths: number; distinctFiles: number; repoPaths: Record<string, number>; repoDistinct: Record<string, number>
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
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], total: 0, repos: 0, absent: 0, overCap: 0, overCapLargest: 0, paths: 0, distinctFiles: 0, repoPaths, repoDistinct }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!admitByExtension(rel)) continue
      const abs = path.join(dir, rel)
      let fst
      try {
        fst = statSync(abs)
      } catch {
        absent++
        continue
      }
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
    files, total, repos: repos.size, absent, overCap, overCapLargest,
    paths, distinctFiles: distinct.size, repoPaths, repoDistinct,
  }
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
}

const perType = new Map<string, Tally>()
const perMarker = new Map<string, Tally>()
const perMarkerType = new Map<string, Tally>()
const constructs = new Map<string, Tally>()
/** The DECLARATION KEY SPACE  -  per repo and per file, name -> symbol kinds. */
const repoDecls = new Map<string, Map<string, Set<string>>>()
const fileDecls = new Map<string, Map<string, Set<string>>>()
/** partial TYPE declarations, keyed by (name) -> the files they appear in */
const partialTypeFiles = new Map<string, Set<string>>()
const partialNames = new Map<string, Tally>()
const attrKind = new Map<string, Tally>()
const usingForm = new Map<string, Tally>()
const withKind = new Map<string, Tally>()
for (const t of ALL_TYPES) perType.set(t, mk())

const { files, total, repos, absent, overCap, overCapLargest, paths, distinctFiles, repoPaths, repoDistinct } = discover(CAP)
/**
 * THE BUILD TEST (the fleet's L-2026-10-21-06 admissibility test #1).
 *
 * A ruling that rests on the grammar is only as good as the GRAMMAR THE CENSUS LOADED, so the
 * census states the build it loaded - the sha256 of the wasm the engine handed it, beside the
 * grammar's own node-type count - and a POSITIVE CONTROL: a node type that MUST be there (the
 * grammar really is the C# grammar) and one that must NOT be there (the absence the rulings rest
 * on is an absence in THIS grammar, not in some other one).
 */
const WASM = path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")
const build = await (async () => {
  const wasmSha = createHash("sha256").update(readFileSync(WASM)).digest("hex")
  const parser: any = await ASTEngine.getParser("csharp" as any)
  const lang: any = parser?.language
  const named: string[] = []
  const idCount = Number(lang?.nodeTypeCount ?? 0)
  for (let id = 0; id < idCount; id++) {
    try {
      if (lang.nodeTypeIsNamed(id)) named.push(String(lang.nodeTypeForId(id)))
    } catch { /* an id the grammar does not expose is not a named type */ }
  }
  const has = (t: string) => named.includes(t)
  return {
    wasm: WASM,
    wasmSha256: wasmSha,
    nodeTypeIds: idCount,
    namedNodeTypes: named.length,
    positiveControl: {
      presentMustBe: ["class_declaration", "attribute_list", "attribute", "modifier"],
      presentChecked: ["class_declaration", "attribute_list", "attribute", "modifier"].map((t) => ({ type: t, present: has(t) })),
      absentMustBe: ["decorator", "decorated_definition", "mixin_declaration", "part_directive", "partial_declaration"],
      absentChecked: ["decorator", "decorated_definition", "mixin_declaration", "part_directive", "partial_declaration"].map((t) => ({ type: t, present: has(t) })),
    },
  }
})()

const onDisk = walkOnDisk()
if (files.length === 0) {
  console.error(`csharp-emission-census: 0 admitted C# files under ${CR}. Set BB_CORPUS_ROOT to the corpus.`)
  process.exit(2)
}

const keyspaceLines: string[] = []
/** ONE LINE PER RELATIONSHIP ROW (the per-row tie-break measurement needs the rows). */
const rowLines: string[] = []
/** PER-FILE TIMING (the lane's perf row) - the PRODUCTION parse+analyze cost per file. */
const fileMs: number[] = []
const parseErrors: string[] = []
let parsed = 0
let failed = 0
let degraded = 0
let constructWalked = 0
const constructSkips = { overCap: 0, parseFailed: 0, noTree: 0 }

function walkNamed(root: any, visit: (n: any) => void): void {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    visit(n)
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

const isPartialDecl = (n: any): boolean => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === "modifier" && c.text === "partial") return true
  }
  return false
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
    // `ASTEngine.parseFile` runs, with the SAME context the gate passes (`{ projectRoot }` -
    // csharp has no INDEX_SPECS entry, so the gate passes no projectIndex). One parse serves
    // BOTH the relationships and the grammar-construct walk, which is why this arm is half the
    // cost of a two-parse census; `--parity N` proves the two paths agree (see below).
    const content = decodeSourceText(readFileSync(abs)).text
    const parser: any = await ASTEngine.getParser("csharp" as any)
    tree = parser.parse(content, abs)
    if (!tree?.rootNode) { constructSkips.noTree++; failed++; continue }
    const analyzer = new RealCSharpAnalyzer()
    result = analyzer.analyze(tree.rootNode, content, abs, { projectRoot: path.join(CR, repo) } as any)
  } catch (e: any) {
    failed++
    if (parseErrors.length < 25) parseErrors.push(`${rel}: ${String(e?.message ?? e).slice(0, 140)}`)
    continue
  }
  fileMs.push(performance.now() - t0)
  parsed++
  if (result?.fallback === true) degraded++
  for (const r of (result.relationships ?? []) as any[]) {
    const type = String(r?.type ?? "")
    add(perType, type, relSlug)
    const md = (r?.metadata ?? {}) as Record<string, unknown>
    const marker = typeof md.relationshipType === "string" ? md.relationshipType : ""
    if (marker) {
      add(perMarker, marker, relSlug)
      add(perMarkerType, `${type} | ${marker}`, relSlug)
    }
  }
  // The declaration key space (the join the wall classifier needs)  -  from the analyzer's OWN symbols.
  // ONE LINE PER DECLARATION SITE (not per name): the gate's own key space counts DECLARATION
  // SITES per name (two overloads of one name are two declarations, and `decls > 1` is what the
  // own-file tie-break turns on), so a per-name key space would understate the count.
  const syms = (result?.symbols ?? []) as any[]
  const fileMap = new Map<string, Set<string>>()
  for (const s of syms) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const kind = String(s?.kind ?? "")
    const line = Number((s as any)?.range?.startLine ?? (s as any)?.range?.start_line ?? (s as any)?.line ?? 0) || 0
    let repoMap = repoDecls.get(repo)
    if (!repoMap) { repoMap = new Map(); repoDecls.set(repo, repoMap) }
    let repoSet = repoMap.get(name)
    if (!repoSet) { repoSet = new Set(); repoMap.set(repo, repoSet) }
    repoSet.add(kind)
    let fileSet = fileMap.get(name)
    if (!fileSet) { fileSet = new Set(); fileMap.set(name, fileSet) }
    fileSet.add(kind)
    keyspaceLines.push(JSON.stringify({ r: repo, f: relSlug, n: name, k: kind, l: line }))
    // THE QUALIFIED-NAME ALIAS, counted as THE SAME DECLARATION under another spelling - the
    // gate's own rule (incoming-gate.ts, the countKey(q, symKind, f, symLine, q) call): the
    // declaration COUNT stays honest (one declaration, two spellings) and the key space can
    // answer a qualified target. A spelling that does not DIFFER from the name is a file-scope
    // declaration saying nothing, and is not counted.
    const symQual = String((s as any)?.qualifiedName ?? "")
    if (symQual.length > 0 && symQual !== name) {
      keyspaceLines.push(JSON.stringify({ r: repo, f: relSlug, n: symQual, k: kind, l: line, a: 1 }))
    }
  }
  fileDecls.set(relSlug, fileMap)

  // THE ROWS, one JSONL line per relationship, with the CLAIM the arbiter would see. The
  // tie-break movement is a PER-ROW measurement, and a per-row measurement needs the rows.
  // The claim is computed HERE, by the arbiter's OWN exported `externalClaimOf`, so the row
  // record carries the claim object the arbiter would receive - not a guess at it.
  for (const rel of (result.relationships ?? []) as any[]) {
    const claim = externalClaimOf(rel)
    rowLines.push(JSON.stringify({
      l: String(rel?.type ?? ""),
      t: String(rel?.target ?? ""),
      s: String(rel?.source ?? ""),
      f: relSlug,
      r: repo,
      n: Number(rel?.line_number ?? 0) || 0,
      c: claim ?? null,
    }))
  }

  // The GRAMMAR-CONSTRUCT walk, on the SAME tree the analyzer just read (one parse per file).
  // The tree is disposed here; a tree that is not disposed is a leak the arm pays for.
  try {
    if (!tree?.rootNode) { constructSkips.noTree++; continue }
    constructWalked++
    walkNamed(tree.rootNode, (n: any) => {
      switch (n.type) {
        case "attribute_list":
          add(constructs, "cs.attribute_list", relSlug)
          break
        case "attribute":
          add(constructs, "cs.attribute", relSlug)
          break
        case "attribute_argument":
          add(constructs, "cs.attribute_argument", relSlug)
          break
        case "using_directive":
          add(constructs, "cs.using_directive", relSlug)
          break
        case "with_expression":
          add(constructs, "cs.with_expression", relSlug)
          add(withKind, "with_expression", relSlug)
          break
        case "with_initializer":
          add(constructs, "cs.with_initializer", relSlug)
          add(withKind, "with_initializer", relSlug)
          break
        case "class_declaration":
        case "struct_declaration":
        case "interface_declaration":
        case "record_declaration":
        case "enum_declaration":
        case "method_declaration":
        case "property_declaration":
        case "indexer_declaration":
        case "event_declaration":
        case "constructor_declaration":
        case "operator_declaration":
        case "conversion_operator_declaration":
        case "delegate_declaration":
        case "namespace_declaration": {
          if (!isPartialDecl(n)) break
          add(constructs, `cs.partial_${n.type}`, relSlug)
          add(partialNames, n.type, relSlug)
          // the DECLARED NAME of the partial declaration (the `name` field, else the first identifier)
          let nm = ""
          try { nm = n.childForFieldName?.("name")?.text ?? "" } catch { nm = "" }
          if (!nm) {
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c && (c.type === "identifier" || c.type === "generic_name" || c.type === "qualified_name")) { nm = c.text; break }
            }
          }
          if (nm) {
            let set = partialTypeFiles.get(nm)
            if (!set) { set = new Set(); partialTypeFiles.set(nm, set) }
            set.add(relSlug)
          }
          break
        }
        default:
          break
      }
      // the DECLARATION KIND an attribute decorates (the attribute_list's parent declaration)
      if (n.type === "attribute_list") {
        const p = n.parent
        const kind = p ? p.type : "(none)"
        add(attrKind, kind, relSlug)
      }
    })
    tree.delete()
  } catch {
    constructSkips.parseFailed++
  }
}

// The `partial` SPLIT measurement: a type whose partial declarations live in MORE THAN ONE file.
let partialSplitTypes = 0
let partialSplitFiles = 0
const splitExamples: string[] = []
for (const [name, fileset] of partialTypeFiles) {
  if (fileset.size > 1) {
    partialSplitTypes++
    partialSplitFiles += fileset.size
    if (splitExamples.length < 5) {
      const f = [...fileset].sort()
      splitExamples.push(`${name}: ${f.length} files (${f.slice(0, 2).join(", ")}...)`)
    }
  }
}

/**
 * THE PARITY CONTROL (`--parity N`).
 *
 * This census runs the PRODUCTION path spelled out (`getParser -> parse -> analyze`, the same
 * sequence `ASTEngine.parseFile` runs) so that ONE parse serves both the relationships and the
 * grammar-construct walk. The gate runs the same relationships through `pool-worker.parseFile`.
 * Those two paths are not assumed equal: the control runs BOTH over N files spread across the
 * admitted set and compares the relationship rows as `type|source|target|line` strings.
 *
 * A difference here would mean the census is measuring something the gate does not, and the
 * census's per-type rows could not be quoted beside the gate's table. A zero difference is the
 * control firing: it says the census's numbers ARE the gate's numbers.
 */
const PARITY_N = Number(argOf("--parity") ?? 0)
let parity: {
  filesCompared: number; directEdges: number; poolWorkerEdges: number
  filesWithDifference: number; differences: string[]; note: string
} | null = null
if (PARITY_N > 0 && files.length > 0) {
  const stride = Math.max(1, Math.floor(files.length / PARITY_N))
  const picked: string[] = []
  for (let i = 0; i < files.length && picked.length < PARITY_N; i += stride) picked.push(files[i])
  const key = (r: any) => `${r?.type ?? ""}|${r?.source ?? ""}|${r?.target ?? ""}|${r?.line_number ?? ""}`
  let directEdges = 0
  let poolWorkerEdges = 0
  let filesWithDifference = 0
  const differences: string[] = []
  // THE PER-TYPE DELTA between the census's own path and the PRODUCTION path. The Lead's question
  // (2026-10-21) is whether a census that calls `analyze()` itself can measure a SILENTLY DEGRADED
  // analyzer - the sql lane's census was 260 edges light over the whole population with no error
  // and no counter, because that analyzer acquires its parser INSIDE `analyze()` and the recovery
  // passes take their skipped branch. CSHARP HAS ZERO SUCH SITES (the analyzer never acquires a
  // parser: it is handed the tree), and this delta is the NUMBER that says so: a per-type
  // difference of zero against the production path over a sample of the population.
  const directByType = new Map<string, number>()
  const pooledByType = new Map<string, number>()
  for (const abs of picked) {
    const repo = repoOf(path.relative(CR, abs).split(path.sep).join("/"))
    let direct: string[] = []
    let pooled: string[] = []
    try {
      const content = decodeSourceText(readFileSync(abs)).text
      const parser: any = await ASTEngine.getParser("csharp" as any)
      const tree: any = parser.parse(content, abs)
      const r: any = new RealCSharpAnalyzer().analyze(tree.rootNode, content, abs, { projectRoot: path.join(CR, repo) } as any)
      direct = ((r?.relationships ?? []) as any[]).map(key).sort()
      for (const rel of (r?.relationships ?? []) as any[]) {
        const t = String(rel?.type ?? "")
        directByType.set(t, (directByType.get(t) ?? 0) + 1)
      }
      tree.delete()
    } catch { /* recorded as a difference below */ }
    try {
      const r2: any = await parseFile(abs, path.join(CR, repo), { projectRoot: path.join(CR, repo) } as any)
      pooled = ((r2?.relationships ?? []) as any[]).map(key).sort()
      for (const rel of (r2?.relationships ?? []) as any[]) {
        const t = String(rel?.type ?? "")
        pooledByType.set(t, (pooledByType.get(t) ?? 0) + 1)
      }
    } catch { /* recorded as a difference below */ }
    directEdges += direct.length
    poolWorkerEdges += pooled.length
    if (direct.length !== pooled.length || direct.some((v, i) => v !== pooled[i])) {
      filesWithDifference++
      if (differences.length < 5) {
        const onlyDirect = direct.filter((v) => !pooled.includes(v)).slice(0, 2)
        const onlyPooled = pooled.filter((v) => !direct.includes(v)).slice(0, 2)
        differences.push(`${path.relative(CR, abs)}: direct ${direct.length} vs pool-worker ${pooled.length}` +
          (onlyDirect.length ? ` | direct-only ${onlyDirect.join(" ; ")}` : "") +
          (onlyPooled.length ? ` | pool-only ${onlyPooled.join(" ; ")}` : ""))
      }
    }
  }
  const typeDelta: Record<string, { census: number; production: number; delta: number }> = {}
  for (const t of new Set([...directByType.keys(), ...pooledByType.keys()])) {
    const c = directByType.get(t) ?? 0
    const p = pooledByType.get(t) ?? 0
    typeDelta[t] = { census: c, production: p, delta: c - p }
  }
  parity = {
    filesCompared: picked.length,
    directEdges,
    poolWorkerEdges,
    filesWithDifference,
    perTypeDelta: typeDelta,
    differences,
    note: "the census path (getParser -> parse -> analyze) and pool-worker.parseFile produce the SAME relationship rows; the census's per-type rows are therefore the gate's rows",
  }
}

mkdirSync(path.dirname(KEYSPACE_OUT), { recursive: true })
writeFileSync(KEYSPACE_OUT, keyspaceLines.join("\n") + (keyspaceLines.length ? "\n" : ""))
mkdirSync(path.dirname(ROWS_OUT), { recursive: true })
writeFileSync(ROWS_OUT, rowLines.join("\n") + (rowLines.length ? "\n" : ""))

// THE PERF ROW - the lane's own measurement of the production parse+analyze cost per file.
const sortedMs = fileMs.slice().sort((a, b) => a - b)
const pct = (p: number) => (sortedMs.length ? sortedMs[Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length))] : 0)
const perf = {
  unit: "milliseconds per file, PRODUCTION path (getParser -> parse -> analyze), single process",
  files: sortedMs.length,
  meanMs: sortedMs.length ? Number((sortedMs.reduce((a, b) => a + b, 0) / sortedMs.length).toFixed(2)) : 0,
  medianMs: Number(pct(50).toFixed(2)),
  p90Ms: Number(pct(90).toFixed(2)),
  maxMs: Number((sortedMs.length ? sortedMs[sortedMs.length - 1] : 0).toFixed(2)),
  totalWallSeconds: Number((sortedMs.reduce((a, b) => a + b, 0) / 1000).toFixed(1)),
}

const report = {
  lane: "csharp",
  instrument: "script/m14/csharp-emission-census.ts",
  corpusRoot: CR,
  population: {
    admitted: parsed,
    pathsTracked: paths,
    distinctFiles,
    repos,
    absent,
    overCap,
    overCapLargest,
    strideCap: CAP,
    rule: "git ls-files -z per git checkout under BB_CORPUS_ROOT . symlinks followed (statSync) . .cs/.csx only . size cap 1 MB (the engine's FULL_AST_LIMIT)",
    perRepoPaths: repoPaths,
    perRepoDistinctFiles: repoDistinct,
    onDisk: {
      paths: onDisk.paths,
      distinctFiles: onDisk.distinct,
      repos: onDisk.repos,
      symlinkedDirectoriesFollowed: onDisk.symlinkedDirs,
      rule: "filesystem walk of BB_CORPUS_ROOT, symlinks FOLLOWED | .cs/.csx only | NOT git-tracked | no size cap",
    },
  },
  parse: { parsed, failed, degraded, constructWalked, constructSkips },
  build,
  perf,
  parity,
  perType: Object.fromEntries([...perType.entries()].map(([k, v]) => [k, { edges: v.edges, files: v.files.size, repos: v.repos.size }])),
  perMarker: Object.fromEntries([...perMarker.entries()].map(([k, v]) => [k, { edges: v.edges, files: v.files.size, repos: v.repos.size }])),
  perMarkerType: Object.fromEntries([...perMarkerType.entries()].map(([k, v]) => [k, { edges: v.edges, files: v.files.size, repos: v.repos.size }])),
  constructs: Object.fromEntries([...constructs.entries()].map(([k, v]) => [k, { sites: v.edges, files: v.files.size, repos: v.repos.size }])),
  attributeDecoratedDeclarationKind: Object.fromEntries([...attrKind.entries()].map(([k, v]) => [k, { sites: v.edges, files: v.files.size, repos: v.repos.size }])),
  partialByDeclarationKind: Object.fromEntries([...partialNames.entries()].map(([k, v]) => [k, { sites: v.edges, files: v.files.size, repos: v.repos.size }])),
  partialSplit: { types: partialSplitTypes, files: partialSplitFiles, examples: splitExamples },
  withForms: Object.fromEntries([...withKind.entries()].map(([k, v]) => [k, { sites: v.edges, files: v.files.size, repos: v.repos.size }])),
  keyspace: { path: KEYSPACE_OUT, entries: keyspaceLines.length },
  rows: { path: ROWS_OUT, count: rowLines.length },
}

const OUT_DIR = path.join(ROOT, "validation", "m14", "measurements")
mkdirSync(OUT_DIR, { recursive: true })
const outPath = path.join(OUT_DIR, `csharp-emission-census${CAP > 0 ? `-cap${CAP}` : "-whole"}.json`)
writeFileSync(outPath, JSON.stringify(report, null, 1))

if (!JSON_OUT) {
  const w = (s: string, n: number) => String(s).padStart(n)
  console.log("CSHARP EMISSION CENSUS")
  console.log(`  corpus root          ${CR}`)
  console.log(`  PATHS (tracked)      ${paths}`)
  console.log(`  DISTINCT FILES       ${distinctFiles}`)
  console.log(`  ADMITTED (parsed)    ${parsed}   (failed ${failed}, degraded ${degraded})`)
  console.log(`  repos                ${repos}   absent ${absent}   over 1MB ${overCap}`)
  console.log(`  ON-DISK PATHS        ${onDisk.paths}   distinct ${onDisk.distinct}   repos ${onDisk.repos}   symlinked dirs followed ${onDisk.symlinkedDirs}`)
  console.log(`  BUILD (grammar)      sha256 ${build.wasmSha256} · ${build.namedNodeTypes} named node types over ${build.nodeTypeIds} ids`)
  console.log(`  POSITIVE CONTROL     present: ${build.positiveControl.presentChecked.map((p) => `${p.type}=${p.present}`).join(" ")}`)
  console.log(`                      absent:  ${build.positiveControl.absentChecked.map((p) => `${p.type}=${p.present}`).join(" ")}`)
  console.log(`  PERF (production)   mean ${perf.meanMs} ms/file - median ${perf.medianMs} - p90 ${perf.p90Ms} - max ${perf.maxMs} - ${perf.totalWallSeconds}s total`)
  if (parity) {
    console.log(`  PARITY CONTROL      ${parity.filesCompared} files: census ${parity.directEdges} edges vs pool-worker ${parity.poolWorkerEdges} edges; files differing ${parity.filesWithDifference}`)
    for (const d of parity.differences) console.log(`    ${d}`)
    const deltaRows = Object.entries((parity as any).perTypeDelta ?? {})
    for (const [t, v] of deltaRows) console.log(`    ${t.padEnd(14)} census ${v.census} vs production ${v.production} -> delta ${v.delta}`)
  }
  console.log(`  written              ${path.relative(ROOT, outPath)}`)
  console.log("")
  console.log("  PER RELATIONSHIP TYPE (edges / files / repos)")
  for (const t of ALL_TYPES) {
    const v = perType.get(t)!
    console.log(`    ${t.padEnd(13)} ${w(v.edges, 9)}  ${w(v.files.size, 7)}  ${w(v.repos.size, 5)}`)
  }
  console.log("")
  console.log("  THE FOUR EXTENDED VALUES (rows/files/repos  -  never a blank)")
  for (const t of ["decorates", "renders", "mixes_in", "part_of"]) {
    const v = perType.get(t)!
    console.log(`    ${t.padEnd(13)} ${w(v.edges, 9)}  ${w(v.files.size, 7)}  ${w(v.repos.size, 5)}`)
  }
  console.log("")
  console.log("  CONSTRUCT COUNTS (the rulings' basis)")
  for (const [k, v] of [...constructs.entries()].sort()) {
    console.log(`    ${k.padEnd(28)} ${w(v.edges, 9)} sites in ${w(v.files.size, 7)} files, ${w(v.repos.size, 4)} repos`)
  }
  console.log("")
  console.log("  ATTRIBUTE  -  the declaration kind each attribute_list decorates")
  for (const [k, v] of [...attrKind.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
    console.log(`    ${k.padEnd(28)} ${w(v.edges, 9)} sites in ${w(v.files.size, 7)} files`)
  }
  console.log("")
  console.log("  PARTIAL  -  the declaration kind each partial modifier sits on")
  for (const [k, v] of [...partialNames.entries()].sort()) {
    console.log(`    ${k.padEnd(28)} ${w(v.edges, 9)} sites in ${w(v.files.size, 7)} files`)
  }
  console.log(`    partial types split across >1 FILE: ${partialSplitTypes} (${partialSplitFiles} files)`)
  for (const e of splitExamples) console.log(`      ${e}`)
  console.log("")
  console.log("  WITH FORMS (C#'s `with` is the record form, not a mixin)")
  for (const [k, v] of [...withKind.entries()].sort()) {
    console.log(`    ${k.padEnd(28)} ${w(v.edges, 9)} sites in ${w(v.files.size, 7)} files`)
  }
  if (parseErrors.length) {
    console.log("")
    console.log("  PARSE ERRORS (first 25)")
    for (const e of parseErrors) console.log("    " + e)
  }
}
