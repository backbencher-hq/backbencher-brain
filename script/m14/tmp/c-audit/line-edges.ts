/**
 * C audit probe: print EVERY relationship the analyzer emits on one source line,
 * with the metadata that identifies which branch produced it.
 *
 *   bun run script/m14/tmp/c-audit/line-edges.ts <file> <line> [<line> ...]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const file = process.argv[2]
const lines = process.argv.slice(3).map(Number)

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))

const src = fs.readFileSync(file, "utf8")
const res: any = (new RealCAnalyzer() as any).analyze(parser.parse(src).rootNode, src, file)
const srcLines = src.split("\n")
const want = new Set(lines)
for (const l of [...want].sort((a, b) => a - b)) console.log(`\n=== line ${l} ===\n  | ${srcLines[l - 1]}`)
for (const r of res.relationships ?? []) {
  const ln = (r as any).line_number
  if (typeof ln !== "number" || !want.has(ln)) continue
  const md = (r.metadata as any) ?? {}
  console.log(
    `  ${ln}  ${r.type.padEnd(11)} ${String(r.source).padEnd(28)} -> ${String(r.target).padEnd(22)} ` +
      `rt=${md.relationshipType ?? "-"} nodeType=${md.nodeType ?? "-"} conf=${r.confidence}`,
  )
}
console.log(`\ntotal relationships in file: ${(res.relationships ?? []).length}`)
