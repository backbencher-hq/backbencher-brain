import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

export const DOC_EVIDENCE_PATHS = [
  "src/intelligence/documentation/doc-engine.ts",
  "src/intelligence/contracts.ts",
  "src/intelligence/evidence.ts",
  "src/mcp/tool-handlers.ts",
  "src/mcp/tool-registry.ts",
  "docs/BB_DOC.md",
  "docs/tools/bb_doc.md",
] as const

export function docSourceFingerprint(root: string): string {
  const hash = createHash("sha256")
  for (const relativePath of DOC_EVIDENCE_PATHS) {
    hash.update(relativePath)
    hash.update("\0")
    hash.update(readFileSync(path.join(root, relativePath)))
    hash.update("\0")
  }
  return hash.digest("hex")
}

export function docRelevantWorkingTreeChanges(root: string): string[] {
  try {
    const output = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    })
    const lines = output.split("\n")
    const paths = new Set<string>(DOC_EVIDENCE_PATHS)
    const dirty: string[] = []
    for (const line of lines) {
      const file = line.slice(3).trim()
      if (paths.has(file) || file.startsWith("script/m20/verify-doc-")) dirty.push(file)
    }
    return dirty
  } catch {
    return ["git-status-unavailable"]
  }
}