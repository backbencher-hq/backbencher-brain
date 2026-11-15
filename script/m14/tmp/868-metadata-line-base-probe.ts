// #868 side-finding measurement: on typescript edges, `metadata.line` and the
// row's own `line_number` disagree by exactly one — is the mirror 0-based while
// every other line in the payload is 1-based? Printed against the source text.
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const SRC = [
  "function sealed(t: any) { return t }", // 1
  "", // 2
  "class Thing {}", // 3
  "", // 4
  "export function make(): Thing {", // 5
  "  return new Thing()", // 6
  "}", // 7
  "", // 8
  "export function use(): void {", // 9
  "  make()", // 10
  "}", // 11
].join("\n") + "\n"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const fs = await import("node:fs")
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)
  const tree = parser.parse(SRC)
  const mod: any = await import(path.join(ROOT, "src/ast/real-typescript-analyzer.ts"))
  const res = await mod.RealTypeScriptAnalyzer.prototype.analyze.call(new mod.RealTypeScriptAnalyzer(), tree.rootNode, SRC, "S.ts")
  console.log("source: `return new Thing()` is written on line 6, the `new` token on 6")
  for (const r of res.relationships ?? []) {
    if (r.metadata?.line === undefined) continue
    console.log(`   ${String(r.type).padEnd(11)} ${r.source} -> ${r.target}  line_number=${r.line_number} metadata.line=${r.metadata.line}  (diff=${(r.line_number ?? 0) - r.metadata.line})`)
  }
}
main()
