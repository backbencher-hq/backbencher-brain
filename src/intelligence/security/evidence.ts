import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

export const SECURITY_EVIDENCE_PATHS = [
  "src/intelligence/security/taint.ts",
  "src/security/cross-language-security.ts",
  "src/intelligence/contracts.ts",
  "src/intelligence/evidence.ts",
  "src/intelligence/analysis/run-history.ts",
  "src/mcp/tool-handlers.ts",
  "src/mcp/tool-registry.ts",
  "docs/BB_SECURITY.md",
  "docs/tools/bb_security.md",
] as const

export function securitySourceFingerprint(root: string): string {
  const hash = createHash("sha256")
  for (const relativePath of SECURITY_EVIDENCE_PATHS) {
    hash.update(relativePath)
    hash.update("\0")
    hash.update(readFileSync(path.join(root, relativePath)))
    hash.update("\0")
  }
  return hash.digest("hex")
}

export function securityRelevantWorkingTreeChanges(root: string): string[] {
  try {
    const output = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    })
    const lines = output.split("\n")
    const paths = new Set<string>(SECURITY_EVIDENCE_PATHS)
    const dirty: string[] = []
    for (const line of lines) {
      const file = line.slice(3).trim()
      if (paths.has(file) || file.startsWith("script/m20/verify-security-")) dirty.push(file)
    }
    return dirty
  } catch {
    return ["git-status-unavailable"]
  }
}
