// #924 node types — the last measurement the fix needs: WHICH grammar node carries the name.
//
// `c924-node-shapes.ts` proves five minimal snippets reproduce all five mechanisms through the
// production entry; `parseFile` does not expose the tree, so this probe parses the same snippets
// with web-tree-sitter directly and prints, for every node whose text carries quoting syntax or
// whitespace, the node type, its ancestor chain, and the FIELD name its parent reaches it by.
// That is what decides the patch: strip inside the text of an existing identifier node, or descend
// to a different node / field.
//
// Read-only. Run: bun script/m14/tmp/c924-node-types.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CASES: { lang: string; wasm: string; what: string; src: string; needles: string[] }[] = [
  {
    lang: "kotlin", wasm: "tree-sitter-kotlin.wasm",
    what: "backticked function name; a call chain as a `uses` target",
    src: "class T {\n  fun `test char column read and write`() {\n    assertEquals(1, dest.selectAll().where { dest.id eq 1 }.single()[dest.id].value)\n  }\n}\n",
    needles: ["`test char column read and write`", "dest.selectAll().where"],
  },
  {
    lang: "scala", wasm: "tree-sitter-scala.wasm",
    what: "backticked def name; anonymous class parent expression",
    src: "class T {\n  @Test def `object` = { assertEquals(1, 1) }\n  def f = new ScalaRandom(Applicative.pure(new JavaSecureRandom())) with SecureRandom\n}\n",
    needles: ["`object`", "ScalaRandom(Applicative"],
  },
  {
    lang: "zig", wasm: "tree-sitter-zig.wasm",
    what: "the @\"…\" sigil on a declaration and on a field access",
    src: "fn @\"weird function name\"() i32 {\n    return 1;\n}\ntest \"x\" {\n    _ = @TypeOf(a.foo).@\"fn\".return_type;\n}\n",
    needles: ["@\"weird function name\"", "@\"fn\""],
  },
  {
    lang: "haskell", wasm: "tree-sitter-haskell.wasm",
    what: "an instance head whose type application becomes the published class name",
    src: "instance (GArbitrarySum f, i ~ D) => GArbitrary (M1 i c f) where\n  gArbitrary = undefined\n",
    needles: ["M1 i c"],
  },
  {
    lang: "elixir", wasm: "tree-sitter-elixir.wasm",
    what: "a definition head split across lines by a comment",
    src: "defmodule M do\n  defp f([char | rest], counter)\n       # 7..13 is the range. 32..126 are ASCII printables.\n       when is_integer(char) and char >= 7 do\n    f(rest, counter)\n  end\nend\n",
    needles: ["# 7..13"],
  },
]

async function parser(lang: string, wasm: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const language: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", wasm)))
  const p = new P()
  p.setLanguage(language)
  return p
}

const flat = (s: string) => String(s).replace(/\s+/g, " ")

for (const c of CASES) {
  console.log(`\n=== ${c.lang} — ${c.what}`)
  let tree: any
  try {
    const p = await parser(c.lang, c.wasm)
    tree = p.parse(c.src)
  } catch (e: any) { console.log(`  parse threw: ${e?.message ?? e}`); continue }
  const root = tree.rootNode
  console.log(`  tree hasError=${root.hasError}`)
  for (const needle of c.needles) {
    // The SMALLEST node whose text is/contains the needle: walk down from the root.
    let best: any = null
    const stack = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (flat(n.text).includes(needle)) {
        if (!best || n.endIndex - n.startIndex < best.endIndex - best.startIndex) best = n
        for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
      }
    }
    if (!best) { console.log(`  ${JSON.stringify(needle)}: NOT FOUND in the tree`); continue }
    const chain: string[] = []
    let p = best
    for (let d = 0; d < 5 && p; d++) {
      // The field the parent reaches this child by (tree-sitter exposes fieldNameForChild).
      const idx = p.parent ? [...Array(p.parent.childCount).keys()].find((i) => p.parent.child(i)?.id === p.id) : null
      const field = p.parent && idx != null && typeof p.parent.fieldNameForChild === "function" ? p.parent.fieldNameForChild(idx) : null
      chain.push(`${p.type}${field ? `:${field}` : ""}(${p.namedChildCount}c${p.childCount - p.namedChildCount > 0 ? `,${p.childCount - p.namedChildCount}tok` : ""})`)
      p = p.parent
    }
    console.log(`  ${JSON.stringify(needle)} -> <${best.type}> text=${JSON.stringify(flat(best.text).slice(0, 60))}`)
    console.log(`      chain (leaf -> root): ${chain.join("  <-  ")}`)
    const kids = [...Array(best.childCount).keys()].map((i) => {
      const ch = best.child(i)
      const f = typeof best.fieldNameForChild === "function" ? best.fieldNameForChild(i) : null
      return `${ch?.type}${f ? `:${f}` : ""}=${JSON.stringify(flat(ch?.text ?? "").slice(0, 26))}`
    })
    console.log(`      children: ${kids.join(" | ")}`)
  }
}
