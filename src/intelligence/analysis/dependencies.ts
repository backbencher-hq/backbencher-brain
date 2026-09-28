import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import type { FileDependency } from "../contracts"
import { makeProvenance } from "../evidence"

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

  // Map an 'imports' relationship target file back to importer files using the
  // brain_import importer file when the relationship source was unresolved.
  // We approximate: for each import row, find an imports-relationship whose
  // target file's basename matches the specifier tail.
  const targetFilesByBasename = new Map<string, string>()
  for (const [fileId, rel] of fileById) {
    const basename = rel.split("/").pop()?.replace(/\.[^.]+$/, "") ?? rel
    targetFilesByBasename.set(basename, fileId)
  }

  const rawDepsByFile = new Map<string, Array<{ path: string; fileId?: string; external: boolean }>>()
  for (const imp of allImports) {
    const external = !!imp.isExternal
    if (external && !includeExternal) continue
    let targetFileId: string | undefined
    if (!external) {
      const tail = imp.importPath.split("/").pop() ?? imp.importPath
      targetFileId = targetFilesByBasename.get(tail)
      if (targetFileId && targetFileId !== imp.fileId) {
        if (!dependentsByFile.has(targetFileId)) dependentsByFile.set(targetFileId, new Set())
        dependentsByFile.get(targetFileId)!.add(imp.fileId)
        if (!depsByFile.has(imp.fileId)) depsByFile.set(imp.fileId, new Set())
        depsByFile.get(imp.fileId)!.add(targetFileId)
      }
    }
    if (!rawDepsByFile.has(imp.fileId)) rawDepsByFile.set(imp.fileId, [])
    rawDepsByFile.get(imp.fileId)!.push({
      path: targetFileId ? fileById.get(targetFileId) ?? imp.importPath : imp.importPath,
      fileId: targetFileId,
      external,
    })
  }

  let fileRows = Array.from(fileById.entries()).map(([id, relativePath]) => ({ id, relativePath }))
  if (options.filePath) {
    fileRows = fileRows.filter((f) => f.relativePath.includes(options.filePath!))
  }

  const prov = makeProvenance({
    evidenceClass: "inferred",
    engine: ENGINE,
    engineVersion: ENGINE_VERSION,
    projectId,
    source: "brain_relationship+brain_import",
    limitations: [
      "File-level edges are derived from symbol-level import relationships; alias/barrel re-exports may flatten multi-hop edges.",
    ],
  })

  const results: FileDependency[] = []
  for (const file of fileRows) {
    const deps = rawDepsByFile.get(file.id) ?? []
    const dependents = Array.from(dependentsByFile.get(file.id) ?? [])
      .map((depFileId) => ({ path: fileById.get(depFileId) ?? depFileId, fileId: depFileId }))
    results.push({ file: file.relativePath, fileId: file.id, dependencies: deps, dependents, score: deps.length + dependents.length, provenance: prov })
  }

  results.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
  return results.slice(0, limit)
}
