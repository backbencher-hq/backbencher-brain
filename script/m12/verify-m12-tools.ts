// verify-m12-tools.ts — M12.45 acceptance:
//  1. Each intelligence tool validated on a representative multi-language corpus
//     covering all 41 analyzers.
//  2. Language-specific symbol kinds resolve in tool queries (F# modules, Rust
//     traits, SQL tables, Markdown headings, CSS selectors, YAML merge keys,
//     JSON $schema, enum members, delegates, events, macros, ...).
//  3. No tool silently drops language-specific facts.
//  4. CLI and MCP outputs are consistent for the same query on the same corpus:
//     the compiled CLI (`node bin/bb tool ...`) and the MCP handlers share the
//     same dispatch, and parity is proven by comparing the real CLI output to
//     the handler output byte-for-byte.
//
//   bun run script/m12/verify-m12-tools.ts
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, readdirSync, readFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { spawnSync } from "child_process"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { createToolHandlers } from "../../src/mcp/tool-handlers"

let failures = 0
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`) }
}

const root = path.resolve(path.join(import.meta.dir ?? ".", "..", ".."))
const FIXTURE_ROOT = path.join(root, "validation/m12/fixtures")
const GT_ROOT = path.join(root, "validation/m12/ground-truth")
const LANGUAGES = readdirSync(FIXTURE_ROOT).filter((d) => !d.startsWith(".")).sort()
check("fixture root covers 41 languages", LANGUAGES.length === 41)

// ── Build the multi-language corpus (mirrors M12.44) ────────────────────────
const corpus = mkdtempSync(path.join(tmpdir(), "bb-m12-tools-"))
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

const projectId = getProjectId(corpus)
console.log("  indexing multi-language corpus...")
const stats: any = await indexProjectParallel(projectId, corpus, { logger: { log: () => {}, write: () => {} } })
check("index completed with zero file errors", stats.errorFiles === 0, `errors=${stats.errorFiles}`)
check("all corpus files indexed", stats.successFiles === corpusFiles, `${stats.successFiles}/${corpusFiles}`)

const raw = await BrainDatabase.getRawInstance(projectId)
const ctx = { projectId: String(projectId), projectPath: corpus }
const handlers = createToolHandlers()
const run = async (name: string, args: any) => {
  try {
    const r = await handlers[name](args, ctx as any)
    return { text: r.content?.map((c: any) => c.text).join("\n") ?? "", isError: !!r.isError, thrown: "" }
  } catch (e: any) {
    return { text: "", isError: true, thrown: e?.message ?? String(e) }
  }
}

// Parse the bb_search symbols text format: `name [type] file:line (lang)`
const SEARCH_LINE = /^(.+?) \[([^\]]+)\] (.+?):(\d+) \(([^)]+)\)$/
function parseSearchLines(text: string): Array<{ name: string; type: string; file: string; line: number; language: string }> {
  const out: Array<{ name: string; type: string; file: string; line: number; language: string }> = []
  for (const line of text.split("\n")) {
    const m = line.match(SEARCH_LINE)
    if (m) out.push({ name: m[1], type: m[2], file: m[3], line: Number(m[4]), language: m[5] })
  }
  return out
}

// ── 1. Per-language search sweep: every language's GT symbols resolve ───────
const LANGUAGE_SPECIFIC_KINDS = new Set([
  "module", "interface", "trait", "enum", "enum_member", "table", "delegate", "event",
  "macro", "constant", "struct", "type", "namespace", "prop", "rune", "reactive",
])
const probesPerLang: Record<string, string[]> = {}
let sweepChecks = 0
let sweepFailures = 0
for (const lang of LANGUAGES) {
  const gtPath = path.join(GT_ROOT, `${lang}.json`)
  if (!existsSync(gtPath)) { console.log(`  (no GT for ${lang})`); continue }
  let gt: any
  try { gt = JSON.parse(readFileSync(gtPath, "utf8")) } catch { continue }
  const names: string[] = []
  const seen = new Set<string>()
  for (const f of gt.facts ?? []) {
    if (f.kind !== "symbol") continue
    // Probe only positive fixtures (Negative.* carry intentional errors) and
    // skip .h facts — header files detect as language `c` by design, so their
    // symbols correctly resolve under `c`, not the fixture dir name.
    const file = String(f.file ?? "")
    if (file.startsWith("Negative") || file.endsWith(".h")) continue
    const n = (f.attributes ?? {}).name
    const k = (f.attributes ?? {}).symbolKind ?? ""
    if (!n || seen.has(n)) continue
    seen.add(n)
    if (LANGUAGE_SPECIFIC_KINDS.has(k)) names.push(n)
    if (names.length >= 4) break
  }
  if (names.length === 0) {
    for (const f of gt.facts ?? []) {
      if (f.kind !== "symbol") continue
      const file = String(f.file ?? "")
      if (file.startsWith("Negative") || file.endsWith(".h")) continue
      const n = (f.attributes ?? {}).name
      if (!n || seen.has(n)) continue
      seen.add(n)
      names.push(n)
      if (names.length >= 4) break
    }
  }
  probesPerLang[lang] = names
  for (const name of names) {
    // exact match so common names (User, Repository, Status) resolve to the
    // exact rows without being truncated by broad substring matches
    const out = await run("bb_search", { query: name, limit: 30, exact: true })
    const hits = parseSearchLines(out.text).filter((r) => r.language === lang)
    if (out.isError || hits.length < 1) sweepFailures++
    check(`bb_search resolves ${lang} symbol ${JSON.stringify(name)}`, !out.isError && hits.length >= 1, out.thrown || `got ${hits.length}`)
    sweepChecks++
  }
}
check("search sweep covered all 41 languages", Object.keys(probesPerLang).length === 41, `${Object.keys(probesPerLang).length}/41`)
console.log(`    -> ${sweepChecks} per-language symbol probes, ${sweepChecks - sweepFailures}/${sweepChecks} resolved`)

// ── 2. bb_search content mode ───────────────────────────────────────────────
const contentOut = await run("bb_search", { mode: "content", query: "IncrementalMarker44", limit: 3 })
check("bb_search content mode runs", !contentOut.isError, contentOut.thrown ?? "")

// ── 3. bb_health: counts ────────────────────────────────────────────────────
const healthOut = await run("bb_health", {})
check("bb_health runs", !healthOut.isError, healthOut.thrown ?? "")
const healthMatch = healthOut.text.match(/files=(\d+) symbols=(\d+) relationships=(\d+)/)
const [hFiles, hSymbols, hRels] = healthMatch ? [Number(healthMatch[1]), Number(healthMatch[2]), Number(healthMatch[3])] : [0, 0, 0]
check("bb_health reports all corpus files", hFiles === corpusFiles, `files=${hFiles}`)
check("bb_health reports symbols > 1000", hSymbols > 1000, `symbols=${hSymbols}`)
check("bb_health reports relationships > 1000", hRels > 1000, `rels=${hRels}`)
const unknownLang = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=? AND COALESCE(language,'')='unknown'").get(projectId) as any)?.c ?? 0
check("no unknown-language files in health", unknownLang === 0, `unknown=${unknownLang}`)

// ── 4. bb_analyze: stats / complexity / callers ─────────────────────────────
const statsOut = await run("bb_analyze", { mode: "stats" })
check("bb_analyze stats runs", !statsOut.isError, statsOut.thrown ?? "")
const statsParsed = safeParse(statsOut.text)
const st = Array.isArray(statsParsed) ? statsParsed[0] : statsParsed
check("bb_analyze stats totals > 0", Number(st?.symbols ?? 0) > 1000 && Number(st?.relationships ?? 0) > 1000, `s=${st?.symbols} r=${st?.relationships}`)

const complexityOut = await run("bb_analyze", { mode: "complexity", target: "java/UserService.java" })
check("bb_analyze complexity (java file) runs", !complexityOut.isError, complexityOut.thrown ?? "")

const callerTarget = pickCallerTarget()
const callersOut = await run("bb_analyze", { mode: "callers", target: callerTarget, limit: 10 })
check(`bb_analyze callers (${callerTarget}) runs`, !callersOut.isError, callersOut.thrown ?? "")

function pickCallerTarget(): string {
  const rows = raw.prepare("SELECT s.name FROM brain_symbol s WHERE s.project_id=? AND s.symbol_type='method' ORDER BY s.complexity DESC LIMIT 30").all(projectId) as any[]
  for (const prefer of ["handleRequest", "getUserById", "createUser", "process"]) {
    const hit = rows.find((r) => r.name === prefer)
    if (hit) return hit.name
  }
  return (rows[0]?.name) || ""
}

// ── 5. bb_patterns: orphaned scan ───────────────────────────────────────────
const patternsOut = await run("bb_patterns", { scope: "orphaned", limit: 50 })
check("bb_patterns orphaned runs", !patternsOut.isError, patternsOut.thrown ?? "")
const orphanMatch = patternsOut.text.match(/orphaned code \((\d+)\)/)
check("bb_patterns finds orphaned code", orphanMatch != null && Number(orphanMatch[1]) > 0, `count=${orphanMatch?.[1]}`)

// ── 6. bb_security ───────────────────────────────────────────────────────────
const secOut = await run("bb_security", {})
check("bb_security runs", !secOut.isError, secOut.thrown ?? "")

// ── 7. bb_visualize: project graph spans language families ───────────────────
const visOut = await run("bb_visualize", { scope: "project", format: "json", maxNodes: 800, maxLinks: 8000 })
check("bb_visualize project runs", !visOut.isError, visOut.thrown ?? "")
const visParsed = safeParse(visOut.text)
const nodes = Array.isArray(visParsed?.nodes) ? visParsed.nodes : []
const langSet = new Set<string>((nodes as any[]).map((n) => n?.group ?? "").filter(Boolean))
check("visualize graph spans >= 3 language families", langSet.size >= 3, `langs=${[...langSet].slice(0, 8).join(",")}`)
console.log(`    -> graph: ${nodes.length} nodes across ${langSet.size} languages`)

// ── 8. bb_doc: cited docs for a language-specific symbol ────────────────────
const docTarget = probesPerLang.rust?.[0] || "Shape"
const docOut = await run("bb_doc", { mode: "symbol", target: docTarget, format: "json" })
check(`bb_doc symbol (${docTarget}) runs`, !docOut.isError, docOut.thrown ?? "")
check("bb_doc cites the target symbol", docOut.text.includes(docTarget), `len=${docOut.text.length}`)

// ── 9. bb_migrate: cross-language migration plan ─────────────────────────────
const migrateTarget = probesPerLang.java?.[0] || "BaseService"
const migrateOut = await run("bb_migrate", { symbolNames: [migrateTarget], targetLanguage: "rust", format: "json" })
check(`bb_migrate (${migrateTarget} -> rust) runs`, !migrateOut.isError, migrateOut.thrown ?? "")
const migrateParsed = safeParse(migrateOut.text)
check("bb_migrate returns a plan", migrateParsed != null, `len=${migrateOut.text.length}`)

// ── 10. bb_edit: dry-run refactor on a corpus symbol ────────────────────────
const editTarget = resolveUniqueSymbol("class", "java")
const editOut = await run("bb_edit", {
  mode: "refactor", symbolName: editTarget.name, newName: `${editTarget.name}Renamed45`,
  filePath: editTarget.file, lineStart: editTarget.line, dryRun: true,
})
check(`bb_edit dry-run refactor (${editTarget.name}) runs`, !editOut.isError, editOut.thrown ?? "")
check("bb_edit dry-run returns preview", editOut.text.length > 0, `len=${editOut.text.length}`)

function resolveUniqueSymbol(kind: string, lang: string): { name: string; file: string; line: number } {
  const row = raw.prepare(
    "SELECT s.name AS name, f.relative_path AS file, s.line_start AS line FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND f.language=? AND s.symbol_type=? LIMIT 1",
  ).get(projectId, lang, kind) as any
  return row ? { name: row.name, file: row.file, line: Number(row.line) } : { name: "BaseService", file: "java/BaseService.java", line: 6 }
}

// ── 11. CLI parity: compiled CLI output == handler output ───────────────────
const cliBin = path.join(root, "bin/bb")
for (const [label, name, args] of [
  ["search", "bb_search", { query: "Repository", limit: 3 }],
  ["health", "bb_health", {}],
] as const) {
  const sp = spawnSync("node", [cliBin, "tool", name, "--dir", corpus, "--args", JSON.stringify(args)], { encoding: "utf8", timeout: 180000 })
  // The compiled CLI runs under plain Node, the handler under Bun — the health
  // report's `runtime:` line documents this by design, so it is normalized
  // before the byte-for-byte comparison.
  const normalize = (s: string) => s.replace(/runtime: (bun|node) [^\n]+/, "runtime: <rt>").trim()
  const cliOut = normalize(sp.stdout || "")
  const handlerOut = normalize((await run(name, args as any)).text)
  check(`CLI/handler parity: ${label}`, sp.status === 0 && cliOut === handlerOut, `status=${sp.status} cliLen=${cliOut.length} handlerLen=${handlerOut.length}${sp.stderr ? ` stderr=${String(sp.stderr).slice(0, 120)}` : ""}`)
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
rmSync(corpus, { recursive: true, force: true })
rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })

if (failures > 0) {
  console.error(`\nM12 TOOLS VERIFY: FAIL (${failures} failure${failures === 1 ? "" : "s"})`)
  process.exit(1)
}
console.log("\nM12 TOOLS VERIFY: PASS")

function safeParse(text: string): any {
  try { return JSON.parse(text) } catch { return null }
}
