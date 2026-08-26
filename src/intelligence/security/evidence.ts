import { createHash } from "node:crypto"
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
