// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the source fingerprint and working-tree check for the
// bb_security evidence suite: a content hash over every file whose bytes decide
// what the tool can honestly claim.
// WHICH TOOL IT SERVES — bb_security (mutability read, requiresIndex true,
//   modes: findings; plannedModes flow, summary, hotspots).
// WHY IT IS SHAPED THIS WAY — a security verdict is only as good as the code that
//   produced it, so the verifier evidence carries a hash of the detection surface
//   (engine adapter, contract, run-history), the indexer writers that fill
//   brain_taint_flow, the per-tool handler/descriptor, the schema that gates the
//   rows, the two docs pages, and the verifiers themselves. The list is explicit
//   rather than a directory glob: an unrelated file changing must not invalidate
//   evidence, and a file moving into a tool module must not silently drop out.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_security/**,
//   validation/m15/results/x*.json, validation/m20/results/S*.json.
// EDIT TOGETHER WHEN THIS FILE CHANGES — the security gate scripts that call it
//   and the per-tool modules when they move.
// CONTRACTS IT MUST NOT BREAK — a fingerprint is a statement about content, not
//   freshness; it must stay deterministic and must cover the handler that renders
//   the answer.
// ─────────────────────────────────────────────────────────────────────────────

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
  // The per-tool modules are where the security answer is shaped and where its
  // contract lives; the assemblers are kept too because a change to the shared
  // door wiring changes what a caller can reach.
  "src/mcp/tools/bb_security/handler.ts",
  "src/mcp/tools/bb_security/descriptor.ts",
  "src/mcp/tool-handlers.ts",
  "src/mcp/tool-registry.ts",
  "src/brain/schema-ddl.ts",
  "docs/BB_SECURITY.md",
  "docs/tools/bb_security.md",
  // The verifier namespace is split across m13 (contract), m15 (deep/precision/
  // regression) and m20 (flow boundary/adversarial/history); every one of those
  // files asserts something about this tool and therefore belongs in the hash.
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
