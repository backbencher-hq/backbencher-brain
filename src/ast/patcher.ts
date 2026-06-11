// Surgical Patcher — Byte-precise file editing
// Ported from backbencher's brain-surgical-patcher.ts
// Handles: smart delete (whitespace cleanup), auto-indent, format, undo backup

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "fs"
import { join, dirname, extname, basename } from "path"
import { execSync } from "child_process"
import { createLogger } from "../util/log.js"

const log = createLogger("patcher")

// ============================================================================
// MAIN PATCH FUNCTION
// ============================================================================

export async function patch(
  filePath: string,
  startIndex: number,
  endIndex: number,
  newContent: string,
  isDelete = false,
  format = true,
): Promise<boolean> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) {
    throw new Error(`Invalid bounds: [${startIndex}, ${endIndex}]`)
  }

  const originalContent = readFileSync(filePath, "utf8")

  if (endIndex > originalContent.length) {
    throw new Error(`endIndex (${endIndex}) exceeds file length (${originalContent.length})`)
  }

  let actualStart = startIndex
  let actualEnd = endIndex
  let finalContent = newContent

  if (isDelete) {
    // SMART DELETE: Cleanup surrounding whitespace
    while (actualStart > 0) {
      const char = originalContent[actualStart - 1]
      if (char === " " || char === "\t") actualStart--
      else break
    }

    const isAtLineStart = actualStart === 0 || originalContent[actualStart - 1] === "\n"
    if (isAtLineStart) {
      if (actualEnd < originalContent.length && originalContent[actualEnd] === "\r") actualEnd++
      if (actualEnd < originalContent.length && originalContent[actualEnd] === "\n") actualEnd++
    }
    finalContent = ""
  } else {
    // SMART PATCH: Fix indentation if LLM provided flush-left code
    let baseIndent = ""
    let tempStart = startIndex
    while (tempStart > 0) {
      const char = originalContent[tempStart - 1]
      if (char === "\n") break
      if (char === " " || char === "\t") {
        baseIndent = char + baseIndent
      } else {
        baseIndent = ""
      }
      tempStart--
    }

    if (baseIndent.length > 0 && finalContent.includes("\n")) {
      const lines = finalContent.split("\n")
      const secondLine = lines.length > 1 ? lines[1] : ""
      const hasOwnIndent = secondLine?.startsWith(" ") || secondLine?.startsWith("\t")

      if (!hasOwnIndent && secondLine?.trim().length) {
        for (let i = 1; i < lines.length; i++) {
          if (lines[i]?.trim().length) {
            lines[i] = baseIndent + lines[i]
          }
        }
        finalContent = lines.join("\n")
      }
    }
  }

  const before = originalContent.substring(0, actualStart)
  const after = originalContent.substring(actualEnd)
  const patchedContent = before + finalContent + after

  writeFileSync(filePath, patchedContent, "utf8")

  // Auto-format
  if (format) {
    tryAutoFormat(filePath).catch(() => {})
  }

  return true
}

// ============================================================================
// AUTO-FORMAT
// ============================================================================

export async function tryAutoFormat(filePath: string): Promise<void> {
  try {
    const ext = extname(filePath)
    const cwd = dirname(filePath)
    let cmd = ""

    if ([".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css", ".md"].includes(ext)) {
      cmd = `npx prettier --write "${filePath}"`
    } else if (ext === ".rs") {
      cmd = `rustfmt "${filePath}"`
    } else if (ext === ".go") {
      cmd = `gofmt -w "${filePath}"`
    } else if (ext === ".py") {
      cmd = `black "${filePath}"`
    } else if (ext === ".dart") {
      cmd = `dart format "${filePath}"`
    }

    if (cmd) {
      execSync(cmd, { cwd, stdio: "ignore", timeout: 5000 })
      log.debug("formatted", { file: basename(filePath), tool: cmd.split(" ")[0] })
    }
  } catch {
    // Formatting is best-effort
  }
}

// ============================================================================
// UNDO BACKUP
// ============================================================================

export function createBackup(filePath: string, projectDir: string): string {
  const backupDir = join(projectDir, ".bb_backups")
  try { mkdirSync(backupDir, { recursive: true }) } catch {}

  const backupPath = join(backupDir, `${basename(filePath)}.${Date.now()}.bak`)
  const content = readFileSync(filePath, "utf8")
  writeFileSync(backupPath, content, "utf8")

  // Prune old backups (keep max 50)
  try {
    const files = readdirSync(backupDir)
      .filter(f => f.startsWith(basename(filePath)))
      .map(f => ({ name: f, mtime: statSync(join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    for (const f of files.slice(50)) {
      try { unlinkSync(join(backupDir, f.name)) } catch {}
    }
  } catch {}

  return backupPath
}

export function restoreBackup(backupPath: string, targetPath: string): boolean {
  try {
    const content = readFileSync(backupPath, "utf8")
    writeFileSync(targetPath, content, "utf8")
    return true
  } catch {
    return false
  }
}

// ============================================================================
// PRE-FLIGHT CHECKS
// ============================================================================

export interface PreflightResult {
  ok: boolean
  errors: string[]
}

export function preflightCheck(filePath: string, projectHash: string): PreflightResult {
  const errors: string[] = []

  if (!existsSync(filePath)) {
    errors.push(`File not found: ${filePath}`)
  }

  // Check file size is reasonable
  try {
    const stats = require("fs").statSync(filePath)
    if (stats.size > 5 * 1024 * 1024) {
      errors.push(`File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB`)
    }
  } catch {
    errors.push("Cannot stat file")
  }

  return { ok: errors.length === 0, errors }
}
