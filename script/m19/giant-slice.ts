// script/m19/giant-slice.ts - S2/S3 helper: index a bounded slice of a giant
// repo into the SAME project DB without copying the corpus.
// Usage:
//   bun script/m19/giant-slice.ts <repoPath> [--slice N --total M] [--ext "cs|fs|vb"] [--dry]
// Prints a JSON summary line. Accumulates in the real project DB.

import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"

function walk(dir: string, extRe: RegExp, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "obj" || entry.name === "bin" || entry.name === "testData" || entry.name === ".idea" || entry.name === "node_modules") continue
    if (entry.isDirectory()) walk(p, extRe, acc)
    else if (entry.isFile() && extRe.test(entry.name)) acc.push(p)
  }
  return acc
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf("--" + name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}
const repo = process.argv[2]
if (!repo || !existsSync(repo)) { console.error("repo missing"); process.exit(2) }
const dry = process.argv.includes("--dry")
const ext = arg("ext") || "cs|fs|vb|cshtml|razor"
const sliceIdx = parseInt(arg("slice") || "0", 10)
const total = parseInt(arg("total") || "1", 10)
const files = walk(repo, new RegExp("\\.(" + ext + ")$"))
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