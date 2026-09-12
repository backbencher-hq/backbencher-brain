// M12/M49 shared regex-census TRUTH core.
//
// Why this exists (found 2026-09-12, M49 W5/W6/W7).
//
// Two derived artifacts describe the analyzers' regex usage — the census
// (`validation/m12/results/regex-census.json`) and the debt register
// (`validation/m49/regex-debt-register.json`) — and both are *positions* in
// files that every wave edits. Two whole classes of defect came out of that:
//
//   1. A DERIVED-FROM-DIRTY-TREE artifact. `script/m12/regex-census.ts` scans
//      the WORKING TREE, so a run taken while an analyzer is uncommitted bakes
//      an uncommitted line number into a committed index. That had already
//      happened (the census at HEAD named `real-cpp-analyzer.ts:727` while the
//      committed cpp blob carries that regex at 382), and no gate could see it
//      because every gate re-scanned the same dirty tree and agreed with it.
//
//   2. A SHARED-TREE FALSE RED. On a checkout where another wave is mid-flight
//      (its analyzers modified but not committed) a working-tree scan disagrees
//      with the HEAD-anchored census, so the gates went red for work that was
//      not theirs — and a *global* gate being red blocks every family closure.
//
// The resolution is one rule, applied everywhere: **the committed artifact must
// describe HEAD, and the working tree is a disclosed preview, never the
// standard of truth.** So this module exposes:
//
//   * `scanHeadAnalyzers()`      — scan the COMMITTED analyzer blobs.
//   * `scanWorkingAnalyzers()`   — scan the working tree (preview only).
//   * `analyzerDrift()`          — per-file difference between the two, with
//                                  additions/removals called out separately, so
//                                  an uncommitted new regex is DISCLOSED rather
//                                  than silently dropped (or wrongly fatal).
//   * pure set/multiset helpers  — so both gates and their self-tests share one
//                                  comparison semantics instead of two.
//
// Everything here is string comparison; the module carries no regex of its own
// beyond the analyzer-filename filter, which matches the M12 scanner's.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** The M12 analyzer-file filter, kept byte-identical to regex-census-core.ts. */
export const ANALYZER_FILE_RE = /^real-.+-analyzer\.ts$/

export interface ScanEntry {
  file: string
  line: number
  column?: number
  source: string
  classification?: string
  operation?: string
  receiverCategory?: string
  [key: string]: unknown
}

export interface Drift {
  /** Files whose working-tree content differs from HEAD (or that are new). */
  dirtyFiles: string[]
  /** Files present in the working tree that no commit contains. */
  addedFiles: string[]
  /** Entries only the working tree scan has (uncommitted additions/moves). */
  added: string[]
  /** Entries only the HEAD scan has (uncommitted removals/moves). */
  removed: string[]
  clean: boolean
}

/** The census truncates long sources; normalise both sides identically. */
export function normSource(source: string): string {
  return source.length > 200 ? source.slice(0, 200) + "\u2026" : source
}

/** Positional identity of a scan entry — the strict key. */
export function entryKey(e: Pick<ScanEntry, "file" | "line" | "source">): string {
  return `${e.file}:${e.line}:${normSource(e.source)}`
}

/**
 * Source identity of a scan entry — the STABLE key.
 *
 * Line numbers move on every edit (`annotation` insertions, wave re-writes),
 * while a regex's source string does not. Any artifact whose job is "name the
 * regexes that need review" must key on this; keying on position is what made
 * the debt register stale four waves in a row.
 */
export function sourceKey(e: Pick<ScanEntry, "file" | "source">): string {
  return `${e.file}\u0000${normSource(e.source)}`
}

export function multiset(entries: Pick<ScanEntry, "file" | "source">[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of entries) {
    const k = sourceKey(e)
    out.set(k, (out.get(k) ?? 0) + 1)
  }
  return out
}

export interface MultisetDiff {
  /** Required keys the available side does not fully cover. */
  missing: { key: string; required: number; available: number }[]
  /** Available keys the required side does not ask for. */
  extra: { key: string; required: number; available: number }[]
}

export function multisetDiff(required: Map<string, number>, available: Map<string, number>): MultisetDiff {
  const missing: MultisetDiff["missing"] = []
  const extra: MultisetDiff["extra"] = []
  for (const [key, req] of required) {
    const have = available.get(key) ?? 0
    if (have < req) missing.push({ key, required: req, available: have })
  }
  for (const [key, have] of available) {
    const req = required.get(key) ?? 0
    if (have > req) extra.push({ key, required: req, available: have })
  }
  const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  return { missing: missing.sort(byKey), extra: extra.sort(byKey) }
}

