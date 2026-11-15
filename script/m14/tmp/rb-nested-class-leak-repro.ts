// Ruby oracle vs analyzer — the nested-class leak in the implicit-override derivation.
//
// Diagnosed by reading `deriveRubyEdges`'s override pass (script/m14/differential.ts ~6840-6940 and
// the pairing at ~7300) after rack's `test/spec_request.rb` produced hard rows whose truth named
// `RackRequestTest.query_parser` / `RackRequestTest.delegate?` / `RackRequestTest.initialize` while
// the analyzer named `Spec.*` / `Request.*`. Mechanism, as this probe proves it:
//
//   `collectDecls` takes a `class` node, finds its `body_statement`, and walks EVERY descendant of
//   that body collecting `method` nodes — it does not stop at a NESTED `class` (which has its own
//   frame and its own name). So the enclosing class's method set contains the nested class's
//   methods, the pairing then sees a method the enclosing class never redeclared, and the truth
//   emits an `overrides` edge the analyzer (which tracks owner frames per class body) never emits.
//
// The rack file has exactly that shape at line 2489 (`class TestProxyRequest < RackRequestTest`
// containing `class DelegateRequest`), which is why the truth invented a base the source never
// re-opened. Cases below: A is the leak, C is the control that must stay, B is the factory-block
// shape (`c = Class.new(Base) do ... end` with a LOCAL variable) that the analyzer attributes to the
// ENCLOSING owner by contract — so the fix must NOT silence it while it silences A.
//
// Run: bun script/m14/tmp/rb-nested-class-leak-repro.ts
import * as fs from "fs"
import * as path from "path"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}

const CASES: { name: string; why: string; src: string }[] = [
  {
    name: "A — nested class leaks into the enclosing class",
    why: "the nested class's method is NOT the enclosing class's redeclaration: truth must emit nothing, analyzer emits nothing",
    src: `class Base
  def query; end
end
class Outer < Base
  class Inner
    def query; end
  end
end
`,
  },
  {
    name: "B — factory block with a LOCAL variable (control that must survive the fix)",
    why: "the analyzer attributes a lowercase-assigned Class.new block's members to the ENCLOSING owner, so this lease is contract-faithful; measure both sides rather than assume",
    src: `class Base
  def make; end
end
class Outer < Base
  c = Class.new(Base) do
    def make; end
  end
end
`,
  },
  {
    name: "C — control: the subclass really redeclares the method",
    why: "both sides must emit overrides Base.query (the contract the leak abuses)",
    src: `class Base
  def query; end
end
class Outer < Base
  def query; end
end
`,
  },
]

async function main() {
  const mod: any = await import("../../../script/m14/differential")
  let problems = 0
  for (const c of CASES) {
    const root = await parseSrc(c.src)
    const analyzer: any = await new RealRubyAnalyzer().analyze(root, c.src, "x.rb")
    // The comparison is on the TARGET (and label), not on the analyzer's source: the oracle's
    // contract publishes `from: "(expr)"` for ruby overrides — the differential pairs label+target,
    // because the question is "which qualified method is being overridden", never "who said it".
    const analyzerOverrides = (analyzer.relationships ?? [])
      .filter((x: any) => String(x.type).toLowerCase() === "overrides")
      .map((x: any) => `${x.target}`).sort()
    const oracleOverrides = (mod.deriveRubyEdges(root) as any[])
      .filter((x: any) => x.label === "overrides")
      .map((x: any) => `${x.target}`).sort()
    console.log(`\n=== ${c.name}`)
    console.log(`    ${c.why}`)
    console.log(`  analyzer targets: ${analyzerOverrides.length ? analyzerOverrides.join(", ") : "(none)"}`)
    console.log(`  oracle   targets: ${oracleOverrides.length ? oracleOverrides.join(", ") : "(none)"}`)
    const agree = JSON.stringify(analyzerOverrides) === JSON.stringify(oracleOverrides)
    console.log(`  → ${agree ? "AGREE" : "DISAGREE"}`)
    if (!agree) problems++
    if (root.hasError) console.log("  (parse error in fixture!)")
  }
  console.log(`\n${problems} of ${CASES.length} case(s) disagree — the fix must make A agree while leaving B and C as measured.`)
}
main()
