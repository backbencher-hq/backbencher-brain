import { BrainDatabase } from "../../brain/database"
import { AnalysisExclusions } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type { OrphanOptions, PatternFinding, PatternReport } from "../contracts"
import { makeProvenance } from "../evidence"

const ENGINE = "orphans@intelligence"

// Relationship types that count as "somebody uses this symbol".
//
// `references` and `imports` and `overrides` were all missing from this list
// until this revision, and each omission produced a measurable false-positive
// class. All three are real consumers of a symbol, and all three carry resolved
// `target_symbol_id` rows in a real index — they were simply never consulted:
//
//   references  19,203 rows on a 45,018-symbol repository; what analyzers emit
//               for a type annotation or a bare identifier reference.
//               Omitting it: 208 provably-used symbols stayed candidates.
//   imports      1,570 resolved symbol targets on that repository, 354 on
//               luarocks. An imported symbol is used by definition.
//   overrides    1,229 on the Perl corpus, 561 on clojure, 48 on rake. A method
//               that a subclass overrides is used by definition. Omitting it
//               alone put 60% of the reported orphans on the Perl corpus into
//               the false-positive column.
//
// Measured over a 9-repository, 9-language corpus, these are the ONLY
// relationship types that ever carry a resolved target and are not in this list
// or in NON_USAGE_TYPES below — so this list is now the complete set, not a
// subset that happened to cover the cases someone thought of.
const USAGE_TYPES = ["calls", "instantiates", "extends", "implements", "uses", "references", "imports", "overrides"]

// Explicitly NOT usage. `contains` is the indexer's own ownership bookkeeping
// (a file or class contains a member) and `exports` is a module offering a
// symbol; neither is a consumer. The previous oracle in the corpus probe
// accidentally included both and reported that 86% of orphan candidates were
// "provably still used", which is an artifact of counting the indexer's own
// bookkeeping as a consumer — see fixtures/bb_patterns/probes/probe-p9.
const NON_USAGE_TYPES = ["contains", "exports"]

// The symbol types the orphan rules report on. This set is the REPORTING scope
// only. It is deliberately NOT the scope used to decide whether a file is
// referenced — that decision needs every symbol type, because a module-level
// `const` or a class field is a perfectly good cross-file usage edge and the
// previous revision looked both endpoints of an edge up in a map built from
// these six types alone, discarding 35,835 of 46,730 real edges (76.7%).
const REPORTED_SYMBOL_TYPES = new Set(["function", "method", "class", "interface", "struct", "enum"])
const CLASS_LIKE_TYPES = new Set(["class", "interface", "struct", "enum"])

// Languages whose indexed "symbols" are structural keys, not executable
// declarations. A YAML mapping key, a Markdown heading, a JSON property and a
// CSS selector have no callers and never will, so reporting them as orphaned
// code is not a finding, it is noise — and because the page is confidence
// ordered it is the noise that fills the page. Measured on a 45,018-symbol
// repository: 1,188 of 5,190 symbol candidates (23%) were in these files.
//
// These files are NOT excluded from the index, from bb_search, or from
// orphaned_file detection. Only their individual symbols stop being orphan
// candidates. The list is derived from the 24 distinct `brain_file.language`
// values present across a 9-repository, 9-language corpus.
const NON_CODE_LANGUAGES = new Set([
  "markdown", "yaml", "toml", "json", "xml", "css", "scss", "less",
  "html", "htm", "vue", "svelte",
  "ini", "cfg", "conf", "properties", "env", "csv", "tsv", "text", "plaintext",
  "rst", "tex", "bib", "org", "adoc", "asciidoc",
])

// Project manifests and build manifests. These are read by tooling, not
// imported by source, so a directory-aware import match cannot clear them and
// they must never be offered as dead code. `package.json` is the concrete case:
// it was previously "protected" only because some module imported
// `../package.json`, which is the stem heuristic accidentally doing the right
// thing for the wrong reason.
const MANIFEST_FILENAMES = new Set([
  "package.json", "package-lock.json", "tsconfig.json", "jsconfig.json", "composer.json",
  "composer.lock", "gemfile", "gemfile.lock", "rakefile", "gemfile",
  "cargo.toml", "cargo.lock", "go.mod", "go.sum", "requirements.txt", "pipfile",
  "pyproject.toml", "setup.py", "setup.cfg", "pom.xml", "build.gradle",
  "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "mix.exs",
  "pubspec.yaml", "pubspec.lock", "cabal.project", "stack.yaml", "shard.yml",
  "dune-project", "dune", "makefile", "justfile", "dockerfile", "cmakelists.txt",
  "deno.json", "deno.jsonc", "bun.lockb", "pnpm-workspace.yaml",
])

