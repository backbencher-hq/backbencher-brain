// Print exact trees for the surprising failures, fresh parser each case.
import { ASTEngine } from "../../../src/ast/engine"

const CASES: Array<[string, string]> = [
  ["parens-two-maps", "foo(group: 'a', module: 'b')\n"],
  ["parens-two-maps-int", "foo(a: 1, b: 2)\n"],
  ["parens-one-map", "foo(a: 1)\n"],
  ["parens-two-maps-real", "configurations.all {\n  exclude(group: 'a', module: 'b')\n}\n"],
  ["parens-map-then-pos", "foo(a: 1, 'x')\n"],
  ["parens-pos-then-map", "foo('x', a: 1)\n"],
  ["parens-three-maps", "foo(a: 1, b: 2, c: 3)\n"],
]

async function main(): Promise<void> {
  for (const [name, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const tree = parser.parse(src)
    console.log(`\n### ${name}  ${JSON.stringify(src)}`)
    console.log(tree?.rootNode.toString() ?? "NULL")
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
