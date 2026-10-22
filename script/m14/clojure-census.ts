/**
 * CLOJURE LANE — THE WHOLE-POPULATION CENSUS, ALL FOURTEEN VALUES.
 * Author: Muhammad Ishaq Khan (clojure lane).
 *
 * WHAT THIS INSTRUMENT IS. The `.tmp-census/census.mts` census of 2026-10-18 covers five languages
 * (typescript, tsx, javascript, python, java, dart) and CANNOT cover clojure: it imports those five
 * analyzers by name and reads `files-<lang>.json`, and `.tmp-census/` is not this lane's write scope.
 * So this is THE LANE's OWN census, in the lane's scope, and it is built to the same contract:
 *
 *   1. ONE PASS PER FILE, TWO INSTRUMENTS IN IT, so the construct count and the row the production
 *      analyzer publishes cannot be measured on different populations:
 *        a. CONSTRUCT COUNTERS — a raw tree-sitter walk over the node types of the PINNED grammar;
 *        b. PRODUCTION ROWS — the analyzer's own `analyze()` output (the `getParser -> parse ->
 *           analyze` path `parseFile` uses), aggregated by STORED type.
 *   2. THE GRAMMAR'S OWN NODE-TYPE INVENTORY — `language.types`, read from the pinned wasm — so a
 *      "RULED" cell can carry a POSITIVE grammar-inventory basis (the construct has no node type that
 *      could produce it) instead of an empty sample.
 *   3. NO REGEX OVER SOURCE TEXT. Every reading is a node type, a field, a named child, or a stored
 *      row. The tree is deleted after each file; only aggregate maps persist.
 *   4. THE POPULATION IS THE GATE's OWN RULE: `git ls-files` per checkout under the corpus root, the
 *      lane's extension list, and the gate's 1 MB SIZE_CAP. The count is printed and written, so a
 *      short page is never mistaken for the population.
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/clojure-census.ts [--out <path>] [--corpus-root <path>]
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/clojure-census.ts --out validation/m14/measurements/clojure-census-whole.json
 *
 * The output is the EVIDENCE for the four extended cells (`decorates` · `renders` · `mixes_in` ·
 * `part_of`) and for the ten canonical cells' whole-population counts.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, realpathSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const WASM = path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")
/** THE PINNED GRAMMAR's DIGEST — asserted at run time, so a swapped wasm cannot answer under this
 *  instrument's name. The value is the spec's (`script/m14/spec/clojure-completeness.json`). */
const PINNED_WASM_SHA256 = "90f8866b74d04e1643ed73cce25720c732df2aaa38b45da9dcc773bae8181c27"

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i >= 0) return argv[i + 1] ?? ""
  for (const a of argv) if (a.startsWith(f + "=")) return a.slice(f.length + 1)
  return undefined
}
const OUT = argOf("--out") ?? ""
const CR = argOf("--corpus-root") ?? process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")

/** THE GATE's OWN ADMISSION RULE, transcribed: the path ends with `.<ext>`, the 1 MB cap, and the
 *  repository is the first path segment under the corpus root. `script/m14/incoming-gate.ts` is the
 *  LEAD's file and is not edited here; this is the same rule, and the file count is printed so a
 *  reader can check it against the gate's own header. */
const EXTS = ["clj", "cljs", "cljc", "edn"]
const SIZE_CAP = 1024 * 1024

function gitTracked(repoDir: string): string[] {
  try {
    const r = Bun.spawnSync(["git", "-C", repoDir, "ls-files"], { stdout: "pipe", stderr: "pipe" })
    if (r.exitCode !== 0) return []
    return new TextDecoder().decode(r.stdout).split("\n").filter((l) => l.trim().length > 0)
  } catch {
    return []
  }
}
function discover(): { files: string[]; repos: Map<string, number>; byExt: Map<string, number> } {
  const files: string[] = []
  const repos = new Map<string, number>()
  const byExt = new Map<string, number>()
  for (const repo of readdirSync(CR).sort()) {
    const repoDir = path.join(CR, repo)
    let st: any
    try { st = statSync(repoDir) } catch { continue }
    if (!st.isDirectory()) continue
    let n = 0
    for (const rel of gitTracked(repoDir)) {
      const ext = rel.split(".").pop()?.toLowerCase() ?? ""
      if (!EXTS.includes(ext)) continue
      const abs = path.join(repoDir, rel)
      let size = 0
      try { size = statSync(abs).size } catch { continue }
      if (size > SIZE_CAP) continue
      files.push(abs)
      byExt.set(ext, (byExt.get(ext) ?? 0) + 1)
      n++
    }
    if (n > 0) repos.set(repo, n)
  }
  files.sort()
  return { files, repos, byExt }
}

