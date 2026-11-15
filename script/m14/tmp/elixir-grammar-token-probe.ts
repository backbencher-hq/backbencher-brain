/**
 * script/m14/tmp/elixir-grammar-token-probe.ts
 *
 * What IS the one token that separates the wired elixir grammar from upstream
 * 0.3.5 (`^^`, an anonymous token the wired build carries and 0.3.5's source does
 * not contain)? Parse minimal snippets under both grammars and print the trees,
 * so the surface delta is characterized by behaviour rather than by a name.
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun.main), "..", "..", "..")
const HOME = process.env.HOME ?? ""
const GRAMMARS = [
  { label: "wired", file: path.join(ROOT, "wasm/tree-sitter-elixir.wasm") },
  { label: "upstream-0.3.5", file: path.join(HOME, ".bun/install/cache/tree-sitter-elixir@0.3.5@@@1/tree-sitter-elixir.wasm") },
]
const SNIPPETS: Array<[string, string]> = [
  ["bare-double-caret", "x = ^^y\n"],
  ["double-caret-operator", "1 ^^ 2\n"],
  ["triple-caret-operator", "1 ^^^ 2\n"],
  ["single-caret-pin", "case x do\n  ^y -> 1\nend\n"],
  ["caret-run-in-string", "s = \"^^^^\"\n"],
]

function dump(node: any, depth = 0, out: string[] = []): string[] {
  out.push(`${"  ".repeat(depth)}${node.type}${node.isNamed ? "" : " (anon)"}${node.childCount === 0 ? ` ${JSON.stringify(node.text)}` : ""}`)
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c) dump(c, depth + 1, out)
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const langs: Record<string, any> = {}
  for (const g of GRAMMARS) langs[g.label] = await Language.load(fs.readFileSync(g.file))

  for (const [name, src] of SNIPPETS) {
    console.log(`\n=== ${name}: ${JSON.stringify(src)}`)
    for (const g of GRAMMARS) {
      const p = new ParserClass()
      p.setLanguage(langs[g.label])
      const tree = p.parse(src)
      const dumpText = dump(tree.rootNode).join("\n")
      console.log(`--- ${g.label}: hasError=${tree.rootNode.hasError}`)
      console.log(dumpText.split("\n").map((l) => "    " + l).join("\n"))
      tree.delete?.()
      p.delete?.()
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
