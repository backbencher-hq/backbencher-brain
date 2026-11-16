// #868: the javascript decorator-metadata layer. Before writing anything, measure
// what TYPESCRIPT emits for the identical source — the JS fix must mirror the
// measured family target, not a remembered one.
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"

const SRC = [
  "function sealed(target) { return target }", // 1
  "function inject(name) { return () => undefined }", // 2
  "", // 3
  "@sealed", // 4
  "class Service {", // 5
  '  @inject("db")', // 6
  "  pool = 1", // 7
  "", // 8
  "  @sealed", // 9
  "  method() {}", // 10
  "}", // 11
  "", // 12
  "const s = new Service()", // 13
  "s.method()", // 14
].join("\n") + "\n"

async function parseWith(wasm: string, file: string) {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const fs = await import("node:fs")
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", wasm)))
  const parser = new P()
  parser.setLanguage(grammar)
  return { tree: parser.parse(SRC), file }
}

async function dump(label: string, modPath: string, wasm: string, ext: string, className: string) {
  const { tree, file } = await parseWith(wasm, `S${ext}`)
  const mod: any = await import(path.join(ROOT, modPath))
  const analyzer = new mod[className]()
  const res = await analyzer.analyze(tree.rootNode, SRC, file)
  console.log(`===== ${label} =====`)
  console.log("--- symbols ---")
  for (const s of res.symbols ?? []) {
    console.log(`   L${s.range?.startLine}->${s.range?.endLine} ${String(s.kind).padEnd(9)} ${s.name} owner=${s.ownerName ?? "-"} decorators=${JSON.stringify(s.decorators ?? [])} meta.decoratorLines=${JSON.stringify(s.metadata?.decoratorLines ?? null)}`)
  }
  console.log("--- relationships ---")
  for (const r of res.relationships ?? []) {
    const m = r.metadata ?? {}
    console.log(`   L${r.line_number} ${String(r.type).padEnd(11)} ${r.source} -> ${r.target} meta=${JSON.stringify(m)}`)
  }
  console.log("")
}

async function main() {
  await dump("TYPESCRIPT (target)", "src/ast/real-typescript-analyzer.ts", "tree-sitter-typescript.wasm", ".ts", "RealTypeScriptAnalyzer")
  await dump("JAVASCRIPT (current)", "src/ast/real-javascript-analyzer.ts", "tree-sitter-javascript.wasm", ".js", "RealJavaScriptAnalyzer")
}
main()
