// One-shot measurement: parse the part-of-include fixture with the REAL
// analyzer (same parser path run-fixtures uses) and dump symbols +
// relationships, so the expectation file is authored from a measured run and
// the line numbers are checked against the numbered source afterwards.
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-make.wasm")))
const parser = new ParserClass()
parser.setLanguage(grammar)

const { RealMakefileAnalyzer } = await import(path.join(ROOT, "src/ast/real-makefile-analyzer"))
const an = new RealMakefileAnalyzer()
const src = readFileSync(path.join(ROOT, "validation/m14/fixtures/make/part-of-include.mk"), "utf8")
const tree = parser.parse(src)
const out: any = an.analyze(tree.rootNode, src, "validation/m14/fixtures/make/part-of-include.mk")
console.log(JSON.stringify({
  symbols: out.symbols.map((s: any) => ({ name: s.name, kind: s.kind, line: s.range?.startLine })),
  rels: out.relationships.map((r: any) => ({ type: r.type, source: r.source, target: r.target, line: r.line_number, meta: r.metadata })),
}, null, 1))
