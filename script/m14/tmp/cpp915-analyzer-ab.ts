// #915 ANALYZER-level A/B (no grammar involved): dump the analyzer's OWN
// output for a deterministic sample of files, so the pre-fix and post-fix
// analyzers can be compared symbol by symbol and edge by edge.
//
// Usage: bun script/m14/tmp/cpp915-analyzer-ab.ts <repoDir> <limit> <out.json>
import { readFileSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))

const repoDir = process.argv[2]
const limit = process.argv[3] ? Number(process.argv[3]) : 0
const outPath = process.argv[4]
if (!repoDir || !outPath) {
  console.error("usage: cpp915-analyzer-ab.ts <repoDir> <limit|0> <out.json>")
  process.exit(2)
}
const EXTS = new Set([".cc", ".cpp", ".cxx", ".h", ".hpp", ".hh"])
let files = execSync("git ls-files", { cwd: repoDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n")
  .map((f) => f.trim())
  .filter((f) => f.length > 0 && EXTS.has(path.extname(f)))
files.sort()
if (limit > 0) files = files.slice(0, limit)

const out: Record<string, any> = {}
for (const rel of files) {
  const abs = path.join(repoDir, rel)
  const src = readFileSync(abs, "utf8")
  let res: any
  try {
    res = await parseFile(abs, src, { language: "cpp" })
  } catch (e: any) {
    out[rel] = { error: String(e?.message ?? e).slice(0, 120) }
    continue
  }
  const symbols = (res.symbols ?? []).map((s: any) => `${s.range?.startLine}:${s.kind}:${s.name}${s.ownerName ? "@" + s.ownerName : ""}`).sort()
  const rels = (res.relationships ?? []).map((r: any) => `${r.line_number}:${r.type}:${r.source}->${r.target}#${r.metadata?.relationshipType ?? ""}`).sort()
  out[rel] = { symbols, rels }
}
writeFileSync(outPath, JSON.stringify(out, null, 0))
console.log(`wrote ${outPath}: ${files.length} files, ${Object.values(out).reduce((a: number, v: any) => a + (v.symbols?.length ?? 0), 0)} symbols, ${Object.values(out).reduce((a: number, v: any) => a + (v.rels?.length ?? 0), 0)} relationships`)
