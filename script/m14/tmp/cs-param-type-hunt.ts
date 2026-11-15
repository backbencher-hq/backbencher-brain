// script/m14/tmp/cs-param-type-hunt.ts — which parameter shapes reach the
// `pType` fallback (M60.R7's registered csharp site), and how often does that
// happen on the pinned corpus? Both answers are needed before paying the site
// down: the branch must be reachable enough to pin in a fixture, and its real
// frequency decides whether the paydown can move anything measurable.
import * as fs from "fs"
import * as path from "path"

async function main() {
  const ROOT = process.cwd()
  const { RealCSharpAnalyzer } = await import(path.join(ROOT, "src/ast/real-csharp-analyzer"))
  const a = new RealCSharpAnalyzer()
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P()
  p.setLanguage(LANG)

  const cases: Array<[string, string]> = [
    ["missing param name", `class C { void M(Widget) { } }`],
    ["function pointer", `class C { unsafe void M(delegate*<int, void> cb) { } }`],
    ["generic fn pointer", `class C { unsafe void M(delegate* unmanaged[Cdecl]<int, void> cb) { } }`],
    ["error param", `class C { void M(int a, ) { } }`],
    ["two names", `class C { void M(int a, b) { } }`],
    ["var param", `class C { void M(var x) { } }`],
    ["scoped ref", `class C { void M(scoped ref int x) { } }`],
    ["empty parens", `class C { void M() { } }`],
    ["params array", `class C { void M(params string[] a) { } }`],
    ["tuple type", `class C { void M((int, string) t) { } }`],
  ]
  for (const [label, src] of cases) {
    const root = p.parse(src).rootNode
    const res: any = await a.analyze(root, src, "x.cs")
    const m = (res.symbols ?? []).find((s: any) => s.kind === "method" || s.kind === "constructor")
    console.log(`[${label.padEnd(18)}] params=${JSON.stringify(m?.parameters)} name=${m?.name}`)
  }

  // Corpus frequency: how many parameters publish the placeholder today?
  const dir = "/home/ishaq2321/bb_tests/repositories/powershell"
  const files: string[] = []
  const stack = [dir]
  while (stack.length && files.length < 400) {
    const d = stack.pop()!
    for (const e of fs.readdirSync(d).sort()) {
      const fp = path.join(d, e)
      let st
      try { st = fs.statSync(fp) } catch { continue }
      if (st.isDirectory()) stack.push(fp)
      else if (e.endsWith(".cs") && st.size > 0) files.push(fp)
      if (files.length >= 400) break
    }
  }
  let params = 0
  let unknownTypes = 0
  const samples: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const root = p.parse(src).rootNode
    const res: any = await a.analyze(root, src, f)
    for (const s of res.symbols ?? []) {
      for (const par of s.parameters ?? []) {
        params++
        if (par.type === undefined || par.type === null || par.type === "unknown") {
          unknownTypes++
          if (samples.length < 6) samples.push(`${path.basename(f)}:${s.name}(${par.name}:${JSON.stringify(par.type)})`)
        }
      }
    }
  }
  console.log(`\ncorpus: ${files.length} files, ${params} published parameters, ${unknownTypes} with no usable type`)
  for (const s of samples) console.log(`   ${s}`)
}

main()
