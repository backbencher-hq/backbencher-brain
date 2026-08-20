// verify-m12-pipeline.ts — M12.44 acceptance:
//  1. All 41 analyzers produce persisted symbols + relationships through the
//     standard pipeline (language detection → analyzer → pool-worker →
//     parallel-indexer storeResults → brain_* tables), with no per-language
//     special casing in storage.
//  2. Worker/pool/indexer paths are language-agnostic — verified by indexing a
//     single multi-language corpus of all 41 fixture languages through
//     indexProjectParallel (production pool-worker path).
//  3. Incremental update, deletion, and rename behave identically for every
//     language (per-file reindex, stale cleanup, deterministic file identity).
//  4. Cross-language resolution works across JVM/.NET/Web/Systems boundaries.
//  5. No analyzer is bypassed by a generic fallback without a documented reason.
//
//   bun run script/m12/verify-m12-pipeline.ts
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

let failures = 0
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`) }
}
console.log(`runtime: ${process.version} (${typeof Bun !== "undefined" ? "bun" : "node"})`)

const root = path.resolve(path.join(import.meta.dir ?? ".", "..", ".."))
const FIXTURE_ROOT = path.join(root, "validation/m12/fixtures")
const LANGUAGES = readdirSync(FIXTURE_ROOT).filter((d) => !d.startsWith(".")).sort()
check("fixture root covers 41 languages", LANGUAGES.length === 41)

// ── Build the multi-language corpus ─────────────────────────────────────────
// Positive fixtures only (Negative.* carry intentional grammar-error data that
// is audited separately). Each language lands in its own subdirectory so all
// 41 coexist without basename collisions.
const corpus = mkdtempSync(path.join(tmpdir(), "bb-m12-pipeline-"))
const filesByLanguage: Record<string, string[]> = {}
for (const lang of LANGUAGES) {
  const srcDir = path.join(FIXTURE_ROOT, lang)
  const dstDir = path.join(corpus, lang)
  mkdirSync(dstDir, { recursive: true })
  const files = readdirSync(srcDir).filter((f) => !f.startsWith("Negative"))
  filesByLanguage[lang] = files
  for (const f of files) copyFileSync(path.join(srcDir, f), path.join(dstDir, f))
}
const corpusFiles = Object.values(filesByLanguage).flat().length
check("multi-language corpus built", corpusFiles === 97, `got ${corpusFiles}`)
check("every language has >=1 positive fixture", LANGUAGES.every((l) => (filesByLanguage[l]?.length ?? 0) >= 1))

// ── 1. Full index through the production pipeline ───────────────────────────
const projectId = getProjectId(corpus)
console.log("  indexing multi-language corpus through indexProjectParallel...")
const stats = await indexProjectParallel(projectId, corpus, { logger: { log: () => {}, write: () => {} } })
check("full index completed with zero file errors", stats.errorFiles === 0, `errors=${stats.errorFiles}`)
check("full index processed all corpus files", stats.successFiles === corpusFiles, `success=${stats.successFiles}`)

const raw = await BrainDatabase.getRawInstance(projectId)
const fileRows = raw.prepare("SELECT id, relative_path, language FROM brain_file WHERE project_id = ?").all(projectId) as any[]
check("all corpus files persisted as brain_file rows", fileRows.length === corpusFiles, `rows=${fileRows.length}`)

// 1a. Every language detected + persisted with the correct language label.
const langsPersisted = new Set(fileRows.map((r) => (r.language || "").toLowerCase()))
const missingLangs = LANGUAGES.filter((l) => !langsPersisted.has(l))
check("all 41 languages persisted with a file row", missingLangs.length === 0, `missing=${missingLangs.join(",")}`)

// 1b. Every language produces >=1 symbol and >=1 relationship in the DB.
const perLangSymbols = new Map<string, number>()
const perLangRels = new Map<string, number>()
for (const lang of LANGUAGES) {
  const fileIds = fileRows
    .filter((r) => (r.language || "").toLowerCase() === lang)
    .map((r) => r.id)
  if (fileIds.length === 0) continue
  const placeholders = fileIds.map(() => "?").join(",")
  const symCount = (raw.prepare(`SELECT COUNT(*) as c FROM brain_symbol WHERE project_id = ? AND file_id IN (${placeholders})`).get(projectId, ...fileIds) as any)?.c ?? 0
  const relCount = (raw.prepare(`SELECT COUNT(*) as c FROM brain_relationship WHERE project_id = ? AND source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id IN (${placeholders}))`).get(projectId, ...fileIds) as any)?.c ?? 0
  perLangSymbols.set(lang, symCount)
  perLangRels.set(lang, relCount)
}
const zeroSymbolLangs = LANGUAGES.filter((l) => (perLangSymbols.get(l) ?? 0) === 0)
const zeroRelLangs = LANGUAGES.filter((l) => (perLangRels.get(l) ?? 0) === 0)
check("every language persists >=1 symbol", zeroSymbolLangs.length === 0, `zero=${zeroSymbolLangs.join(",")}`)
check("every language persists >=1 relationship", zeroRelLangs.length === 0, `zero=${zeroRelLangs.join(",")}`)

const totalSymbols = [...perLangSymbols.values()].reduce((a, b) => a + b, 0)
const totalRels = [...perLangRels.values()].reduce((a, b) => a + b, 0)
check("aggregate symbol persistence is substantial", totalSymbols > 1000, `symbols=${totalSymbols}`)
check("aggregate relationship persistence is substantial", totalRels > 1000, `rels=${totalRels}`)
console.log(`    -> ${totalSymbols} symbols / ${totalRels} relationships across 41 languages`)

// 1c. No analyzer bypassed: every fixture language resolves through a real
//     analyzer, not the generic fallback. The generic fallback emits line
//     regex symbols with only basic kinds; presence of analyzer-specific kinds
//     (method/property/interface/enum/...) proves the real analyzer ran.
const symTypesPerLang = new Map<string, Set<string>>()
for (const lang of LANGUAGES) {
  const fileIds = fileRows.filter((r) => (r.language || "").toLowerCase() === lang).map((r) => r.id)
  if (fileIds.length === 0) continue
  const placeholders = fileIds.map(() => "?").join(",")
  const rows = raw.prepare(`SELECT DISTINCT symbol_type FROM brain_symbol WHERE project_id = ? AND file_id IN (${placeholders})`).all(projectId, ...fileIds) as any[]
  symTypesPerLang.set(lang, new Set(rows.map((r) => r.symbol_type)))
}
const REAL_ANALYZER_KINDS = new Set([
  "method", "property", "constructor", "interface", "enum", "enum_member", "type", "import", "constant", "delegate", "event",
])
// A language is bypassed only when it has NO analyzer-specific kind AND
// almost no persisted symbols. HTML legitimately maps tags to `class`
// (its analyzer contract), so kind alone would be a false positive — but
// the generic fallback cannot extract meaningful symbols from structured
// markup, so a symbol floor proves the real analyzer ran.
const bypassed = LANGUAGES.filter((l) => {
  const kinds = symTypesPerLang.get(l)
  if (!kinds) return true
  const hasRealKind = [...kinds].some((k) => REAL_ANALYZER_KINDS.has(k))
  if (hasRealKind) return false
  const count = perLangSymbols.get(l) ?? 0
  return count < 5
})
check("no language relies solely on generic fallback kinds", bypassed.length === 0, `bypassed=${bypassed.join(",")}`)

// ── 2. Incremental update, deletion, rename ─────────────────────────────────
// Language-appropriate top-level declarations named IncrementalMarker44.
const markerSnippets: Record<string, string> = {
  java: "\nclass IncrementalMarker44 { int value() { return 44; } }\n",
  csharp: "\nclass IncrementalMarker44 { public int Value() { return 44; } }\n",
  typescript: "\nexport class IncrementalMarker44 { value = 44 }\n",
  rust: "\npub struct IncrementalMarker44;\n",
}

// 2a. Incremental update: append a declaration to one file per boundary family
//     and reindex those files (files override + isIncremental).
const incTargets = [
  { file: path.join(corpus, "java", "UserService.java"), snippet: markerSnippets.java },
  { file: path.join(corpus, "csharp", "UserService.cs"), snippet: markerSnippets.csharp },
  { file: path.join(corpus, "typescript", "Services.ts"), snippet: markerSnippets.typescript },
  { file: path.join(corpus, "rust", "service.rs"), snippet: markerSnippets.rust },
]
const { readFileSync: rf, utimesSync } = await import("fs")
const now = new Date()
for (const t of incTargets) {
  writeFileSync(t.file, `${rf(t.file, "utf8")}${t.snippet}`)
  utimesSync(t.file, now, now)
}
const incStats = await indexProjectParallel(projectId, corpus, {
  files: incTargets.map((t) => t.file),
  isIncremental: true,
  logger: { log: () => {}, write: () => {} },
})
check("incremental reindex processed the touched files", incStats.successFiles === incTargets.length, `success=${incStats.successFiles}`)
for (const t of incTargets) {
  const rel = path.relative(corpus, t.file).split(path.sep).join("/")
  const row = raw.prepare("SELECT COUNT(*) as c FROM brain_symbol WHERE project_id = ? AND file_id = ? AND name = ?").get(projectId, `${projectId}:${rel}`, "IncrementalMarker44") as any
  check(`incremental symbol persisted: ${rel}`, (row?.c ?? 0) === 1, `c=${row?.c}`)
}

// 2b. Deletion: remove one file per boundary family, then a full incremental
//     run (no files override) so stale-file cleanup removes the rows.
const delTargets = [
  path.join(corpus, "kotlin", "Models.kt"),
  path.join(corpus, "fsharp", "Domain.fs"),
  path.join(corpus, "python", "Service.py"),
  path.join(corpus, "go", "service.go"),
]
for (const t of delTargets) {
  const rel = path.relative(corpus, t).split(path.sep).join("/")
  check(`pre-delete row exists: ${rel}`, (raw.prepare("SELECT COUNT(*) as c FROM brain_file WHERE project_id = ? AND id = ?").get(projectId, `${projectId}:${rel}`) as any)?.c === 1)
  rmSync(t)
}
const delStats = await indexProjectParallel(projectId, corpus, { isIncremental: true, logger: { log: () => {}, write: () => {} } })
check("post-delete reindex completed", delStats.errorFiles === 0, `errors=${delStats.errorFiles}`)
for (const t of delTargets) {
  const rel = path.relative(corpus, t).split(path.sep).join("/")
  const row = raw.prepare("SELECT COUNT(*) as c FROM brain_file WHERE project_id = ? AND id = ?").get(projectId, `${projectId}:${rel}`) as any
  check(`deleted file row cleaned: ${rel}`, (row?.c ?? 0) === 0, `c=${row?.c}`)
  const symRow = raw.prepare("SELECT COUNT(*) as c FROM brain_symbol WHERE project_id = ? AND file_id = ?").get(projectId, `${projectId}:${rel}`) as any
  check(`deleted file symbols cleaned: ${rel}`, (symRow?.c ?? 0) === 0, `c=${symRow?.c}`)
}

// 2c. Rename: rename one file per boundary family; a full incremental run
//     removes the old identity and persists the new one.
const renamePairs = [
  [path.join(corpus, "scala", "Models.scala"), path.join(corpus, "scala", "ModelsRenamed.scala")],
  [path.join(corpus, "swift", "UserService.swift"), path.join(corpus, "swift", "UserServiceRenamed.swift")],
  [path.join(corpus, "dart", "Services.dart"), path.join(corpus, "dart", "ServicesRenamed.dart")],
  [path.join(corpus, "cpp", "Shape.cpp"), path.join(corpus, "cpp", "ShapeRenamed.cpp")],
]
const { renameSync } = await import("fs")
for (const [from, to] of renamePairs) {
  const fromRel = path.relative(corpus, from).split(path.sep).join("/")
  check(`pre-rename row exists: ${fromRel}`, (raw.prepare("SELECT COUNT(*) as c FROM brain_file WHERE project_id = ? AND id = ?").get(projectId, `${projectId}:${fromRel}`) as any)?.c === 1)
  renameSync(from, to)
}
const renStats = await indexProjectParallel(projectId, corpus, { isIncremental: true, logger: { log: () => {}, write: () => {} } })
check("post-rename reindex completed", renStats.errorFiles === 0, `errors=${renStats.errorFiles}`)
for (const [from, to] of renamePairs) {
  const fromRel = path.relative(corpus, from).split(path.sep).join("/")
  const toRel = path.relative(corpus, to).split(path.sep).join("/")
  const oldRow = raw.prepare("SELECT COUNT(*) as c FROM brain_file WHERE project_id = ? AND id = ?").get(projectId, `${projectId}:${fromRel}`) as any
  const newRow = raw.prepare("SELECT COUNT(*) as c FROM brain_file WHERE project_id = ? AND id = ?").get(projectId, `${projectId}:${toRel}`) as any
  check(`rename: old row gone — ${fromRel}`, (oldRow?.c ?? 0) === 0, `c=${oldRow?.c}`)
  check(`rename: new row persisted — ${toRel}`, (newRow?.c ?? 0) === 1, `c=${newRow?.c}`)
}

// ── 3. Cross-language resolution across boundaries ──────────────────────────
const { CrossLanguageIntelligence } = await import("../../src/ast/cross-language-intelligence")
try {
  const analysis = await CrossLanguageIntelligence.analyzePolyglotProjectFromDB(projectId as any)
  const symbols = analysis?.crossLanguageSymbols ?? []
  const rels = analysis?.crossLanguageRelationships ?? []
  const relTypes = new Set(rels.map((r: any) => r.type))
  check("cross-language analysis returns symbols", symbols.length > 0, `symbols=${symbols.length}`)
  check("cross-language analysis returns relationships", rels.length > 0, `rels=${rels.length}`)
  check("cross-language relationships span multiple types", relTypes.size >= 2, `types=${[...relTypes].join(",")}`)
  console.log(`    -> cross-language: ${symbols.length} symbols / ${rels.length} relationships (${[...relTypes].slice(0, 6).join(", ")})`)
} catch (e: any) {
  check("cross-language analysis runs", false, e?.message?.slice(0, 160) ?? String(e))
}

// ── 4. Language-agnostic storage proof ──────────────────────────────────────
// Storage is a single shared path: one insertFile/insertSymbol/insertRel set
// in storeResults with no per-language branch. Verify the persisted rows carry
// the detected language labels (not "unknown").
const unknownLangRows = fileRows.filter((r) => !r.language || r.language === "unknown")
check("no persisted file row has unknown language", unknownLangRows.length === 0, `count=${unknownLangRows.length}`)

// ── 4b. Verified analyzer contracts survive the store layer ────────────────
// M12.44 regression guard: every one of these names is a VERIFIED ground-truth
// symbol (P/R 1.000 per-analyzer differential) that the store-time noise
// filters used to drop (CSS selectors, Markdown headings, F# active patterns,
// YAML merge keys, Groovy Spock test names, enum members named `None`). They
// must all persist through the standard pipeline now.
const verifiedContractSymbols: Array<[string, string]> = [
  [".header", "css"],
  ["tr[data-order=\"1001\"]", "css"],
  ["Main Title", "markdown"],
  ["1.0.0 - 2026-01-01", "markdown"],
  ["(|Even|Odd|)", "fsharp"],
  ["<<", "yaml"],
  ["addition works", "groovy"],
  ["None", "typescript"],
  ["None", "csharp"],
  ["$schema", "json"],
  ["Address", "json"],
]
for (const [name, lang] of verifiedContractSymbols) {
  const fileIds = fileRows.filter((r) => (r.language || "").toLowerCase() === lang).map((r) => r.id)
  const placeholders = fileIds.map(() => "?").join(",")
  const row = fileIds.length
    ? (raw.prepare(`SELECT COUNT(*) as c FROM brain_symbol WHERE project_id = ? AND name = ? AND file_id IN (${placeholders})`).get(projectId, name, ...fileIds) as any)
    : { c: 0 }
  check(`verified contract symbol persisted: ${lang} ${JSON.stringify(name)}`, (row?.c ?? 0) >= 1, `c=${row?.c}`)
}

// Cleanup
rmSync(corpus, { recursive: true, force: true })
rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })

if (failures > 0) {
  console.error(`\nM12 PIPELINE VERIFY: FAIL (${failures} failure${failures === 1 ? "" : "s"})`)
  process.exit(1)
}
console.log("\nM12 PIPELINE VERIFY: PASS")