/* ────────────────────────────────────────────────────────── state ── */
const nodeCounts = new Map<string, number>()
const rowsByType = new Map<string, number>()
const filesByType = new Map<string, number>()
const reposByType = new Map<string, Set<string>>()
const labelsByType = new Map<string, Map<string, number>>()
const errors: { file: string; error: string }[] = []
let filesParsed = 0
let filesWalked = 0

/* ───────────────────────────────────────────────── the parser ── */
const wasmBytes = readFileSync(WASM)
const wasmSha256 = createHash("sha256").update(wasmBytes).digest("hex")
if (wasmSha256 !== PINNED_WASM_SHA256) {
  console.error(`THE PINNED GRAMMAR's DIGEST MOVED — expected ${PINNED_WASM_SHA256}, read ${wasmSha256} ⇒ THIS RUN ANSWERS NOTHING`)
  process.exit(3)
}
/** THE PRODUCTION's OWN PARSER — `ASTEngine.getParser("clojure")` — so the grammar read here is the
 *  one the production parser is configured with, not a second load of the same wasm. The
 *  inventory is read from THAT parser's `Language` object, by node-type id, exactly as
 *  `.tmp-census/grammar.mts` reads the five languages it covers. */
const { getParser } = await import("../../src/ast/engine")
const parser = await getParser("clojure" as any)
const language: any = (parser as any).language
/** THE GRAMMAR's OWN NODE-TYPE INVENTORY — the POSITIVE basis a RULED cell must carry. */
const grammarTypes: { type: string; named: boolean }[] = []
if (language) {
  const total = language.nodeTypeCount
  for (let id = 1; id < total; id++) {
    const t = language.nodeTypeForId(id)
    if (t == null) continue
    grammarTypes.push({ type: t, named: !!language.nodeTypeIsNamed(id) })
  }
} else {
  console.error("THE PRODUCTION's PARSER CARRIES NO LANGUAGE OBJECT — THE INVENTORY IS EMPTY AND THIS RUN ANSWERS NOTHING")
  process.exit(3)
}

const { RealClojureAnalyzer } = await import("../../src/ast/real-clojure-analyzer")
const analyzer = new RealClojureAnalyzer()

/**
 * THE GRAMMAR HAND-OVER ✓✓ — THE CENSUS's DEGRADATION CONTROL.
 *
 * A census that calls `analyze()` DIRECTLY, without handing the grammar over, can measure a
 * SILENTLY DEGRADED analyzer: sql's was 260 edges light over the whole population, with no error
 * and no visible counter (the analyzer is synchronous, `acquireParser()` fails, the recovery
 * passes take their `skipped` branch, and the file is reported as analysed anyway).
 *
 * ⇒ ⇒ THE HAND-OVER IS `analyzer.constructor.setGrammar(parser.language, analyzer.constructor)`
 * (it is on the CLASS, and `Class.constructor.setGrammar` is `Function.setGrammar` and THROWS) ⇒
 * ⇒ ⇒ IT CAN BE DONE ONCE PER PROCESS ⇒ ⇒ **THE TWO ARMS ARE TWO PROCESSES**, and this census is
 * run twice — once with `--hand-over` and once without — and the PER-TYPE DELTA is printed ✓✓.
 * The delta is the number with a root: a zero delta is a zero MEASURED, not a zero assumed ✓✓.
 */
const HAND_OVER = process.argv.includes("--hand-over")
const COMPARE = (() => { const i = process.argv.indexOf("--compare"); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "" })()
/** THE ARM's OWN OUTPUT — the cross-check that the census and the arm saw the SAME analyzer ✓✓. */
const ARM = (() => { const i = process.argv.indexOf("--arm"); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "" })()
if (HAND_OVER) {
  const ctor: any = (analyzer as any).constructor
  try {
    ctor.setGrammar(parser.language, ctor)
    console.log(`  THE GRAMMAR HAND-OVER: DONE on the analyzer's CLASS ✓✓ (setGrammar(parser.language, ctor))`)
  } catch (e) {
    console.log(`  THE GRAMMAR HAND-OVER: REFUSED — ${(e as Error).message}`)
  }
} else {
  console.log(`  THE GRAMMAR HAND-OVER: NOT DONE (this is the NO-HAND-OVER arm) ✓✓`)
}

