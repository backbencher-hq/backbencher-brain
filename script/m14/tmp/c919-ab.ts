// #919 A/B: dump the cpp analyzer's per-file output (symbols + relationship
// tuples) for the cpp corpora, so the before/after diff can classify every
// change. Run with the HEAD analyzer file in place for the baseline, then with
// the change in place for the "after" dump.
//   bun script/m14/tmp/c919-ab.ts <out.json> [repo ...]
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const out = process.argv[2]
const REPOS = process.argv.slice(3).length ? process.argv.slice(3) : ["fmt", "nlohmann-json"]
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))

const files: string[] = []
for (const repo of REPOS) {
  const collect = (dir: string) => {
    let entries: any[] = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) collect(p)
      else if (/\.(cpp|cc|cxx|hpp|hh|h)$/.test(e.name)) files.push(p)
    }
  }
  collect(path.join(CORPUS, repo))
}
files.sort()

const dump: Record<string, any> = {}
for (const f of files) {
  const rel = path.relative(CORPUS, f)
  let src: string
  try { src = readFileSync(f, "utf8") } catch { continue }
  let res: any
  try { res = await parseFile(f, src, { language: "cpp" }) } catch (e: any) { dump[rel] = { error: String(e?.message ?? e) }; continue }
  dump[rel] = {
    symbols: (res.symbols ?? []).map((s: any) => `${s.kind}|${s.name}|${s.ownerName ?? ""}|${s.range?.startLine ?? 0}`),
    rels: (res.relationships ?? []).map((r: any) => `${r.type}|${r.source}|${r.target}|${r.line_number ?? 0}`),
    exports: (res.exports ?? []).map((e: any) => `${e.kind}|${e.name}`),
  }
}
writeFileSync(out, JSON.stringify(dump))
console.log(`files=${files.length} → ${out}`)
