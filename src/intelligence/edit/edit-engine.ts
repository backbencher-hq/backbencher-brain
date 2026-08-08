import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { BrainDatabase } from "../../brain/database"
import { checkSymbolFreshness, fileUnchangedSince } from "../../brain/freshness"
import { ASTEngine } from "../../ast/engine"
import { BrainSurgicalPatcher } from "../../ast/brain-surgical-patcher"
import { ImportPruner } from "../../ast/import-pruner"
import { reindexFilesParallel } from "../../ast/parallel-indexer"

export type EditMode = "write" | "update" | "insert" | "delete" | "refactor"
export type InsertPosition = "before" | "after" | "inside-top" | "inside-bottom"

export type EditRequest = {
  mode: EditMode
  dryRun?: boolean
  filePath?: string
  symbolName?: string
  lineStart?: number
  content?: string
  newContent?: string
  targetSymbolName?: string
  position?: InsertPosition
  newName?: string
  force?: boolean
  format?: boolean
  /** Legacy adapter compatibility only; never exposed by bb_edit. */
  allowStaleIndex?: boolean
}

export interface EditPlanChange { path: string; before: string; after: string }
export interface EditResult {
  mode: EditMode
  dryRun: boolean
  changes: EditPlanChange[]
  formatted: boolean
  validated: boolean
  reindexed: boolean
}

type SymbolMatch = { id: string; fileId: string; byteStart: number; byteEnd: number; lineStart?: number; name: string }

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
}

function nearestExisting(candidate: string): string {
  let cursor = candidate
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return cursor
}

export function resolveSafeEditPath(projectPath: string, requested: string): string {
  const root = realpathSync(projectPath)
  const candidate = path.resolve(root, requested)
  if (!inside(root, candidate)) throw new Error(`path escapes project root: ${requested}`)
  const existing = nearestExisting(candidate)
  const realExisting = realpathSync(existing)
  if (!inside(root, realExisting)) throw new Error(`path escapes project root through symlink: ${requested}`)
  if (existsSync(candidate)) {
    const realCandidate = realpathSync(candidate)
    if (!inside(root, realCandidate)) throw new Error(`path escapes project root through symlink: ${requested}`)
    return realCandidate
  }
  return candidate
}

function replaceRange(text: string, start: number, end: number, replacement: string): string {
  if (start < 0 || end < start || end > text.length) throw new Error(`invalid edit bounds: ${start}-${end}`)
  return text.slice(0, start) + replacement + text.slice(end)
}

function codeMask(text: string): boolean[] {
  const code = Array(text.length).fill(true)
  let state: "code" | "single" | "double" | "template" | "line" | "block" = "code"
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1]
    if (state === "code") {
      if (c === "'" || c === '"' || c === "`") { state = c === "'" ? "single" : c === '"' ? "double" : "template"; code[i] = false }
      else if (c === "/" && n === "/") { state = "line"; code[i] = code[i + 1] = false; i++ }
      else if (c === "/" && n === "*") { state = "block"; code[i] = code[i + 1] = false; i++ }
    } else {
      code[i] = false
      if ((state === "single" && c === "'") || (state === "double" && c === '"') || (state === "template" && c === "`")) {
        let slashes = 0
        for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) slashes++
        if (slashes % 2 === 0) state = "code"
      } else if (state === "line" && c === "\n") state = "code"
      else if (state === "block" && c === "*" && n === "/") { code[i + 1] = false; i++; state = "code" }
    }
  }
  return code
}

function bodyOffsets(text: string, start: number, end: number): { open: number; close: number } {
  const mask = codeMask(text)
  let open = -1
  for (let i = start; i < end; i++) if (mask[i] && text[i] === "{") { open = i; break }
  if (open < 0) throw new Error("anchor has no AST-like body block")
  let depth = 0
  for (let i = open; i < end; i++) {
    if (!mask[i]) continue
    if (text[i] === "{") depth++
    else if (text[i] === "}" && --depth === 0) return { open, close: i }
  }
  throw new Error("anchor body block is unbalanced")
}

function identifierOffsets(text: string, name: string, start = 0, end = text.length): number[] {
  const mask = codeMask(text)
  const offsets: number[] = []
  let i = start
  while (i < end) {
    if (!mask[i] || !/[A-Za-z_$]/.test(text[i])) { i++; continue }
    let j = i + 1
    while (j < end && mask[j] && /[A-Za-z0-9_$]/.test(text[j])) j++
    if (text.slice(i, j) === name) offsets.push(i)
    i = j
  }
  return offsets
}

async function uniqueSymbol(projectId: string, name: string, filePath?: string, lineStart?: number, allowStaleIndex = false): Promise<SymbolMatch> {
  const found: any = await ASTEngine.findSymbol(projectId, name, filePath, lineStart)
  const matches = (found?.matches ?? []).filter((m: any) => m.byteStart != null && m.byteEnd != null)
  if (matches.length === 0) throw new Error(`symbol ${name} not found or has no byte bounds`)
  if (matches.length > 1) throw new Error(`symbol ${name} is ambiguous; provide filePath and lineStart`)
  const match = matches[0] as SymbolMatch
  if (allowStaleIndex) return match
  const raw = await BrainDatabase.getRawInstance(projectId)
  const freshness = checkSymbolFreshness(raw, match.id)
  if (freshness?.status === "fresh") return match
  const row = raw.prepare("SELECT file_hash FROM brain_file WHERE path=? AND project_id=?").get(match.fileId, projectId) as { file_hash?: string } | undefined
  if (!row?.file_hash || !fileUnchangedSince(match.fileId, row.file_hash)) throw new Error(`stale index bounds for ${name}; reindex before editing`)
  return match
}