// Common entry-point names. A symbol matching one of these is not reported as
// orphaned even with zero incoming edges.
const ENTRY_POINT_NAMES = new Set(["main", "__main__", "start", "run", "init", "setup", "handler", "default"])
const ENTRY_POINT_SUFFIXES = ["Handler", "Controller", "Middleware", "Route", "Routes", "Command", "Plugin"]

// File basenames that are entry points by convention.
const ENTRY_POINT_FILE_STEMS = new Set(["index", "main", "app", "mod"])

// --- string helpers. No regex anywhere in this file: every one of these is
// index arithmetic, and a regex here would be a second, weaker copy of a rule
// that the indexer already applied when it stored the row.

/** "src/a/b.ts" -> "b". Extension removed by finding the last "." in the
 *  basename only, so a dotted directory name cannot be mistaken for one. */
function stemOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/")
  const base = slash >= 0 ? relativePath.slice(slash + 1) : relativePath
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(0, dot) : base
}

function baseNameOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/")
  return slash >= 0 ? relativePath.slice(slash + 1) : relativePath
}

/**
 * A two-segment path key: "src/lsp/hub_protocol" for "src/lsp/hub_protocol.ts".
 *
 * This replaces the previous global set of import *stems*, which compared a
 * file against a bare name with no directory information at all. That matched
 * `src/utils/foo.ts` with `src/other/foo.ts` because they share a stem, and it
 * matched a local `node.ts` with Node's own `node:fs` built-in import — on a
 * 45,018-symbol repository, 185 real files were suppressed by a collision like
 * that, including Markdown docs "imported" because a same-named TypeScript file
 * was. Requiring the last two segments to agree removes both classes.
 *
 * Returns "" for a single-segment path: `import "express"` and a file called
 * `express.ts` share no path evidence, and pretending otherwise is the defect.
 */
function pathKey2(relativePathOrSpecifier: string): string {
  const segments = relativePathOrSpecifier.split("/").filter((s) => s.length > 0)
  if (segments.length < 2) return ""
  const last = segments[segments.length - 1]
  const dot = last.lastIndexOf(".")
  const lastStem = dot > 0 ? last.slice(0, dot) : last
  return segments[segments.length - 2] + "/" + lastStem
}

function isEntryPointName(name: string): boolean {
  if (ENTRY_POINT_NAMES.has(name)) return true
  return ENTRY_POINT_SUFFIXES.some((s) => name.endsWith(s))
}

function isManifestFile(relativePath: string): boolean {
  return MANIFEST_FILENAMES.has(baseNameOf(relativePath).toLowerCase())
}

function isNonCodeFile(language: string | null): boolean {
  return NON_CODE_LANGUAGES.has((language ?? "").toLowerCase())
}

function locFor(sym: { line: number; lineEnd: number }): number {
  return sym.lineEnd > sym.line ? sym.lineEnd - sym.line : 0
}

type SymRow = {
  id: string
  name: string
  symbolType: string
  visibility: string | null
  line: number
  lineEnd: number
  file: string
  fileId: string
  language: string | null
  fileLineCount: number | null
}

type FileRow = { id: string; relativePath: string; language: string | null; lineCount: number | null }

