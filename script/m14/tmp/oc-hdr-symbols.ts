// script/m14/tmp/oc-hdr-symbols.ts — dump what the analyzer publishes for ONE file,
// next to the declarations the source text actually contains (independent of it).
// Usage: bun script/m14/tmp/oc-hdr-symbols.ts <path> [more paths...]
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"

async function main() {
  const files = process.argv.slice(2)
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-objc.wasm")))
  const ocmod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer"))

  for (const rel of files) {
    const abs = rel.startsWith("/") ? rel : path.join(CORPUS, rel)
    const src = fs.readFileSync(abs, "utf8")
    const p = new P(); p.setLanguage(lang)
    const root = p.parse(src).rootNode
    const r: any = await new ocmod.RealObjectiveCAnalyzer().analyze(root, src, abs)
    const lines = src.split("\n")
    const declLines = lines.map((l, i) => [i + 1, l] as const).filter(([, l]) => /^\s*[@+-]|@property|@interface|@protocol|@implementation/.test(l))
    console.log(`\n=== ${rel} ===`)
    console.log(`source: ${lines.length} lines, hasError=${root.hasError}`)
    console.log(`analyzer: ${(r.symbols ?? []).length} symbols, ${(r.relationships ?? []).length} relationships`)
    console.log(`declaration-shaped source lines: ${declLines.length}`)
    console.log("  --- analyzer symbols (first 25) ---")
    for (const s of (r.symbols ?? []).slice(0, 25)) console.log(`    ${s.kind.padEnd(11)} ${s.ownerName ? s.ownerName + "." : ""}${s.name}`)
    console.log("  --- source declaration lines (first 25) ---")
    for (const [n, l] of declLines.slice(0, 25)) console.log(`    ${String(n).padStart(4)} | ${l.trim().slice(0, 100)}`)
  }
}
main()
