#!/usr/bin/env npx tsx
/**
 * M12 language-coverage gate — "the indexer must index not only the languages you
 * think, but what we provide."
 *
 * WHAT THIS PROVES, AND HOW
 * -------------------------
 * For EVERY language bb ships an analyzer for, a real source file is indexed by the
 * real in-process indexer and then read back out of the index. Three facts are
 * asserted per language, each independently:
 *
 *   1. DISCOVERED  — the file appears in `brain_file` (the router admitted it).
 *   2. PARSED      — at least one symbol is stored against that file.
 *   3. CLASSIFIED  — the stored `brain_file.language` is the language intended.
 *
 * THE LANGUAGE LIST IS DERIVED, NEVER WRITTEN DOWN. It comes from
 * `ASTEngine.supportedLanguageNames()`, which reads `SUPPORTED_LANGUAGES` in
 * `src/ast/engine.ts` — the same table `isSupportedLanguage` consults. The
 * extension a fixture is written with is derived the same way, from
 * `languageExtensionEntries()` (`EXTENSION_LANGUAGE` in
 * `src/ast/language-detection.ts`), the table the discovery gate
 * (`hasValidExtension` → `detectLanguageFromPath`) actually reads. So neither the
 * language set nor the extension set can drift from the product without this gate
 * changing with it.
 *
 * WHY THREE SEPARATE ASSERTIONS: a language can fail at any of the three seams and
 * each failure looks different from the outside. A missing router entry means the
 * file is never even opened; a missing/broken grammar means the file is opened and
 * yields nothing; a wrong router entry means the file is indexed and *mislabeled* —
 * which is the worst of the three, because the index looks healthy.
 *
 * FAILURE MODES (mutually exclusive, reported per language, naming the language):
 *   DISCOVERY-MISS     the extension is not routed, so discovery never admits the
 *                      file (or admits it as a different language than the one the
 *                      analyzer table declares)
 *   PARSE-EMPTY        discovered, but zero symbols were stored for it
 *   LANGUAGE-MISMATCH  discovered and parsed, but the stored language is not the
 *                      intended one
 *   NO-FIXTURE         no fixture exists and none could be written — reported,
 *                      never silently skipped
 *   ANALYZER-MISSING   the grammar the language table names is not loadable
 *
 * NEGATIVE CONTROL: a file with an unknown extension (`.zzz`) carrying content that
 * WOULD produce symbols if it were parsed must NOT appear in the index. Without it
 * a gate that counted everything would look like a gate that discovered everything.
 *
 * USAGE
 *   npx tsx script/m12/verify-language-coverage.ts
 *   npx tsx script/m12/verify-language-coverage.ts --repeat=2   # prove idempotence
 *   npx tsx script/m12/verify-language-coverage.ts --verbose    # evidence for every row
 *   npx tsx script/m12/verify-language-coverage.ts --keep       # keep .langcov/ scratch
 *
 * EXIT CODE: 0 when every derived language passes AND the negative control holds,
 * 1 otherwise. The failing language names are printed on the summary line.
 *
 * STATE: everything this gate writes lives under `.langcov/` (fixture copies, the
 * scratch project root, and the brain DB via BB_DATA_DIR). The owner's real index
 * under ~/.bb is never touched. The scratch tree is deleted at the end unless
 * --keep is passed, so a second run starts from the same empty state and returns
 * the same answer.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

// ---------------------------------------------------------------------------
// Paths. The repo root is derived from this file's location, not from cwd, so the
// gate is runnable from anywhere; BB_DATA_DIR is set BEFORE any bb module is
// imported (the dynamic imports below) so no module can observe ~/.bb.
// ---------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..", "..")
const SCRATCH_ROOT = join(REPO_ROOT, ".langcov")
const DATA_DIR = join(SCRATCH_ROOT, "data")
const PROJECT_ROOT = join(SCRATCH_ROOT, "project")
const PROJECT_ID = "langcov-gate"
const GATE_FIXTURE_ROOT = join(REPO_ROOT, "validation", "m12", "language-coverage")
const NEGATIVE_REL = "_negative-control/Control.zzz"

process.env.BB_DATA_DIR = DATA_DIR

const argv = process.argv.slice(2)
const hasFlag = (name: string): boolean => argv.includes(name)
const flagValue = (name: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : undefined
}

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(readGateHelp())
  process.exit(0)
}

const KEEP = hasFlag("--keep")
const VERBOSE = hasFlag("--verbose")
const REPEAT = Math.max(1, Number.parseInt(flagValue("--repeat") ?? "1", 10) || 1)
const GRAMMAR_TIMEOUT_MS = 20_000

function readGateHelp(): string {
  return [
    "verify-language-coverage — index one real fixture per derived language, assert per language.",
    "",
    "  npx tsx script/m12/verify-language-coverage.ts [--repeat=N] [--verbose] [--keep]",
    "",
    "  --repeat=N   run the full measurement N times and fail if the matrices differ (idempotence)",
    "  --verbose    print the raw evidence for passing rows too, not only failures",
    "  --keep       keep the .langcov/ scratch tree (fixtures copy + brain DB) for inspection",
    "",
  ].join("\n")
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Status = "PASS" | "DISCOVERY-MISS" | "PARSE-EMPTY" | "LANGUAGE-MISMATCH" | "NO-FIXTURE" | "ANALYZER-MISSING"

interface FixtureChoice {
  /** absolute path of the source fixture inside the repo */
  source: string
  /** repo-relative path of the source fixture */
  sourceRel: string
  /** which tree it came from, e.g. "corpus validation/m12/fixtures/<lang>" */
  origin: string
}

