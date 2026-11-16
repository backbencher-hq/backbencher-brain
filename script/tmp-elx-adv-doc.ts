// tmp-elx-adv-doc.ts — measured doc-channel evidence: does a @doc staged
// INSIDE a quote block attach to a definition outside it (wrong symbol)?
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
const parser = new ParserClass()
parser.setLanguage(g)
const mod: any = await import("../src/ast/real-elixir-analyzer")
const analyzer = new mod.RealElixirAnalyzer()

const files = [
  "<corpus-root>/bb_tests/repositories/elixir/lib/elixir/lib/supervisor.ex",
  "<corpus-root>/bb_tests/repositories/elixir/lib/elixir/lib/gen_event.ex",
  "<corpus-root>/bb_tests/repositories/phoenix/lib/phoenix/router/helpers.ex",
]
for (const fp of files) {
  const src = fs.readFileSync(fp, "utf8")
  const res: any = analyzer.analyze(parser.parse(src).rootNode, src, fp)
  console.log(`\n══════ ${fp.replace(/^.*repositories\//, "")} ══════`)
  for (const s of res.symbols) {
    if (!s.comments) continue
    const doc = JSON.stringify(String(s.comments[0]).replace(/\s+/g, " ").trim().slice(0, 80))
    console.log(`  [${s.kind}] ${s.name} L${s.range?.startLine} doc=${doc}`)
  }
}
process.exit(0)
