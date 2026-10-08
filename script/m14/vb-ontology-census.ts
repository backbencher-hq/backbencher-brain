/**
 * VB ONTOLOGY CENSUS — the per-type measurement behind every VERIFY_VB10 verdict.
 *
 * ## Why this file exists rather than a line in a report
 *
 * `firing-check-v2.mjs` answers exactly one question: which of the ten production
 * relationship types came out. It prints a count per type and nothing about the
 * SHAPE of those edges — so it cannot answer the six questions the workstream asks
 * of a type that is already emitted, and it cannot support a ruling for a type that
 * is not. This census is the instrument for both, and it is the lane's own, so it
 * runs against the ANALYZER IN THIS WORKTREE rather than the main checkout.
 *
 * ## Population is DERIVED, never a hand-written list
 *
 * The honesty contract's "an instrument must declare the population it covered"
 * rule exists because a lane printed "0 regexes across 0 of 16 files" when it had
 * scanned 16 of its 25. So this file walks the corpus directory itself, prints how
 * many `.vb` files it found, and reports every count against THAT number. A count
 * here is always "N of M", where M is what the walk actually saw.
 *
 * ## Which files it measures over, and which it refuses
 *
 * `parseFile` (src/ast/pool-worker.ts) is the PRODUCTION entry and it is used here,
 * not `analyze()` — the workstream's EMITTED verdict is defined on parseFile, and
 * calling the analyzer directly skips the 5 MB structural bail and the 1 MB
 * full-AST threshold, both of which are production behaviour a consumer sees.
 * Files over 1 MB therefore take the structural path and produce no AST edges.
 * They are COUNTED and reported rather than dropped silently: the number of them
 * is part of every verdict, because a corpus where most files bypass the analyzer
 * cannot support an EMITTED claim about itself.
 *
 * ## No regex anywhere in this file
 *
 * The same rule the analyzer holds itself to. Name matching is `endsWith` and
 * `lastIndexOf`; classification is a node-type test or a field read. The one place
 * a pattern would be tempting — "is this endpoint a placeholder literal?" — is a
 * table lookup plus a character scan, written out below.
 */

import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.VB_CORPUS ?? "roslyn-vb"
const LIMIT = Number(process.env.VB_NFILES ?? 0) // 0 = every file the walk finds
const DIR = join(CORPUS_ROOT, REPO)

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

// ---------------------------------------------------------------------------
// helpers — no regex
// ---------------------------------------------------------------------------

function hasSuffix(s: string, suffix: string): boolean {
  if (s.length < suffix.length) return false
  return s.lastIndexOf(suffix) === s.length - suffix.length
}

/** Is this char an ASCII letter? Used by the placeholder-literal scan. */
function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

/**
 * The placeholder-literal test for an edge endpoint (standing rule R7).
 *
 * An endpoint is PLACEHOLDER if, after lower-casing by char code, it is one of the
 * literals the product uses when it has nothing to name. A character scan, not a
 * pattern: the table is exact-match and the scan only decides whether a leading
 * `<`/`>` angle bracket pair is present, which is how this codebase writes an
 * unnameable thing.
 */
const PLACEHOLDERS = new Set([
  "unknown", "unnamed", "?", "<unknown>", "<unnamed>", "<empty>", "empty",
  "undefined", "null", "nil", "none", "todo", "tbd", "n/a", "na",
])
function isPlaceholderEndpoint(s: string): boolean {
  let lo = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    lo += (c >= 65 && c <= 90) ? String.fromCharCode(c + 32) : s.charAt(i)
  }
  if (PLACEHOLDERS.has(lo)) return true
  // A bracketed body, `<anything>`, is the codebase's other spelling of "unnamed".
  if (lo.length >= 3 && lo.charCodeAt(0) === 60 && lo.charCodeAt(lo.length - 1) === 62) return true
  return false
}

// ---------------------------------------------------------------------------
// population — derived by walking the directory, never a literal list
// ---------------------------------------------------------------------------

