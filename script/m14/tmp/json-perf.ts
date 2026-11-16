import { parseFile } from "<corpus-root>/mcp/backbencher-brain/src/ast/pool-worker"
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { detectLanguageFromPath } from "<corpus-root>/mcp/backbencher-brain/src/ast/language-detection"
import * as path from "path"
const CR = "<corpus-root>/bb_tests/repositories"
const REPOS = ["terraform", "otp", "ansible", "clj-kondo", "svelte", "kubernetes"]
const cands: any[] = []
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512*1024*1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512*1024) continue; const t = readFileSync(abs, "utf8"); if (detectLanguageFromPath(abs, t) !== "json") continue
      cands.push({ dir, abs, bytes: statSync(abs).size, h: createHash("sha256").update(t).digest("hex") }) } catch {}
  }
}
const run = async (label: string, pick: any[]) => {
  const bytes = pick.reduce((a, b) => a + b.bytes, 0)
  const t0 = performance.now(); let syms = 0, rels = 0
  for (const c of pick) { const r: any = await parseFile(c.abs, c.dir); syms += (r.symbols ?? []).length; rels += (r.relationships ?? []).length }
  const ms = performance.now() - t0
  const sorted = [...pick].map(p => p.bytes).sort((a, b) => a - b)
  console.log(`  ${label}`)
  console.log(`    files ${pick.length}  median ${Math.round(sorted[Math.floor(sorted.length/2)]/1024)} KB  mean ${Math.round(bytes/pick.length/1024)} KB  total ${Math.round(bytes/1024/1024)} MB`)
  console.log(`    symbols ${syms.toLocaleString()}  relationships ${rels.toLocaleString()}`)
  console.log(`    wall ${(ms/1000).toFixed(2)} s = ${(ms/pick.length).toFixed(1)} ms/file   ${(bytes/1024/1024/(ms/1000)).toFixed(2)} MB/s`)
}
const byHash = [...cands].sort((a, b) => a.h < b.h ? -1 : 1)
await run("REPRESENTATIVE (300 hash-ordered, median-size)", byHash.slice(0, 300))
await run("WORST CASE (300 LARGEST admitted)", [...cands].sort((a, b) => b.bytes - a.bytes).slice(0, 300))
