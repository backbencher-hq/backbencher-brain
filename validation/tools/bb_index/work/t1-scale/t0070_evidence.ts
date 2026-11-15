import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

export const PATTERN_EVIDENCE_PATHS = [
  "src/ast/tools.ts",
  "src/intelligence/patterns/orphans.ts",
  "src/intelligence/patterns/rules.ts",
  "src/intelligence/contracts.ts",
  "src/intelligence/evidence.ts",
  "src/intelligence/analysis/run-history.ts",
  "src/mcp/tool-handlers.ts",
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
