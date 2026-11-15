// Evidence for the mutability question: with the OLD directory fingerprint
// (size+mtime of every file), which file moves across a plain bb_health call?
// db+WAL bytes are compared directly; -shm is reported separately.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { getUnifiedHealth } from "../../../../src/intelligence/health/health-provider"
const root = mkdtempSync(path.join(tmpdir(), "bb-health-shm-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "a.ts"), "export function alpha(): number { return 1 }\n")
await indexProjectParallel(projectId as any, root, {})
const dbDir = path.dirname(BrainDatabase.getDbPath(projectId))
const dirFp = () => Object.fromEntries(readdirSync(dbDir).sort().map((f) => [f, `${statSync(path.join(dbDir, f)).size}:${statSync(path.join(dbDir, f)).mtimeMs}`]))
const byteFp = () => Object.fromEntries(["brain.db", "brain.db-wal"].filter((f) => existsSync(path.join(dbDir, f))).map((f) => [f, readFileSync(path.join(dbDir, f)).length + ":" + readFileSync(path.join(dbDir, f)).subarray(0, 64).toString("hex")]))
const before = { dir: dirFp(), bytes: byteFp() }
await getUnifiedHealth(projectId, root, {})
const after = { dir: dirFp(), bytes: byteFp() }
const moved = Object.keys({ ...before.dir, ...after.dir }).filter((f) => before.dir[f] !== after.dir[f])
const byteMoved = Object.keys({ ...before.bytes, ...after.bytes }).filter((f) => before.bytes[f] !== after.bytes[f])
console.log(JSON.stringify({ dirFpMoved: moved, byteFpMoved: byteMoved, shmMoved: moved.includes("brain.db-shm"), walMoved: moved.includes("brain.db-wal") }))
