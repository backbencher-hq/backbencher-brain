// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the evidence identity of bb_patterns: the source-path list
// whose content hash identifies the engine version a report was produced by, and the
// working-tree query the m20 receipts use to tell a settled tree from a known gap.
// WHICH TOOL IT SERVES — bb_patterns (read), through its m20 evidence receipts.
// WHY IT IS SHAPED THIS WAY — a fingerprint is only meaningful if it covers the code
//   that produced the findings, so the list names the per-tool handler and descriptor
//   after the registry split, not the shell that assembles handlers.
// WHERE ITS EVIDENCE LIVES — validation/m20/results/**, validation/tools/bb_patterns/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_patterns/{handler,descriptor}.ts,
//   the engines listed below, and the m20 pattern receipts.
// CONTRACTS IT MUST NOT BREAK — separate source reads remain non-fatal (git status
//   unavailable is reported, not thrown) and the list must cover every module that
//   can change a finding.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

// Every module that can change a bb_patterns finding. The per-tool handler and
// descriptor are listed after the registry split: the previous list named
// src/mcp/tool-handlers.ts, which is now a 39-line assembler, so the fingerprint
// could not change when the tool code did.
export const PATTERN_EVIDENCE_PATHS = [
  "src/mcp/tools/bb_patterns/handler.ts",
  "src/mcp/tools/bb_patterns/descriptor.ts",
  "src/ast/tools.ts",
  "src/intelligence/patterns/orphans.ts",
  "src/intelligence/patterns/rules.ts",
  "src/intelligence/contracts.ts",
  "src/intelligence/evidence.ts",
  "src/intelligence/analysis/run-history.ts",
  "docs/BB_PATTERNS.md",
  "docs/tools/bb_patterns.md",
  "package.json",
] as const

export function patternSourceFingerprint(root: string): string {
  const hash = createHash("sha256")
  for (const relativePath of PATTERN_EVIDENCE_PATHS) {
    hash.update(relativePath)
    hash.update("\0")
    hash.update(readFileSync(path.join(root, relativePath)))
    hash.update("\0")
  }
  return hash.digest("hex")
}

export function patternRelevantWorkingTreeChanges(root: string): string[] {
  try {
    const output = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    })
    const paths = new Set<string>(PATTERN_EVIDENCE_PATHS)
    for (const line of output.split("\n")) {
      const file = line.slice(3).trim()
      if (paths.has(file) || file.startsWith("script/m20/verify-patterns-")) paths.add(file)
    }
    return [...paths].filter((file) => output.split("\n").some((line) => line.slice(3).trim() === file))
  } catch {
    return ["git-status-unavailable"]
  }
}
