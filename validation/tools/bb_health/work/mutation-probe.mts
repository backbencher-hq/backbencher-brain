// Is a plain (default-argument) bb_health call byte-mutation-free on its index?
// Tests three levels: open-only, plain getUnifiedHealth, and the fingerprint the
// mutability gate uses (size+mtime of every file in the project DB dir).
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { getUnifiedHealth } from "../../../../src/intelligence/health/health-provider"

const root = mkdtempSync(path.join(tmpdir(), "bb-health-mutation-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "a.ts"), "export function a(): number { return 1 }\n")
await indexProjectParallel(projectId as any, root, {})
const dbDir = path.dirname(BrainDatabase.getDbPath(projectId))
const fp = () => readdirSync(dbDir).sort().map((f) => `${f}:${statSync(path.join(dbDir, f)).size}:${statSync(path.join(dbDir, f)).mtimeMs}`).join("|")
const before = fp()
await getUnifiedHealth(projectId, root, {})
const after = fp()
console.log(JSON.stringify({ dbDir, before, after, mutated: before !== after, filesBefore: before.split("|"), filesAfter: after.split("|") }, null, 2))