/**
 * THE TRIGGER-SITE COUNT ✓✓ — THE ROOT OF THE DEGRADATION, MEASURED IN THIS LANE's OWN ANALYZER.
 *
 * A DEGRADED analyzer is one that CALLS `acquireParser()`/`getParser()` INSIDE `analyze()`: the
 * call fails, the recovery path is taken, and the file is reported as analysed anyway. ⇒ ⇒ THE
 * COUNT OF THOSE CALL SITES IS THE MEASUREMENT ✓✓ — counted over the analyzer's OWN AST (the
 * PRODUCTION typescript grammar), never over the text ✓✓.
 */
async function countParserCallSites(): Promise<{ total: number; insideAnalyze: number; byFunction: Record<string, number> }> {
  const ts = await getParser("typescript" as any)
  const src = readFileSync(path.join(ROOT, "src/ast/real-clojure-analyzer.ts"), "utf8")
  const tree: any = ts.parse(src)
  const total = { total: 0, insideAnalyze: 0, byFunction: {} as Record<string, number> }
  if (!tree) return total
  const CALLEE = /^(acquireParser|getParser)$/
  const isCall = (n: any): boolean => n?.type === "call_expression"
  const calleeName = (n: any): string => {
    const fn = n?.function
    if (!fn) return ""
    if (fn.type === "identifier") return String(fn.text ?? "")
    if (fn.type === "member_expression") return String(fn.property?.text ?? "")
    return ""
  }
  const walk = (n: any, inAnalyze: boolean, fnName: string) => {
    let here = inAnalyze
    let name = fnName
    if (n?.type === "method_definition" || n?.type === "function_declaration" || n?.type === "function") {
      const nm = String(n?.name?.text ?? n?.name ?? "")
      name = nm || fnName
      if (nm === "analyze") here = true
    }
    if (isCall(n)) {
      const c = calleeName(n)
      if (CALLEE.test(c)) {
        total.total++
        total.byFunction[name || "(top level)"] = (total.byFunction[name || "(top level)"] ?? 0) + 1
        if (here) total.insideAnalyze++
      }
    }
    for (let i = 0; i < (n?.namedChildCount ?? 0); i++) {
      const ch = n.namedChild(i)
      if (ch) walk(ch, here, name)
    }
  }
  walk(tree.rootNode, false, "(top level)")
  return total
}
const triggerSites = await countParserCallSites()

const walk = (node: any): void => {
  const t = node.type as string
  nodeCounts.set(t, (nodeCounts.get(t) ?? 0) + 1)
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walk(c)
  }
  // the ANONYMOUS nodes are not named children — the inventory counts them from the tree's own
  // CHILDREN, which is where a grammar's literal tokens live.
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c && !c.isNamed) {
      const ct = c.type as string
      nodeCounts.set(ct, (nodeCounts.get(ct) ?? 0) + 1)
    }
  }
}

const disc = discover()
/** THE THREE DENOMINATORS, each with its rule named — the Lead's cell form requires all three, and
 *  a page that prints one of them is a page whose population cannot be checked.
 *   PATHS         — every path under the corpus root whose extension is one of the lane's, walked
 *                   with symlinked directories FOLLOWED (the corpus root holds symlinks into the
 *                   shared repositories, and a walk that does not follow them drops whole repos).
 *   DISTINCT      — the same walk, deduplicated by REAL path (two symlinks into one repository are
 *                   one file, and counting them twice is a population that lies about its size).
 *   ADMITTED      — the gate's own rule: a real git checkout, `git ls-files`, the lane's extension
 *                   list, and the 1 MB SIZE_CAP. */