interface DbFileRow {
  files: number
  symbols: number
  relationships: number
  language: string | null
  syntaxErrors: number
}

interface LanguageRow {
  language: string
  /** every extension in EXTENSION_LANGUAGE whose value is this language */
  routedExtensions: string[]
  /** the extension the fixture was written with, as it exists on disk */
  extension: string
  fixture: FixtureChoice | null
  /** what the production router says the scratch fixture is (null = not admitted) */
  routed: string | null
  /** is the grammar the language table names actually loadable */
  analyzer: { ok: boolean; error?: string }
  /** the fixture's path inside the scratch project (project-relative, forward slashes) */
  fileRel: string | null
  filePath: string | null
  db: DbFileRow | null
  status: Status
  evidence: string[]
}

interface MatrixRow {
  language: string
  extension: string
  files: number
  symbols: number
  relationships: number
  status: Status
  routed: string | null
  syntax: string
  fixture: string
}

interface RunResult {
  rows: LanguageRow[]
  matrix: MatrixRow[]
  negativeIndexed: boolean
  stats: {
    totalFiles: number
    processedFiles: number
    successFiles: number
    errorFiles: number
    skippedFiles: number
    symbolsExtracted: number
    relationshipsFound: number
  }
  indexMs: number
  measureMs: number
}

// ---------------------------------------------------------------------------
// Small filesystem helpers
// ---------------------------------------------------------------------------
function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** readdir that never throws; an unreadable directory is simply empty. */
function readdirSafe(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Bounded, sorted, dotfile-free recursive file listing. */
function walkFiles(dir: string, depth = 0, out: string[] = []): string[] {
  if (depth > 4) return out
  const sorted = [...readdirSafe(dir)].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of sorted) {
    if (e.name.startsWith(".")) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, depth + 1, out)
    else if (e.isFile()) out.push(p)
  }
  return out
}

/** A fixture whose name says "this one is meant to produce nothing" is not a fixture. */
const NEGATIVE_NAME = /(^|[-_.])(negative|invalid|broken|duplicate|empty|error|bad|malformed)([-_.]|$)/i
/**
 * Package markers and scaffolding: real files, but never a declaration witness.
 *
 * Measured consequence of not having this: python resolved its witness to
 * `validation/m11/fixtures/python/__init__.py` — a 107-byte re-export shim that
 * declares nothing — and the gate reported python(PARSE-EMPTY) while
 * `validation/m11/fixtures/python/models.py` yields 11 symbols and
 * `validation/m12/fixtures/python/Service.py` yields 33. A gate artefact was being
 * reported as a product failure, which is the one thing this gate must not do.
 */
const SCAFFOLD_NAME = /^(__init__|__main__|main|index|mod|lib)$/i

function stripExt(p: string): string {
  const b = basename(p)
  const e = extname(b)
  return e ? b.slice(0, -e.length) : b
}

// ---------------------------------------------------------------------------
// Derivation: languages from SUPPORTED_LANGUAGES, extensions from the router
// ---------------------------------------------------------------------------
interface Derived {
  languages: string[]
  routedByLanguage: Map<string, string[]>
  routedExtensions: number
  unroutedLanguages: string[]
}

