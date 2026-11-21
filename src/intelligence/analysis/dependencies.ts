// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the file-dependency engine: file→file edges resolved from relative specifiers, each labelled resolved/suffix-match/unresolved, with per-row caps and one exported scope rule.
// WHICH TOOL IT SERVES — bb_analyze (mutability read, requiresIndex true, modes
//   dependencies).
// WHY IT IS SHAPED THIS WAY — imports relationships are mostly unresolvable in the store, so a real specifier resolution is the primary path; the scope normalisation exists once so the denominator cannot disagree with the rows.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_analyze.md, docs/BB_ANALYZE.md, validation/tools/bb_analyze/**;
//   gates: npx tsx script/m13/verify-analyze-modes.ts, npx tsx script/verify-analyze.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_analyze/handler.ts,
//   script/tool-docs/curation/bb_analyze.ts, and the gates named above.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   the read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import type { FileDependency } from "../contracts"
import type { EvidenceProvenance } from "../evidence"
import { makeProvenance } from "../evidence"
import { goPackageDirForSpecifier } from "../../ast/go-module"

/** Cap on the per-file dependent / dependency lists inside one row.
 *
 *  A barrel or a widely-imported utility can have hundreds of importers; each
 *  was rendered in full, so one row could dominate the page while saying
 *  nothing a count would not say better. Capped and DECLARED per row: the
 *  totals are the real figures and the two Truncated flags say the list was
 *  cut. */
const MAX_ROW_ENTRIES = 100
/**
 * How many dependency/dependent ENTRIES one page may carry in total.
 *
 * `limit` bounds the number of FILE ROWS, and each row can carry up to
 * MAX_ROW_ENTRIES entries per list — so the old worst case was 50 files x 200 =
 * 10,000 entries. Measured on 0.1.8: `session/session.go` reached 10,923 lines
 * before the host truncated the payload, and `limit` did nothing about it because
 * it bounds files, not rows. The per-row cap is kept (one widely-imported file
 * must not dominate) and this page budget bounds the WHOLE answer; both are
 * reported so a short page is never read as a small graph.
 */
const MAX_PAGE_ROW_ENTRIES = 300

/**
 * Test sources. A `_test.go` file importing the package under test is REAL
 * coupling, but for a blast-radius question it is noise: on 0.1.8
 * `session/session.go` returned its own `_test.go` dependents and filled the page
 * with them. Filtered by default and COUNTED, so the exclusion is visible;
 * `includeTests: true` restores them.
 */
function isTestSource(relativePath: string): boolean {
  const p = relativePath.toLowerCase()
  return (
    p.endsWith("_test.go") ||
    p.endsWith(".test.ts") || p.endsWith(".test.tsx") || p.endsWith(".test.js") || p.endsWith(".test.jsx") ||
    p.endsWith(".spec.ts") || p.endsWith(".spec.tsx") || p.endsWith(".spec.js") || p.endsWith(".spec.jsx") ||
    p.endsWith("_test.py") || p.endsWith("_test.rs") ||
    p.includes("/__tests__/") || p.includes("/tests/") || p.includes("/testdata/")
  )
}




type FileRow = { id: string; relativePath: string; language: string }
type ImportRow = {
  fileId: string
  importPath: string
  isExternal: number | null
}
type EdgeRow = {
  sourceFileId: string | null
  targetFileId: string | null
  targetExternal: string | null
}

const ENGINE = "dependencies@intelligence"
const ENGINE_VERSION = "m10.04"

/** Extensions tried, in order, when a specifier names a module without one.
 *  Ordered by what projects actually write, so the answer is a function of the
 *  request rather than of Set iteration order. */
const SOURCE_EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const

type Resolution = "resolved" | "suffix-match" | "unresolved"

/** Minimal POSIX join — brain_file.relative_path uses forward slashes on every
 *  platform, and node:path would not agree on Windows. */
function posixJoin(dir: string, rel: string): string {
  const out: string[] = []
  for (const part of (dir ? dir.split("/") : []).concat(rel.split("/"))) {
    if (part === "" || part === ".") continue
    if (part === "..") { out.pop(); continue }
    out.push(part)
  }
  return out.join("/")
}

