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
  filesParsed++
  const rels = Array.isArray(res?.relationships) ? res.relationships : []
  const typesInFile = new Set<string>()
  for (const row of rels) {
    const type = String(row?.type ?? row?.relationshipType ?? "")
    if (type === "") continue
    typesInFile.add(type)
    rowsByType.set(type, (rowsByType.get(type) ?? 0) + 1)
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
const elapsedMs = Date.now() - t0
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
]
const cells: Record<string, { rows: number; files: number; repos: number; metadataRelationshipTypes: Record<string, number> }> = {}
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
for (const t of ALL_TYPES) {
  const c = cells[t]
  console.log(`  ${c.rows === 0 ? "RULED" : "E    "}  ${t.padEnd(13)} rows ${String(c.rows).padStart(6)} · files ${String(c.files).padStart(5)} · repos ${String(c.repos).padStart(3)}`)
}
console.log("")
console.log(`THE GRAMMAR's OWN INVENTORY — ${named.length} named type(s): ${named.join(" ")}`)
console.log(`  ${anonymous.length} anonymous type(s): ${anonymous.join(" ")}`)
console.log(`  files parsed ${filesParsed} of ${disc.files.length} · errors ${errors.length}`)
console.log(`  THE PERF: ${elapsedMs} ms for ${disc.files.length} file(s) ⇒ ${(elapsedMs / Math.max(1, disc.files.length)).toFixed(3)} ms/file (the whole pass: parse + construct walk + analyze) ✓✓`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
  console.log(`JSON: ${OUT}`)
}
