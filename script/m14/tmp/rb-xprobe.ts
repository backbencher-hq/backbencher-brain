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
  B1_endless: `def double(x) = x * 2
def fetch = client.get
`,
  B2_numbered_it: `items.each { process(_1) }
items.each { process(it) }
`,
  B3_defined: `def m(x)
  return 1 if defined?(Foo)
  return 2 if defined?(bar)
end
`,
  B4_for_retry_undef: `for x in [1, 2]
  puts x
end
def m
  retry
rescue
  undef helper
end
`,
  B5_safenav: `def m(user)
  name = user&.profile&.name
  user&.save!
end
`,
  B6_struct_data: `Point = Struct.new(:x, :y)
origin = Point.new(0, 0)
Cfg = Data.define(:host, :port)
`,
  B7_autoload: `autoload :JsonParser, "json/parser"
autoload :Helper, helper_path
`,
  B8_module_function: `module M
  module_function
  def helper = 1
  module_function :other
end
`,
  B9_attr_string: `class A
  attr_reader "name", :age
  def m = name
end
`,
  B10_super_calls: `class B < A
  def m(x)
    super
    super(x, 1)
    super()
  end
end
`,
}
async function main() {
  const which = process.argv[2]
  for (const [name, src] of Object.entries(CASES)) {
    if (which && name !== which) continue
    const root = await parseSrc(src)
    const r: any = await new RealRubyAnalyzer().analyze(root, src, "x.rb")
    const rels = (r.relationships ?? []).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)
    const syms = (r.symbols ?? []).map((s: any) => `${s.name}:${s.kind}`)
    console.log(`=== ${name} err=${root.hasError}\n  syms: ${JSON.stringify(syms)}\n  rels: ${JSON.stringify(rels)}\n  imports: ${JSON.stringify((r.imports ?? []).map((i: any) => i.module))}`)
  }
}
main()
