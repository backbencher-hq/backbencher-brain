import * as fs from "fs"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-ruby.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealRubyAnalyzer()

  const run = (name: string, lines: string[]) => {
    const source = lines.join("\n") + "\n"
    const tree = parser.parse(source)
    const res: any = az.analyze(tree.rootNode, source, "probe.rb")
    process.stdout.write("=== " + name + " (parseError=" + (tree.rootNode as any).hasError + ") ===\n")
    process.stdout.write("rel: " + JSON.stringify((res.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
    process.stdout.write("fw: " + JSON.stringify(res.metadata?.detectedFrameworks) + " lines: " + JSON.stringify((res.symbols ?? []).filter((s: any) => ["foo", "target"].includes(s.name)).map((s: any) => s.name + "@" + s.range?.startLine)) + "\n")
  }

  run("write+read", [
    "class W",
    "  def initialize",
    "    @x = 0",
    "  end",
    "  def set(v)",
    "    @x = v",
    "  end",
    "  def get",
    "    @x",
    "  end",
    "end",
  ])
  run("chain+dup+string", [
    "class C",
    "  def read",
    "    inner.deeper.leaf",
    "  end",
    "  def foo",
    "    1",
    "  end",
    "  def foo",
    "    2",
    "  end",
    "  def go",
    "    log('save')",
    "  end",
    "  def log(m)",
    "  end",
    "end",
  ])
  run("rails", [
    "require 'rails'",
    "class App < Rails::Application",
    "end",
  ])
}
main().catch((e) => { console.error(e); process.exit(1) })