/**
 * Resolve one internal import specifier to a file in THIS project.
 *
 * Why not a basename map: on the corpus `src/util/format.ts` and
 * `src/vendor/format.ts` share a basename, so the map kept one of them — last
 * writer wins over an UNORDERED select, so which one survived was not even
 * stable between builds — and the other import was reported against the wrong
 * file. `src/core/engine.ts` imports all three of ./plugin, ../util/format and
 * ../vendor/format; the tool reported `src/util/format.ts` twice and
 * `src/vendor/format.ts` with no dependents at all. Two files named
 * `format.ts` is not an edge case; it is `index.ts` and `types.ts` in every
 * real codebase.
 *
 * Why not simply "prefer the relationship graph", which is what the reference
 * document says: that graph is almost entirely EMPTY. Measured on bb's own
 * src — 695 import statements, 789 `imports` relationships, and only 49 with
 * BOTH a source and a target symbol (6.2%). `brain_import.resolved_symbol_id`
 * is set on 0 of 695 rows. So 94% of the file->file edges this engine reports
 * were basename guesses, and the document describes that guess as the rare
 * fallback.
 *
 * The rule here: a RELATIVE specifier is resolved against the importing
 * file's own directory, trying the extension list and `/index`. A
 * directory-anchored suffix match (`util/format` -> `src/util/format.ts`) is
 * the next best thing and is labelled `suffix-match`. Anything else is
 * reported unresolved with the specifier the caller wrote — never guessed.
 */
function resolveInternalSpecifier(
  importerRel: string,
  specifier: string,
  filesByPath: Map<string, string>,
): { fileId?: string; resolution: Resolution } {
  const dir = importerRel.includes("/") ? importerRel.slice(0, importerRel.lastIndexOf("/")) : ""
  const base = specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")
    ? posixJoin(dir, specifier.startsWith("/") ? specifier.slice(1) : specifier)
    : specifier
  for (const ext of SOURCE_EXTENSIONS) {
    const hit = filesByPath.get(base + ext)
    if (hit) return { fileId: hit, resolution: "resolved" }
  }
  for (const ext of SOURCE_EXTENSIONS) {
    if (!ext) continue
    const hit = filesByPath.get(base + "/index" + ext)
    if (hit) return { fileId: hit, resolution: "resolved" }
  }
  // Directory-anchored, and only on a whole segment boundary, so `format`
  // cannot match `src/util/format.ts` and `util/format` cannot match
  // `src/util/formatting.ts`.
  let needleEnd = specifier.length
  while (needleEnd > 0 && specifier[needleEnd - 1] === "/") needleEnd--
  const needle = specifier.slice(0, needleEnd)
  if (needle && !needle.startsWith(".")) {
    for (const [rel, id] of filesByPath) {
      if (rel !== needle && !rel.endsWith("/" + needle)) continue
      const dot = rel.lastIndexOf(".")
      const stem = dot > 0 ? rel.slice(0, dot) : rel
      if (stem === needle || stem.endsWith("/" + needle)) return { fileId: id, resolution: "suffix-match" }
    }
  }
  return { resolution: "unresolved" }
}

/** Escape %, _ and backslash: a file path is a path, never a LIKE pattern.
 *  Character-wise, because the input is data — a character loop is the one
 *  formulation with no metacharacter to miss. */
function escapeLike(value: string): string {
  let out = ""
  for (const ch of value) out += ch === "\\" || ch === "%" || ch === "_" ? "\\" + ch : ch
  return out
}

// File dependency analysis.
//
// Two resolution sources are used, in order of reliability:
//   1. brain_relationship 'imports' edges — the indexer resolves imports here
//      (target_symbol_id points at the imported symbol). We derive the target
//      FILE from the symbol's own file, giving a resolved file->file edge.
//   2. brain_import rows — used for the raw dependency specifier list and to
//      flag external packages (brain_import.resolved_symbol_id is often null).
//
// Both dependents and dependencies return path AND fileId consistently, using
// resolved relationships rather than path-substring guessing.
/** The engine's own identity, once. The report-level page provenance is built
 *  from this rather than from a second copy of the same three lines, so the two
 *  can never disagree about which engine produced an edge. */