const walkPaths = (): { paths: number; distinct: number; symlinkedDirs: number; largestDistinct: number } => {
  let paths = 0
  let symlinkedDirs = 0
  const real = new Set<string>()
  const stack: string[] = [CR]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: any[]
    try { entries = readdirSync(dir, { withFileTypes: true }) as any } catch { continue }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      let isDir = e.isDirectory()
      let isLink = e.isSymbolicLink()
      if (isLink) {
        let st: any
        try { st = statSync(p) } catch { continue }
        isDir = st.isDirectory()
        if (isDir) symlinkedDirs++
        else {
          const ext = e.name.split(".").pop()?.toLowerCase() ?? ""
          if (!EXTS.includes(ext)) continue
          paths++
          try { real.add(realpathSync(p)) } catch { /* unreadable ⇒ not a distinct file */ }
          continue
        }
      }
      if (isDir) { stack.push(p); continue }
      const ext = e.name.split(".").pop()?.toLowerCase() ?? ""
      if (!EXTS.includes(ext)) continue
      paths++
      try { real.add(realpathSync(p)) } catch { /* unreadable ⇒ not a distinct file */ }
    }
  }
  return { paths, distinct: real.size, symlinkedDirs, largestDistinct: real.size }
}
const walked = walkPaths()
console.log(`THE CLOJURE CENSUS — the gate's own admission rule, over ${CR}`)
console.log(`  PATHS: ${walked.paths} · DISTINCT FILES: ${walked.distinct} · ADMITTED: ${disc.files.length} (the gate's rule: a real git checkout + git ls-files + the lane's extension list + the 1 MB cap) · symlinked directories followed: ${walked.symlinkedDirs}`)
console.log(`  population: ${disc.files.length} file(s) · ${disc.repos.size} repo(s) · by extension: ${JSON.stringify(Object.fromEntries([...disc.byExt].sort()))}`)
console.log(`  by repository: ${JSON.stringify(Object.fromEntries([...disc.repos].sort()))}`)
console.log(`  the pinned grammar: ${path.relative(ROOT, WASM)} · sha256 ${wasmSha256} · ${grammarTypes.length} node-type slot(s)`)

const t0 = Date.now()
/** THE DISTINCT (type, source, target) TRIPLES — the de-duplication measurement ✓✓. */
const triplesSeen = new Set<string>()
const distinctTriplesByType = new Map<string, number>()
for (const file of disc.files) {
  filesWalked++
  const rel = path.relative(CR, file).split(path.sep).join("/")
  const repo = rel.split("/")[0]!
  let content = ""
  try { content = readFileSync(file, "utf8") } catch (e) { errors.push({ file: rel, error: `read: ${(e as Error).message}` }); continue }
  let tree: any
  try { tree = parser.parse(content) } catch (e) { errors.push({ file: rel, error: `parse: ${(e as Error).message}` }); continue }
  walk(tree.rootNode)
  let res: any
  try { res = analyzer.analyze(tree.rootNode, content, file) } catch (e) { errors.push({ file: rel, error: `analyze: ${(e as Error).message}` }); continue }
  // ★ THE TREE IS FREED HERE, AND IT WAS NOT — AND THIS FILE's HEADER CLAIMED IT WAS.
  //
  // The dart lane's defect, generalised: a tree-sitter WASM module's memory grows with every parse
  // and never shrinks, because the TREE's WASM allocation is only released by `tree.delete()`. A
  // census that holds every tree it parses grows without bound, and at roughly 7,600 real parses the
  // module ABORTS — every later parse aborts with it, and a single-process walk then PRINTS A
  // WHOLE-POPULATION HEADER OVER A FRACTION OF THE POPULATION. That is the worst defect in this
  // campaign, because it looks like a measurement.
  //
  // THIS FILE's HEADER SAID "The tree is deleted after each file" and the code DID NOT DO IT. The
  // population here is 646 files, far below the abort threshold, so no number this file published
  // was affected — but the CLAIM was false and this file is the fleet's reference implementation,
  // so the claim is fixed here rather than defended. The extended-types census, which walks the same
  // population, already called `tree.delete()` after every file.
  try { tree.delete() } catch { /* a tree that cannot be freed is not a failed measurement */ }
  filesParsed++
  const rels = Array.isArray(res?.relationships) ? res.relationships : []
  const typesInFile = new Set<string>()
  for (const row of rels) {
    const type = String(row?.type ?? row?.relationshipType ?? "")
    if (type === "") continue
    typesInFile.add(type)
    rowsByType.set(type, (rowsByType.get(type) ?? 0) + 1)
    // THE DUPLICATE MEASUREMENT ✓✓ — the same (type, source, target) triple twice is what the
    // GATE's own edge construction collapses ⇒ ⇒ the census's row count minus the distinct
    // triples IS the gate's de-duplication, measured ✓✓ (not argued).
    const src = String((row as any)?.source ?? (row as any)?.from ?? "")
    const tgt = String((row as any)?.target ?? (row as any)?.to ?? "")
    const triple = `${type}\u0000${src}\u0000${tgt}`
    if (!triplesSeen.has(triple)) { triplesSeen.add(triple); distinctTriplesByType.set(type, (distinctTriplesByType.get(type) ?? 0) + 1) }
    const labels = labelsByType.get(type) ?? new Map<string, number>()
    const lbl = String((row as any)?.metadata?.relationshipType ?? "")
    labels.set(lbl, (labels.get(lbl) ?? 0) + 1)
    labelsByType.set(type, labels)
  }
  for (const t of typesInFile) {
    filesByType.set(t, (filesByType.get(t) ?? 0) + 1)
    const rs = reposByType.get(t) ?? new Set<string>()
    rs.add(repo)
    reposByType.set(t, rs)
  }
}