function derivePopulation(dir: string, ext: string, want: number): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    if (out.length >= want || depth > 24) return
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      if (out.length >= want) return
      if (e.name === "node_modules" || e.name === ".git") continue
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (!hasSuffix(e.name, ext)) continue
      try { if (statSync(p).isFile()) out.push(p) } catch {}
    }
  }
  walk(dir, 0)
  return out
}

const ALL_ON_DISK = derivePopulation(DIR, ".vb", Number.MAX_SAFE_INTEGER)
const files = LIMIT > 0 ? ALL_ON_DISK.slice(0, LIMIT) : ALL_ON_DISK

console.log("=" .repeat(92))
console.log("VB ONTOLOGY CENSUS — analyzer: src/ast/real-vb-analyzer.ts (this worktree)")
console.log(`corpus dir: ${DIR}`)
console.log(`population DERIVED by directory walk: ${ALL_ON_DISK.length} .vb files on disk`)
console.log(`population MEASURED this run:        ${files.length} files` + (LIMIT > 0 ? ` (VB_NFILES=${LIMIT})` : " (all of them)"))
console.log(`entry point: parseFile() from src/ast/pool-worker.ts — production, not analyze()`)
console.log("=".repeat(92) + "\n")

// ---------------------------------------------------------------------------
// pass 1 — symbols, so endpoints can be RESOLVED later
// ---------------------------------------------------------------------------

function pctCell(x: number, of: number): string {
  if (of === 0) return "—".padStart(10)
  return `${x} ${((x / of) * 100).toFixed(1)}%`.padStart(10)
}

type FileRec = {
  abs: string
  rel: string
  bytes: number
  overStructuralLimit: boolean
  overFullAstLimit: boolean
  ok: boolean
  error: string
  symbols: any[]
  symbolNames: Set<string>
  edges: any[]
  imports: any[]
  exports: any[]
  metadata: any
}

const recs: FileRec[] = []
let parseFailures = 0
const parseFailExamples: string[] = []

for (const abs of files) {
  const rel = abs.slice(DIR.length + 1)
  let bytes = 0
  try { bytes = statSync(abs).size } catch {}
  const rec: FileRec = {
    abs, rel, bytes,
    overStructuralLimit: bytes > 5 * 1024 * 1024,
    overFullAstLimit: bytes > 1 * 1024 * 1024,
    ok: false, error: "",
    symbols: [], symbolNames: new Set<string>(), edges: [], imports: [], exports: [], metadata: null,
  }
  try {
    const r: any = await parseFile(abs, DIR)
    rec.ok = true
    rec.symbols = r.symbols ?? []
    rec.edges = r.relationships ?? []
    rec.imports = r.imports ?? []
    rec.exports = r.exports ?? []
    rec.metadata = r.metadata ?? null
    for (const s of rec.symbols) if (typeof s?.name === "string" && s.name.length > 0) rec.symbolNames.add(s.name)
  } catch (e: any) {
    parseFailures++
    if (parseFailExamples.length < 5) parseFailExamples.push(`${rel}: ${String(e).slice(0, 120)}`)
  }
  recs.push(rec)
  if ((recs.length % 250) === 0) process.stderr.write(`  …${recs.length}/${files.length}\n`)
}

const projectNames = new Set<string>()
for (const r of recs) for (const n of r.symbolNames) projectNames.add(n)

// ---------------------------------------------------------------------------
// pass 2 — the per-type table
// ---------------------------------------------------------------------------

type TypeRow = {
  n: number
  files: Set<string>
  exampleFiles: string[]
  confBelow07: number
  confIs10: number
  srcResolvesInFile: number
  srcResolvesProject: number
  tgtResolvesInFile: number
  tgtResolvesProject: number
  srcIsRoot: number
  tgtPlaceholder: number
  srcPlaceholder: number
  emptyEndpoint: number
  selfEdge: number
  confidences: Map<string, number>
  byMetaKey: Map<string, number>
  examples: string[]
}

function newRow(): TypeRow {
  return {
    n: 0, files: new Set<string>(), exampleFiles: [], confBelow07: 0, confIs10: 0,
    srcResolvesInFile: 0, srcResolvesProject: 0, tgtResolvesInFile: 0, tgtResolvesProject: 0,
    srcIsRoot: 0, tgtPlaceholder: 0, srcPlaceholder: 0, emptyEndpoint: 0, selfEdge: 0,
    confidences: new Map<string, number>(), byMetaKey: new Map<string, number>(), examples: [],
  }
}

