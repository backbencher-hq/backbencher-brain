// #920 A/B: dump the cpp analyzer's output for a corpus in a DETERMINISTIC order
// (git ls-files), so pre-fix and post-fix runs measure the same file set. The F5
// sweep rotates its sample by design (cold-pool, #760), so its lane numbers are
// not comparable across consecutive runs — this instrument is.
//
// Usage: bun script/m14/tmp/c920-ab.ts <repoDir> <out.json>
import { readFileSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))

const repoDir = process.argv[2]
const outPath = process.argv[3]
if (!repoDir || !outPath) {
  console.error("usage: c920-ab.ts <repoDir> <out.json>")
  process.exit(2)
}
const files = execSync("git ls-files", { cwd: repoDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n")
  .map((f) => f.trim())
  .filter((f) => /\.(cpp|cc|cxx|hpp|hh|h)$/.test(f))
  .sort()

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
  out[rel] = {
    symbols: (res.symbols ?? []).map((s: any) => `${s.range?.startLine}:${s.kind}:${s.name}${s.ownerName ? "@" + s.ownerName : ""}`).sort(),
    rels: (res.relationships ?? []).map((r: any) => `${r.line_number}:${r.type}:${r.source}->${r.target}`).sort(),
  }
}
writeFileSync(outPath, JSON.stringify(out))
const tot = Object.values(out).reduce((a: number, v: any) => a + (v.symbols?.length ?? 0), 0)
const rt = Object.values(out).reduce((a: number, v: any) => a + (v.rels?.length ?? 0), 0)
console.log(`wrote ${outPath}: ${files.length} files, ${tot} symbols, ${rt} relationships`)
