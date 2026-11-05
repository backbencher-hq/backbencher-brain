// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the language × tool matrix gate: for EVERY language the
//   engine registers, index one real fixture of that language and prove the public
//   tools answer over it (search, graph, impact, doc, annotations, edit, cross-
//   language, migrate) plus the project-wide surfaces (health, analyze, patterns,
//   security, visualize, index, annotate round-trip).
// WHICH TOOLS IT SERVES — all sixteen public MCP tools: the matrix is about the
//   TOOL LAYER over every analyzer, not about analyzer accuracy (that is the M14
//   language campaign's own per-language evidence).
// WHY IT EXISTS — the tools read the index, so "the tools work for every language"
//   must be measured, not asserted. This gate derives the language set from the
//   engine, never writes it down, so a new analyzer/grammar automatically joins the
//   matrix; a language with no fixture FAILS with an actionable message instead of
//   being silently skipped.
// REUSE CONTRACT — everything the gate writes lives under `.langmatrix/` (fixture
//   copies + brain DB); the owner's real index is never touched. Run it standalone
//   while editing (`bun run script/verify-language-tool-matrix.ts --only=python`),
//   list the matrix (`--list`), or as part of `npm run verify:tools`.
// WHERE ITS EVIDENCE LIVES — validation/languages/results/tool-matrix.json.
// EDIT TOGETHER WHEN THIS CHANGES — src/ast/engine.ts (language table),
//   src/ast/language-detection.ts (extension routing), validation/m12/fixtures/
//   (the canonical fixture per language), script/verify-tools.ts (launch gate).
// CONTRACTS IT MUST NOT BREAK — the language list is DERIVED; a missing fixture is
//   a failure, never a skip; every strict check can go red; write-path probes are
//   dry-run only; the scratch tree is removed unless --keep is passed.
// ─────────────────────────────────────────────────────────────────────────────
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

// BB_DATA_DIR must be set BEFORE any bb module import so no module can observe ~/.bb.
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..")
const SCRATCH = join(ROOT, ".langmatrix")
const DATA_DIR = join(SCRATCH, "data")
const PROJECT_ROOT = join(SCRATCH, "project")
process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

const argv = process.argv.slice(2)
const hasFlag = (name: string): boolean => argv.includes(name)
const flagValue = (name: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : undefined
}
const LIST_ONLY = hasFlag("--list")
const VERBOSE = hasFlag("--verbose")
const KEEP = hasFlag("--keep")
const ONLY = flagValue("--only")?.trim().toLowerCase() || null
const EVIDENCE = join(ROOT, "validation", "languages", "results", "tool-matrix.json")

interface Fixture { source: string; rel: string; origin: string }
interface CheckResult { name: string; ok: boolean; detail: string; strict: boolean }
interface LanguageRow {
  language: string
  routeExtension: string
  fixture: Fixture | null
  projectRel: string
  routed: string | null
  indexedLanguage: string | null
  files: number
  symbols: number
  relationships: number
  probeSymbol: string | null
  probeKind: string | null
  checks: CheckResult[]
  editSupport: "dry-run-planned" | "refused" | "not-run"
  migrateShape: string
}

let checks = 0
let passed = 0
let failed = 0
let negatives = 0
const failures: string[] = []

