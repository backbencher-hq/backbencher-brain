import * as fs from "fs"
import * as path from "path"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-ruby.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
const CASES: Record<string, string> = {
  C1_endless_singleton: `class A\n def self.build = new\nend\n`,
  C2_defined_complex: `def m(x)\n y = 1 if defined?(x.foo(Bar))\n z = 2 if defined?(@cfg)\nend\n`,
  C3_undef_multi: `class A\n def a; end\n def b; end\n undef a, b\nend\n`,
  C4_struct_block: `Point = Struct.new(:x) do\n def magnitude\n Math.sqrt(x*x)\n end\nend\n`,
  C5_classnew_base: `Klass = Class.new(Base)\nMod = Module.new\n`,
  C6_interp_heredoc: `def m(name)\n msg = "hello #{name.upcase}, #{1 + 1}"\n doc = <<~TEXT\n dear #{name},\nTEXT\n re = /x#{name}y/\n arr = %W[a #{name} b]\nend\n`,
  C7_begin_end: `BEGIN { setup_all }\nEND { teardown_all }\n`,
  C8_throw_catch: `def m(x)\n catch(:done) do\n throw :done if x.nil?\n end\nend\n`,
  C9_for_shadow: `def total\n sum = 0\n for x in [1, 2]\n sum += x\n end\n sum\nend\ndef other\n x\nend\n`,
  C10_redo_next: `def m(items)\n items.each do |i|\n next if i.nil?\n redo if i < 0\n break if done\n end\nend\n`,
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  const which = process.argv[2]
  for (const [name, src] of Object.entries(CASES)) {
    if (which && name !== which) continue
    const root = await parseSrc(src)
    const r: any = await new RealRubyAnalyzer().analyze(root, src, "x.rb")
    const ana = (r.relationships ?? []).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)
    const tru = mod.deriveRubyEdges(root).map((x: any) => `${x.label}[${x.from}->${x.target}]`)
    const anaS = new Set(ana.map((s: string) => s.replace(/^[a-z]+\[Global->/, "X[").replace(/^[a-z]+\[[^->]+->/, "X[")))
    const truS = new Set(tru.map((s: string) => s.replace(/^[a-z]+\[\(expr\)->/, "X[")))
    const miss = [...truS].filter((x) => ![...anaS].some((a) => a === x || (a as string).includes(x as string) || (x as string).includes(a as string)))
    const unexpl = [...anaS].filter((a) => ![...truS].some((x) => a === x || (a as string).includes(x as string) || (x as string).includes(a as string)))
    console.log(`=== ${name} err=${root.hasError}\n  MISSING: ${JSON.stringify(miss)}\n  UNEXPLAINED: ${JSON.stringify(unexpl)}`)
  }
}
main()
