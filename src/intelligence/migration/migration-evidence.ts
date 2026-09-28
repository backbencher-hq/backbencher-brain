import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"

export const MIGRATION_EVIDENCE_PATHS = [
  "src/ast/cross-language-migration-assistant.ts",
  "src/intelligence/migration/migration-engine.ts",
  "docs/BB_MIGRATE.md",
  "docs/tools/bb_migrate.md",
  "package.json",
] as const

export function migrationSourceFingerprint(root: string): string {
  const hash = createHash("sha256")
  for (const relativePath of MIGRATION_EVIDENCE_PATHS) {
    hash.update(relativePath)
    hash.update("\0")
    hash.update(readFileSync(path.join(root, relativePath)))
    hash.update("\0")
  }
  return hash.digest("hex")
}
