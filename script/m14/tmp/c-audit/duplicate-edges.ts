/**
 * C audit probe: dump the SAME-SITE duplicate edges the census counts.
 *
 * The census reports a duplicate as "a second (source, type, target) edge carrying
 * a line an earlier identical edge already carried". This probe prints those edges
 * with their file, line and metadata so each one can be looked at by hand -- a
 * count is a question, the edges are the evidence.
 *
 *   bun run script/m14/tmp/c-audit/duplicate-edges.ts --dir <corpus dir> [--limit N]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const DIR = arg("dir", "/home/sano/ishaq/bb_tests/repositories/redis/src")
const LIMIT = Number(arg("limit", "40"))
const MAX_FILES = Number(arg("max-files", "200"))

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))

const files: string[] = []
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === ".git") continue
    const full = path.join(d, e.name)
    if (e.isDirectory()) walk(full)
    else if (e.name.endsWith(".c") && files.length < MAX_FILES) files.push(full)
  }
}
walk(DIR)

const rows: any[] = []
const perFileCounts: Record<string, number> = {}
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const res: any = (new RealCAnalyzer() as any).analyze(parser.parse(src).rootNode, src, f)
  const seen = new Set<string>()
  const local: any[] = []
  for (const r of res.relationships ?? []) {
    const ln = (r as any).line_number
    const key = `${r.source}|${r.type}|${r.target}@${typeof ln === "number" ? ln : "none"}`
    if (seen.has(key)) {
      local.push({
        file: path.relative(DIR, f),
        line: ln,
        type: r.type,
        source: r.source,
        target: r.target,
        relType: (r.metadata as any)?.relationshipType,
        nodeType: (r.metadata as any)?.nodeType,
        sourceText: src.split("\n")[((ln ?? 1) as number) - 1]?.trim().slice(0, 110),
      })
    }
    seen.add(key)
  }
  if (local.length) {
    perFileCounts[path.relative(DIR, f)] = local.length
    rows.push(...local)
  }
}

const byRelType: Record<string, number> = {}
for (const r of rows) {
  const k = `${r.type}/${r.relType}/${r.nodeType ?? "-"}`
  byRelType[k] = (byRelType[k] ?? 0) + 1
}
console.log(`files scanned: ${files.length}; files with same-site duplicates: ${Object.keys(perFileCounts).length}`)
console.log(`total same-site duplicate edges: ${rows.length}`)
console.log("by class:", JSON.stringify(byRelType, null, 1))
console.log("worst files:", JSON.stringify(Object.entries(perFileCounts).sort((a, b) => b[1] - a[1]).slice(0, 12), null, 1))
console.log("\n--- first 30 ---")
for (const r of rows.slice(0, LIMIT)) {
  console.log(`${r.file}:${r.line} ${r.type}/${r.relType} [node=${r.nodeType}] ${r.source} -> ${r.target}`)
  console.log(`    | ${r.sourceText}`)
}
