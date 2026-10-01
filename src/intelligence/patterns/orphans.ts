import { BrainDatabase } from "../../brain/database"
import { AnalysisExclusions, isNonCodeLanguage, NON_CODE_LANGUAGES } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type { OrphanOptions, PatternFinding, PatternReport } from "../contracts"
import { makeProvenance } from "../evidence"

const ENGINE = "orphans@intelligence"

// Relationship types that can express "somebody uses this symbol".
//
// Membership here is NECESSARY BUT NOT SUFFICIENT. A row of one of these types
// is treated as evidence of a consumer only if it also passes the evidence
// quality gate below. The previous revision decided on the type alone, which
// meant an `overrides` row produced by a name guess was accepted as proof.
const USAGE_TYPES = ["calls", "instantiates", "extends", "implements", "uses", "references", "imports", "overrides"]

// ---- evidence quality gate ------------------------------------------------
//
// A resolved target is necessary but not sufficient. The index publishes an
// evidence class and a confidence per edge, and a meaningful share of rows
// assert something that is not evidence of a CONSUMER. Measured on real
// corpora with the current analyzers, over every resolved edge:
//
//   type          edges   selfLoop   inferred   conf<0.7   all-clean
//   calls         12182       2.8%       0.0%       0.0%      97.2%
//   uses           3086       1.2%       0.0%       0.0%      98.8%
//   references     2057       0.7%       0.1%       0.0%      99.2%
//   instantiates    664       0.0%       0.0%       0.0%     100.0%
//   extends           2       0.0%       0.0%       0.0%     100.0%
//   implements      180       0.6%       0.0%       0.0%      99.4%
//   overrides        48      87.5%     93.8%      93.8%       2.1%   <- rake
//   overrides         1     100.0%    100.0%     100.0%       0.0%   <- ripgrep
//
// Three defects, all of which the old type-only test accepted:
//
//   1. SELF-LOOPS. source_symbol_id == target_symbol_id asserts that a symbol
//      is a consumer of ITSELF. The concrete case on rake is `test_files=` and
//      `ruby_version` in lib/rake/testtask.rb, each with an `overrides` edge
//      to itself and metadata
//        reasonCode "first-parent-guess", evidenceClass "inferred", confidence 0.5
//      A self-edge cannot be a consumer of anything.
//
//   2. INFERENCES. evidenceClass "inferred" marks a heuristic tier. The
//      upstream review (60eb13ef) measures that tier at 65.2% wrong on real
//      Kotlin and records that it "has NO oracle", because a per-file oracle
//      cannot adjudicate a guess that fires precisely when the declaring
//      ancestor is out of file. Those rows are not explained; they are filed
//      under a different counter, so they never surface as a failure.
//
//   3. LOW CONFIDENCE. Rows published below 0.7 are the guess tier for this
//      index; 0.5 is the default the guess tier emits.
//
// The gate is stated once, on the row's own evidence, rather than as a
// per-type exception list. That is deliberate: a list of types that "happen to
// be sound" is the same shape of decision that produced a second, weaker copy
// of the import-stem rule and the six-symbol-type file map, and both were
// wrong. The gate is also self-correcting — an analyzer that starts publishing
// sound `overrides` rows automatically contributes them again, with no change to
// this file.
//
// What this costs: on rake, 2.1% of `overrides` rows survive, so a small number
// of symbols that a guess suppressed become candidates again. That is the
// correct direction of error. The exposure is counted and reported in
// summary.suppressedByReason and in every affected finding's evidence, so the
// number of candidates a guess is keeping out of the report is never invisible.
const MIN_EDGE_CONFIDENCE = 0.7
const SELF_LOOP_EXCLUDED = "selfLoop"
const INFERRED_EXCLUDED = "inferred"
const LOW_CONFIDENCE_EXCLUDED = "lowConfidence"

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
// declarations, live in analysis-exclusions.NON_CODE_LANGUAGES and are shared
// with the anti-pattern rules. This engine used to carry its own list while the
// rules branch excluded none of these languages at all, and its top-ranked
// god-class finding on a real index was a JSON file's members. One definition,
// because a second, weaker copy of a language rule is exactly how the qualified
// references and the import-stem collisions went missing in the first place.
//
// These files are NOT excluded from the index, from bb_search, or from
// orphaned_file detection. Only their individual symbols stop being
// code-rule candidates.

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

