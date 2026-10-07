/**
 * KOTLIN_GAP — lane-local ontology census.
 *
 * Runs the analyzer through the PRODUCTION path (`getParser` -> `parse` ->
 * `analyze`) over the pinned kotlin corpus and tallies the relationship types
 * that actually COME OUT, per type, with the files they came from.
 *
 * Source derivation answers only "is this type constructible". This answers
 * "does it FIRE", which is a different question and the one the ontology gate
 * exists for.
 *
 * NO REGEX: file selection is by extension and git ls-files, type selection is
 * by enum value. No pattern matching over source text anywhere in this file.
 *
 * Usage:
 *   bun run script/m14/kotlin-gap/census.ts [fileCount] [--out FILE] [--parse-only]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../../src/ast/engine"
import { RelationshipType } from "../../../src/ast/types"
import { RealKotlinAnalyzer } from "../../../src/ast/real-kotlin-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv0 = process.argv.slice(2)
const repoIdx = argv0.indexOf("--repo")
const REPO_DIR = repoIdx >= 0 ? argv0[repoIdx + 1] : "kotlin"

const ALL_TYPES: string[] = [...new Set(Object.values(RelationshipType))].sort()

const argv = process.argv.slice(2)
const want = Number(argv.find((a) => !a.startsWith("--")) ?? "300")
const outIdx = argv.indexOf("--out")
const outPath = outIdx >= 0 ? argv[outIdx + 1] : undefined

// ------------------------------------------------------------------ corpus
// Deterministic: git ls-files, then lexicographic order, no sampling luck.
const tracked: string[] = execFileSync("git", ["-C", path.join(CR, REPO_DIR), "ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean)

const KOTLIN_EXT = [".kt", ".kts"]
const candidates = tracked
  .filter((rel) => {
    const ext = path.extname(rel).toLowerCase()
    return KOTLIN_EXT.some((e) => ext === e)
  })
  .sort()

let files = candidates
if (want > 0) {
  // Interleave across the tree so a size-ordered prefix cannot put the whole
  // sample inside one directory. Stride sampling, deterministic.
  const stride = Math.max(1, Math.floor(candidates.length / want))
  const strided: string[] = []
  for (let i = 0; i < candidates.length && strided.length < want; i += stride) strided.push(candidates[i])
  files = strided
}

const abs = (rel: string) => path.join(CR, REPO_DIR, rel)
const sizes = files.map((f) => {
  try { return statSync(abs(f)).size } catch { return 0 }
})
const totalBytes = sizes.reduce((a, b) => a + b, 0)

const rev = execFileSync("git", ["-C", path.join(CR, REPO_DIR), "rev-parse", "HEAD"], { encoding: "utf8" }).trim()

console.log(`kotlin ontology census — production path (getParser -> parse -> analyze)`)
console.log(`corpus ${CR}/${REPO_DIR} @ ${rev}`)
console.log(`admitted: ${files.length} of ${candidates.length} tracked .kt/.kts (${(totalBytes / 1024 / 1024).toFixed(1)} MB)\n`)

// ------------------------------------------------------------------ run
const parser = await getParser("kotlin")
const tally = new Map<string, { n: number; files: Set<string>; examples: string[] }>()
const perConf = new Map<string, Map<number, number>>()
const sources = new Map<string, number>() // source-name -> edge count (Calls)
const emptyTargets: string[] = []
const placeholderTargets: string[] = []
const unknownSources = new Map<string, number>()
let symbolTotal = 0
let parseFail = 0
let relTotal = 0
let filesWithErrors = 0
let errorNodes = 0
const typeFiles = new Map<string, Set<string>>()

const PLACEHOLDER_NAMES = new Set(["root", "Global", "this", "super", "constructor", "unknown", "<unknown>"])

for (const rel of files) {
  const p = abs(rel)
  let content: string
  try { content = readFileSync(p, "utf8") } catch { parseFail++; continue }
  let tree: any
  try { tree = await parser.parse(content, p) } catch { parseFail++; continue }
  if (!tree) { parseFail++; continue }
  let res: any
  try { res = new RealKotlinAnalyzer().analyze(tree.rootNode, content, p) } catch (e) {
    parseFail++
    continue
  }
  tree.delete?.()
  symbolTotal += res.symbols?.length ?? 0
  const errs = res.errors ?? []
  if (errs.length) { filesWithErrors++; errorNodes += errs.length }

  for (const r of res.relationships ?? []) {
    const t = String(r.type ?? r.relationshipType ?? "")
    if (!t) continue
    relTotal++
    const row = tally.get(t) ?? { n: 0, files: new Set<string>(), examples: [] }
    row.n++
    row.files.add(rel)
    if (row.examples.length < 3) row.examples.push(`${rel}:${r.line_number ?? "?"} ${r.source} -> ${r.target}`)
    tally.set(t, row)
    if (!typeFiles.has(t)) typeFiles.set(t, new Set())
    typeFiles.get(t)!.add(rel)

    const c = typeof r.confidence === "number" ? r.confidence : -1
    const cm = perConf.get(t) ?? new Map<number, number>()
    cm.set(c, (cm.get(c) ?? 0) + 1)
    perConf.set(t, cm)

    const src = String(r.source ?? "")
    const tgt = String(r.target ?? "")
    if (tgt === "") emptyTargets.push(`${rel}: ${src} -> ""`)
    if (PLACEHOLDER_NAMES.has(tgt)) placeholderTargets.push(`${rel}: ${t} ${src} -> ${tgt}`)
    if (t === "calls") sources.set(src, (sources.get(src) ?? 0) + 1)
    // "unknown symbols": a source that is not any symbol the file produced
    if (t === "overrides" || t === "contains" || t === "exports") {
      // checked below with the symbol set
    }
  }
}

// ------------------------------------------------------------------ report
const rows: any[] = []
for (const t of ALL_TYPES) {
  const row = tally.get(t)
  rows.push({
    type: t,
    verdict: row && row.n > 0 ? "EMITTED" : "SILENT",
    count: row?.n ?? 0,
    files: row?.files.size ?? 0,
    examples: row?.examples ?? [],
    confidence: row ? Object.fromEntries([...(perConf.get(t) ?? new Map())].sort((a, b) => a[0] - b[0])) : {},
  })
}

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("type", 14)}${w("verdict", 10)}${w("count", 10)}${w("files", 8)}confidence`)
console.log("-".repeat(96))
for (const r of rows) {
  console.log(`${w(r.type, 14)}${w(r.verdict, 10)}${w(r.count.toLocaleString(), 10)}${w(String(r.files), 8)}${JSON.stringify(r.confidence)}`)
}
console.log("-".repeat(96))
const emitted = rows.filter((r) => r.verdict === "EMITTED").length
console.log(`EMITTED ${emitted}/10   SILENT ${rows.filter((r) => r.verdict === "SILENT").map((r) => r.type).join(" ") || "(none)"}`)
console.log(`files ${files.length}  symbols ${symbolTotal.toLocaleString()}  relationships ${relTotal.toLocaleString()}  parseFail ${parseFail}`)
console.log(`files carrying ERROR/MISSING warnings: ${filesWithErrors} (${errorNodes} warning records)`)
console.log(`empty-string targets: ${emptyTargets.length}`)
if (placeholderTargets.length) {
  console.log(`placeholder-literal targets: ${placeholderTargets.length}  e.g. ${placeholderTargets.slice(0, 3).join(" | ")}`)
}

const report = {
  at: new Date().toISOString(),
  corpus: { root: CR, repo: REPO_DIR, rev, admittedFiles: files.length, trackedKotlinFiles: candidates.length },
  productionPath: "getParser -> parser.parse -> RealKotlinAnalyzer.analyze",
  enumValues: ALL_TYPES,
  rows,
  totals: {
    symbols: symbolTotal,
    relationships: relTotal,
    parseFail,
    filesWithErrors,
    errorNodes,
    emptyTargets: emptyTargets.length,
    placeholderTargets: placeholderTargets.length,
    placeholderExamples: placeholderTargets.slice(0, 20),
  },
}
if (outPath) {
  writeFileSync(outPath, JSON.stringify(report, null, 1))
  console.log(`\nwrote ${outPath}`)
}