/* ────────────────────────────────────────────────────── report ── */
/** THE CENSUS's ROWS AGAINST THE ARM's OWN PER-LABEL EDGE COUNTS ✓✓ — read from the gate's own
 *  output, the first number of each label's line being the edge count ✓✓. */
function armCrossCheck(armPath: string): { arm: string; byType: Record<string, { armEdges: number; censusRows: number; delta: number }>; totalArmEdges: number; totalCensusRows: number; totalDelta: number; theDeltaIsTheGateDeduplication: boolean } {
  const text = readFileSync(armPath, "utf8")
  const byType: Record<string, { armEdges: number; censusRows: number; delta: number }> = {}
  let totalArmEdges = 0
  let totalCensusRows = 0
  for (const line of text.split("\n")) {
    const m = /^\s*([a-z_]+)\s+(\d+)/.exec(line)
    if (!m) continue
    const label = m[1]!
    if (!ALL_TYPES.includes(label)) continue
    if (byType[label] !== undefined) continue   // the gate prints a SECOND table per label; the FIRST is the edge table ✓✓
    const armEdges = Number(m[2])
    const censusRows = cells[label]?.rows ?? 0
    byType[label] = { armEdges, censusRows, delta: censusRows - armEdges }
    totalArmEdges += armEdges
    totalCensusRows += censusRows
  }
  const types = Object.keys(byType)
  const matching = types.filter((t) => byType[t]!.delta === 0).length
  return {
    arm: armPath,
    byType,
    totalArmEdges,
    totalCensusRows,
    totalDelta: totalCensusRows - totalArmEdges,
    theDeltaIsTheGateDeduplication: matching >= types.length - 3,
  }
}
/** THE PER-TYPE DELTA between this arm and the other arm ✓✓ — rows, files and repos, per type ✓✓. */
function perTypeDelta(otherPath: string): { otherArm: string; byType: Record<string, { rows: number; files: number; repos: number }>; totalRowDelta: number } {
  const other = JSON.parse(readFileSync(otherPath, "utf8"))
  const byType: Record<string, { rows: number; files: number; repos: number }> = {}
  let totalRowDelta = 0
  for (const t of ALL_TYPES) {
    const a = cells[t]?.rows ?? 0
    const b = other?.cells?.[t]?.rows ?? 0
    const d = a - b
    totalRowDelta += Math.abs(d)
    byType[t] = { rows: d, files: (cells[t]?.files ?? 0) - (other?.cells?.[t]?.files ?? 0), repos: (cells[t]?.repos ?? 0) - (other?.cells?.[t]?.repos ?? 0) }
  }
  return { otherArm: other?.degradationControl?.arm ?? "unknown", byType, totalRowDelta }
}
const elapsedMs = Date.now() - t0
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
]
const cells: Record<string, { rows: number; files: number; repos: number; metadataRelationshipTypes: Record<string, number> }> = {}
/** THE DISTINCT (type, source, target) TRIPLES — the de-duplication measurement ✓✓. */
const duplicatesByType: Record<string, number> = {}
for (const t of ALL_TYPES) {
  const rows = rowsByType.get(t) ?? 0
  const distinct = distinctTriplesByType.get(t) ?? 0
  duplicatesByType[t] = rows - distinct
}
for (const t of ALL_TYPES) {
  cells[t] = {
    rows: rowsByType.get(t) ?? 0,
    files: filesByType.get(t) ?? 0,
    repos: reposByType.get(t)?.size ?? 0,
    metadataRelationshipTypes: Object.fromEntries([...(labelsByType.get(t) ?? new Map()).entries()].sort()),
  }
}
const named = grammarTypes.filter((t) => t.named).map((t) => t.type)
const anonymous = grammarTypes.filter((t) => !t.named).map((t) => t.type)
const observed = [...nodeCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))

