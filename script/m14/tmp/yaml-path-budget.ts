// Pick the qualified-name budget from a measurement instead of from taste.
// Reports the distribution of emitted qualifiedName length and nesting depth over the
// eight pinned corpora, plus the count of ids that would collide under any cap.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"
const REPOS = ["grails-core", "docker", "ansible", "kubernetes", "terraform", "openapi-spec", "helm", "gh-cli"]
const PER_REPO = Number(process.env.YAML_F8_PER_REPO ?? 250)

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 14) return
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else if (/\.(ya?ml)$/i.test(e.name)) out.push(p)
  }
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-yaml.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const mod: any = await import(path.join(ROOT, "src/ast/real-yaml-analyzer.ts"))

  const lengths: number[] = []
  const depths: number[] = []
  const perFileMax: Array<{ file: string; maxLen: number; maxDepth: number; symbols: number }> = []
  let dupIdFiles = 0
  let totalSymbols = 0
  let totalDupIds = 0

  for (const r of REPOS) {
    const files: string[] = []
    walk(path.join(CORPUS_ROOT, r), files)
    files.sort()
    let n = 0
    for (const f of files) {
      if (n >= PER_REPO) break
      let content: string
      try { content = fs.readFileSync(f, "utf8") } catch { continue }
      if (content.length > 4_000_000) continue
      n++
      const t = parser.parse(content)
      if (!t?.rootNode) continue
      const res: any = await new mod.RealYamlAnalyzer().analyze(t.rootNode, content, f)
      let maxLen = 0, maxDepth = 0
      const ids: string[] = []
      for (const s of res.symbols ?? []) {
        const q = String(s.qualifiedName ?? s.id ?? "")
        ids.push(q)
        lengths.push(q.length)
        const d = (q.match(/\./g) ?? []).length
        depths.push(d)
        if (q.length > maxLen) maxLen = q.length
        if (d > maxDepth) maxDepth = d
      }
      totalSymbols += ids.length
      const uniq = new Set(ids)
      const dups = ids.length - uniq.size
      if (dups > 0) { dupIdFiles++; totalDupIds += dups }
      perFileMax.push({ file: path.relative(CORPUS_ROOT, f), maxLen, maxDepth, symbols: ids.length })
    }
  }

  const pct = (arr: number[], p: number) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0 }
  console.log(JSON.stringify({
    totalSymbols,
    filesWithDuplicateIds: dupIdFiles,
    totalDuplicateIds: totalDupIds,
    qualifiedNameLength: { p50: pct(lengths, 50), p90: pct(lengths, 90), p99: pct(lengths, 99), p999: pct(lengths, 99.9), max: Math.max(...lengths), over120: lengths.filter((l) => l > 120).length, over200: lengths.filter((l) => l > 200).length, over400: lengths.filter((l) => l > 400).length },
    dotDepth: { p50: pct(depths, 50), p90: pct(depths, 90), p99: pct(depths, 99), p999: pct(depths, 99.9), max: Math.max(...depths), over20: depths.filter((d) => d > 20).length, over40: depths.filter((d) => d > 40).length, over80: depths.filter((d) => d > 80).length },
    worstFilesByLength: [...perFileMax].sort((a, b) => b.maxLen - a.maxLen).slice(0, 10),
    worstFilesByDepth: [...perFileMax].sort((a, b) => b.maxDepth - a.maxDepth).slice(0, 10),
  }, null, 1))
}
main()
