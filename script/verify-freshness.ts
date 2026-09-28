// verify-freshness.ts — Phase 5 acceptance.
// 1. Index a fixture; search returns all-fresh results.
// 2. Modify one file on disk; search must flag that file's rows stale.
// 3. Delete a file; its rows must be flagged (missing/stale), never "fresh".
// 4. Unmodified files stay fresh. Runs under Bun and Node.
import { BrainTools } from "../src/ast/tools"
import { BrainDatabase } from "../src/brain/database"
import { checkFileFreshness } from "../src/brain/freshness"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

let failures = 0
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label} ${detail}`)
  }
}
console.log(`runtime: ${process.version} (${typeof Bun !== "undefined" ? "bun" : "node"})`)

const root = mkdtempSync(path.join(tmpdir(), "bb-fresh-"))
const pid = "verify-freshness"
mkdirSync(path.join(root, "src"), { recursive: true })
const alphaPath = path.join(root, "src", "alpha.ts")
const betaPath = path.join(root, "src", "beta.ts")
const gammaPath = path.join(root, "src", "gamma.ts")
writeFileSync(alphaPath, `export function alphaOne(): number {\n  return 1\n}\nexport function alphaTwo(): number {\n  return 2\n}\n`)
writeFileSync(betaPath, `export function betaOne(): string {\n  return "b"\n}\n`)
writeFileSync(gammaPath, `export function gammaOne(): boolean {\n  return true\n}\n`)

await indexProjectParallel(pid, root, {})
const raw = await BrainDatabase.getRawInstance(pid)

const alphaFileId = (raw.prepare("SELECT id FROM brain_file WHERE path = ?").get(alphaPath) as any).id
const betaFileId = (raw.prepare("SELECT id FROM brain_file WHERE path = ?").get(betaPath) as any).id
const gammaFileId = (raw.prepare("SELECT id FROM brain_file WHERE path = ?").get(gammaPath) as any).id

// 1. everything fresh right after indexing
check("alpha fresh after index", checkFileFreshness(raw, alphaFileId)?.status === "fresh")
check("beta fresh after index", checkFileFreshness(raw, betaFileId)?.status === "fresh")
check("gamma fresh after index", checkFileFreshness(raw, gammaFileId)?.status === "fresh")

// 2. search results carry no stale flags
const s1 = await BrainTools.searchCode(pid, "One", { maxResults: 20 })
check("search after index: no stale flags", (s1 as any).staleCount === 0, `stale=${(s1 as any).staleCount} fresh=${(s1 as any).freshCount}`)

// 3. modify alpha on disk
appendFileSync(alphaPath, `// changed after indexing\n`)
check("alpha now stale", checkFileFreshness(raw, alphaFileId)?.status === "stale")
check("beta still fresh", checkFileFreshness(raw, betaFileId)?.status === "fresh")

// 4. search flags alpha's rows but not beta/gamma
const s2 = await BrainTools.searchCode(pid, "One", { maxResults: 20 })
const alphaStale = s2.filter((r: any) => r.fileId === alphaFileId && r.stale)
const betaStale = s2.filter((r: any) => r.fileId === betaFileId && r.stale)
check("alpha rows flagged stale", alphaStale.length >= 1, `got ${alphaStale.length}`)
check("beta rows NOT flagged", betaStale.length === 0, `got ${betaStale.length}`)
check("staleCount reflects alpha only", (s2 as any).staleCount >= alphaStale.length && (s2 as any).staleCount < (s2 as any).freshCount, `stale=${(s2 as any).staleCount}`)

// 5. delete gamma -> its rows are flagged, not fresh
rmSync(gammaPath)
check("gamma missing", checkFileFreshness(raw, gammaFileId)?.status === "missing")
const s3 = await BrainTools.searchCode(pid, "gamma", { maxResults: 10 })
const gammaRows = s3.filter((r: any) => r.fileId === gammaFileId)
check("deleted file's rows flagged", gammaRows.length === 0 || gammaRows.every((r: any) => r.stale), `rows=${gammaRows.length}`)

// 6. reindex alpha -> fresh again
await indexProjectParallel(pid, root, {})
check("alpha fresh after reindex", checkFileFreshness(raw, alphaFileId)?.status === "fresh")

rmSync(root, { recursive: true, force: true })
rmSync(path.dirname(BrainDatabase.getDbPath(pid)), { recursive: true, force: true })
console.log(failures === 0 ? "\nFRESHNESS VERIFY: ALL PASS" : `\nFRESHNESS VERIFY: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