export function dependencyProvenance(projectId: string): EvidenceProvenance {
  return makeProvenance({
    evidenceClass: "inferred",
    engine: ENGINE,
    engineVersion: ENGINE_VERSION,
    projectId,
    source: "brain_relationship+brain_import",
    limitations: [
      "File-level edges are derived from symbol-level import relationships; alias/barrel re-exports may flatten multi-hop edges.",
      "Internal specifiers are resolved against the importing file's directory. One that resolves to nothing is reported with resolution \"unresolved\" and no fileId — never guessed from a basename.",
      "Only a small minority of 'imports' relationships carry both a source and a target symbol and brain_import.resolved_symbol_id is empty, so specifier resolution is the primary path here, not a fallback.",
      "A file's dependent and dependency lists are capped per row; dependentsTotal and dependenciesTotal are the real sizes and the Truncated flags say the list was cut.",
      "GO CLASSIFICATION BASIS: a Go import is internal when it equals the project's go.mod module path or starts with it; the specifier then names a PACKAGE (every .go file in one directory). The module path is read from go.mod at index time and persisted per project. When a project has no recorded module path, a domain-shaped Go specifier cannot be classified internal and is reported external with no resolution claim \u2014 the page cannot then claim Go coupling, and that absence is a classification limit, not a measurement of zero coupling.",
    ],
  })
}

/**
 * The scope, as this engine applies it: trailing slashes removed, nothing else
 * changed.
 *
 * This exists because the scope was being normalised in TWO places with TWO
 * rules. The engine stripped trailing slashes before matching
 * (`filePath.replace(/\/+$/, "")`) and the handler counted the denominator
 * with the RAW string. The disagreement produced the worst kind of answer this
 * tool can give — a false statement of completeness:
 *
 *   filePath: "src/wide"    -> returned 20 of 68 files, totalFiles: 68, truncated: true
 *   filePath: "src/wide/"   -> returned 20 of 68 files, totalFiles: 0,  truncated: FALSE
 *
 * The second line is the defect: 48 files were hidden and the answer said it
 * was not truncated, because `20 < 0` is false. One definition, exported, so a
 * caller cannot apply a different one.
 */
export function normalizeScopePath(filePath: string): string {
  let end = filePath.length
  while (end > 0 && filePath[end - 1] === "/") end--
  return filePath.slice(0, end)
}

/** How many indexed files the scope covers — the denominator the page is
 *  measured against, computed with the SAME normalization and the SAME segment
 *  boundary as the rows. */
