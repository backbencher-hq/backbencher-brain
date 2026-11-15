// #916 ANALYZER-level A/B: dump the c analyzer's own output for a deterministic
// sample so the pre-fix and post-fix analyzers can be compared symbol by symbol
// and edge by edge (F5's oracle walks the same tree and cannot see this class).
//
// Usage: bun script/m14/tmp/c916-ab.ts <repoDir> <limit|0> <out.json>
import { readFileSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))

const repoDir = process.argv[2]
const limit = process.argv[3] ? Number(process.argv[3]) : 0
const outPath = process.argv[4]
if (!repoDir || !outPath) {
  console.error("usage: c916-ab.ts <repoDir> <limit|0> <out.json>")
  process.exit(2)
}
let files = execSync("git ls-files", { cwd: repoDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n")
  .map((f) => f.trim())
  .filter((f) => /\.(c|h)$/.test(f))
files.sort()
if (limit > 0) files = files.slice(0, limit)

const out: Record<string, any> = {}
for (const rel of files) {
  const abs = path.join(repoDir, rel)
  const src = readFileSync(abs, "utf8")
  let res: any
  try {
    res = await parseFile(abs, src, { language: "c" })
  } catch (e: any) {
    out[rel] = { error: String(e?.message ?? e).slice(0, 120) }
    continue
  }
  const symbols = (res.symbols ?? [])
    .map((s: any) => `${s.range?.startLine}:${s.kind}:${s.name}${s.ownerName ? "@" + s.ownerName : ""}`)
    .sort()
  const rels = (res.relationships ?? [])
    .map((r: any) => `${r.line_number}:${r.type}:${r.source}->${r.target}#${r.metadata?.relationshipType ?? ""}`)
    .sort()
  out[rel] = { symbols, rels }
}
writeFileSync(outPath, JSON.stringify(out, null, 0))
const tot = Object.values(out).reduce((a: number, v: any) => a + (v.symbols?.length ?? 0), 0)
const rt = Object.values(out).reduce((a: number, v: any) => a + (v.rels?.length ?? 0), 0)
console.log(`wrote ${outPath}: ${files.length} files, ${tot} symbols, ${rt} relationships`)
