// M59 (#825): dump the node shape for `@Param(...) var size: Int = _` so the
// declaration-line rule can be judged from the tree instead of assumed.
import * as fs from "fs"
const F = "/home/ishaq2321/bb_tests/repositories/cats-effect/benchmarks/src/main/scala/cats/effect/benchmarks/QueueBenchmark.scala"

async function main(): Promise<void> {
  const WTS: any = await import("web-tree-sitter")
  const Parser = WTS.Parser ?? WTS.default?.Parser
  await Parser.init()
  const Language = WTS.Language ?? WTS.default?.Language
  const lang = await Language.load("/tmp/bb-wasm_tree-sitter-scala_tree-sitter-scala.wasm")
  const p = new Parser()
  p.setLanguage(lang)
  const src = fs.readFileSync(F, "utf8")
  const tree = p.parse(src)
  const root = tree.rootNode

  // Find the definition node that contains `size` on line 48.
  const found: any[] = []
  const visit = (n: any, depth: number): void => {
    if (n.startPosition.row + 1 >= 44 && n.startPosition.row + 1 <= 49) {
      const kids: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) kids.push(`${c.type}@${c.startPosition.row + 1}:${c.startPosition.column}`)
      }
      found.push({ depth, type: n.type, at: `${n.startPosition.row + 1}:${n.startPosition.column}`, end: `${n.endPosition.row + 1}:${n.endPosition.column}`, kids, text: n.text.slice(0, 45).replace(/\n/g, "\\n") })
    }
    for (let i = 0; i < n.namedChildCount; i++) visit(n.namedChild(i), depth + 1)
  }
  visit(root, 0)
  for (const f of found) {
    console.log(`${"  ".repeat(f.depth)}${f.type} ${f.at}..${f.end} :: ${JSON.stringify(f.text)}`)
    console.log(`${"  ".repeat(f.depth)}   named children: ${f.kids.join(", ")}`)
  }
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