// Strict orphan detection.
//
// Correctness model. Every clause below is a measured fix; the numbers are from
// a 9-repository corpus in fixtures/bb_patterns/REVIEW-PLAN.md.
//
//   1. A symbol is "used" iff it is the target of a resolved USAGE edge, or an
//      unambiguous name-matched cross-file reference. `contains` and `exports`
//      are indexer bookkeeping and are NOT usage.
//   2. Visibility is NOT a filter. Many analyzers mark everything public.
//   3. Reported symbol types are the six below, but the file-referenced map is
//      built from ALL symbol types, because a `const`, a property, a variable or
//      a type alias is a legitimate cross-file usage edge.
//   4. Entry points are excluded by explicit name/suffix rules, and the count
//      suppressed that way is reported in summary.suppressedByRule so the
//      silence is visible.
//   5. Non-code files (markdown, yaml, json, ...) contribute no symbol
//      candidates. Their keys have no callers by construction.
//   6. A file is referenced if a resolved cross-file usage edge lands in it, or
//      an import specifier agrees with it on the last two path segments.
//
// Confidence is DERIVED FROM EVIDENCE, not a per-rule constant. It used to be a
// constant (0.6 for symbols, 0.5 for files), which made `minConfidence` a
// two-valued switch, made the sort degenerate to alphabetical path order, and
// meant the shipped default of 0.6 silently deleted the entire orphaned_file
// rule — a rule the documentation describes and no user could reach.
export async function detectOrphans(projectId: ProjectID, options: OrphanOptions = {}): Promise<PatternReport> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const minConfidence = options.minConfidence ?? 0
  const maxResults = options.maxResults ?? 100
  const rules = new Set(options.rules ?? ["orphaned_function", "orphaned_class", "orphaned_file"])
  const includeTests = options.includeTests ?? false

  // ---- file universe -------------------------------------------------------
  // Loaded once and joined in JS rather than re-joined per statement. The
  // previous revision selected brain_file twice and brain_symbol twice, and
  // could not join a symbol to its file's language at all.
  const files = raw.prepare(
    "SELECT id, relative_path AS relativePath, language, line_count AS lineCount FROM brain_file WHERE project_id = ?",
  ).all(projectId) as FileRow[]
  const fileById = new Map(files.map((f) => [f.id, f]))

  // ---- symbols -------------------------------------------------------------
  // ALL symbols, for the file-referenced decision. This is the fix for the
  // 76.7% of cross-file edges the previous revision could not see.
  const allSymbols = raw.prepare(
    "SELECT s.id, s.file_id AS fileId FROM brain_symbol s WHERE s.project_id = ?",
  ).all(projectId) as Array<{ id: string; fileId: string }>
  const fileOfSymbolId = new Map(allSymbols.map((s) => [s.id, s.fileId]))

  // The six reportable types, joined to their file's language and line count.
  const reportedTypes = [...REPORTED_SYMBOL_TYPES]
  const symbols = raw.prepare(
    "SELECT s.id, s.name, s.symbol_type AS symbolType, s.visibility, " +
      "COALESCE(s.line_start,0) AS line, COALESCE(s.line_end,0) AS lineEnd, " +
      "f.relative_path AS file, f.id AS fileId, f.language AS language, f.line_count AS fileLineCount " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND s.symbol_type IN (" + reportedTypes.map(() => "?").join(",") + ")",
  ).all(projectId, ...reportedTypes) as SymRow[]

  // ---- incoming usage evidence --------------------------------------------
  const usageRows = raw.prepare(
    "SELECT target_symbol_id AS id, target_external AS ext FROM brain_relationship " +
      "WHERE project_id = ? AND relationship_type IN (" + USAGE_TYPES.map(() => "?").join(",") + ")",
  ).all(projectId, ...USAGE_TYPES) as Array<{ id: string | null; ext: string | null }>

  const usedIds = new Set<string>()
  const usedNames = new Set<string>()
  for (const row of usageRows) {
    if (row.id) usedIds.add(row.id)
    if (row.ext) {
      // target_external is a bare name ("usedFn") or "module:item" or
      // "fileId:Name:line". Take the tail after the last colon, and — this is
      // the part the previous revision omitted — the tail after the last dot,
      // because a qualified reference ("com.example.Service", "Mod.fn") can
      // never equal a stored bare name otherwise. The indexer's own extractLeaf
      // does both; a second, weaker copy of that rule is how the qualified
      // references went missing.
      const afterColon = row.ext.includes(":") ? row.ext.slice(row.ext.lastIndexOf(":") + 1) : row.ext
      const dot = afterColon.lastIndexOf(".")
      usedNames.add(dot > 0 ? afterColon.slice(dot + 1) : afterColon)
    }
  }

  // Ambiguity is computed over the REPORTING scope — the six types, in
  // non-test, non-noise files — not over every row in brain_symbol. The
  // previous query had no symbol_type, path, or test filter, so a declaration
  // in a test file made a same-named production declaration "ambiguous" and
  // disabled the only channel that could have cleared it.
  const ambiguousNames = new Set<string>()
  {
    const dupRows = raw.prepare(
      "SELECT s.name AS name, COUNT(*) AS c FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
        "WHERE s.project_id = ? AND s.symbol_type IN (" + reportedTypes.map(() => "?").join(",") + ") " +
        "GROUP BY s.name HAVING COUNT(*) > 1",
    ).all(projectId, ...reportedTypes) as Array<{ name: string }>
    for (const row of dupRows) ambiguousNames.add(row.name)
  }

  // ---- cross-file referenced files -----------------------------------------
  // Built from ALL symbol types, with both endpoints resolvable to files. This
  // replaces a map keyed on six types that made a module-level `const`, a class
  // field, or a type alias invisible as evidence.
  const referencedFiles = new Set<string>()
  {
    const crossFile = raw.prepare(
      "SELECT r.source_symbol_id AS src, r.target_symbol_id AS tgt FROM brain_relationship r " +
        "WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL AND r.source_symbol_id IS NOT NULL " +
        "AND r.relationship_type IN (" + USAGE_TYPES.map(() => "?").join(",") + ")",
    ).all(projectId, ...USAGE_TYPES) as Array<{ src: string; tgt: string }>
    for (const row of crossFile) {
      const srcFile = fileOfSymbolId.get(row.src)
      const tgtFile = fileOfSymbolId.get(row.tgt)
      if (tgtFile && srcFile && srcFile !== tgtFile) referencedFiles.add(tgtFile)
    }
  }

  // ---- import agreement ----------------------------------------------------
  // Two kinds of evidence, both path-based, neither a bare global stem set.
  //
  //   importPathKeys — a specifier with two or more real path segments must
  //     agree with the file's last two segments. `../../src/lsp/hub_protocol`
  //     clears `src/lsp/hub_protocol.ts` and nothing else.
  //
  //   importStems ∩ uniqueFileStems — a specifier like `./used` is RELATIVE:
  //     its leading `.` / `..` segments are navigation, not identity, so the
  //     only thing it names is a stem, and which file that stem belongs to
  //     depends on the importer's directory. An import cannot be attributed to
  //     its importer in this index, so the stem alone is evidence only when the
  //     stem names exactly ONE file in the project. `./used` clearing
  //     `src/used.ts` is right when only one `used.ts` exists and unsound when
  //     two do. Uniqueness is decidable here, so it is used.
  //
  // This is what the previous code got wrong in both directions at once. It
  // compared every file against one flat set of stems, so `node:fs` (1,158 rows
  // on a 45,018-symbol index) would clear a local `node.ts`, and
  // `src/utils/foo.ts` cleared `src/other/foo.ts`. On that index 185 real files
  // were suppressed by such a collision — mostly Markdown docs "imported"
  // because a same-named .ts file was.
  //
  // Provenance caveat, now recorded rather than assumed away: 3,444 of 3,554
  // `imports` rows on that index have a NULL source_symbol_id, so an import
  // cannot be attributed to the file that made it. The previous code's comment
  // claimed "we require incoming from another file"; the query it ran could
  // not express that.
  const importPathKeys = new Set<string>()
  const importStems = new Set<string>()
  let importRowsSeen = 0
  {
    const importTargets = raw.prepare(
      "SELECT target_external AS ext FROM brain_relationship WHERE project_id = ? AND relationship_type = 'imports'",
    ).all(projectId) as Array<{ ext: string | null }>
    for (const row of importTargets) {
      if (!row.ext) continue
      importRowsSeen++
      const spec = row.ext.includes(":") ? row.ext.slice(0, row.ext.indexOf(":")) : row.ext
      const key = pathKey2(spec)
      if (key) importPathKeys.add(key)
      const stem = stemOf(spec)
      if (stem) importStems.add(stem)
    }
  }

  // Stems that name exactly one indexed file. A stem shared by two or more
  // files carries no information about which one was imported.
  const fileStemCounts = new Map<string, number>()
  for (const file of files) {
    const stem = stemOf(file.relativePath)
    fileStemCounts.set(stem, (fileStemCounts.get(stem) ?? 0) + 1)
  }
  const uniqueFileStems = new Set<string>()
  for (const [stem, count] of fileStemCounts) if (count === 1) uniqueFileStems.add(stem)

  /** Does an import specifier plausibly name this file? */
  const importedBySomething = (relativePath: string): boolean => {
    const key = pathKey2(relativePath)
    if (key && importPathKeys.has(key)) return true
    const stem = stemOf(relativePath)
    return uniqueFileStems.has(stem) && importStems.has(stem)
  }

  // ---- suppression accounting ---------------------------------------------
  // Every skip below is counted. The previous revision silently dropped
  // candidates for seven different reasons and reported none of them, so a
  // project with 5,000 real orphans and 5,000 skipped entry points looked
  // identical to a clean project.
  const suppressed = {
    testPath: 0,
    hardNoise: 0,
    noiseSymbolName: 0,
    entryPointName: 0,
    nonCodeFile: 0,
    manifestFile: 0,
    ruleNotRequested: 0,
    belowMinConfidence: 0,
  }

  // Path predicates are pure functions of the path; the scan evaluated them
  // once per symbol. Memoized by path.
  const testPathMemo = new Map<string, boolean>()
  const noisePathMemo = new Map<string, boolean>()
  const isTestFile = (p: string): boolean => {
    let v = testPathMemo.get(p)
    if (v === undefined) { v = AnalysisExclusions.isTestPath(p); testPathMemo.set(p, v) }
    return v
  }
  const isNoiseFile = (p: string): boolean => {
    let v = noisePathMemo.get(p)
    if (v === undefined) { v = AnalysisExclusions.isHardNoisePath(p); noisePathMemo.set(p, v) }
    return v
  }

  type OrphanCandidate = { conf: number; file: string; loc: number; symbol?: SymRow; fileRow?: FileRow; limitations?: string[] }
  const candidates: OrphanCandidate[] = []

  const buildSymbolFinding = (sym: SymRow, confidence: number, fileReferenced: boolean, nameAmbiguous: boolean): PatternFinding => {
    const classLike = CLASS_LIKE_TYPES.has(sym.symbolType)
    const rule = classLike ? "orphaned_class" : "orphaned_function"
    return {
      rule: rule as any,
      engine: ENGINE,
      severity: "info",
      confidence,
      location: { file: sym.file, line: sym.line, symbol: sym.name },
      linesOfCode: locFor(sym),
      description: `${classLike ? "Type" : "Function"} '${sym.name}' has no incoming ${USAGE_TYPES.join("/")} relationship.`,
      remediation: "Verify it is not referenced dynamically, via reflection, framework registration, or build/test config before considering removal.",
      evidence: [
        { kind: "relationship", description: `No resolved incoming relationship of type ${USAGE_TYPES.join("/")} names this symbol id. (contains/exports are indexer bookkeeping and are not usage.)` },
        { kind: "reference", description: nameAmbiguous ? `No name-matched reference either, but '${sym.name}' is declared ${2}+ times in the reporting scope, so a name reference could not have been attributed to this declaration. Candidates in this class measured 14.4% false positive against 0.0% for unambiguous names.` : `No name-matched cross-file reference (target_external) names this symbol, and its name is declared exactly once in the reporting scope, so a name reference would have been decisive if one existed.` },
        { kind: "heuristic", description: fileReferenced ? `Its file IS reached from other files by a resolved cross-file edge, which correlates with a higher false-positive rate (11.4% vs 3.7% measured across a 9-repository corpus): a reachable file is where an unrecorded reference is most likely.` : `Its file has no incoming cross-file reference at all, which correlates with a lower false-positive rate (3.7% measured).` },
      ],
      limitations: [
        "Name-only matching cannot see dynamic dispatch, reflection, or string-based lookups.",
        ...(nameAmbiguous ? [`The name '${sym.name}' is declared more than once; unresolved name-only references are treated as uncertain and do not suppress this candidate.`] : []),
        "Framework entry points not matched by the built-in name/suffix rules may be false positives.",
        "Build configs, plugin manifests (XML), and test conventions are not scanned.",
      ],
    }
  }

  const buildFileFinding = (row: FileRow, confidence: number): PatternFinding => {
    const hasSymbols = symbols.some((s) => s.fileId === row.id)
    return {
      rule: "orphaned_file",
      engine: ENGINE,
      severity: "info",
      confidence,
      location: { file: row.relativePath, line: 1 },
      linesOfCode: row.lineCount ?? 0,
      description: `File '${row.relativePath}' has no incoming references from other files (no cross-file symbol usage, and no import specifier agreeing with its path).`,
      remediation: "Confirm the file is not an entry point, dynamically loaded, or referenced by build/test tooling before removal.",
      evidence: [
        { kind: "relationship", description: "No resolved cross-file usage relationship lands in this file." },
        { kind: "import", description: `No import specifier names this file: two-segment key ${pathKey2(row.relativePath) || "(none — the file is at the project root)"}; stem "${stemOf(row.relativePath)}"${uniqueFileStems.has(stemOf(row.relativePath)) ? " is unique in this project and is never imported" : " is shared with other files, so it carries no path evidence"}.` },
        { kind: "heuristic", description: importRowsSeen > 0 ? `The index records ${importRowsSeen} import relationship(s), so the import channel was available as evidence.` : `The index records NO import relationships, so the only evidence channel available was cross-file symbol usage.` },
      ],
      limitations: [
        "Entry points and dynamically loaded files may appear orphaned.",
        "Build systems and non-code manifests are not scanned.",
        "An import cannot be attributed to the file that made it in this index, so a name collision inside a package cannot be used to clear a file.",
        ...(hasSymbols ? [] : ["This file contributed no reportable symbols, so the cross-file symbol channel had nothing to match on."]),
      ],
    }
  }

  // ---- symbol candidates ---------------------------------------------------
  for (const sym of symbols) {
    if (!includeTests && isTestFile(sym.file)) { suppressed.testPath++; continue }
    if (isNoiseFile(sym.file)) { suppressed.hardNoise++; continue }
    if (AnalysisExclusions.isNoiseSymbolName(sym.name)) { suppressed.noiseSymbolName++; continue }
    if (isEntryPointName(sym.name)) { suppressed.entryPointName++; continue }
    if (isNonCodeFile(sym.language)) { suppressed.nonCodeFile++; continue }

    const used = usedIds.has(sym.id) || (usedNames.has(sym.name) && !ambiguousNames.has(sym.name))
    if (used) continue

    const rule = CLASS_LIKE_TYPES.has(sym.symbolType) ? "orphaned_class" : "orphaned_function"
    if (!rules.has(rule as any)) { suppressed.ruleNotRequested++; continue }

    const nameAmbiguous = ambiguousNames.has(sym.name)
    const fileReferenced = referencedFiles.has(sym.fileId)

    // Evidence-derived confidence. Every term is measured, not assumed: the
    // false-positive rate below is from a 9-repository, 9-language corpus,
    // scoring each reported candidate against "is something other than
    // contains/exports pointing at this symbol, or unambiguously naming it".
    //
    //   name unique in the reporting scope : 2,581 candidates,  0.0% false positive
    //   name ambiguous                      : 6,113 candidates, 14.4% false positive
    //   file IS cross-file referenced       : 7,234 candidates, 11.4% false positive
    //   file is NOT cross-file referenced   : 1,460 candidates,  3.7% false positive
    //
    // Name uniqueness is the strongest predictor available by a wide margin, and
    // on the "unique" side the measured false-positive rate is zero in every
    // one of the nine repositories, so it carries the most weight. The
    // file-reachability term points the opposite way to intuition and the
    // measurement is what settled it: a file that other files already reach is
    // the file where an unrecorded reference is most likely, while a file with
    // no cross-file edge at all is the one most likely to be genuinely dead.
    //
    // The range is [0.30, 0.70]. The ceiling is the cap this tool has always
    // published (docs/BB_PATTERNS.md "capped at"), kept rather than raised:
    // a candidate can now move within that band, but the band did not move, so
    // the one number a downstream consumer could rely on still holds. Nothing
    // in this rule can reach 1.0, because name matching cannot see dynamic
    // dispatch, reflection, or string lookup, and that limit has not changed.
    let confidence = 0.5
    confidence += nameAmbiguous ? -0.15 : 0.15
    confidence += fileReferenced ? -0.05 : 0.05
    if (confidence < 0.3) confidence = 0.3
    if (confidence > 0.7) confidence = 0.7

    if (confidence < minConfidence) { suppressed.belowMinConfidence++; continue }
    candidates.push({ conf: confidence, file: sym.file, loc: locFor(sym), symbol: sym })
  }

  // ---- file candidates -----------------------------------------------------
  // A file is scanned even when it contributed no reportable symbols, so
  // summary.scannedFiles describes this branch's real scope. It used to count
  // only files that happened to hold one of the six types (1,400) while this
  // branch iterated all 1,654 rows.
  const fileScope = new Set<string>()
  if (rules.has("orphaned_file")) {
    for (const file of files) {
      if (!includeTests && isTestFile(file.relativePath)) continue
      if (isNoiseFile(file.relativePath)) continue
      if (isManifestFile(file.relativePath)) { suppressed.manifestFile++; continue }
      const stem = stemOf(file.relativePath)
      if (ENTRY_POINT_FILE_STEMS.has(stem.toLowerCase())) continue
      fileScope.add(file.id)

      const referencedBySymbol = referencedFiles.has(file.id)
      if (referencedBySymbol || importedBySomething(file.relativePath)) continue

      // Evidence-derived. A file rule is only as trustworthy as the channels it
      // could consult: when the index records no imports at all (Erlang, Rust,
      // Clojure, Python, Mojo, Ruby in this corpus record zero), the file
      // verdict rests on the symbol channel alone and must say so by scoring
      // lower rather than by hiding.
      let confidence = importRowsSeen > 0 ? 0.5 : 0.3
      if (isNonCodeFile(file.language)) confidence += 0.05

      if (confidence < minConfidence) { suppressed.belowMinConfidence++; continue }
      candidates.push({ conf: confidence, file: file.relativePath, loc: file.lineCount ?? 0, fileRow: file })
    }
  } else {
    for (const sym of symbols) if (!isTestFile(sym.file) && !isNoiseFile(sym.file)) fileScope.add(sym.fileId)
  }

  // ---- rank ----------------------------------------------------------------
  // Confidence first, then size, then path. The previous comparator was
  // confidence then path, and because every symbol candidate had the same
  // confidence the page became an alphabetical prefix of the repository: on a
  // 1,654-file index the default page was 59 rows of .github/workflows/*.yml,
  // 39 of docs/*.md, and 0 under src/.
  candidates.sort((a, b) => b.conf - a.conf || b.loc - a.loc || a.file.localeCompare(b.file))

  const truncated = candidates.length > maxResults
  const page = candidates.slice(0, maxResults).map((c) =>
    c.symbol
      ? buildSymbolFinding(c.symbol, c.conf, referencedFiles.has(c.symbol.fileId), ambiguousNames.has(c.symbol.name))
      : buildFileFinding(c.fileRow!, c.conf),
  )

  const byRule: Record<string, number> = {}
  for (const f of page) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1

  const candidatesByRule: Record<string, number> = {}
  let candidatesConfidenceSum = 0
  for (const c of candidates) {
    const rule = c.symbol ? (CLASS_LIKE_TYPES.has(c.symbol.symbolType) ? "orphaned_class" : "orphaned_function") : "orphaned_file"
    candidatesByRule[rule] = (candidatesByRule[rule] ?? 0) + 1
    candidatesConfidenceSum += c.conf
  }

  return {
    findings: page,
    provenance: makeProvenance({
      evidenceClass: "static_finding",
      engine: ENGINE,
      engineVersion: "m10.03",
      projectId,
      source: "brain_symbol+brain_relationship+brain_file",
      limitations: [
        "Dynamic dispatch, reflection, string references, and external manifests are not fully observable.",
        ...(ambiguousNames.size ? [`${ambiguousNames.size} duplicate symbol name(s) in the reporting scope were treated as ambiguous rather than globally resolved.`] : []),
        ...(importRowsSeen === 0 ? ["The index records no import relationships, so file-level findings rest on the cross-file symbol channel alone."] : []),
        `Non-code files (${[...NON_CODE_LANGUAGES].slice(0, 6).join(", ")}, ...) contribute no symbol candidates; they are still indexed and still checked as whole files.`,
      ],
      truncated,
    }),
    summary: {
      total: page.length,
      byRule,
      scannedSymbols: symbols.length,
      scannedFiles: fileScope.size,
      truncated,
      candidatesTotal: candidates.length,
      candidatesByRule,
      candidatesAverageConfidence: candidates.length ? candidatesConfidenceSum / candidates.length : 0,
      // New: why the candidate set is the size it is. Every number the scan
      // discarded, so "the tool found nothing" is distinguishable from "the
      // tool suppressed everything it saw".
      suppressedByReason: suppressed,
    } as PatternReport["summary"],
  }
}
