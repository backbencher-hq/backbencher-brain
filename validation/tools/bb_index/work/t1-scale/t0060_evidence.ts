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
  // The engine's evidence comes from rows the indexer writes, so a change to the
  // taint writers is a change to what this tool can honestly claim. These were
  // missing from the fingerprint, which meant the security fingerprint stayed
  // identical while the detection surface moved underneath it.
  "src/ast/taint-analyzer.ts",
  "src/ast/parallel-indexer.ts",
  "src/mcp/tool-handlers.ts",
  "src/mcp/tool-registry.ts",
  "src/brain/schema-ddl.ts",
  "docs/BB_SECURITY.md",
  "docs/tools/bb_security.md",
  // The verifier namespace is `script/m15/` for the M15 X-codes; the old glob
  // `script/m20/verify-security-` matched three files that this tool's own
  // contract does not describe, and missed the X1-X8 suite entirely.
  "script/m15/verify-security-deep.ts",
  "script/m20/verify-security-flow-boundary.ts",
  "script/m20/verify-security-adversarial.ts",
  "script/m20/verify-security-history.ts",
] as const

const SECURITY_VERIFIER_PREFIXES = ["script/m15/verify-security-", "script/m20/verify-security-"] as const

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
      if (paths.has(file) || SECURITY_VERIFIER_PREFIXES.some((p) => file.startsWith(p))) dirty.push(file)
    }
    return dirty
  } catch {
    return ["git-status-unavailable"]
  }
}