async function derive(): Promise<Derived> {
  const engine = await import("../../src/ast/engine")
  const detection = await import("../../src/ast/language-detection")

  const languages = engine.ASTEngine.supportedLanguageNames()
  const routedByLanguage = new Map<string, string[]>()
  for (const lang of languages) routedByLanguage.set(lang, [])
  let routedExtensions = 0
  for (const [ext, lang] of detection.languageExtensionEntries()) {
    routedExtensions++
    const bucket = routedByLanguage.get(lang)
    if (bucket) bucket.push(ext)
  }
  const unroutedLanguages = languages.filter((l) => (routedByLanguage.get(l) ?? []).length === 0)
  return { languages, routedByLanguage, routedExtensions, unroutedLanguages }
}

// ---------------------------------------------------------------------------
// Fixture selection: an existing repo fixture wins; otherwise the gate-owned
// minimal fixture under validation/m12/language-coverage/<language>/.
// ---------------------------------------------------------------------------
function existingFixtureRoots(language: string): Array<{ dir: string; origin: string }> {
  const roots: Array<{ dir: string; origin: string }> = []
  const validation = join(REPO_ROOT, "validation")
  if (isDir(validation)) {
    const milestones = readdirSync(validation, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
    for (const m of milestones) {
      for (const sub of ["fixtures", "corpus"]) {
        const d = join(validation, m, sub, language)
        if (isDir(d)) roots.push({ dir: d, origin: `corpus validation/${m}/${sub}/${language}` })
      }
    }
  }
  for (const sub of ["fixtures", "corpus"]) {
    const d = join(REPO_ROOT, "test", sub, language)
    if (isDir(d)) roots.push({ dir: d, origin: `corpus test/${sub}/${language}` })
  }
  return roots
}

/**
 * Pick the fixture for one language.
 *
 * Existing corpora are searched first and only files the PRODUCTION ROUTER
 * attributes to this language are eligible — a corpus file that routes elsewhere
 * is not a fixture for this language. The gate-owned tree is the fallback and is
 * accepted even when the router does NOT route it, because that is exactly the
 * case the gate has to be able to measure (sass, terraform).
 */
function pickFixture(language: string, routedExtensions: string[], routeOf: (p: string) => string | null): FixtureChoice | null {
  for (const root of existingFixtureRoots(language)) {
    const candidates = walkFiles(root.dir)
      .filter((f) => !NEGATIVE_NAME.test(stripExt(f)))
      .filter((f) => !SCAFFOLD_NAME.test(stripExt(f)))
      .filter((f) => {
        try {
          return statSync(f).size > 0
        } catch {
          return false
        }
      })
      .filter((f) => routeOf(f) === language)
      .sort((a, b) => {
        const da = a.split(sep).length
        const db = b.split(sep).length
        if (da !== db) return da - db
        return a < b ? -1 : a > b ? 1 : 0
      })
    if (candidates.length > 0) {
      const chosen = candidates[0]
      return { source: chosen, sourceRel: relative(REPO_ROOT, chosen).split(sep).join("/"), origin: root.origin }
    }
  }

  // Gate-owned minimal fixture. `routedExtensions` is reported (not used to
  // filter) so the failure, when it comes, is measured rather than assumed.
  const gateDir = join(GATE_FIXTURE_ROOT, language)
  if (isDir(gateDir)) {
    const files = walkFiles(gateDir).sort()
    if (files.length > 0) {
      return {
        source: files[0],
        sourceRel: relative(REPO_ROOT, files[0]).split(sep).join("/"),
        origin: `gate-fixture validation/m12/language-coverage/${language}`,
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Scratch project construction
// ---------------------------------------------------------------------------
function buildScratch(rows: LanguageRow[]): void {
  rmSync(PROJECT_ROOT, { recursive: true, force: true })
  mkdirSync(PROJECT_ROOT, { recursive: true })

  for (const row of rows) {
    row.fileRel = null
    row.filePath = null
    if (!row.fixture) continue
    const dir = join(PROJECT_ROOT, row.language)
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, basename(row.fixture.source))
    copyFileSync(row.fixture.source, dest)
    row.filePath = dest
    row.fileRel = relative(PROJECT_ROOT, dest).split(sep).join("/")
  }

  // Negative control: an unknown extension whose CONTENT would produce symbols if
  // any analyzer saw it. If this ever appears in the index, discovery is not
  // measuring what this gate claims it measures.
  const negPath = join(PROJECT_ROOT, NEGATIVE_REL)
  mkdirSync(dirname(negPath), { recursive: true })
  writeFileSync(
    negPath,
    [
      "// Negative control for the M12 language-coverage gate.",
      "// The extension is unknown to EXTENSION_LANGUAGE, so no analyzer may ever see this file.",
      "export function negativeControl(): number {",
      "  return 42",
      "}",
      "export class NegativeControl {}",
      "",
    ].join("\n"),
  )
}

// ---------------------------------------------------------------------------
// One full measurement cycle: build scratch, index for real, read the index back
// ---------------------------------------------------------------------------
async function measure(cycle: number, derived: Derived, log: (s: string) => void): Promise<RunResult> {
  const engine = await import("../../src/ast/engine")
  const detection = await import("../../src/ast/language-detection")
  const { indexProjectParallel } = await import("../../src/ast/parallel-indexer")
  const { BrainDatabase } = await import("../../src/brain/database")

  const routeOf = (p: string): string | null => detection.detectLanguageFromPath(p)

  // 1. plan ----------------------------------------------------------------
  const rows: LanguageRow[] = []
  for (const language of derived.languages) {
    const routedExtensions = [...(derived.routedByLanguage.get(language) ?? [])]
    const fixture = pickFixture(language, routedExtensions, routeOf)
    const extension = fixture ? extname(fixture.source).replace(/^\./, "") : routedExtensions[0] ?? ""
    rows.push({
      language,
      routedExtensions,
      extension,
      fixture,
      routed: null,
      analyzer: { ok: false },
      fileRel: null,
      filePath: null,
      db: null,
      status: "PASS",
      evidence: [],
    })
  }

  buildScratch(rows)

  // 2. analyzer probe: is the grammar the language table names actually loadable?
  //    Run for every language, before indexing, so an unloadable grammar is named
  //    as ANALYZER-MISSING instead of surfacing later as a mysterious empty parse.
  for (const row of rows) {
    try {
      const parser = await Promise.race([
        engine.ASTEngine.getParser(row.language as never),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`grammar load exceeded ${GRAMMAR_TIMEOUT_MS} ms`)), GRAMMAR_TIMEOUT_MS),
        ),
      ])
      row.analyzer = { ok: Boolean(parser) }
    } catch (e) {
      row.analyzer = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // 3. route probe: what does the production router say about the scratch file?
  for (const row of rows) {
    row.routed = row.filePath ? routeOf(row.filePath) : null
    if (row.fixture && row.filePath) {
      const sourceRoute = routeOf(row.fixture.source)
      if (sourceRoute !== row.routed) {
        row.evidence.push(
          `router disagrees between source and scratch copy: ${row.fixture.sourceRel} -> ${String(sourceRoute)}, ` +
            `${row.fileRel} -> ${String(row.routed)}`,
        )
      }
    }
  }

  // 4. index for real ------------------------------------------------------
  // Everything the previous cycle wrote goes, so cycle N starts from the same
  // empty state as cycle 1: the project DB (handle closed first) and the fixture
  // copies. Nothing outside .langcov/ is touched.
  BrainDatabase.close(PROJECT_ID)
  rmSync(join(DATA_DIR, "projects", PROJECT_ID), { recursive: true, force: true })

  log(`cycle ${cycle}: indexing ${rows.length} languages from ${PROJECT_ROOT}`)
  const indexStart = Date.now()
  const stats = (await indexProjectParallel(PROJECT_ID, PROJECT_ROOT, {})) as unknown as {
    totalFiles: number
    processedFiles: number
    successFiles: number
    errorFiles: number
    skippedFiles: number
    symbolsExtracted: number
    relationshipsFound: number
    errors?: Array<{ file: string; error: string }>
  }
  const indexMs = Date.now() - indexStart

  // An index run that discovered nothing is not evidence about 51 languages.
  // `indexProjectParallel` answers a missing or emptied project path with
  // totalFiles: 0 and NO error (measured), so without this guard every language is
  // reported as DISCOVERY-MISS — 51 findings that are really one missing tree. That
  // was not hypothetical: two gate processes sharing one scratch directory produced a
  // complete 51-row failure matrix whose output was indistinguishable from "every
  // language is unreachable".
  const expectedFiles = rows.filter((r) => r.fileRel).length
  if (stats.totalFiles < expectedFiles) {
    throw new Error(
      `index run discovered ${stats.totalFiles} file(s) but the scratch project holds ${expectedFiles} fixture(s) — ` +
        `the per-language matrix would describe the scratch tree, not language coverage`,
    )
  }

  // 5. read the index back -------------------------------------------------
  const measureStart = Date.now()
  const raw = (await BrainDatabase.getRawInstance(PROJECT_ID)) as unknown as {
    prepare: (sql: string) => { all: (...params: unknown[]) => unknown }
  }

  const fileRows = raw
    .prepare(`SELECT id, relative_path, language, has_syntax_errors FROM brain_file WHERE project_id = ?`)
    .all(PROJECT_ID) as Array<{ id: string; relative_path: string; language: string | null; has_syntax_errors: number | null }>

  const symbolRows = raw
    .prepare(`SELECT file_id, COUNT(*) AS c FROM brain_symbol WHERE project_id = ? GROUP BY file_id`)
    .all(PROJECT_ID) as Array<{ file_id: string; c: number }>

  const relRows = raw
    .prepare(
      `SELECT s.file_id AS file_id, COUNT(*) AS c
         FROM brain_relationship r
         JOIN brain_symbol s ON s.id = r.source_symbol_id
        WHERE r.project_id = ?
        GROUP BY s.file_id`,
    )
    .all(PROJECT_ID) as Array<{ file_id: string; c: number }>

  const symByFile = new Map(symbolRows.map((r) => [r.file_id, Number(r.c)]))
  const relByFile = new Map(relRows.map((r) => [r.file_id, Number(r.c)]))
  const byRelative = new Map(fileRows.map((r) => [r.relative_path.split(sep).join("/"), r]))

  const negativeIndexed = fileRows.some((r) => r.relative_path.split(sep).join("/") === NEGATIVE_REL)

  // 6. assert per language -------------------------------------------------
  for (const row of rows) {
    const dbFile = row.fileRel ? byRelative.get(row.fileRel) : undefined
    row.db = dbFile
      ? {
          files: 1,
          symbols: symByFile.get(dbFile.id) ?? 0,
          relationships: relByFile.get(dbFile.id) ?? 0,
          language: dbFile.language ?? null,
          syntaxErrors: Number(dbFile.has_syntax_errors ?? 0),
        }
      : null

    row.status = classify(row)
    row.evidence.push(...explain(row))
  }

  const measureMs = Date.now() - measureStart

  const matrix: MatrixRow[] = rows.map((r) => ({
    language: r.language,
    extension: r.extension,
    files: r.db?.files ?? 0,
    symbols: r.db?.symbols ?? 0,
    relationships: r.db?.relationships ?? 0,
    status: r.status,
    routed: r.routed,
    syntax: r.db ? (r.db.syntaxErrors > 0 ? "ERR" : "clean") : "-",
    fixture: r.fixture ? `${basename(r.fixture.source)} [${r.fixture.origin.startsWith("gate-fixture") ? "gate" : "corpus"}]` : "-",
  }))

  return {
    rows,
    matrix,
    negativeIndexed,
    stats: {
      totalFiles: Number(stats.totalFiles ?? 0),
      processedFiles: Number(stats.processedFiles ?? 0),
      successFiles: Number(stats.successFiles ?? 0),
      errorFiles: Number(stats.errorFiles ?? 0),
      skippedFiles: Number(stats.skippedFiles ?? 0),
      symbolsExtracted: Number(stats.symbolsExtracted ?? 0),
      relationshipsFound: Number(stats.relationshipsFound ?? 0),
    },
    indexMs,
    measureMs,
  }
}

/**
 * The one place the verdict is decided, so the precedence is explicit:
 *   NO-FIXTURE > ANALYZER-MISSING > DISCOVERY-MISS > PARSE-EMPTY > LANGUAGE-MISMATCH > PASS
 * The most specific cause wins: an unloadable grammar is named as such rather than
 * being reported as an empty parse, and a file that was never routed is named as a
 * discovery miss rather than as a language mismatch.
 */
function classify(row: LanguageRow): Status {
  if (!row.fixture || !row.fileRel) return "NO-FIXTURE"
  if (!row.analyzer.ok) return "ANALYZER-MISSING"
  if (row.routed !== row.language) return "DISCOVERY-MISS"
  if (!row.db) return "DISCOVERY-MISS"
  if (row.db.symbols === 0) return "PARSE-EMPTY"
  if (row.db.language !== row.language) return "LANGUAGE-MISMATCH"
  return "PASS"
}

/** Raw evidence strings for one row — the bytes a reader can check the verdict against. */
function explain(row: LanguageRow): string[] {
  const out: string[] = []
  const routed = row.routed === null ? "null (not routed)" : row.routed
  const stored = row.db ? (row.db.language === null ? "null" : row.db.language) : "(no brain_file row)"

  switch (row.status) {
    case "NO-FIXTURE":
      out.push(
        `assertion: a fixture exists for "${row.language}" — no existing corpus fixture matched and ` +
          `validation/m12/language-coverage/${row.language}/ holds none`,
      )
      break
    case "ANALYZER-MISSING":
      out.push(`assertion: the grammar named by SUPPORTED_LANGUAGES["${row.language}"] loads — it did not`)
      out.push(`ASTEngine.getParser("${row.language}") threw: ${row.analyzer.error ?? "(no message)"}`)
      break
    case "DISCOVERY-MISS":
      out.push(`assertion: the router admits the fixture as "${row.language}"`)
      out.push(`detectLanguageFromPath("${row.fileRel}") = ${routed}`)
      if (row.routedExtensions.length === 0) {
        out.push(
          `EXTENSION_LANGUAGE maps NO extension to "${row.language}" — ` +
            `the language is declared in SUPPORTED_LANGUAGES but unreachable by discovery`,
        )
      } else {
        out.push(`EXTENSION_LANGUAGE maps ${row.routedExtensions.map((e) => `.${e}`).join(", ")} to "${row.language}"`)
      }
      out.push(`brain_file row: ${row.db ? "present" : "ABSENT"}`)
      if (row.db) out.push(`stored language = ${stored}`)
      break
    case "PARSE-EMPTY":
      out.push(`assertion: the discovered file yields >= 1 symbol`)
      out.push(`brain_file row: present (${row.fileRel}), stored language = ${stored}, symbols = 0`)
      out.push(`relationships = ${row.db?.relationships ?? 0}, syntax errors = ${row.db?.syntaxErrors ?? 0}`)
      break
    case "LANGUAGE-MISMATCH":
      out.push(`assertion: stored brain_file.language == "${row.language}"`)
      out.push(`stored language = ${stored} (expected "${row.language}"), symbols = ${row.db?.symbols ?? 0}`)
      out.push(`detectLanguageFromPath("${row.fileRel}") = ${routed}`)
      break
    case "PASS":
      out.push(
        `discovered as ${row.fileRel}; stored language = ${stored}; symbols = ${row.db?.symbols ?? 0}; ` +
          `relationships = ${row.db?.relationships ?? 0}; syntax = ${row.db?.syntaxErrors ? "ERRORS" : "clean"}`,
      )
      break
  }
  if (!row.analyzer.ok && row.status !== "ANALYZER-MISSING") {
    out.push(`(also: grammar not loadable — ${row.analyzer.error ?? "unknown error"})`)
  }
  return out
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
function printMatrix(matrix: MatrixRow[]): void {
  const header = ["language", "ext", "files", "symbols", "rels", "status", "routed", "syntax", "fixture"]
  const cells = matrix.map((r) => [
    r.language,
    r.extension || "-",
    String(r.files),
    String(r.symbols),
    String(r.relationships),
    r.status,
    r.routed === null ? "null" : r.routed,
    r.syntax,
    r.fixture,
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)))
  const line = (cols: string[]): string => cols.map((c, i) => c.padEnd(widths[i])).join(" | ").trimEnd()
  console.log(line(header))
  console.log(widths.map((w) => "-".repeat(w)).join("-+-"))
  for (const c of cells) console.log(line(c))
}

function printFailures(rows: LanguageRow[]): void {
  const failed = rows.filter((r) => r.status !== "PASS")
  if (failed.length === 0) return
  console.log("")
  console.log(`FAILURES (${failed.length}) — each names the language, the assertion, the file and the raw evidence`)
  console.log("")
  for (const row of failed) {
    console.log(`  [${row.status}] ${row.language}`)
    console.log(`    fixture   : ${row.fixture ? row.fixture.sourceRel : "(none)"}`)
    console.log(`    extension : ${row.extension ? `.${row.extension}` : "(none)"}`)
    console.log(`    in index  : ${row.fileRel ?? "(not in the scratch project)"}`)
    console.log(`    grammar   : ${row.analyzer.ok ? "loadable" : `NOT LOADABLE — ${row.analyzer.error ?? "unknown"}`}`)
    for (const e of row.evidence) console.log(`    evidence  : ${e}`)
    console.log("")
  }
}

function printDetails(rows: LanguageRow[], onlyPassing: boolean): void {
  console.log("")
  console.log(onlyPassing ? "PER-LANGUAGE EVIDENCE (passing rows)" : "PER-LANGUAGE EVIDENCE")
  for (const row of rows) {
    if (onlyPassing && row.status !== "PASS") continue
    console.log(`  ${row.language} [${row.status}]`)
    if (row.fixture) console.log(`    source    : ${row.fixture.sourceRel} (${row.fixture.origin})`)
    console.log(`    routed    : ${row.routed === null ? "null (not admitted)" : row.routed}`)
    console.log(`    grammar   : ${row.analyzer.ok ? "loadable" : `MISSING (${row.analyzer.error ?? "unknown"})`}`)
    if (row.db) {
      console.log(
        `    stored    : language=${row.db.language ?? "null"} symbols=${row.db.symbols} ` +
          `relationships=${row.db.relationships} syntaxErrors=${row.db.syntaxErrors}`,
      )
    }
    for (const e of row.evidence) console.log(`    note      : ${e}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<number> {
  const startedAt = Date.now()
  const derived = await derive()
  const { ASTEngine } = await import("../../src/ast/engine")

  const languages = derived.languages
  const routedLanguages = languages.filter((l) => (derived.routedByLanguage.get(l) ?? []).length > 0)
  const unroutedLanguages = derived.unroutedLanguages

  console.log("M12 language-coverage gate — one real fixture per derived language, indexed end to end")
  console.log("")
  console.log(`  repo root          : ${REPO_ROOT}`)
  console.log(`  analyzer table     : src/ast/engine.ts SUPPORTED_LANGUAGES`)
  console.log(`                       read through ASTEngine.supportedLanguageNames()`)
  console.log(`  languages derived  : ${languages.length}`)
  console.log(`                       ${languages.join(", ")}`)
  console.log(`  router table       : src/ast/language-detection.ts EXTENSION_LANGUAGE`)
  console.log(`                       read through languageExtensionEntries() — ${derived.routedExtensions} extensions`)
  console.log(`  languages routed   : ${routedLanguages.length} of ${languages.length}`)
  if (unroutedLanguages.length > 0) {
    console.log(`  NO ROUTED EXTENSION: ${unroutedLanguages.join(", ")}`)
    console.log(`                       (declared by SUPPORTED_LANGUAGES but no extension maps to them)`)
  }
  console.log(`  scratch project    : ${relative(REPO_ROOT, PROJECT_ROOT)}/`)
  console.log(`  data dir           : ${relative(REPO_ROOT, DATA_DIR)}/  (BB_DATA_DIR — ~/.bb is untouched)`)
  console.log(`  negative control   : ${NEGATIVE_REL} (unknown extension; must NOT be indexed)`)
  console.log(`  cycles             : ${REPEAT}${REPEAT > 1 ? " (matrices must agree)" : ""}`)
  console.log("")

  const cycleResults: RunResult[] = []
  for (let cycle = 1; cycle <= REPEAT; cycle++) {
    cycleResults.push(await measure(cycle, derived, (s) => console.log(`${s}`)))
  }

  const first = cycleResults[0]
  const rows = first.rows

  console.log("")
  console.log(`MATRIX — ${rows.length} languages, ${cycleResults.length} cycle(s)`)
  console.log("  columns: language | extension used | files stored | symbols stored | relationships sourced in the file")
  console.log("           | verdict | language the router assigned | parse syntax | fixture used [corpus|gate]")
  console.log("")
  printMatrix(first.matrix)

  // --- negative control ----------------------------------------------------
  console.log("")
  console.log("NEGATIVE CONTROL")
  if (first.negativeIndexed) {
    console.log(`  FAIL: ${NEGATIVE_REL} WAS indexed — discovery is not what this gate measures`)
  } else {
    console.log(`  ok: ${NEGATIVE_REL} was not discovered (unknown extension, no analyzer may claim it)`)
  }

  // --- analyzer probe summary ---------------------------------------------
  const analyzerFailures = rows.filter((r) => !r.analyzer.ok)
  console.log("")
  console.log(`GRAMMAR LOADABILITY (ASTEngine.getParser, all ${rows.length} languages)`)
  if (analyzerFailures.length === 0) {
    console.log(`  ok: every grammar SUPPORTED_LANGUAGES names loaded`)
  } else {
    console.log(`  FAIL: ${analyzerFailures.length} grammar(s) not loadable:`)
    for (const r of analyzerFailures) console.log(`    - ${r.language}: ${r.analyzer.error ?? "unknown error"}`)
  }

  // --- failures ------------------------------------------------------------
  printFailures(rows)
  if (hasFlag("--verbose")) {
    printDetails(rows, false)
  }

  // --- idempotence ---------------------------------------------------------
  // Compares the VERDICT-bearing projection, not the raw row. Relationship counts are
  // order-dependent in the product — measured: identical cycles gave xml 12 then 9
  // relationships with the verdict stable — so comparing whole rows made this check
  // fail on a number the product never promised. The counts are still compared below
  // and REPORTED as drift when they move, so the non-determinism stays visible
  // instead of being silently compared away.
  let idempotenceOk = true
  const projection = (m: MatrixRow[]) =>
    JSON.stringify(m.map((r) => [r.language, r.extension, r.files, r.symbols, r.status, r.routed]))
  if (cycleResults.length > 1) {
    const base = projection(cycleResults[0].matrix)
    let relDrift = 0
    for (let i = 1; i < cycleResults.length; i++) {
      const other = projection(cycleResults[i].matrix)
      if (other !== base) {
        idempotenceOk = false
        console.log("")
        console.log(`IDEMPOTENCE FAIL: cycle ${i + 1} matrix differs from cycle 1`)
        const a = cycleResults[0].matrix
        const b = cycleResults[i].matrix
        for (let k = 0; k < a.length; k++) {
          const sa = projection([a[k]])
          const sb = projection([b[k]])
          if (sa !== sb) console.log(`    ${a[k].language}: cycle1=${sa} cycle${i + 1}=${sb}`)
        }
      }
      const a = cycleResults[0].matrix
      const b = cycleResults[i].matrix
      for (let k = 0; k < a.length && k < b.length; k++) {
        if (a[k].relationships !== b[k].relationships) {
          relDrift++
          console.log(
            `    note: ${a[k].language} relationship count moved between cycles ` +
              `(${a[k].relationships} -> ${b[k].relationships}); verdicts are stable and the product ` +
              `computes these from cross-file resolution, which is order-dependent`,
          )
        }
      }
    }
    console.log("")
    console.log(
      idempotenceOk
        ? `IDEMPOTENCE ok: ${cycleResults.length} independent cycles produced identical verdicts` +
            (relDrift > 0 ? ` (${relDrift} relationship-count drift(s) noted above)` : "")
        : `IDEMPOTENCE FAIL: cycles disagreed`,
    )
  }

  // --- run summary ---------------------------------------------------------
  console.log("")
  console.log("INDEX RUN SUMMARY (per cycle)")
  for (let i = 0; i < cycleResults.length; i++) {
    const s = cycleResults[i].stats
    console.log(
      `  cycle ${i + 1}: discovered ${s.totalFiles}, processed ${s.processedFiles}, success ${s.successFiles}, ` +
        `errors ${s.errorFiles}, skipped ${s.skippedFiles}, symbols ${s.symbolsExtracted}, ` +
        `relationships ${s.relationshipsFound}; index ${cycleResults[i].indexMs} ms, read-back ${cycleResults[i].measureMs} ms`,
    )
  }

  // --- cleanup -------------------------------------------------------------
  if (!KEEP) {
    rmSync(SCRATCH_ROOT, { recursive: true, force: true })
  } else {
    console.log("")
    console.log(`scratch kept: ${relative(REPO_ROOT, SCRATCH_ROOT)}/ (--keep)`)
  }

  // --- verdict -------------------------------------------------------------
  const failed = rows.filter((r) => r.status !== "PASS")
  const totalMs = Date.now() - startedAt
  const passCount = rows.length - failed.length
  console.log("")
  console.log(
    `${rows.length} languages derived from SUPPORTED_LANGUAGES; ${passCount} PASS; ${failed.length} FAIL; ` +
      `wall time ${totalMs} ms`,
  )
  if (failed.length === 0 && !first.negativeIndexed && idempotenceOk) {
    console.log(
      `LANGUAGE COVERAGE: ALL ${rows.length} LANGUAGES PASS (discovered, parsed, stored with the intended language)`,
    )
    return 0
  }
  const names = failed.map((r) => `${r.language}(${r.status})`)
  console.log(`LANGUAGE COVERAGE: ${failed.length} FAILURE(S): ${names.join(", ")}`)
  if (first.negativeIndexed) console.log("LANGUAGE COVERAGE: NEGATIVE CONTROL FAILED (unknown-extension file was indexed)")
  if (!idempotenceOk) console.log("LANGUAGE COVERAGE: IDEMPOTENCE FAILED (cycles disagreed)")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("language-coverage gate crashed:", e)
    process.exit(1)
  })