export async function scopeFileCount(projectId: ProjectID, filePath: string | null | undefined): Promise<number> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  if (!filePath) {
    return Number((raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?").get(projectId) as { c: number }).c)
  }
  const prefix = escapeLike(normalizeScopePath(filePath))
  return Number(
    (
      raw
        .prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id = ? AND (relative_path = ? OR relative_path LIKE ? ESCAPE '\\')")
        .get(projectId, normalizeScopePath(filePath), prefix + "/%") as { c: number }
    ).c ?? 0,
  )
}

export async function getFileDependencies(
  projectId: ProjectID,
  options: { filePath?: string; includeExternal?: boolean; limit?: number; includeTests?: boolean } = {},
): Promise<FileDependency[]> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const includeExternal = options.includeExternal !== false
  const limit = options.limit ?? 50
  const includeTests = options.includeTests === true

  const fileById = new Map<string, string>()
  const languageById = new Map<string, string>()
  for (const row of raw
    .prepare("SELECT id, relative_path AS relativePath, COALESCE(language, '') AS language FROM brain_file WHERE project_id = ?")
    .all(projectId) as FileRow[]) {
    fileById.set(row.id, row.relativePath)
    languageById.set(row.id, row.language)
  }

  // P1-1 PHASE 2 — the project's Go module identity, if the indexer recorded one.
  //
  // The indexer writes these two keys once per project (`brain_project_meta`); a project
  // with no go.mod (or a database indexed before this wave) has none and every Go
  // specifier below degrades to the pre-existing behaviour. This engine has no project
  // path in hand, so the PERSISTED identity is the only route to the module boundary.
  let goModule: { modulePath: string; moduleDir: string } | null = null
  try {
    const metaRows = raw
      .prepare("SELECT key, value FROM brain_project_meta WHERE project_id = ? AND key IN ('go_module_path', 'go_module_dir')")
      .all(projectId) as Array<{ key: string; value: string | null }>
    const modulePath = metaRows.find((r) => r.key === "go_module_path")?.value ?? null
    if (modulePath) goModule = { modulePath, moduleDir: metaRows.find((r) => r.key === "go_module_dir")?.value ?? "" }
  } catch {
    // A database that predates `brain_project_meta` has no Go module identity; the
    // engine must not fail to answer because of an additive table it never wrote.
    goModule = null
  }

  // The file->file edges are derived in SQL (importEdges joins both symbols), so
  // no symbol->file map is built here. The engine used to materialise one anyway:
  // one row per symbol for the whole project (310,423 rows on the reference
  // index) into a Map nothing read. That was the single largest cost of a
  // `dependencies` call and it bought nothing.

  // Resolved file->file dependency edges from 'imports' relationships.
  const importEdges = raw.prepare(
    "SELECT srcsym.file_id AS sourceFileId, tgt.file_id AS targetFileId, r.target_external AS targetExternal " +
      "FROM brain_relationship r " +
      "LEFT JOIN brain_symbol srcsym ON srcsym.id = r.source_symbol_id " +
      "LEFT JOIN brain_symbol tgt ON tgt.id = r.target_symbol_id " +
      "WHERE r.project_id = ? AND r.relationship_type = 'imports'",
  ).all(projectId) as EdgeRow[]

  // dependencies: sourceFile -> set of targetFile ids (resolved internal)
  const depsByFile = new Map<string, Set<string>>()
  // dependents: targetFile -> set of sourceFile ids
  const dependentsByFile = new Map<string, Set<string>>()

  // When the relationship's source_symbol_id is null, fall back to matching the
  // import specifier to the importing file via brain_import (below). Here we use
  // the resolved target file when available.
  for (const edge of importEdges) {
    const targetFileId = edge.targetFileId
    if (!targetFileId) continue
    // Determine source file: relationship source symbol, else skip (handled by
    // the brain_import pass below which knows the importer file directly).
    const sourceFileId = edge.sourceFileId
    if (!sourceFileId || sourceFileId === targetFileId) continue
    if (!depsByFile.has(sourceFileId)) depsByFile.set(sourceFileId, new Set())
    depsByFile.get(sourceFileId)!.add(targetFileId)
    if (!dependentsByFile.has(targetFileId)) dependentsByFile.set(targetFileId, new Set())
    dependentsByFile.get(targetFileId)!.add(sourceFileId)
  }

  // brain_import gives us the importer file directly plus external flags. For
  // internal imports whose relationship had a null source symbol, resolve the
  // target file by matching a target symbol whose file matches the specifier.
  const allImports = raw.prepare(
    "SELECT file_id AS fileId, import_path AS importPath, is_external AS isExternal FROM brain_import WHERE project_id = ?",
  ).all(projectId) as ImportRow[]

  const filesByPath = new Map<string, string>()
  for (const [fileId, rel] of fileById) filesByPath.set(rel, fileId)

  const rawDepsByFile = new Map<
    string,
    Array<{ path: string; fileId?: string; external: boolean; resolution?: Resolution }>
  >()
  for (const imp of allImports) {
    const external = !!imp.isExternal
    if (external && !includeExternal) continue
    const importerLanguage = languageById.get(imp.fileId) ?? ""
    // Targets this specifier resolves to. A RELATIVE specifier names at most one file;
    // a GO MODULE specifier names a PACKAGE, so it can name every `.go` file in one
    // directory — the set is the honest unit, and each member gets its own edge.
    const resolvedTargets: string[] = []
    let resolution: Resolution = "unresolved"
    if (!external) {
      let handledByLanguage = false
      if (importerLanguage === "go" && goModule) {
        // P1-1 PHASE 2 — Go module-path resolution. This engine's generic resolver
        // understands `./x`, `../x` and a project-relative suffix match; a Go module path
        // (`github.com/bettercap/bettercap/v2/session`) is none of those and matched no
        // brain_file path, so 100% of Go internal imports stayed unresolved (ISSUE-03).
        // The Go rule is different in kind: strip the project's module path to get the
        // PACKAGE DIRECTORY, then the package is every indexed `.go` file directly in it.
        const packageDir = goPackageDirForSpecifier(imp.importPath, goModule)
        if (packageDir !== null) {
          handledByLanguage = true
          const prefix = packageDir.length > 0 ? packageDir + "/" : ""
          for (const [rel, targetId] of filesByPath) {
            if (!rel.endsWith(".go")) continue
            if (rel === packageDir) continue // a directory is not a file
            const inPackage = prefix.length === 0 ? rel.indexOf("/") === -1 : rel.startsWith(prefix) && rel.slice(prefix.length).indexOf("/") === -1
            if (inPackage && targetId !== imp.fileId) resolvedTargets.push(targetId)
          }
          if (resolvedTargets.length > 0) resolution = "resolved"
        }
      }
      if (!handledByLanguage) {
        const resolved = resolveInternalSpecifier(fileById.get(imp.fileId) ?? "", imp.importPath, filesByPath)
        resolution = resolved.resolution
        const targetFileId = resolved.fileId === imp.fileId ? undefined : resolved.fileId
        if (targetFileId) resolvedTargets.push(targetFileId)
      }
      for (const targetFileId of resolvedTargets) {
        if (!dependentsByFile.has(targetFileId)) dependentsByFile.set(targetFileId, new Set())
        dependentsByFile.get(targetFileId)!.add(imp.fileId)
        if (!depsByFile.has(imp.fileId)) depsByFile.set(imp.fileId, new Set())
        depsByFile.get(imp.fileId)!.add(targetFileId)
      }
    }
    if (!rawDepsByFile.has(imp.fileId)) rawDepsByFile.set(imp.fileId, [])
    const list = rawDepsByFile.get(imp.fileId)!
    // An EXTERNAL Go package is a declared fact, not a resolution attempt: the engine
    // cannot resolve stdlib/third-party code and labelling that absence "unresolved"
    // conflated "we tried and failed" with "outside the project" (the reported
    // contradiction). Go rows carry no resolution claim at all; the external flag is the
    // claim. Other languages keep their historical shape.
    const reportResolution = external && importerLanguage === "go"
    const reportedPaths = resolvedTargets.length > 0
      ? resolvedTargets.map((id) => fileById.get(id) ?? imp.importPath)
      : [imp.importPath]
    // Two specifiers that resolve to the same file are one edge; two that stay
    // unresolved are two edges and both are listed, because dropping one would
    // hide a real import.
    for (const reportedPath of reportedPaths) {
      const targetFileId = resolvedTargets.length > 0 && reportedPaths.length === 1 ? resolvedTargets[0] : resolvedTargets.find((id) => (fileById.get(id) ?? "") === reportedPath)
      if (list.some((d) => d.path === reportedPath && d.external === external)) continue
      list.push(
        reportResolution
          ? { path: reportedPath, fileId: targetFileId, external, resolution: undefined }
          : { path: reportedPath, fileId: targetFileId, external, resolution },
      )
    }
  }

  let fileRows = Array.from(fileById.entries()).map(([id, relativePath]) => ({ id, relativePath }))
  if (options.filePath) {
    // The registry says "filePath scopes ... to a project-relative path
    // PREFIX". `includes` is a substring match, so filePath "util" and
    // filePath "src/util" returned the same two files — two different
    // questions, one answer. Escaped, so a % or _ in the caller's path is a
    // character and not a wildcard.
    const prefix = escapeLike(normalizeScopePath(options.filePath))
    fileRows = fileRows.filter((f) => f.relativePath === prefix || f.relativePath.startsWith(prefix + "/"))
  }

  const results: FileDependency[] = []
  // Page-level row budget. Every emitted entry is charged against it, so `limit`
  // bounding FILE ROWS can no longer produce a ten-thousand-entry payload.
  let rowsRemaining = MAX_PAGE_ROW_ENTRIES
  for (const file of fileRows) {
    const allDeps = rawDepsByFile.get(file.id) ?? []
    const allDependents = Array.from(dependentsByFile.get(file.id) ?? [])
      .map((depFileId) => ({ path: fileById.get(depFileId) ?? depFileId, fileId: depFileId }))
      .sort((a, b) => a.path.localeCompare(b.path))
    // Test sources are real coupling but not blast radius. Counted, not hidden.
    const deps = includeTests ? allDeps : allDeps.filter((d) => !d.fileId || !isTestSource(fileById.get(d.fileId) ?? ""))
    const dependents = includeTests ? allDependents : allDependents.filter((d) => !isTestSource(d.path))
    const testFilesExcluded = (allDeps.length - deps.length) + (allDependents.length - dependents.length)
    // A dependency on `node:fs` is a constant of the ecosystem, not coupling
    // to this project, and an unresolved specifier is not coupling either.
    // Counting them let a file's npm imports outrank its real structure: on the
    // corpus src/ext/runner.ts (1 internal + 3 npm) outscored
    // src/util/format.ts (4 real dependents).
    const internalDeps = deps.filter((d) => !d.external && d.fileId).length
    const unresolved = deps.filter((d) => d.resolution === "unresolved" && !d.external).length
    const dependenciesTotal = deps.length
    const dependentsTotal = dependents.length
    // Two budgets from one page allowance: dependencies first, dependents with
    // whatever is left. Both are capped at MAX_ROW_ENTRIES so a single file
    // cannot monopolise the page, which is what the per-row cap always meant.
    const depBudget = Math.min(MAX_ROW_ENTRIES, Math.max(0, rowsRemaining))
    const depdentBudget = Math.min(MAX_ROW_ENTRIES, Math.max(0, rowsRemaining - depBudget))
    rowsRemaining -= depBudget + depdentBudget
    results.push({
      file: file.relativePath,
      fileId: file.id,
      // Neither list carries `fileId`. A file id is
      // `<40-hex project id>:<relative path>`, so every edge repeated the path
      // it sat next to: 506 edges carried 506 copies, 56,540 of 121,340 bytes on
      // a 20-file page of backbencher-brain/src. The path IS the locator — the
      // handler resolves freshness from it, and the row above carries the id for
      // the file the row is about. `resolution` is kept: it is the part that is
      // NOT derivable from a path.
      dependencies: deps.slice(0, depBudget).map((d) => ({
        path: d.path,
        external: d.external,
        resolution: d.resolution,
      })),
      dependents: dependents.slice(0, depdentBudget).map((d) => ({ path: d.path })),
      dependenciesTotal,
      dependentsTotal,
      dependenciesTruncated: dependenciesTotal > depBudget,
      dependentsTruncated: dependentsTotal > depdentBudget,
      testFilesExcluded,
      score: internalDeps + dependentsTotal,
      unresolvedSpecifiers: unresolved,
    })
  }

  results.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
  return results.slice(0, limit)
}

/**
 * The report-level provenance for a dependency page.
 *
 * CONTRACT CHANGE (M-r2): provenance used to be repeated on every row. It is
 * the SAME object for all of them — one engine, one evidence class, one set of
 * limitations — and at 20 rows it was roughly a third of the payload: a
 * default `dependencies` call rendered 38,124 bytes of which the informative
 * part was the edges. It now lives once, on the report, next to the summary
 * that states the page bound. A consumer reads `report.provenance`.
 */
export function dependencyPageProvenance(
  provenance: EvidenceProvenance,
  opts: { projectId: string; shown: number; total: number },
): EvidenceProvenance {
  return makeProvenance({
    evidenceClass: provenance.evidenceClass,
    engine: provenance.engine,
    engineVersion: provenance.engineVersion,
    projectId: opts.projectId,
    source: provenance.source,
    limitations: provenance.limitations,
    truncated: opts.total > opts.shown,
    unknowns: opts.total > opts.shown ? [`file-page: showing ${opts.shown} of ${opts.total} files — raise limit for the rest`] : [],
  })
}