const rows = new Map<Type, TypeRow>()
for (const t of ALL_TYPES) rows.set(t, newRow())

let totalSymbols = 0
let totalEdges = 0
let totalImports = 0
let totalExports = 0
let emptySymbolNames = 0
let unknownSymbolKinds = 0
let missingSymbolKinds = 0
let membersWithoutOwner = 0
let membersWithoutOwnerInCleanFile = 0
let edgesWithoutLine = 0
let gapTotals = new Map<string, number>()
let relUnknownType = 0

const cleanFiles = recs.filter((r) => r.ok)
const anyEdgeFile = new Set<string>()

for (const r of cleanFiles) {
  totalSymbols += r.symbols.length
  totalImports += r.imports.length
  totalExports += r.exports.length
  const gapMeta = r.metadata?.vbGaps
  if (gapMeta && typeof gapMeta === "object") {
    for (const k of Object.keys(gapMeta)) gapTotals.set(k, (gapTotals.get(k) ?? 0) + Number(gapMeta[k] || 0))
  }
  for (const s of r.symbols) {
    if (typeof s?.name !== "string" || s.name.length === 0) emptySymbolNames++
    if (s?.kind === undefined || s?.kind === null) missingSymbolKinds++
    if (typeof s?.kind === "string" && (s.kind === "unknown" || s.kind === "")) unknownSymbolKinds++
    const ownerless = s?.ownerName === undefined || s.ownerName === null
    if (ownerless && (s?.kind === "method" || s?.kind === "property" || s?.kind === "field" || s?.kind === "variable" || s?.kind === "event" || s?.kind === "constructor")) {
      membersWithoutOwner++
      if (!r.overFullAstLimit) membersWithoutOwnerInCleanFile++
    }
  }
  for (const e of r.edges) {
    totalEdges++
    anyEdgeFile.add(r.rel)
    const t = String(e?.type ?? e?.relationshipType ?? "")
    if (t === "" || t === "undefined" || t === "null") { relUnknownType++; continue }
    if (!(ALL_TYPES as readonly string[]).includes(t)) { relUnknownType++; continue }
    const row = rows.get(t as Type)!
    row.n++
    row.files.add(r.rel)
    if (row.exampleFiles.length < 6 && !row.exampleFiles.includes(r.rel)) row.exampleFiles.push(r.rel)
    if (e.line_number === undefined || e.line_number === null) edgesWithoutLine++
    const conf = typeof e.confidence === "number" ? e.confidence : -1
    const cs = String(conf)
    row.confidences.set(cs, (row.confidences.get(cs) ?? 0) + 1)
    if (conf >= 0 && conf < 0.7) row.confBelow07++
    if (conf === 1.0) row.confIs10++
    const src = String(e.source ?? "")
    const tgt = String(e.target ?? "")
    if (src.length === 0 || tgt.length === 0) row.emptyEndpoint++
    if (src === tgt) row.selfEdge++
    if (src === "root") row.srcIsRoot++
    if (isPlaceholderEndpoint(tgt)) row.tgtPlaceholder++
    if (isPlaceholderEndpoint(src)) row.srcPlaceholder++
    if (r.symbolNames.has(src)) row.srcResolvesInFile++
    if (r.symbolNames.has(tgt)) row.tgtResolvesInFile++
    if (src.length > 0 && projectNames.has(src)) row.srcResolvesProject++
    if (tgt.length > 0 && projectNames.has(tgt)) row.tgtResolvesProject++
    for (const k of Object.keys(e.metadata ?? {})) row.byMetaKey.set(k, (row.byMetaKey.get(k) ?? 0) + 1)
    if (row.examples.length < 4) {
      row.examples.push(`${r.rel}:${e.line_number ?? "?"} ${JSON.stringify(src)} -[${t}]-> ${JSON.stringify(tgt)} (c=${conf})`)
    }
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

console.log(`files walked              ${files.length}`)
console.log(`  parseFile() returned     ${cleanFiles.length}`)
console.log(`  parseFile() threw        ${parseFailures}${parseFailExamples.length ? `  e.g. ${parseFailExamples[0]}` : ""}`)
console.log(`  over 1 MB (structural)   ${recs.filter((r) => r.overFullAstLimit).length}  ← these take parseFile's structural path and contribute NO AST edge`)
console.log(`  over 5 MB (skipped)      ${recs.filter((r) => r.overStructuralLimit).length}`)
console.log(`  files that produced >=1 relationship edge: ${anyEdgeFile.size}`)
console.log(`  total bytes              ${recs.reduce((a, r) => a + r.bytes, 0)}`)
console.log("")
console.log(`symbols                   ${totalSymbols}`)
console.log(`relationships             ${totalEdges}`)
console.log(`  without a line_number   ${edgesWithoutLine}`)
console.log(`  type not in the 10      ${relUnknownType}`)
console.log(`imports[] (separate ch.)  ${totalImports}`)
console.log(`exports[] (separate ch.)  ${totalExports}`)
console.log(`empty symbol names        ${emptySymbolNames}`)
console.log(`missing/unknown kinds     ${missingSymbolKinds} / ${unknownSymbolKinds}`)
console.log(`members without owner     ${membersWithoutOwner} (of which in a file under 1 MB: ${membersWithoutOwnerInCleanFile})`)
if (gapTotals.size > 0) {
  console.log("declared gaps (metadata.vbGaps):")
  for (const [k, v] of [...gapTotals.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(38)} ${v}`)
} else {
  console.log("declared gaps (metadata.vbGaps): (none reported)")
}
console.log("")

console.log("PER-TYPE TABLE")
console.log("-".repeat(120))
const COLS = "type".padEnd(14) + "count".padStart(9) + "files".padStart(8) +
  "heur<0.7".padStart(10) + "src@file".padStart(10) + "tgt@file".padStart(10) +
  "tgt@proj".padStart(10) + "self".padStart(8) + "place".padStart(8) + "empty".padStart(8)
console.log(COLS)
console.log("-".repeat(COLS.length))
for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  console.log(
    t.padEnd(14) + String(r.n).padStart(9) + String(r.files.size).padStart(8) +
    pctCell(r.confBelow07, r.n) + pctCell(r.srcResolvesInFile, r.n) +
    pctCell(r.tgtResolvesInFile, r.n) + pctCell(r.tgtResolvesProject, r.n) +
    String(r.selfEdge).padStart(8) +
    String(r.tgtPlaceholder + r.srcPlaceholder).padStart(8) + String(r.emptyEndpoint).padStart(8),
  )
}
console.log("-".repeat(COLS.length))
console.log("percentages are OF THE TYPE'S OWN EDGE COUNT; @file = resolves to a symbol declared in the SAME file,")
console.log("@proj = resolves to a symbol declared ANYWHERE in the measured corpus (a bare name is project-ambiguous).")

for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  console.log(`\n== ${t} == ${r.n === 0 ? "NOT EMITTED — 0 edges in " + cleanFiles.length + " files" : `${r.n} edges in ${r.files.size} files`}`)
  if (r.n === 0) continue
  console.log(`   confidence histogram: ${[...r.confidences.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}:${v}`).join("  ")}`)
  console.log(`   src resolves PROJECT-wide: ${r.srcResolvesProject}/${r.n}   tgt resolves PROJECT-wide: ${r.tgtResolvesProject}/${r.n}`)
  console.log(`   src is the literal "root": ${r.srcIsRoot}   self-edges: ${r.selfEdge}   empty endpoint: ${r.emptyEndpoint}`)
  console.log(`   metadata keys: ${[...r.byMetaKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join("  ")}`)
  console.log(`   example files: ${r.exampleFiles.slice(0, 4).join("  ")}`)
  for (const e of r.examples.slice(0, 3)) console.log(`   e.g. ${e}`)
}

console.log("\nDONE. Every count above is against a DERIVED population of " + ALL_ON_DISK.length + " .vb files on disk.")