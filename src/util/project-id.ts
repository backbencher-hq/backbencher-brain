// src/util/project-id.ts — the SINGLE owner of project identity.
//
// History: this lived in src/cli/index.ts, which made the bb_lsp server's
// bundling graph reach into the CLI (commander and all). The owner spot-check
// (2026-09-05) caught the result: the packaged VSIX server crashed at boot
// with ERR_MODULE_NOT_FOUND 'commander' — a runtime dep the server never
// needed. Moved here so the server graph stays CLI-free; the CLI re-exports
// for compatibility (its identity remains sha1-of-realpath, unchanged).
//
// Nonexistent paths keep deterministic lexical identity for validation; a
// legacy non-canonical id is migrated to the canonical one when only the
// legacy directory exists.
import { createHash } from "crypto"
import { existsSync, mkdirSync, realpathSync, renameSync } from "fs"
import path from "path"
import { bbProjectsDir } from "./bb-data-dir"

export function getProjectId(projectPath: string): string {
  const resolved = path.resolve(projectPath)
  let canonical = resolved
  try {
    canonical = realpathSync.native(resolved)
  } catch {
    // Nonexistent paths retain deterministic lexical identity for validation.
  }
  const canonicalId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
  if (canonical !== resolved) {
    const legacyId = createHash("sha1").update(resolved).digest("hex").substring(0, 40)
    const legacyDir = path.join(bbProjectsDir(), legacyId)
    const canonicalDir = path.join(bbProjectsDir(), canonicalId)
    if (existsSync(legacyDir) && !existsSync(canonicalDir)) {
      mkdirSync(bbProjectsDir(), { recursive: true })
      try { renameSync(legacyDir, canonicalDir) } catch {}
    }
  }
  return canonicalId
}
