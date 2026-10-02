import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import type { FileDependency } from "../contracts"
import type { EvidenceProvenance } from "../evidence"
import { makeProvenance } from "../evidence"

/** Cap on the per-file dependent / dependency lists inside one row.
 *
 *  A barrel or a widely-imported utility can have hundreds of importers; each
 *  was rendered in full, so one row could dominate the page while saying
 *  nothing a count would not say better. Capped and DECLARED per row: the
 *  totals are the real figures and the two Truncated flags say the list was
 *  cut. */
const MAX_ROW_ENTRIES = 100




type FileRow = { id: string; relativePath: string }
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
  const needle = specifier.replace(/\/+$/, "")
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

/** Escape %, _ and backslash: a file path is a path, never a LIKE pattern. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => "\\" + c)
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
  return filePath.replace(/\/+$/, "")
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
  options: { filePath?: string; includeExternal?: boolean; limit?: number } = {},
): Promise<FileDependency[]> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const includeExternal = options.includeExternal !== false
  const limit = options.limit ?? 50

  const fileById = new Map<string, string>()
  for (const row of raw.prepare("SELECT id, relative_path AS relativePath FROM brain_file WHERE project_id = ?").all(projectId) as FileRow[]) {
    fileById.set(row.id, row.relativePath)
  }

  // symbol id -> file id (the symbol table row ids are file-scoped)
  const symbolFile = new Map<string, string>()
  for (const row of raw.prepare("SELECT id, file_id AS fileId FROM brain_symbol WHERE project_id = ?").all(projectId) as Array<{ id: string; fileId: string }>) {
    symbolFile.set(row.id, row.fileId)
  }

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
    Array<{ path: string; fileId?: string; external: boolean; resolution: Resolution }>
  >()
  for (const imp of allImports) {
    const external = !!imp.isExternal
    if (external && !includeExternal) continue
    let targetFileId: string | undefined
    let resolution: Resolution = "unresolved"
    if (!external) {
      const resolved = resolveInternalSpecifier(fileById.get(imp.fileId) ?? "", imp.importPath, filesByPath)
      resolution = resolved.resolution
      targetFileId = resolved.fileId === imp.fileId ? undefined : resolved.fileId
      if (targetFileId) {
        if (!dependentsByFile.has(targetFileId)) dependentsByFile.set(targetFileId, new Set())
        dependentsByFile.get(targetFileId)!.add(imp.fileId)
        if (!depsByFile.has(imp.fileId)) depsByFile.set(imp.fileId, new Set())
        depsByFile.get(imp.fileId)!.add(targetFileId)
      }
    }
    if (!rawDepsByFile.has(imp.fileId)) rawDepsByFile.set(imp.fileId, [])
    const list = rawDepsByFile.get(imp.fileId)!
    const reportedPath = targetFileId ? fileById.get(targetFileId) ?? imp.importPath : imp.importPath
    // Two specifiers that resolve to the same file are one edge; two that stay
    // unresolved are two edges and both are listed, because dropping one would
    // hide a real import.
    if (!list.some((d) => d.path === reportedPath && d.external === external)) {
      list.push({ path: reportedPath, fileId: targetFileId, external, resolution })
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
  for (const file of fileRows) {
    const deps = rawDepsByFile.get(file.id) ?? []
    const dependents = Array.from(dependentsByFile.get(file.id) ?? [])
      .map((depFileId) => ({ path: fileById.get(depFileId) ?? depFileId, fileId: depFileId }))
      .sort((a, b) => a.path.localeCompare(b.path))
    // A dependency on `node:fs` is a constant of the ecosystem, not coupling
    // to this project, and an unresolved specifier is not coupling either.
    // Counting them let a file's npm imports outrank its real structure: on the
    // corpus src/ext/runner.ts (1 internal + 3 npm) outscored
    // src/util/format.ts (4 real dependents).
    const internalDeps = deps.filter((d) => !d.external && d.fileId).length
    const unresolved = deps.filter((d) => d.resolution === "unresolved" && !d.external).length
    const dependenciesTotal = deps.length
    const dependentsTotal = dependents.length
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
      dependencies: deps.slice(0, MAX_ROW_ENTRIES).map((d) => ({
        path: d.path,
        external: d.external,
        resolution: d.resolution,
      })),
      dependents: dependents.slice(0, MAX_ROW_ENTRIES).map((d) => ({ path: d.path })),
      dependenciesTotal,
      dependentsTotal,
      dependenciesTruncated: dependenciesTotal > MAX_ROW_ENTRIES,
      dependentsTruncated: dependentsTotal > MAX_ROW_ENTRIES,
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
