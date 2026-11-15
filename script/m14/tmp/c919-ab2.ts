// #919 A/B dump (bounded): the same output shape as c919-ab.ts, but the file
// list is MARKER-FIRST — every file writing a macro-heading marker is included,
// then a deterministic slice of the rest, capped per repo — so the pre/post
// comparison covers the whole class without walking 5k files twice.
//   bun script/m14/tmp/c919-ab2.ts <out.json> [repo ...]
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const out = process.argv[2]
const REPOS = process.argv.slice(3).length ? process.argv.slice(3) : ["fmt", "nlohmann-json"]
const CAP = 300
const MARKER = /\b(TEST_CASE|TEST_F|TEST|SECTION|SUBCASE|SCENARIO|GIVEN|WHEN|BOOST_AUTO_TEST_CASE|JSON_|NLOHMANN)\b/
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))

const dump: Record<string, any> = {}
let total = 0
for (const repo of REPOS) {
  const files: string[] = []
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
  files.sort()
  const marked: string[] = []
  const rest: string[] = []
  for (const f of files) {
    try {
      if (statSync(f).size > 700_000) continue
      const s = readFileSync(f, "utf8")
      ;(MARKER.test(s) ? marked : rest).push(f)
    } catch {}
  }
  // Deterministic slice of the unmarked remainder (every Nth, not random).
  const slice: string[] = []
  const step = Math.max(1, Math.ceil(rest.length / Math.max(0, CAP - marked.length)))
  for (let i = 0; i < rest.length; i += step) slice.push(rest[i])
  const selected = [...marked, ...slice].slice(0, Math.max(CAP, marked.length))
  console.log(`[${repo}] cpp-ish=${files.length} marked=${marked.length} selected=${selected.length}`)
  for (const f of selected) {
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
    total++
  }
}
writeFileSync(out, JSON.stringify(dump))
console.log(`files=${total} → ${out}`)