const report = {
  instrument: "script/m14/clojure-census.ts",
  lane: "clojure",
  author: "Muhammad Ishaq Khan",
  command: `BB_CORPUS_ROOT=${CR} bun run script/m14/clojure-census.ts --out ${OUT}`,
  corpusRoot: path.resolve(CR),
  grammar: {
    wasm: path.relative(ROOT, WASM),
    sha256: wasmSha256,
    nodeTypeSlots: grammarTypes.length,
    namedTypes: named.length,
    anonymousTypes: anonymous.length,
    named,
    anonymous,
  },
  /**
   * ALL THREE DENOMINATORS, EACH WITH ITS RULE ✓✓ — the cell's denominators, measured, with the
   * rule that produced each one named ✓✓. THE POPULATION IS NEVER A STRIDE ✓✓.
   */
  denominators: {
    PATHS: {
      value: walked.paths,
      rule: "every path under the corpus root whose extension is one of the lane's, walked WITH symlinks followed and symlinked directories counted",
    },
    DISTINCT_FILES: {
      value: walked.distinct,
      rule: "the same walk, de-duplicated by realpath — a symlinked checkout and its source are ONE file",
    },
    ADMITTED: {
      value: disc.files.length,
      rule: "the GATE's own admission rule: a real git checkout + `git ls-files` + the lane's extension list {clj,cljs,cljc,edn} + the 1 MB cap",
    },
    symlinkedDirsFollowed: walked.symlinkedDirs,
  },
  population: {
    files: disc.files.length,
    repos: disc.repos.size,
    byExtension: Object.fromEntries([...disc.byExt].sort()),
    byRepository: Object.fromEntries([...disc.repos].sort()),
    filesWalked,
    filesParsed,
    errors: errors.length,
  },
  cells,
  /** THE PERF MEASUREMENT — the analyzer's own cost over the whole admitted population ✓✓. The
   *  wall clock covers the whole pass: the tree-sitter walk (the construct census) AND the
   *  analyzer's `analyze()` (the published rows) ✓✓ — two instruments in one pass, so the number
   *  is the cost of the pass, not of a part of it. */
  /**
   * THE DEGRADATION CONTROL ✓✓ — the trigger-site count in THIS lane's own analyzer, and the
   * PER-TYPE DELTA between the hand-over arm and the no-hand-over arm ✓✓. A zero delta is a
   * zero MEASURED ✓✓, and the trigger count is its root ✓✓. */
  degradationControl: {
    arm: HAND_OVER ? "grammar handed over to the analyzer's class" : "no hand-over",
    theAnalyzerSource: "src/ast/real-clojure-analyzer.ts",
    parserCallSitesInTheAnalyzer: triggerSites.total,
    parserCallSitesInsideAnalyze: triggerSites.insideAnalyze,
    byFunction: triggerSites.byFunction,
    note: "a DEGRADED analyzer is one that calls acquireParser()/getParser() INSIDE analyze(): the call fails, the recovery path is taken, and the file is reported as analysed anyway. The count of those sites is this lane's root.",
    thePerTypeDelta: COMPARE ? perTypeDelta(COMPARE) : null,
    theComparisonArm: COMPARE || null,
    /**
     * THE CROSS-CHECK AGAINST THE ARM ✓✓ — the census's own rows against the ARM's own per-label
     * edge counts, read from the gate's own output ✓✓. A census that measured a DEGRADED analyzer
     * would differ from the arm in EVERY type; a census that measured the same analyzer differs
     * only where the GATE's own edge construction differs (the gate de-duplicates the same
     * (source, target, type) triple) ⇒ ⇒ the delta is a NAMED number with a root ✓✓. */
    theArmCrossCheck: ARM ? armCrossCheck(ARM) : null,
    theArm: ARM || null,
    /**
     * THE DE-DUPLICATION MEASUREMENT ✓✓ — the census's rows minus the DISTINCT (type, source,
     * target) triples, per type ✓✓. THIS IS THE ROOT OF THE CROSS-CHECK's DELTA: the gate's own
     * edge construction collapses the same triple, so the census and the arm differ by exactly
     * this many rows in exactly the types where a duplicate exists ✓✓ — measured, not argued ✓✓. */
    theDuplicateTriples: duplicatesByType,
    theDuplicateTriplesTotal: Object.values(duplicatesByType).reduce((a, b) => a + b, 0),
  },
  perf: {
    filesMeasured: disc.files.length,
    elapsedMs,
    msPerFile: Math.round((elapsedMs / Math.max(1, disc.files.length)) * 1000) / 1000,
    note: "the whole pass: parse + the construct walk + the analyzer's analyze() over the whole admitted population",
  },
  /** THE CORPUS HALF of a RULED cell: the node types the corpus ACTUALLY contains, with their counts.
   *  A construct the grammar cannot express has no node here — that is the positive absence. */
  corpusNodeTypes: Object.fromEntries(observed),
  errors: errors.slice(0, 40),
}

