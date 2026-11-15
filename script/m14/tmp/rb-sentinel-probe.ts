// script/m14/tmp/rb-sentinel-probe.ts — probe for the R7 placeholder sites in the
// ruby analyzer (`source: owner || "unknown"`, four sites, register entry
// real-ruby-analyzer.ts/or-fallback/source x4).
//
// Question this answers, with measurements and not opinion: WHICH ruby shapes
// reach the `|| "unknown"` fallback, and what does the truthful attribution look
// like alongside them (a class-level control for each top-level case)?
//
// Run: bun script/m14/tmp/rb-sentinel-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-ruby.wasm")))
  const p = new P()
  p.setLanguage(LANG)
  return p.parse(src).rootNode
}

const CASES: Record<string, string> = {
  "top-level alias": `alias new_name old_name\n`,
  "class-level alias": `class Acct\n  alias fresh stale\nend\n`,
  "top-level alias_method": `alias_method :a, :b\n`,
  "class-level alias_method": `class Acct\n  alias_method :a, :b\nend\n`,
  "top-level include": `include Comparable\n`,
  "class-level include": `class Acct\n  include Comparable\nend\n`,
  "top-level extend": `extend Helpers\n`,
  "class-level extend": `class Acct\n  extend Helpers\nend\n`,
  "top-level has_many": `has_many :widgets\n`,
  "class-level has_many": `class Acct\n  has_many :widgets\nend\n`,
  "dynamic class factory with association": `Widget = Class.new do\n  has_many :parts\nend\n`,
  "singleton class with alias": `class Acct\n  class << self\n    alias fresh stale\n  end\nend\n`,
  "module-level include": `module M\n  include Comparable\nend\n`,
}

async function main() {
  for (const [name, src] of Object.entries(CASES)) {
    const root = await parseSrc(src)
    const r: any = await new RealRubyAnalyzer().analyze(root, src, "probe.rb")
    const rels: any[] = r.relationships ?? []
    const placeholder = rels.filter((x) => String(x.source) === "unknown" || x.source === "<unknown>")
    const summary = rels.map((x) => `${x.type}:${x.source ?? "(absent)"}->${x.target}`)
    console.log(`\n=== ${name}`)
    console.log(`    relationships: ${JSON.stringify(summary)}`)
    console.log(`    placeholder-sourced: ${placeholder.length}${placeholder.length ? "  <-- FIRES" : ""}`)
    const syms: any[] = r.symbols ?? []
    if (syms.length) console.log(`    symbols: ${JSON.stringify(syms.map((s) => `${s.kind}:${s.name}${s.ownerName ? "@" + s.ownerName : ""}`))}`)
  }
}

main()