async function validateFile(filePath: string, content: string): Promise<void> {
  const result = await ASTEngine.parseFile(filePath, content)
  const errors = (result.errors ?? []).filter((error: any) => /syntax error/i.test(error.message ?? ""))
  if (errors.length > 0) throw new Error(`validation failed for ${filePath}: ${errors[0].message}`)
}

async function planEdit(projectPath: string, projectId: string, request: EditRequest): Promise<EditPlanChange[]> {
  if (request.mode === "write") {
    if (!request.filePath) throw new Error("write requires filePath")
    const target = resolveSafeEditPath(projectPath, request.filePath)
    return [{ path: target, before: existsSync(target) ? readFileSync(target, "utf8") : "", after: String(request.content ?? request.newContent ?? "") }]
  }

  const symbolName = request.mode === "insert" ? request.targetSymbolName : request.symbolName
  if (!symbolName) throw new Error(`${request.mode} requires ${request.mode === "insert" ? "targetSymbolName" : "symbolName"}`)
  const match = await uniqueSymbol(projectId, symbolName, request.filePath, request.lineStart, request.allowStaleIndex === true)
  resolveSafeEditPath(projectPath, match.fileId)
  const original = readFileSync(match.fileId, "utf8")

  if (request.mode === "update") return [{ path: match.fileId, before: original, after: replaceRange(original, match.byteStart, match.byteEnd, String(request.newContent ?? request.content ?? "")) }]
  if (request.mode === "insert") {
    const position = request.position ?? "after"
    let offset = position === "before" ? match.byteStart : match.byteEnd
    if (position === "inside-top" || position === "inside-bottom") {
      const body = bodyOffsets(original, match.byteStart, match.byteEnd)
      offset = position === "inside-top" ? body.open + 1 : body.close
    }
    return [{ path: match.fileId, before: original, after: replaceRange(original, offset, offset, `\n${String(request.newContent ?? request.content ?? "")}\n`) }]
  }
  if (request.mode === "delete") {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const callers = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE target_symbol_id=? AND relationship_type IN ('calls','instantiates','references','uses')").get(match.id) as any)?.c ?? 0
    if (callers > 0 && request.force !== true) throw new Error(`cannot delete ${symbolName}: ${callers} active references; pass force=true after reviewing impact`)
    const deleted = replaceRange(original, match.byteStart, match.byteEnd, "")
    const pruned = await ImportPruner.prune(deleted, match.fileId)
    return [{ path: match.fileId, before: original, after: pruned }]
  }

  const newName = String(request.newName ?? "")
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(newName)) throw new Error("refactor requires a valid identifier newName")
  const raw = await BrainDatabase.getRawInstance(projectId)
  const callerRows = raw.prepare("SELECT DISTINCT f.path AS fileId, s.byte_start AS byteStart, s.byte_end AS byteEnd FROM brain_relationship r JOIN brain_symbol s ON s.id=r.source_symbol_id JOIN brain_file f ON f.id=s.file_id WHERE r.target_symbol_id=? AND r.relationship_type IN ('calls','instantiates','references','uses')").all(match.id) as any[]
  const spans = new Map<string, Array<{ start: number; end: number }>>()
  spans.set(match.fileId, [{ start: match.byteStart, end: match.byteEnd }])
  for (const row of callerRows) if (row.fileId && row.byteStart != null) {
    const list = spans.get(row.fileId) ?? []
    list.push({ start: row.byteStart, end: row.byteEnd ?? Number.MAX_SAFE_INTEGER })
    spans.set(row.fileId, list)
  }
  const changes: EditPlanChange[] = []
  for (const [file, fileSpans] of spans) {
    resolveSafeEditPath(projectPath, file)
    const before = readFileSync(file, "utf8")
    const offsets = new Set<number>()
    for (const span of fileSpans) for (const offset of identifierOffsets(before, symbolName, span.start, Math.min(span.end, before.length))) offsets.add(offset)
    if (offsets.size === 0) continue
    let after = before
    for (const offset of [...offsets].sort((a, b) => b - a)) after = replaceRange(after, offset, offset + symbolName.length, newName)
    changes.push({ path: file, before, after })
  }
  return changes
}

export async function executeEdit(projectPath: string, projectId: string, request: EditRequest): Promise<EditResult> {
  const changes = await planEdit(projectPath, projectId, request)
  if (request.dryRun === true) return { mode: request.mode, dryRun: true, changes, formatted: false, validated: false, reindexed: false }
  const snapshots = new Map(changes.map((change) => [change.path, { existed: existsSync(change.path), content: change.before }]))
  try {
    for (const change of changes) {
      mkdirSync(path.dirname(change.path), { recursive: true })
      const temporary = `${change.path}.bb-edit-${randomUUID()}`
      writeFileSync(temporary, change.after, "utf8")
      renameSync(temporary, change.path)
    }
    if (request.format !== false) for (const change of changes) await BrainSurgicalPatcher.tryAutoFormat(change.path)
    for (const change of changes) await validateFile(change.path, readFileSync(change.path, "utf8"))
    await reindexFilesParallel(projectId as any, realpathSync(projectPath), changes.map((change) => ({ path: change.path, type: snapshots.get(change.path)!.existed ? "modified" as const : "added" as const })))
    return { mode: request.mode, dryRun: false, changes: changes.map((change) => ({ ...change, after: readFileSync(change.path, "utf8") })), formatted: request.format !== false, validated: true, reindexed: true }
  } catch (error) {
    for (const [file, snapshot] of snapshots) {
      if (snapshot.existed) writeFileSync(file, snapshot.content, "utf8")
      else rmSync(file, { force: true })
    }
    throw error
  }
}