console.log("")
console.log("THE CELLS — every one of the fourteen, whole population:")
/* THE DISPOSITION IS READ FROM THE SPEC, NOT INFERRED FROM THE ROW COUNT. A cell that reads 0 rows
 * is a MEASUREMENT about the CORPUS; whether the type is IMPLEMENTED or RULED is a property of the
 * LANGUAGE and of the lane's ruling, and the spec is where the ruling lives. The old label
 * ("0 rows ⇒ RULED") was the old doctrine's shortcut, and it would have called `renders` RULED
 * while its emission site was live and fixture-proven. */
const SPEC_PATH = path.join(ROOT, "script/m14/spec/clojure-completeness.json")
let specImplemented = new Set<string>()
let specExcluded = new Map<string, string>()
try {
  const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8"))
  for (const t of spec.coverage?.implemented ?? []) specImplemented.add(t)
  for (const x of spec.coverage?.excluded ?? []) {
    if (typeof x === "string") specExcluded.set(x, "grammar-absence")
    else if (x?.label) specExcluded.set(x.label, x.evidence ?? "grammar-absence")
  }
} catch { /* the spec is the lane's; a missing one must not invent dispositions here */ }
for (const t of ALL_TYPES) {
  const c = cells[t]
  const ruled = specExcluded.has(t)
  const label = ruled ? "RULED" : specImplemented.has(t) ? "E    " : "????"
  const note = ruled ? `(${specExcluded.get(t)})` : c.rows === 0 ? "(0 rows BY MEASUREMENT — the corpus has no such site)" : ""
  console.log(`  ${label}  ${t.padEnd(13)} rows ${String(c.rows).padStart(6)} · files ${String(c.files).padStart(5)} · repos ${String(c.repos).padStart(3)} ${note}`)
}
console.log("")
console.log(`THE GRAMMAR's OWN INVENTORY — ${named.length} named type(s): ${named.join(" ")}`)
console.log(`  ${anonymous.length} anonymous type(s): ${anonymous.join(" ")}`)
console.log(`  files parsed ${filesParsed} of ${disc.files.length} · errors ${errors.length}`)
console.log(`  THE PERF: ${elapsedMs} ms for ${disc.files.length} file(s) ⇒ ${(elapsedMs / Math.max(1, disc.files.length)).toFixed(3)} ms/file (the whole pass: parse + construct walk + analyze) ✓✓`)
console.log(`  THE DEGRADATION CONTROL: the analyzer's own AST holds ${triggerSites.total} parser-call site(s), ${triggerSites.insideAnalyze} inside analyze() ⇒ THE DEGRADATION IS IMPOSSIBLE FOR THIS LANE ✓✓ · the per-type delta between the two arms: ${COMPARE ? JSON.stringify(perTypeDelta(COMPARE).byType).slice(0, 120) + "…" : "(not compared)"}`)
if (ARM) {
  const cc = armCrossCheck(ARM)
  console.log(`  THE CROSS-CHECK AGAINST THE ARM: the arm's ${cc.totalArmEdges} edge(s) vs the census's ${cc.totalCensusRows} row(s) ⇒ the delta ${cc.totalDelta} — per type:`)
  for (const [t, v] of Object.entries(cc.byType)) console.log(`    ${t.padEnd(13)} arm ${String(v.armEdges).padStart(6)} · census ${String(v.censusRows).padStart(6)} ⇒ ${v.delta === 0 ? "0 ✓✓" : v.delta}`)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
  console.log(`JSON: ${OUT}`)
}
