// Which 12 files carry duplicate ids, and is it duplicate mapping keys or something else?
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"
const REPOS = ["grails-core", "docker", "ansible", "kubernetes", "terraform", "openapi-spec", "helm", "gh-cli"]
const PER_REPO = 250

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
      const ids: string[] = (res.symbols ?? []).map((s: any) => String(s.id))
      const counts = new Map<string, number>()
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
      const dups = [...counts.entries()].filter(([, c]) => c > 1)
      if (dups.length === 0) continue
      console.log(`\n=== ${path.relative(CORPUS_ROOT, f)}  (${ids.length} symbols, ${dups.length} duplicated ids) ===`)
      for (const [id, c] of dups.slice(0, 6)) {
        const rows = (res.symbols ?? []).filter((s: any) => String(s.id) === id)
        console.log(`  ${id}  x${c}  lines=[${rows.map((s: any) => s.range?.startLine).join(",")}]  kinds=[${[...new Set(rows.map((s: any) => s.kind))].join(",")}]`)
        // show the source lines to identify the shape
        const srcLines = content.split("\n")
        for (const s of rows.slice(0, 3)) {
          const ln = s.range?.startLine ?? 0
          console.log(`      L${ln}: ${JSON.stringify(srcLines[ln - 1] ?? "")}`)
        }
      }
    }
  }
}
main()
