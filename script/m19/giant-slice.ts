// script/m19/giant-slice.ts - S2/S3 helper: index a bounded slice of a giant
// repo into the SAME project DB without copying the corpus.
// Usage:
//   bun script/m19/giant-slice.ts <repoPath> [--slice N --total M] [--dry]
// Prints a JSON summary line. Accumulates in the real project DB.

import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "obj" || entry.name === "bin") continue
    if (entry.isDirectory()) walk(p, acc)
    else if (entry.isFile() && /\.(cs|fs|vb|cshtml|razor)$/.test(entry.name)) acc.push(p)
  }
  return acc
}

const repo = process.argv[2]
if (!repo || !existsSync(repo)) { console.error("repo missing"); process.exit(2) }
const dry = process.argv.includes("--dry")
const files = walk(repo)
const sliceIdx = process.argv.indexOf("--slice") >= 0 ? parseInt(process.argv[process.argv.indexOf("--slice") + 1], 10) : 0
const total = process.argv.indexOf("--total") >= 0 ? parseInt(process.argv[process.argv.indexOf("--total") + 1], 10) : 1
const chunk = Math.ceil(files.length / total)
const sliceFiles = files.slice(sliceIdx * chunk, (sliceIdx + 1) * chunk)
console.log("total vetted:", files.length, "| slice", sliceIdx, "of", total, "| filesInSlice:", sliceFiles.length)
if (dry) {
  console.log(JSON.stringify({ ok: true, dry: true, total: files.length, slice: sliceIdx, filesInSlice: sliceFiles.length, sample: sliceFiles.slice(0, 3) }))
  process.exit(0)
}

const pid = getProjectId(repo)
const t0 = Date.now()
process.env.BB_EMBEDDING_BATCH_LIMIT = "1"
await indexProjectParallel(pid, repo, { files: sliceFiles, skipDiscovery: true })
delete process.env.BB_EMBEDDING_BATCH_LIMIT
const wallMs = Date.now() - t0
const raw = await BrainDatabase.getRawInstance(pid)
const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(pid) as any).c
const rels = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?").get(pid) as any).c
console.log(JSON.stringify({ ok: true, slice: sliceIdx, filesInSlice: sliceFiles.length, wallMs, wallSec: Math.round(wallMs / 1000), totalSymbols: symbols, totalRels: rels }))
process.exit(0)