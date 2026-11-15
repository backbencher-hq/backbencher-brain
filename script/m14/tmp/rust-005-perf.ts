// rust lane audit: analyzer cost per file, and whether that cost grows
// SUPERLINEARLY in file size. A quadratic term in a walk shows up as
// ms/kB rising with size; a linear one keeps it flat. Reports the top-20
// slowest files with their kB and ms/kB, plus the quartile trend.
//
// Run: bun script/m14/tmp/rust-005-perf.ts <repoRoot> [limitFiles]
import * as fs from "node:fs"
import * as path from "node:path"

const { parseFile } = await import("../../../src/ast/engine")

const root = process.argv[2]
const limit = process.argv[3] ? parseInt(process.argv[3]) : 0
const files: string[] = []
const walk = (dir: string, depth = 0) => {
  if (depth > 14) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (e.name.endsWith(".rs")) files.push(p)
  }
}
walk(root)
files.sort()

const rows: Array<{ f: string; kb: number; ms: number; lok: number }> = []
let done = 0
for (const f of files) {
  if (limit && done >= limit) break
  const src = fs.readFileSync(f, "utf8")
  const kb = Buffer.byteLength(src) / 1024
  const t0 = performance.now()
  try { await parseFile(f, src) } catch { continue }
  const ms = performance.now() - t0
  rows.push({ f: path.relative(root, f), kb, ms, lok: src.split("\n").length })
  done++
}
const byMs = [...rows].sort((a, b) => b.ms - a.ms)
console.log("=== 15 slowest ===")
for (const r of byMs.slice(0, 15)) {
  console.log(`${r.ms.toFixed(0).padStart(6)}ms  ${r.kb.toFixed(0).padStart(5)}kB  ${(r.ms / Math.max(r.kb, 0.001)).toFixed(3)} ms/kB  ${r.f}`)
}
const sizes = [...rows].sort((a, b) => a.kb - b.kb)
const q = (arr: typeof rows) => {
  const kb = arr.reduce((s, r) => s + r.kb, 0)
  const ms = arr.reduce((s, r) => s + r.ms, 0)
  return { n: arr.length, kb: kb.toFixed(0), ms: ms.toFixed(0), perKb: (ms / Math.max(kb, 0.001)).toFixed(3) }
}
const n = sizes.length
console.log("\n=== ms/kB by size quartile (flat = linear, rising = superlinear) ===")
for (const [name, part] of [
  ["Q1 smallest", sizes.slice(0, Math.floor(n / 4))],
  ["Q2", sizes.slice(Math.floor(n / 4), Math.floor(n / 2))],
  ["Q3", sizes.slice(Math.floor(n / 2), Math.floor((3 * n) / 4))],
  ["Q4 largest ", sizes.slice(Math.floor((3 * n) / 4))],
] as const) {
  console.log(name, JSON.stringify(q(part)))
}
console.log(`\ntotal: ${n} files, ${q(rows).ms}ms, ${q(rows).perKb} ms/kB aggregate`)
