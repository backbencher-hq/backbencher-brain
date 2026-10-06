import { readFileSync } from "node:fs"
import { RealRustAnalyzer } from "../../src/ast/real-rust-analyzer"
import * as path from "node:path"
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => "$HOME/backbencher-brain/node_modules/web-tree-sitter/tree-sitter.wasm" })
const p = new WSP()
p.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-rust.wasm"))))
const file = process.argv[2]
const src = readFileSync(file, "utf8")
const tree = p.parse(src)
const a = new RealRustAnalyzer()
const r: any = a.analyze(tree.rootNode as any, src, file)
for (const rel of r.relationships) {
  if (["imports", "exports", "overrides"].includes(String(rel.type))) {
    console.log(`${rel.type}\t${rel.source} -> ${rel.target}\tline=${rel.line_number}\tconf=${rel.confidence}\tmeta=${JSON.stringify(rel.metadata)}`)
  }
}
