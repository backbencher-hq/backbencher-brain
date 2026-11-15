// Chunk the fsharp corpus into equal shards for the census probe.
//
// The full extent (6,627 files, ~0.27 s/file measured on a 250-file smoke run) is
// ~30 minutes of wall clock, past the terminal's 10-minute cap; the erlang ER3
// census precedent is to SHARD and MERGE rather than sample. Boundaries are
// computed over the full walk, so no directory listing can silently truncate.
//
// Usage: bun script/m14/tmp/fsharp-census-chunks.ts [--chunks N] [--dir outdir] [root]
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const argv = process.argv.slice(2)
const ci = argv.indexOf("--chunks")
const CHUNKS = ci >= 0 ? parseInt(argv[ci + 1]) : 5
const di = argv.indexOf("--dir")
const OUTDIR = di >= 0 ? argv[di + 1] : "/tmp/fsharp-census"
const rest = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--chunks" && argv[i - 1] !== "--dir")
const ROOT = rest[0] ?? "/home/ishaq2321/bb_tests/repositories/fsharp"
const SKIP_DIRS = new Set([".git", "node_modules", "artifacts", "obj", "bin"])

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, out)
    else if (e.endsWith(".fs") || e.endsWith(".fsi") || e.endsWith(".fsx")) out.push(p)
  }
  return out
}

const all = walk(ROOT).sort()
mkdirSync(OUTDIR, { recursive: true })
const per = Math.ceil(all.length / CHUNKS)
const shards: string[] = []
for (let i = 0; i < CHUNKS; i++) {
  const slice = all.slice(i * per, (i + 1) * per)
  if (!slice.length) continue
  const list = join(OUTDIR, `shard-${i}.txt`)
  writeFileSync(list, slice.join("\n") + "\n")
  shards.push(list)
  console.log(`shard ${i}: ${slice.length} files -> ${list}   [${slice[0]} … ${slice[slice.length - 1]}]`)
}
console.log(`total ${all.length} files in ${shards.length} shards`)
console.log(`merge: ${shards.map((s) => s.replace(/\.txt$/, ".json")).join(",")}`)