/**
 * Join a relative module specifier onto a directory the way a module resolver
 * does, collapsing "." and "..".
 *
 * Written out rather than delegated to path.posix.join because this file has no
 * filesystem import and the rule has to be byte-identical on every runtime the
 * engine runs on (bun:sqlite under Bun, better-sqlite3 under Node). Segment
 * arithmetic is also the whole rule: "." contributes nothing, ".." pops one
 * segment, anything else is appended. No regex, and no dependence on the host
 * platform's path separator.
 */
function posixJoin(dir: string, spec: string): string {
  const out: string[] = []
  for (const segment of ((dir === "" ? "" : dir + "/") + spec).split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      if (out.length > 0) out.pop()
      continue
    }
    out.push(segment)
  }
  return out.join("/")
}

function isNonCodeFile(language: string | null): boolean {
  return isNonCodeLanguage(language)
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
  // TWO channels, because "this name appears in the project" and "this symbol
  // was consumed by another symbol" are different kinds of claim and the index
  // distinguishes them, in a way that varies enormously by project:
  //
  //   ID evidence  an ANCHORED edge (source_symbol_id present) from a different
  //                symbol to this one, structurally published. Decisive: it
  //                clears the candidate outright.
  //
  //   NAME evidence a name match — the leaf of `target_external`, or the name of
  //                the target of an UNANCHORED clean row. Clearing on this
  //                requires the name to be unambiguous in the reporting scope.
  //
  //   NOTHING       a row that fails the quality gate contributes nothing, not
  //                even its name. A guess is not a sighting.
  //
  // The split is not a stylistic choice. The share of edges that are unanchored
  // is a property of the project, not of the relationship type, so no per-type
  // rule can capture it:
  //
  //   repo      calls  uses  imports  references   (share with a NULL source)
  //   rake        2%    0%      5%        97%
  //   ripgrep     2%    4%      0%         0%
  //   rebar3      0%    0%      0%         0%
  //   clojure     0%    3%      0%         0%
  //   lodash     83%   31%     65%        61%
  //   luarocks   17%   14%     83%        13%
  //
  // Treating lodash's 3,775 unanchored `calls` edges as proof that a specific
  // symbol was consumed is the error the old code made: 95.1% of that corpus's
  // reported orphans were then provably used. Treated as NAME evidence and
  // gated on uniqueness, the same edges can only clear a candidate whose name
  // nobody else claims — which is the claim they actually support.
  //
  // The three quality criteria apply to both channels, from the row's own
  // published evidence (see the gate's table above): a self-loop asserts that a
  // symbol consumes itself, `evidenceClass: "inferred"` is the heuristic tier the
  // analyzer documentation discloses has no oracle, and confidence below
  // MIN_EDGE_CONFIDENCE is the guess tier. On lodash 5,639 rows fail that test;
  // on rebar3 1,507 rows are self-loops; on clojure 6,442 fail. Every rejected
  // row is counted in summary.unverifiedUsageEdges rather than dropped silently.
  type EdgeRow = { rt: string; id: string | null; ext: string | null; src: string | null; srcFile: string | null }
  const edgeRows: EdgeRow[] = []
  const edgeRejects = { [SELF_LOOP_EXCLUDED]: 0, [INFERRED_EXCLUDED]: 0, [LOW_CONFIDENCE_EXCLUDED]: 0, unanchored: 0 }
  const edgeRejectsByType: Record<string, Record<string, number>> = {}
  const nameEvidence = new Set<string>()
  // symbolId -> why a row about it was refused, so the finding can disclose it.
  const rejectedFor = new Map<string, string[]>()
  // Declared BEFORE the load loop that fills it. `usedIds` sat below the loop in
  // the first draft of this two-channel version, so every call that reached the
  // loop body threw "Cannot access 'usedIds' before initialization". It was
  // invisible for a while because a probe pointed at a wrong BB_DATA_DIR, the
  // database was empty, the loop never ran, and the tool reported a clean
  // project. A crash and a clean result are indistinguishable if the corpus is
  // not asserted to be real first.
  const usedIds = new Set<string>()
  {
    // json_extract keeps the metadata read in SQLite. A JS JSON.parse per edge
    // would be 18k-30k parses per scan on a large index; the first version of
    // this loop did that and then prepared a statement inside it, which is two
    // mistakes in the same loop.
    const rows = raw.prepare(
      "SELECT r.relationship_type AS rt, r.target_symbol_id AS id, r.target_external AS ext, " +
        "r.source_symbol_id AS src, r.confidence AS conf, " +
        "json_extract(r.metadata, '$.evidenceClass') AS ev, " +
        "json_extract(r.metadata, '$.bareRead') AS bareRead, " +
        "CASE WHEN s.file_id IS NULL THEN NULL ELSE s.file_id END AS srcFile, " +
        "t.name AS tgtName " +
        "FROM brain_relationship r " +
        "LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id " +
        "LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id " +
        "WHERE r.project_id = ? AND r.relationship_type IN (" + USAGE_TYPES.map(() => "?").join(",") + ")",
    ).all(projectId, ...USAGE_TYPES) as Array<{
      rt: string; id: string | null; ext: string | null; src: string | null
      conf: number | null; ev: string | null; bareRead: number | null; srcFile: string | null; tgtName: string | null
    }>

    /** The tail of a reference: after the last colon, then after the last dot. */
    const leafName = (value: string): string => {
      const afterColon = value.includes(":") ? value.slice(value.lastIndexOf(":") + 1) : value
      const dot = afterColon.lastIndexOf(".")
      return dot > 0 ? afterColon.slice(dot + 1) : afterColon
    }

    for (const row of rows) {
      const reason =
        row.src !== null && row.id !== null && row.src === row.id ? SELF_LOOP_EXCLUDED
        : row.ev === "inferred" ? INFERRED_EXCLUDED
        : typeof row.conf === "number" && row.conf < MIN_EDGE_CONFIDENCE ? LOW_CONFIDENCE_EXCLUDED
        : null
      if (reason) {
        // A row the index publishes as a guess establishes NOTHING — not even
        // that a name was used. The first version of this loop forwarded the
        // rejected row's name into the name channel "so the identifier was not
        // lost", and the effect was that bb_patterns returned ZERO candidates
        // for rake: `references` is 97% unanchored there, and once every
        // rejected row's identifier became name evidence, `usedNames` covered
        // nearly every symbol in the project and the ambiguity rule cleared
        // them all. A guess is not a sighting.
        edgeRejects[reason]++
        const bucket = (edgeRejectsByType[row.rt] ??= {})
        bucket[reason] = (bucket[reason] ?? 0) + 1
        // It IS worth recording WHICH symbols a guess was keeping out of the
        // report, so that a finding can say so. The concrete case that motivates
        // this: `listen` in lib/Mojo/IOLoop/Server.pm has NO incoming call edge
        // at all — the index never recorded its callers — and the only thing
        // standing between it and a report was an `overrides` row that is
        // simultaneously a self-loop, `inferred`, and published at 0.5. Calling
        // it dead is the honest reading of the index; NOT telling the reader
        // that a rejected guess pointed here is not.
        if (row.id) {
          const list = rejectedFor.get(row.id)
          if (list) list.push(reason)
          else rejectedFor.set(row.id, [reason])
        }
        continue
      }
      // Clean row. Two claims, at different strengths:
      //   anchored   this symbol was consumed by another identified symbol.
      //              Decisive: clears the candidate outright.
      //   unanchored the row is ABOUT this target but names no consumer, so it
      //              is a name match and only clears an unambiguous name.
      if (row.src !== null) {
        if (row.id) usedIds.add(row.id)
      } else if (row.tgtName) {
        nameEvidence.add(row.tgtName)
      }
      // The leaf of `target_external` is the name the edge is about, on either
      // kind of row. Taken after the last colon and then after the last dot,
      // matching the indexer's own extractLeaf, so a qualified reference
      // ("com.example.Service", "Mod.fn") can still match a stored bare name.
      if (row.ext) nameEvidence.add(leafName(row.ext))
      edgeRows.push({ rt: row.rt, id: row.id, ext: row.ext, src: row.src, srcFile: row.srcFile })
    }
  }

  const usedNames = nameEvidence

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
  // Built from ALL symbol types, with both endpoints resolvable to files, from
  // the SAME gated edge set the symbol channel used. This replaces a map keyed
  // on six types that made a module-level `const`, a class field, or a type
  // alias invisible as evidence.
  const referencedFiles = new Set<string>()
  for (const row of edgeRows) {
    if (!row.id || !row.src) continue
    const srcFile = fileOfSymbolId.get(row.src)
    const tgtFile = fileOfSymbolId.get(row.id)
    if (tgtFile && srcFile && srcFile !== tgtFile) referencedFiles.add(tgtFile)
  }

  // ---- import resolution ----------------------------------------------------
  // An `imports` row now carries its SOURCE, so the specifier can be resolved
  // the way a module resolver would: relative to the importing file's own
  // directory, then matched against the real indexed path set. This replaces
  // two rounds of name matching that could not express "some OTHER file imports
  // this one":
  //
  //   flat stem set     `node:fs` cleared a local `node.ts`; src/utils/foo.ts
  //                     cleared src/other/foo.ts; 185 real files suppressed.
  //   two-segment key   correct, but could not resolve `./used`, because a
  //                     relative specifier's leading `.` and `..` are
  //                     navigation rather than identity and the importer was
  //                     unknown.
  //   resolve then match the importer is known, so `./used` from src/main.ts
  //                     resolves to src/used.ts and nothing else.
  //
  // Bare specifiers ("express", "node:fs", "com.example.Service") are package
  // or namespace references and are deliberately NOT resolved: they say nothing
  // about which local file, if any, was meant. That is the exact mistake the
  // flat stem set made.
  //
  // Where the index still cannot attribute an import to a file, the row is
  // counted and the fallback stem rule is used ONLY for those rows, and only
  // when the stem names exactly one file in the project. Measured provenance
  // with the current analyzers: 96/96 attributable on ripgrep, 18/19 on rake,
  // 0/3554 before the analyzer work — so the fallback is now a rare path
  // rather than the main one, and the report says how often it was needed.
  const importReferencedFiles = new Set<string>()
  const importUnattributedStems = new Set<string>()
  let importRowsSeen = 0
  let importRowsResolved = 0
  let importRowsUnattributed = 0
  {
    const indexedPaths = new Set<string>()
    const fileDirById = new Map<string, string>()
    const fileIdByPath = new Map<string, string>()
    for (const f of files) {
      indexedPaths.add(f.relativePath)
      fileIdByPath.set(f.relativePath, f.id)
      const slash = f.relativePath.lastIndexOf("/")
      fileDirById.set(f.id, slash > 0 ? f.relativePath.slice(0, slash) : "")
    }
    // Module paths a specifier may stand for, in resolution order: the bare
    // path first (a specifier that already names the extension), then the
    // common source extensions, then the per-language index forms.
    const RESOLVABLE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs", ".lua", ".ex", ".exs", ".clj", ".java", ".kt", ".c", ".h", ".cpp", ".cs", ".php", ".pl", ".sh", ".erl", ".jl", ".swift", ".scala", ".json", ".yaml", ".yml", ".toml", ".md"]
    const INDEX_STEMS = ["index", "mod", "init", "__init__"]
    const resolveAgainst = (spec: string, importerDir: string): string | null => {
      // Two bases, in order of authority:
      //   relative ("../x")  — resolved against the IMPORTER's directory. This
      //     is what a module resolver does and it is unambiguous now that the
      //     importer is known.
      //   root-relative ("rake/file_list", "src/lsp/hub") — resolved against the
      //     project root. Ruby, Python, and JS-partial conventions all use it,
      //     and it is safe precisely because it must name a path that EXISTS in
      //     the index: a package specifier like "node" or "express" names no
      //     indexed file and so matches nothing. That is the property the old
      //     flat stem set lacked, which is why "node:fs" could clear a local
      //     node.ts.
      const bases = spec.startsWith(".") ? [importerDir] : [""]
      for (const base of bases) {
        const joined = posixJoin(base, spec)
        for (const suffix of RESOLVABLE_SUFFIXES) {
          const candidate = joined + suffix
          if (indexedPaths.has(candidate)) return candidate
        }
        for (const stem of INDEX_STEMS) {
          for (const suffix of RESOLVABLE_SUFFIXES) {
            if (!suffix) continue
            const candidate = joined + "/" + stem + suffix
            if (indexedPaths.has(candidate)) return candidate
          }
        }
      }
      return null
    }
    const importTargets = raw.prepare(
      "SELECT r.target_external AS ext, r.source_symbol_id AS src, s.file_id AS srcFile " +
        "FROM brain_relationship r LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id " +
        "WHERE r.project_id = ? AND r.relationship_type = 'imports'",
    ).all(projectId) as Array<{ ext: string | null; src: string | null; srcFile: string | null }>
    for (const row of importTargets) {
      if (!row.ext) continue
      importRowsSeen++
      const spec = row.ext.includes(":") ? row.ext.slice(0, row.ext.indexOf(":")) : row.ext
      const importerDir = row.srcFile ? fileDirById.get(row.srcFile) : undefined
      if (importerDir === undefined) {
        // The index cannot say which file made this import. Fall back to a stem
        // match, only where that stem is unambiguous, and count it.
        importRowsUnattributed++
        const stem = stemOf(spec)
        if (stem) importUnattributedStems.add(stem)
        continue
      }
      const resolved = resolveAgainst(spec, importerDir)
      if (resolved === null) continue
      importRowsResolved++
      const resolvedId = fileIdByPath.get(resolved)
      // "Some OTHER file imports this one" is now expressible, which the
      // previous code's comment claimed and its query could not do.
      if (resolvedId && resolvedId !== row.srcFile) importReferencedFiles.add(resolvedId)
    }
  }

  /** Stems that name exactly one indexed file. A stem shared by two or more
   *  files carries no information about which one was imported. */
  const uniqueFileStems = new Set<string>()
  {
    const stemCounts = new Map<string, number>()
    for (const f of files) {
      const stem = stemOf(f.relativePath)
      stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1)
    }
    for (const [stem, count] of stemCounts) if (count === 1) uniqueFileStems.add(stem)
  }

  /** Does an import resolve to this file, or fall back to an unambiguous stem? */
  const importedBySomething = (fileId: string, relativePath: string): boolean => {
    if (importReferencedFiles.has(fileId)) return true
    if (importUnattributedStems.size === 0) return false
    const stem = stemOf(relativePath)
    return uniqueFileStems.has(stem) && importUnattributedStems.has(stem)
  }

  // ---- per-file incoming usage, for the coverage-gap disclosure -----------
  // The refused-evidence disclosure above covers a symbol that HAD rows and had
  // all of them refused. It does not cover the case the rake corpus forced:
  // Rake::TestTask, Rake::FileCreationTask and Rake::EarlyTime have no
  // incoming relationship of any kind, refused or otherwise, so nothing fires.
  // They are used — lib/rake.rb:51 and :57 `require_relative` their files, and
  // dsl_definition.rb:83 calls `Rake::FileCreationTask.define_task` — and the
  // index records none of it. The signature is available and is precise:
  //
  //   lib/rake/testtask.rb            21 incoming usage edges from 11 sources,
  //                                    and TestTask itself has 0
  //   lib/rake/file_creation_task.rb   2 incoming usage edges from 2 sources,
  //                                    and FileCreationTask itself has 0
  //   lib/rake/early_time.rb           0 from 0, and EarlyTime is genuinely
  //                                    self-contained, so it is correctly
  //                                    reported without any disclaimer
  //
  // The analyzer reached the file and recorded its other members. It did not
  // record this one. That is a coverage gap in the index, and the finding has to
  // say so, because "no incoming edge" and "the index did not look here enough"
  // are indistinguishable from inside the engine and very different to a reader.
  //
  // Counted over ALL non-bookkeeping incoming rows, anchored or not, and with
  // `contains`/`exports` excluded. This measures whether the analyzer PRODUCED
  // ANY ROW about a symbol in this file, which is a coverage question and not
  // the evidence-quality question the gate above answers. Restricting it to
  // anchored clean rows made FileCreationTask invisible to the disclosure even
  // though its file has two incoming rows; restricting it to nothing at all would
  // make the disclaimer fire on files the analyzer never mentioned, which is the
  // failure mode the EarlyTime check in the corpus probe guards against.
  const fileIncomingUsage = new Map<string, { edges: number; sources: Set<string> }>()
  {
    const reach = raw.prepare(
      "SELECT t.file_id AS fid, COALESCE(r.source_symbol_id, '?') AS src, COUNT(*) AS n " +
        "FROM brain_relationship r JOIN brain_symbol t ON t.id = r.target_symbol_id " +
        "WHERE r.project_id = ? " +
        "AND r.relationship_type IN (" + USAGE_TYPES.map(() => "?").join(",") + ") " +
        "AND (r.source_symbol_id IS NULL OR r.source_symbol_id <> r.target_symbol_id) " +
        "GROUP BY t.file_id, COALESCE(r.source_symbol_id, '?')",
    ).all(projectId, ...USAGE_TYPES) as Array<{ fid: string | null; src: string; n: number }>
    for (const row of reach) {
      if (!row.fid) continue
      const entry = fileIncomingUsage.get(row.fid) ?? { edges: 0, sources: new Set<string>() }
      entry.edges += row.n
      entry.sources.add(row.src)
      fileIncomingUsage.set(row.fid, entry)
    }
  }

  // Symbols that DO have an incoming USAGE row are not coverage-gap candidates.
  // `contains` and `exports` are excluded here for the same reason they are
  // excluded from usage everywhere else: they are the indexer's own
  // bookkeeping. Including them made Rake::TestTask look referenced, because
  // its own module offers it via `exports` — which is the definition of a
  // declaration nobody called.
  const symbolsWithAnyIncoming = new Set<string>()
  {
    const rows = raw.prepare(
      "SELECT DISTINCT target_symbol_id AS id FROM brain_relationship " +
        "WHERE project_id = ? AND target_symbol_id IS NOT NULL " +
        "AND source_symbol_id <> target_symbol_id " +
        "AND relationship_type IN (" + USAGE_TYPES.map(() => "?").join(",") + ")",
    ).all(projectId, ...USAGE_TYPES) as Array<{ id: string }>
    for (const row of rows) symbolsWithAnyIncoming.add(row.id)
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

  type OrphanCandidate = { conf: number; file: string; loc: number; symbol?: SymRow; fileRow?: FileRow; rejectedReasons?: string[]; fileUsage?: { edges: number; sources: Set<string> } }
  const candidates: OrphanCandidate[] = []

  const buildSymbolFinding = (sym: SymRow, confidence: number, fileReferenced: boolean, nameAmbiguous: boolean, rejectedReasons: string[], fileUsage: { edges: number; sources: Set<string> } | undefined): PatternFinding => {
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
        ...(rejectedReasons.length > 0
          ? [{
              kind: "heuristic" as const,
              description: `REFUSED EVIDENCE: ${rejectedReasons.length} row(s) about this symbol were excluded as unverified (${[...new Set(rejectedReasons)].join(", ")}). A row like that is not proof of a consumer — on rake an \`overrides\` row that is simultaneously a self-loop, evidenceClass "inferred" and published at 0.5 was the only thing standing between \`listen\` in lib/Mojo/IOLoop/Server.pm and this report, and that symbol has no recorded callers at all. If you believe the excluded row, the declaring ancestor or caller is outside the indexed files and the analyzer did not capture it; this finding is then a coverage gap, not dead code.`,
            }]
          : []),
        ...(fileUsage ? [{
            kind: "heuristic" as const,
            description: `COVERAGE GAP INDICATOR: this symbol has no incoming usage edge at all, but its file receives ${fileUsage.edges} incoming usage edge(s) from ${fileUsage.sources.size} distinct source(s). The analyzer reached this file and recorded its other members; it did not record this one. That asymmetry is the signature of a missing reference rather than of an unused declaration, and it is why this finding should be checked against the source before anything is removed.`,
          }]
          : []),
      ],
      limitations: [
        "Name-only matching cannot see dynamic dispatch, reflection, or string-based lookups.",
        ...(rejectedReasons.length > 0
          ? [`${rejectedReasons.length} relationship row(s) about this symbol were excluded as unverified. If the analyzer failed to capture a real caller, this finding is a coverage gap rather than dead code; the excluded rows are itemised in the evidence above.`]
          : []),
        ...(fileUsage
          ? [`This symbol has no recorded incoming reference while its file has ${fileUsage.edges} from ${fileUsage.sources.size} source(s), so the absence of evidence here is probably the analyzer's, not the code's. Verify against the source before acting on it.`]
          : []),
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
        { kind: "import", description: `No import specifier resolves to this file. The index attributed ${importRowsResolved} of ${importRowsSeen} import row(s) to a source file and resolved ${importReferencedFiles.size} target file(s); ${importRowsUnattributed} row(s) could not be attributed and fell back to a stem match, which applies only to a stem naming exactly one file in the project.` },
        { kind: "heuristic", description: importRowsSeen > 0 ? `The import channel was available as evidence (${importRowsSeen} row(s), ${importRowsUnattributed} unattributable).` : `The index records NO import relationships, so the only evidence channel available was cross-file symbol usage.` },
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
    // The coverage-gap indicator: this symbol has NO incoming row of any kind,
    // while its file has some. Computed from the raw table rather than from
    // usedIds, because usedIds holds only what survived the gate — a symbol the
    // gate rejected is exactly the one whose absence of evidence is in question.
    const fileUsage = symbolsWithAnyIncoming.has(sym.id) ? undefined : fileIncomingUsage.get(sym.fileId)
    candidates.push({ conf: confidence, file: sym.file, loc: locFor(sym), symbol: sym, rejectedReasons: rejectedFor.get(sym.id) ?? [], fileUsage })
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
      if (referencedBySymbol || importedBySomething(file.id, file.relativePath)) continue

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
      ? buildSymbolFinding(c.symbol, c.conf, referencedFiles.has(c.symbol.fileId), ambiguousNames.has(c.symbol.name), c.rejectedReasons ?? [], c.fileUsage)
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
        ...(importRowsUnattributed > 0
          ? [`${importRowsUnattributed} of ${importRowsSeen} import row(s) name no source file, so they could only be matched by stem; a stem shared by two or more files carries no path evidence and was ignored.`]
          : []),
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
      // How much usage evidence the scan refused to believe, and why. The
      // orphan page is the product of what is believed, so the volume that was
      // NOT believed is part of the result and is reported with it. These rows
      // are the index's own published confidence and evidence class, so the
      // numbers are the analyzer's, not this tool's opinion of them.
      unverifiedUsageEdges: {
        total: edgeRejects[SELF_LOOP_EXCLUDED] + edgeRejects[INFERRED_EXCLUDED] + edgeRejects[LOW_CONFIDENCE_EXCLUDED],
        byReason: {
          [SELF_LOOP_EXCLUDED]: edgeRejects[SELF_LOOP_EXCLUDED],
          [INFERRED_EXCLUDED]: edgeRejects[INFERRED_EXCLUDED],
          [LOW_CONFIDENCE_EXCLUDED]: edgeRejects[LOW_CONFIDENCE_EXCLUDED],
        },
        byRelationshipType: edgeRejectsByType,
        minimumConfidence: MIN_EDGE_CONFIDENCE,
      },
      importResolution: {
        rowsSeen: importRowsSeen,
        attributedToASourceFile: importRowsSeen - importRowsUnattributed,
        unattributed: importRowsUnattributed,
        resolvedToAFile: importRowsResolved,
        filesClearedByImport: importReferencedFiles.size,
      },
    } as PatternReport["summary"],
  }
}
