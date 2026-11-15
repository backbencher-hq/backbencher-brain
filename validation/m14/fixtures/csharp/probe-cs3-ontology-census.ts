/**
 * CS3 / csharp — ONTOLOGY CENSUS: all ten relationship types, three channels.
 *
 * ## Why this file exists
 *
 * `script/m14/firing-check-v2.mjs` has NO `csharp` lane. Its `LANES` table
 * (firing-check-v2.mjs:42-64) lists 20 languages and C# is not one of them, and
 * its `ALIAS` map carries `CSHARP: null` (line 178), so
 *
 *     NFILES=200 bun script/m14/firing-check-v2.mjs CORPUS_CS3
 *
 * exits 2 with "no lane matches". The shared harness is the master's, so this
 * lane did not edit it; this file is the lane's own equivalent, and it differs
 * from v2 in exactly one way that matters: it prints the THIRD channel.
 *
 * ## The three channels, and why two instruments are not enough
 *
 * `ParseResult` (src/ast/types.ts:218-226) carries three lists, and an
 * instrument that reads one of them cannot see the others:
 *
 *   res.relationships : the relationship rows (the `type` string is the label)
 *   res.imports       : ImportInfo[] — `parallel-indexer.ts:2169` writes these to
 *                       the `brain_import` TABLE, never to `brain_relationship`
 *   res.exports       : ExportInfo[] — OPTIONAL in ParseResult (types.ts:223)
 *
 * A type can be present on one channel and absent on the other and neither is a
 * defect. v2 reports the first two; it does not read `exports` at all, so an
 * analyzer that publishes exports would score as silent on `exports`.
 *
 * ## The population is derived, never hand-written
 *
 * HONESTY-CONTRACT §"Rule: an instrument must declare the population it
 * covered": the file list comes from `git ls-files` over every repo in the
 * corpus root, filtered by the repository's OWN `detectLanguageFromPath`, and
 * the admitted count is printed before any tally. A hard-coded `FILES = [...]`
 * would rot silently and keep reporting a confident number.
 *
 * ## No regular expression
 *
 * MASTER-HANDOFF rule 1. Everything here is `node.type` / field lookups /
 * `Set` / `Map`. The corpus filter uses the repository's own language detector
 * rather than a `endsWith(".cs")` pattern of its own.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "csharp"
const NFILES = Number(process.env.NFILES || 0) // 0 = whole admitted population
const REPO_ONLY = process.env.BB_REPO || ""   // restrict to one corpus repo dir

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

// ---------------------------------------------------------------- population
const files: { repo: string; rel: string; abs: string }[] = []
const repos = readdirSync(CR).filter((e) => (REPO_ONLY ? e === REPO_ONLY : true))
for (const e of repos) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let head = ""
    try {
      if (statSync(abs).size > 512 * 1024) continue
      head = readFileSync(abs, "utf8").slice(0, 4096)
    } catch { continue }
    if (detectLanguageFromPath(abs, head) !== LANG) continue
    files.push({ repo: e, rel, abs })
  }
}
const population = files
const drawn = NFILES > 0 ? population.slice(0, NFILES) : population

const byRepo = new Map<string, number>()
for (const f of population) byRepo.set(f.repo, (byRepo.get(f.repo) ?? 0) + 1)

console.log(`CS3 csharp ontology census`)
console.log(`corpus root      : ${CR}`)
console.log(`repos searched   : ${repos.length} (${REPO_ONLY || "all"})`)
console.log(`ADMITS           : ${population.length} files detected as csharp by language-detection.ts`)
for (const [r, n] of [...byRepo].sort((a, b) => b[1] - a[1])) console.log(`   ${r.padEnd(20)} ${n}`)
console.log(`DRAWN            : ${drawn.length} files  (NFILES=${NFILES || "ALL"})`)
console.log(`population share : ${((drawn.length / Math.max(1, population.length)) * 100).toFixed(1)}%`)
console.log()

// ---------------------------------------------------------------- production path
const { parseFile } = await import("../../../../src/ast/pool-worker")

const relTally = new Map<Type, { n: number; files: Set<string> }>()
const relExamples = new Map<Type, string[]>()
let importCount = 0, filesWithImports = 0, importExamples: string[] = []
let exportCount = 0, filesWithExports = 0, exportExamples: string[] = []
let symbolTotal = 0, parseFailed = 0
const unknownKindSymbols: string[] = []
const emptyNameSymbols: string[] = []
const PLACEHOLDER = "unknown"

for (const f of drawn) {
  let r: any
  try {
    r = await parseFile(f.abs, path.join(CR, f.repo))
  } catch {
    parseFailed++
    continue
  }
  symbolTotal += (r?.symbols ?? []).length
  for (const s of r?.symbols ?? []) {
    if (!s.name || String(s.name).length === 0) emptyNameSymbols.push(`${f.repo}/${f.rel}:${s.range?.start?.line ?? "?"}`)
    const k = String(s.kind ?? "")
    if (k.length === 0 || k.toLowerCase() === PLACEHOLDER || k.toLowerCase().includes("unknown"))
      unknownKindSymbols.push(`${f.repo}/${f.rel}:${s.name}=${k || "(empty)"}`)
  }
  for (const x of r?.relationships ?? []) {
    const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
    if (!ALL_TYPES.includes(t)) continue
    const row = relTally.get(t) ?? { n: 0, files: new Set<string>() }
    row.n++
    if (row.files.size < 4) row.files.add(`${f.repo}/${f.rel}`)
    relTally.set(t, row)
    const ex = relExamples.get(t) ?? []
    if (ex.length < 3) {
      ex.push(`${f.repo}/${f.rel}:${x.line_number ?? "?"}  ${x.source} -> ${x.target}  conf=${x.confidence ?? "?"} ev=${x.metadata?.evidenceClass ?? "-"}`)
      relExamples.set(t, ex)
    }
  }
  const imps = r?.imports ?? []
  // `parseFile` is the WORKER, and it maps ImportInfo -> BasicImport
  // (pool-worker.ts:1102-1183): `module` becomes `path`, and one row is emitted
  // per imported NAME. Reading `i.module` here reports the empty string for every
  // lane, which would have been an instrument defect printed as a data defect.
  if (imps.length) {
    importCount += imps.length
    filesWithImports++
    if (importExamples.length < 3)
      importExamples.push(`${f.repo}/${f.rel} :: ${imps.slice(0, 3).map((i: any) => `${i.path}${i.isExternal ? " [external]" : " [project]"}`).join(" , ")}`)
  }
  const exps = r?.exports ?? []
  if (exps.length) { exportCount += exps.length; filesWithExports++; if (exportExamples.length < 3) exportExamples.push(`${f.repo}/${f.rel} :: ${exps.slice(0, 3).map((e: any) => e.name).join(" , ")}`) }
}

console.log(`parsed ${drawn.length - parseFailed}/${drawn.length} files  (failures ${parseFailed})   symbols ${symbolTotal.toLocaleString()}`)
console.log()
console.log(`--- CHANNEL 1: res.relationships ---`)
for (const t of ALL_TYPES) {
  const row = relTally.get(t)
  if (!row) { console.log(`${t.padEnd(14)} 0`); continue }
  console.log(`${t.padEnd(14)} ${String(row.n).padStart(8)} edges in ${row.files.size}+ files`)
  for (const e of relExamples.get(t) ?? []) console.log(`                 ${e}`)
}
console.log()
console.log(`--- CHANNEL 2: res.imports[] (persisted to the brain_import TABLE) ---`)
console.log(`imports         ${String(importCount).padStart(8)} in ${filesWithExports === -1 ? "" : filesWithImports} of ${drawn.length} files`)
for (const e of importExamples) console.log(`                 ${e}`)
console.log()
console.log(`--- CHANNEL 3: res.exports[] (ExportInfo[]) ---`)
console.log(`exports         ${String(exportCount).padStart(8)} in ${filesWithExports} of ${drawn.length} files`)
for (const e of exportExamples) console.log(`                 ${e}`)
console.log()
console.log(`--- STANDING RULES (R7 / SymbolKind) ---`)
console.log(`empty symbol names       ${emptyNameSymbols.length}`)
for (const s of emptyNameSymbols.slice(0, 5)) console.log(`                 ${s}`)
console.log(`empty/unknown symbol kind${unknownKindSymbols.length > 0 ? " " + unknownKindSymbols.length : " 0"}`)
for (const s of unknownKindSymbols.slice(0, 5)) console.log(`                 ${s}`)

const fired = ALL_TYPES.filter((t) => (relTally.get(t)?.n ?? 0) > 0)
console.log()
console.log(`=== VERDICT SUMMARY (relationship channel) ===`)
console.log(`fired ${fired.length}/10: ${fired.join(" ") || "(none)"}`)
console.log(`silent    : ${ALL_TYPES.filter((t) => !fired.includes(t)).join(" ") || "-"}`)
console.log(`imports[] : ${importCount} in ${filesWithImports} files  -> imports verdict = ${importCount > 0 ? "EMITTED" : "SILENT"}`)
console.log(`exports[] : ${exportCount} in ${filesWithExports} files  -> exports verdict = ${exportCount > 0 ? "EMITTED" : "SILENT"}`)