export interface SetDiff {
  missing: string[]
  stale: string[]
}

/** Strict positional diff between two scans (`other` = candidate truth). */
export function diffScans(base: ScanEntry[], other: ScanEntry[]): SetDiff {
  const baseKeys = new Set(base.map(entryKey))
  const otherKeys = new Set(other.map(entryKey))
  return {
    missing: [...otherKeys].filter((k) => !baseKeys.has(k)).sort(),
    stale: [...baseKeys].filter((k) => !otherKeys.has(k)).sort(),
  }
}

export function prettyKey(key: string): string {
  return key.replace("\u0000", " | ")
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

/** Analyzer basenames that exist in HEAD. */
export function headAnalyzerFiles(): string[] {
  return git(["ls-tree", "--name-only", "HEAD", "src/ast/"])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((p) => basename(p))
    .filter((f) => ANALYZER_FILE_RE.test(f))
    .sort()
}

/** Committed content of `src/ast/<file>`, or null when HEAD has no such file. */
export function headBlobContent(file: string): string | null {
  try {
    return git(["show", `HEAD:src/ast/${file}`])
  } catch {
    return null
  }
}

export function workingAnalyzerFiles(dir = join(ROOT, "src/ast")): string[] {
  return readdirSync(dir).filter((f) => ANALYZER_FILE_RE.test(f)).sort()
}

/** Scan the analyzer blobs as committed — THE standard of truth. */
export async function scanHeadAnalyzers(): Promise<ScanEntry[]> {
  const files = headAnalyzerFiles()
  const tmp = mkdtempSync(join(tmpdir(), "bb-census-head-"))
  try {
    for (const file of files) {
      const content = headBlobContent(file)
      if (content !== null) writeFileSync(join(tmp, file), content)
    }
    const { scanAnalyzers } = await import("./regex-census-core")
    return (await scanAnalyzers(tmp)) as ScanEntry[]
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Scan the working tree — a PREVIEW, never the standard. */
export async function scanWorkingAnalyzers(): Promise<ScanEntry[]> {
  const { scanAnalyzers } = await import("./regex-census-core")
  return (await scanAnalyzers()) as ScanEntry[]
}

/**
 * Per-file difference between the working tree and HEAD.
 *
 * `dirtyFiles` is derived by comparing CONTENT (not `git status`), so it is
 * correct regardless of index state, and so a file that is merely `touch`ed
 * never counts as drift.
 */
export async function analyzerDrift(head: ScanEntry[], work: ScanEntry[]): Promise<Drift> {
  const dirtyFiles: string[] = []
  const addedFiles: string[] = []
  for (const file of workingAnalyzerFiles()) {
    const headContent = headBlobContent(file)
    if (headContent === null) {
      addedFiles.push(file)
      dirtyFiles.push(file)
      continue
    }
    if (readFileSync(join(ROOT, "src/ast", file), "utf8") !== headContent) dirtyFiles.push(file)
  }

  const headKeys = new Set(head.map(entryKey))
  const workKeys = new Set(work.map(entryKey))
  const added = [...workKeys].filter((k) => !headKeys.has(k)).sort()
  const removed = [...headKeys].filter((k) => !workKeys.has(k)).sort()

  return {
    dirtyFiles: dirtyFiles.sort(),
    addedFiles: addedFiles.sort(),
    added,
    removed,
    clean: dirtyFiles.length === 0,
  }
}

/**
 * Stable (file, source) pair from a strict `file:line:source` entry key.
 * Lets a drift key be classified as a pure line SHIFT (its pair is known) or a
 * genuinely NEW regex source (its pair is not).
 */
export function pairKeyOfEntryKey(key: string): string {
  const first = key.indexOf(":")
  const second = key.indexOf(":", first + 1)
  return `${key.slice(0, first)}\u0000${key.slice(second + 1)}`
}

/** Resolve the HEAD line(s) at which a (file, source) pair actually sits. */
export function headPositionsOf(head: ScanEntry[], file: string, source: string): number[] {
  return head.filter((e) => e.file === file && normSource(e.source) === normSource(source)).map((e) => e.line).sort((a, b) => a - b)
}