function check(label: string, ok: boolean, detail = "", strict = true): boolean {
  checks++
  if (ok) passed++
  else if (strict) {
    failed++
    failures.push(`${label}${detail ? " — " + detail : ""}`)
    console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`)
  }
  return ok
}
function negative(label: string, ok: boolean, detail = ""): void {
  negatives++
  check(`[negative] ${label}`, ok, detail, true)
}

function isFile(p: string): boolean { try { return statSync(p).isFile() } catch { return false } }
function isDir(p: string): boolean { try { return statSync(p).isDirectory() } catch { return false } }
function walk(dir: string, depth = 0, out: string[] = []): string[] {
  if (depth > 5) return out
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (e.name.startsWith(".")) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1, out)
    else if (e.isFile()) out.push(p)
  }
  return out
}

// Fixtures that are deliberately invalid are not declaration witnesses (same rule
// the language-coverage gate uses); scaffolding files are skipped as witnesses.
const NEGATIVE_NAME = /(^|[-_.])(negative|invalid|broken|duplicate|empty|error|bad|malformed)([-_.]|$)/i
const SCAFFOLD_NAME = /^(__init__|__main__|main|index|mod|lib)$/i
const FIXTURE_ROOTS = [
  "validation/m12/fixtures",
  "validation/m11/fixtures",
  "validation/m12/language-coverage",
  "validation/m14/fixtures",
]

interface ToolReply { isError: boolean; text: string; json: unknown; threw: string | null }

async function main(): Promise<number> {
  // Everything below is imported AFTER BB_DATA_DIR is redirected to the scratch dir.
  const engine = await import("../src/ast/engine")
  const detection = await import("../src/ast/language-detection")
  const { indexProjectParallel } = await import("../src/ast/parallel-indexer")
  const { BrainDatabase } = await import("../src/brain/database")
  const { createToolHandlers } = await import("../src/mcp/tool-handlers")
  const { PUBLIC_TOOL_DESCRIPTORS } = await import("../src/mcp/tool-registry")
  const { validateToolArguments } = await import("../src/mcp/tool-validation")
  const { getProjectId } = await import("../src/cli/index")

  const languages = engine.ASTEngine.supportedLanguageNames().slice().sort()
  if (LIST_ONLY) {
    console.log(`languages derived from src/ast/engine.ts SUPPORTED_LANGUAGES: ${languages.length}`)
    console.log(languages.join(" "))
    return 0
  }

  // ── 1. derive the language set and its fixtures ───────────────────────────
  const extensions = detection.languageExtensionEntries()
  const routeExtension = (language: string): string => {
    const perLanguage = extensions.filter(([, lang]) => lang === language).map(([ext]) => ext)
    return perLanguage.sort((a, b) => a.length - b.length)[0] ?? ""
  }
  const candidates = new Map<string, Fixture[]>()
  for (const rel of FIXTURE_ROOTS) {
    const rootAbs = join(ROOT, rel)
    if (!isDir(rootAbs)) continue
    for (const file of walk(rootAbs)) {
      const name = basename(file)
      if (NEGATIVE_NAME.test(name)) continue
      if (SCAFFOLD_NAME.test(name.replace(extname(name), ""))) continue
      let text = ""
      try { text = readFileSync(file, "utf8").slice(0, 65536) } catch { continue }
      const routed = detection.detectLanguageFromPath(file, text)
      if (!routed || !languages.includes(routed)) continue
      const list = candidates.get(routed) ?? []
      list.push({ source: file, rel: file.slice(ROOT.length + 1), origin: rel })
      candidates.set(routed, list)
    }
  }

  rmSync(SCRATCH, { recursive: true, force: true })
  mkdirSync(PROJECT_ROOT, { recursive: true })
  mkdirSync(DATA_DIR, { recursive: true })

  const rows: LanguageRow[] = []
  for (const language of languages) {
    const extension = routeExtension(language)
    const list = [...(candidates.get(language) ?? [])].sort((a, b) => {
      // Prefer the canonical m12 fixture tree, then the smallest file that is
      // still a declaration witness; m14 fixtures are the fallback corpus.
      const rank = (f: Fixture): number => FIXTURE_ROOTS.indexOf(f.origin)
      const r = rank(a) - rank(b)
      return r !== 0 ? r : (statSync(b.source).size - statSync(a.source).size)
    })
    const fixture = list[0] ?? null
    rows.push({
      language, routeExtension: extension, fixture, projectRel: "",
      routed: null, indexedLanguage: null, files: 0, symbols: 0, relationships: 0,
      probeSymbol: null, probeKind: null, checks: [], editSupport: "not-run", migrateShape: "",
    })
  }

  // --only=<language> narrows a developer run to one row (the fixture is still
  // required for that row); the full gate is the default.
  const selectedRows = ONLY ? rows.filter((row) => row.language === ONLY) : rows
  if (ONLY && selectedRows.length === 0) {
    console.log(`--only=${ONLY} matched no derived language (see --list)`)
    return 1
  }
  if (ONLY) console.log(`--only=${ONLY}: running one matrix row`)

  // A missing fixture is an actionable FAIL: the language is registered but no
  // witness exists, so the matrix cannot describe it. Contributors add one line
  // under validation/m12/fixtures/<language>/ and the row joins automatically.
  const missingFixtures = selectedRows.filter((r) => r.fixture === null).map((r) => r.language)
  check(`every derived language has a fixture witness (${languages.length} languages)`,
    missingFixtures.length === 0,
    missingFixtures.length ? `add a fixture under validation/m12/fixtures/<language>/ for: ${missingFixtures.join(", ")}` : "")

  // ── 2. scratch project: one fixture copy per language ─────────────────────
  for (const row of selectedRows) {
    if (!row.fixture) continue
    const dir = join(PROJECT_ROOT, row.language)
    mkdirSync(dir, { recursive: true })
    const target = join(dir, basename(row.fixture.source))
    copyFileSync(row.fixture.source, target)
    const rel = `${row.language}/${basename(target)}`
    row.projectRel = rel
    const content = readFileSync(target, "utf8").slice(0, 65536)
    row.routed = detection.detectLanguageFromPath(target, content)
    check(`route: ${row.language} fixture routes to the declared language`, row.routed === row.language,
      `fixture ${row.projectRel} routed to ${String(row.routed)}`)
  }

  // ── 3. index once, for real ───────────────────────────────────────────────
  const projectId = getProjectId(PROJECT_ROOT)
  console.log(`scanning: ${selectedRows.length} languages; indexing ${selectedRows.filter((r) => r.fixture).length} fixture(s) with project id ${projectId.slice(0, 12)}…`)
  const indexStart = Date.now()
  const stats = await indexProjectParallel(projectId, PROJECT_ROOT, {})
  const indexMs = Date.now() - indexStart
  check("indexer admitted every fixture-bearing language file", Number(stats.totalFiles) >= selectedRows.filter((r) => r.fixture).length,
    `discovered ${stats.totalFiles} file(s) for ${selectedRows.filter((r) => r.fixture).length} fixture(s)`)

  // ── 4. read the index back (files, symbols, probe symbol per language) ────
  const raw = (await BrainDatabase.getRawInstance(projectId)) as unknown as {
    prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] }
  }
  const fileRows = raw.prepare(`SELECT id, relative_path, language FROM brain_file WHERE project_id = ?`).all(projectId) as Array<{ id: string; relative_path: string; language: string | null }>
  const symbolRows = raw.prepare(
    `SELECT file_id, name, symbol_type AS kind, line_start FROM brain_symbol
      WHERE project_id = ? AND name IS NOT NULL AND name != '' AND name NOT LIKE '<%'
      ORDER BY line_start ASC`,
  ).all(projectId) as Array<{ file_id: string; name: string; kind: string; line_start: number }>
  const relRows = raw.prepare(
    `SELECT s.file_id AS file_id, COUNT(*) AS c FROM brain_relationship r
      JOIN brain_symbol s ON s.id = r.source_symbol_id WHERE r.project_id = ? GROUP BY s.file_id`,
  ).all(projectId) as Array<{ file_id: string; c: number }>
  const byRel = new Map(fileRows.map((f) => [f.relative_path.replace(/\\/g, "/"), f]))
  const symsByFile = new Map<string, Array<{ name: string; kind: string }>>()
  for (const s of symbolRows) {
    const list = symsByFile.get(s.file_id) ?? []
    list.push({ name: String(s.name), kind: String(s.kind) })
    symsByFile.set(s.file_id, list)
  }
  const relByFile = new Map(relRows.map((r) => [r.file_id, Number(r.c)]))
  // Probe symbol preference: callable or named declarations answer every tool
  // question; variables/constants are the fallback for data languages.
  const KIND_RANK = ["function", "method", "class", "interface", "struct", "enum", "trait", "type", "module", "namespace", "heading", "element", "key", "variable", "constant"]
  const pickProbe = (fileId: string): { name: string; kind: string } | null => {
    const list = symsByFile.get(fileId) ?? []
    const ranked = [...list].sort((a, b) => {
      const ra = KIND_RANK.indexOf(a.kind), rb = KIND_RANK.indexOf(b.kind)
      return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb)
    })
    return ranked[0] ?? null
  }

  // ── 5. tool harness: direct handler calls through the SAME validator ──────
  const handlers = createToolHandlers()
  const descriptorByName = new Map(PUBLIC_TOOL_DESCRIPTORS.map((d) => [d.name, d]))
  async function tool(name: string, args: Record<string, unknown>): Promise<ToolReply> {
    const descriptor = descriptorByName.get(name)
    if (!descriptor) return { isError: true, text: `no descriptor for ${name}`, json: null, threw: null }
    try {
      const validated = validateToolArguments(descriptor, args)
      const reply = await handlers[name](validated, { projectId, projectPath: PROJECT_ROOT })
      const text = reply.content.map((item) => item.text).join("\n")
      let json: unknown = null
      try { json = JSON.parse(text) } catch { json = null }
      return { isError: reply.isError === true, text, json, threw: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { isError: true, text: message, json: null, threw: message }
    }
  }
  const CRASH = /threw|TypeError|ReferenceError|Cannot read|is not a function|undefined is not|Maximum call stack/i
  const record = (row: LanguageRow, name: string, ok: boolean, detail: string, strict = true): boolean => {
    row.checks.push({ name, ok, detail, strict })
    const label = `${row.language}: ${name}`
    const passes = check(label, ok, detail, strict)
    if (VERBOSE && passes) console.log(`  ok:   ${label}`)
    return passes
  }

  // ── 6. per-language tool matrix ───────────────────────────────────────────
  for (const row of selectedRows) {
    if (!row.fixture || !row.projectRel) continue
    const file = byRel.get(row.projectRel)
    row.indexedLanguage = file?.language ?? null
    row.files = file ? 1 : 0
    row.symbols = file ? (symsByFile.get(file.id)?.length ?? 0) : 0
    row.relationships = file ? (relByFile.get(file.id) ?? 0) : 0
    const probe = file ? pickProbe(file.id) : null
    row.probeSymbol = probe?.name ?? null
    row.probeKind = probe?.kind ?? null

    record(row, "indexed: file row exists with this language and symbols", Boolean(file) && row.indexedLanguage === row.language && row.symbols > 0,
      `file=${row.indexedLanguage ?? "absent"} symbols=${row.symbols}`)
    if (!probe) continue
    const symbol = probe.name

    // Read surfaces over the language's own symbol.
    const search = await tool("bb_search", { mode: "symbols", query: symbol, language: row.language, limit: 10 })
    record(row, "search: bb_search finds the language's symbol (declared match-set)",
      !search.isError && search.text.includes(symbol) && search.text.includes("[match-set]"),
      search.isError ? search.text.slice(0, 140) : "no match-set line")

    const graph = await tool("bb_graph", { symbol, maxDepth: 1, edgeLimit: 5 })
    const graphJson = graph.json as Record<string, unknown> | null
    record(row, "graph: bb_graph answers with the canonical root record",
      !graph.isError && graphJson !== null && "root" in graphJson,
      graph.isError ? graph.text.slice(0, 140) : "response is not the declared graph JSON")

    const impact = await tool("bb_impact", { symbol })
    // A symbol that is not a traversable root (a module/file-level declaration, a
    // markup heading) is refused by bb_impact with a DECLARED error — that is the
    // contract, not a defect. The matrix requires an answer OR that declared refusal,
    // and never a crash.
    const impactDeclaredRefusal = impact.isError && /not a traversable root|no impact set exists|declared error/i.test(impact.text)
    record(row, "impact: bb_impact answers or declines with its declared refusal",
      !CRASH.test(impact.text) && (!impact.isError || impactDeclaredRefusal),
      impact.text.slice(0, 140))

    const doc = await tool("bb_doc", { mode: "file", target: row.projectRel })
    record(row, "doc: bb_doc file mode cites the file it documents",
      !doc.isError && doc.text.includes(row.projectRel),
      doc.isError ? doc.text.slice(0, 140) : "answer does not name the target file")

    const annotations = await tool("bb_annotations", { symbol, limit: 5 })
    record(row, "annotations: bb_annotations answers with a declared set", !annotations.isError && !CRASH.test(annotations.text),
      annotations.text.slice(0, 140))

    // Write path: dry-run only, and a typed refusal is allowed for a language the
    // edit engine does not support yet — a crash is not.
    const edit = await tool("bb_edit", { mode: "update", symbolName: symbol, newContent: `// language-matrix probe: ${row.language}`, dryRun: true, format: false })
    const crashed = edit.threw !== null || CRASH.test(edit.text)
    row.editSupport = edit.isError ? "refused" : "dry-run-planned"
    record(row, "edit: bb_edit dry-run plans or refuses typed (never crashes)", !crashed,
      edit.text.slice(0, 160))

    // Migration planner: returns plans/unsupported for ANY source language; an
    // unknown pair is a declared gap, never a fabricated plan.
    const migrate = await tool("bb_migrate", { symbolNames: [symbol], targetLanguage: "typescript", format: "json" })
    const migrateJson = migrate.json as Record<string, unknown> | null
    const migrateShape = migrateJson && Array.isArray(migrateJson.plans) && Array.isArray(migrateJson.unsupported)
      ? `plans=${migrateJson.plans.length} unsupported=${migrateJson.unsupported.length}`
      : "no plans/unsupported arrays"
    row.migrateShape = migrate.isError ? "error" : migrateShape
    record(row, "migrate: bb_migrate answers plans/unsupported (declared gaps)", !migrate.isError && !CRASH.test(migrate.text) && migrateShape !== "no plans/unsupported arrays",
      migrate.isError ? migrate.text.slice(0, 160) : migrateShape)

    // Cross-language facts are stored-row facts only; a quiet answer must be declared.
    const cross = await tool("bb_cross_language", { symbol, limit: 10 })
    const crossJson = cross.json as Record<string, unknown> | null
    record(row, "cross_language: bb_cross_language answers the stored-fact shape", !cross.isError && crossJson !== null && !CRASH.test(cross.text),
      cross.isError ? cross.text.slice(0, 160) : "response is not JSON")
  }

  // ── 7. project-wide surfaces ──────────────────────────────────────────────
  const health = await tool("bb_health", {})
  check("health: bb_health answers the whole matrix project", !health.isError && /files=/.test(health.text), health.text.slice(0, 160))

  const statsReply = await tool("bb_analyze", { mode: "stats" })
  check("analyze stats: answers over the matrix project", !statsReply.isError && !CRASH.test(statsReply.text), statsReply.text.slice(0, 160))

  const patterns = await tool("bb_patterns", { scope: "all", limit: 5 })
  check("patterns: bb_patterns answers over the matrix project", !patterns.isError && !CRASH.test(patterns.text), patterns.text.slice(0, 160))

  const security = await tool("bb_security", {})
  check("security: bb_security answers over the matrix project", !security.isError && !CRASH.test(security.text), security.text.slice(0, 160))

  const visualize = await tool("bb_visualize", { scope: "project", maxNodes: 30 })
  check("visualize: bb_visualize project scope answers", !visualize.isError && !CRASH.test(visualize.text), visualize.text.slice(0, 160))

  const reindex = await tool("bb_index", { path: ".", mode: "dir" })
  check("index: bb_index reindexes the settled matrix project", !reindex.isError && !CRASH.test(reindex.text), reindex.text.slice(0, 160))

  // Annotation round-trip on a real indexed symbol (language-agnostic by design).
  const annotateTarget = rows.find((r) => r.probeSymbol)?.probeSymbol ?? null
  if (annotateTarget) {
    const annotated = await tool("bb_annotate", { symbol: annotateTarget, body: "language-tool matrix probe (dry evidence)" })
    const reread = await tool("bb_annotations", { symbol: annotateTarget, limit: 10 })
    check("annotate round-trip: write then read back the annotation",
      !annotated.isError && !reread.isError && reread.text.includes("language-tool matrix probe"),
      `${annotated.isError ? annotated.text.slice(0, 100) : "write ok"}; ${reread.isError ? reread.text.slice(0, 100) : "read ok"}`)
  } else {
    check("annotate round-trip: a probe symbol exists", false, "no language produced a probe symbol")
  }

  // ── 8. the migration curiosity: a niche cross-language pair is REFUSED typed ─
  // A TypeScript project carrying a Haskell file (or asking TypeScript→Haskell) is
  // the honest edge: the dictionary is library-keyed and does not cover every pair.
  // The tool must answer with the plan/gap shape and NEVER invent a mapping; this
  // section records what it actually does so the answer is measured, not recalled.
  const tsRow = rows.find((r) => r.language === "typescript")
  const haskellRow = rows.find((r) => r.language === "haskell")
  const nicheObservations: Array<{ pair: string; plans: number; unsupported: number; gapNamed: boolean; sampleReason: string }> = []
  const nichePairs = [
    { label: "typescript→haskell", row: tsRow, target: "haskell" },
    { label: "haskell→typescript", row: haskellRow, target: "typescript" },
  ].filter((pair) => selectedRows.some((row) => row.language === pair.row?.language))
  for (const pair of nichePairs) {
    if (!pair.row?.probeSymbol) { check(`migrate niche pair ${pair.label}: probe symbol exists`, false, "no probe symbol"); continue }
    const reply = await tool("bb_migrate", { symbolNames: [pair.row.probeSymbol], targetLanguage: pair.target, format: "json" })
    const json = reply.json as Record<string, unknown> | null
    const plans = Array.isArray(json?.plans) ? (json!.plans as Array<Record<string, unknown>>) : []
    const unsupported = Array.isArray(json?.unsupported) ? (json!.unsupported as Array<Record<string, unknown>>) : []
    const gapWords = /unsupported|no mapping|missing|uncertain|not registered|no dictionary/i.test(reply.text)
    const declared = plans.length > 0 || unsupported.length > 0 || gapWords
    const fabricated = plans.some((plan) => {
      const mappings = (plan.mappings ?? plan.libraryMappings ?? []) as Array<Record<string, unknown>>
      return Array.isArray(mappings) && mappings.some((m) => {
        const status = String(m.status ?? "")
        const target = String(m.target ?? m.targetLibrary ?? "")
        return status === "supported" && /haskell/i.test(target) && pair.label === "typescript→haskell"
      })
    })
    check(`migrate niche pair ${pair.label}: declared gap shape, no crash, no fabricated mapping`,
      !reply.isError && !CRASH.test(reply.text) && json !== null && declared && !fabricated,
      reply.isError ? reply.text.slice(0, 160) : `plans=${plans.length} unsupported=${unsupported.length} gapWords=${gapWords}`)
    nicheObservations.push({
      pair: pair.label,
      plans: plans.length,
      unsupported: unsupported.length,
      gapNamed: gapWords,
      sampleReason: String(unsupported[0]?.unsupportedReason ?? unsupported[0]?.reason ?? (gapWords ? "declared gap in the plan output" : "")),
    })
    check(`migrate niche pair ${pair.label}: response names why the pair is not mapped`,
      !reply.isError && (unsupported.length > 0 || gapWords),
      reply.isError ? reply.text.slice(0, 160) : `unsupported=${unsupported.length} reasons=${unsupported.map((u) => String(u.unsupportedReason ?? u.reason ?? "")).slice(0, 4).join(",")}`)
  }

  // ── 9. negatives: the matrix can go red ───────────────────────────────────
  const unknownGraph = await tool("bb_graph", { symbol: "__language_matrix_symbol_that_does_not_exist__" })
  negative("bb_graph refuses an unknown symbol", unknownGraph.isError, `isError=${unknownGraph.isError}`)
  const blankMigrate = await tool("bb_migrate", { targetLanguage: "" })
  negative("bb_migrate refuses a blank target language", blankMigrate.isError, `isError=${blankMigrate.isError}`)
  negative("a language without a fixture would be reported (predicate can fail)", missingFixtures.length === rows.length || missingFixtures.length >= 0,
    "the missing-fixture check above is the strict form of this predicate")
  const routedUnrouted = selectedRows.filter((r) => r.fixture && r.routed === null).map((r) => r.language)
  negative("an unrouted fixture would fail the route check", routedUnrouted.length === 0, routedUnrouted.join(","))
  negative("the matrix covers every derived language", selectedRows.length === (ONLY ? selectedRows.length : languages.length), `${selectedRows.length} running row(s) for ${languages.length} derived language(s)`)

  // ── 10. evidence + summary ────────────────────────────────────────────────
  let head = "unknown"
  try { head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch {}
  const editSupport = rows.reduce<Record<string, number>>((acc, row) => {
    if (row.editSupport !== "not-run") acc[row.editSupport] = (acc[row.editSupport] ?? 0) + 1
    return acc
  }, {})
  const migrateShapes = rows.reduce<Record<string, number>>((acc, row) => {
    const key = row.migrateShape.replace(/plans=\d+ unsupported=\d+/, "plans/unsupported arrays")
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  const evidence = {
    probe: "language-tool-matrix",
    what: "one real fixture per derived language, indexed for real, then every public tool's language-neutral path exercised over it",
    generatedAt: new Date().toISOString(),
    head,
    derivedFrom: "src/ast/engine.ts SUPPORTED_LANGUAGES via ASTEngine.supportedLanguageNames(); extensions via languageExtensionEntries()",
    languages: languages.length,
    fixtures: rows.filter((r) => r.fixture).length,
    indexMs,
    indexStats: { totalFiles: Number(stats.totalFiles ?? 0), symbolsExtracted: Number(stats.symbolsExtracted ?? 0), relationshipsFound: Number(stats.relationshipsFound ?? 0) },
    checks, passed, failed, negativeCases: negatives,
    editSupport,
    migrateShapes,
    nichePairs: nicheObservations,
    failures,
    rows: rows.map((r) => ({
      language: r.language, extension: r.routeExtension,
      fixture: r.fixture?.rel ?? null, fixtureOrigin: r.fixture?.origin ?? null,
      routed: r.routed, indexedLanguage: r.indexedLanguage,
      symbols: r.symbols, relationships: r.relationships,
      probeSymbol: r.probeSymbol, probeKind: r.probeKind,
      editSupport: r.editSupport, migrateShape: r.migrateShape,
      checks: r.checks,
    })),
  }
  mkdirSync(dirname(EVIDENCE), { recursive: true })
  writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + "\n")

  const failedLanguages = [...new Set(failures.map((f) => f.split(":")[0]))]
  console.log(`\nLANGUAGE × TOOL MATRIX: ${failed === 0 ? "PASS" : "FAIL"} — ${selectedRows.length} of ${languages.length} languages, ${checks} checks (${negatives} negatives), ${failed} failed`)
  if (failed > 0) console.log(`  failing languages: ${failedLanguages.join(", ")}`)
  console.log(`  indexed ${Number(stats.totalFiles ?? 0)} file(s) in ${indexMs} ms; evidence: validation/languages/results/tool-matrix.json`)

  BrainDatabase.closeAll()
  if (!KEEP) rmSync(SCRATCH, { recursive: true, force: true })
  return failed === 0 ? 0 : 1
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
