// ER2 restoration / F6 enrolment probe: which node type does the pinned erlang
// grammar emit for each include form? The F6 gate's `uncovered` list named
// `pp_include_lib` against the analyzer, so this measures whether the fixture
// can even PRODUCE it — a spec-declared type no fixture shape can trigger would
// be a fixture gap that no fixture can close, which is a different finding from
// an untested branch.
//
// Run: bun script/m14/tmp/erlang-er2-include-shapes.ts
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

const FORMS: [string, string][] = [
  ["include", `-module(m1).\n-include("a.hrl").\n`],
  ["include_lib", `-module(m2).\n-include_lib("kernel/include/file.hrl").\n`],
  ["pp_include", `-module(m3).\n-ifdef(FOO).\n-include("a.hrl").\n-endif.\n`],
  ["pp_include_lib", `-module(m4).\n-ifdef(FOO).\n-include_lib("kernel/include/file.hrl").\n-endif.\n`],
  ["bare_include", `-module(m5).\n-include(a.hrl).\n`],
]

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm")))

  for (const [name, src] of FORMS) {
    const tree = parser.parse(src)
    const types: string[] = []
    const stack = [tree.rootNode]
    while (stack.length) {
      const n: any = stack.pop()!
      types.push(n.type)
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
    const includey = [...new Set(types)].filter((t) => t.includes("include"))
    console.log(`${name.padEnd(16)} hasError=${tree.rootNode.hasError} include-types=[${includey.join(", ")}]`)
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
